"use server";

import { createClient } from "@supabase/supabase-js";
import { latLngToCell, cellToLatLng, gridDistance } from "h3-js";
import clustersDbscan from "@turf/clusters-dbscan";
import centerOfMass from "@turf/center-of-mass";
import { point, featureCollection } from "@turf/helpers";
import { distance } from "@turf/distance";
import { H3_RESOLUTION } from "../h3";

/**
 * Server-only Supabase client using service role key.
 * This bypasses RLS for administrative operations.
 * NEVER expose this client to the browser.
 */
function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Server Supabase client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, serviceRoleKey);
}

/**
 * Summary stats for fog coverage - lightweight payload for UI.
 */
export interface FogSummary {
  totalHexes: number;
  clearedHexes: number;
  unclearedHexes: number;
  percentComplete: number;
}

/**
 * A cluster of uncleared hexagons identified by DBSCAN.
 * Represents a "Fog Zone" that the Pathfinder Agent can target.
 */
export interface FogZone {
  id: string; // "zone_0", "zone_1", etc.
  centroid: [number, number]; // [lng, lat]
  hexCount: number; // Number of hexes in cluster
  estimatedAreaKm2: number; // hexCount * 0.015 for Res 10
  distanceFromUser: number; // km from user's location
  priorityScore: number; // hexCount / (distanceFromUser + 1)
}

/**
 * Returns summary stats for UI display.
 * Lightweight payload (~100 bytes) - safe to send to client.
 *
 * @param userId - The user's UUID
 * @param borough - Borough name (default: "Brooklyn")
 */
export async function getUnclearedHexesSummary(
  userId: string,
  borough: string = "Brooklyn"
): Promise<FogSummary> {
  const supabase = getServerSupabase();

  const { data, error } = await supabase.rpc("get_fog_summary", {
    p_user_id: userId,
    p_borough: borough,
  });

  if (error) {
    throw new Error(`Failed to get fog summary: ${error.message}`);
  }

  return data as FogSummary;
}

/**
 * Returns full list of uncleared H3 indices via RPC.
 *
 * WARNING: Returns ~130k strings (~5MB) for Brooklyn.
 * Use server-side only (for Agent/clustering). Do NOT send to client.
 *
 * Uses NOT EXISTS pattern to avoid WHERE IN limits.
 *
 * @param userId - The user's UUID
 * @param borough - Borough name (default: "Brooklyn")
 */
export async function getUnclearedHexes(
  userId: string,
  borough: string = "Brooklyn"
): Promise<string[]> {
  const supabase = getServerSupabase();

  const { data, error } = await supabase.rpc("get_uncleared_hex_list", {
    p_user_id: userId,
    p_borough: borough,
  });

  if (error) {
    throw new Error(`Failed to get uncleared hexes: ${error.message}`);
  }

  return data?.map((row: { h3_index: string }) => row.h3_index) ?? [];
}

/**
 * Area of a single H3 resolution 10 hexagon in km².
 * Average hex area at res 10 is ~0.015 km².
 */
const HEX_AREA_KM2 = 0.015;

/**
 * Default search radius in H3 grid steps.
 * 50 steps at resolution 10 ≈ 3-5km depending on direction.
 */
const DEFAULT_SEARCH_RADIUS_STEPS = 50;

/**
 * DBSCAN parameters tuned for urban fog discovery.
 * - maxDistance: 500m covers ~7-8 hexes, good for street-level clustering
 * - minPoints: 20 catches smaller "gamified" pockets while filtering noise
 */
const DBSCAN_MAX_DISTANCE_KM = 0.5;
const DBSCAN_MIN_POINTS = 20;

/**
 * Maximum number of fog zones to return.
 * Keeps the LLM context window manageable.
 */
const MAX_ZONES_RETURNED = 20;

export interface GetFogZonesOptions {
  searchRadiusGridSteps?: number;
  borough?: string;
}

/**
 * Identifies dense clusters of uncleared hexagons ("Fog Zones") near the user.
 *
 * Uses spatial pre-filtering + DBSCAN clustering to reduce 130k hexes to
 * ~20 high-value targets for the Pathfinder Agent.
 *
 * @param userId - The user's UUID
 * @param userLocation - User's current location as [lng, lat]
 * @param options - Optional configuration
 * @returns Array of FogZone objects sorted by priorityScore (descending)
 */
export async function getFogZones(
  userId: string,
  userLocation: [number, number],
  options?: GetFogZonesOptions
): Promise<FogZone[]> {
  const searchRadius = options?.searchRadiusGridSteps ?? DEFAULT_SEARCH_RADIUS_STEPS;
  const borough = options?.borough ?? "Brooklyn";

  // 1. Fetch all uncleared hexes for the borough
  const allUnclearedHexes = await getUnclearedHexes(userId, borough);

  if (allUnclearedHexes.length === 0) {
    return [];
  }

  // 2. Spatial pre-filter: only keep hexes within search radius of user
  const [userLng, userLat] = userLocation;
  const userHex = latLngToCell(userLat, userLng, H3_RESOLUTION);

  const nearbyHexes = allUnclearedHexes.filter((hex) => {
    try {
      const dist = gridDistance(userHex, hex);
      return dist <= searchRadius;
    } catch {
      // gridDistance throws if hexes are in different icosahedron faces
      // (shouldn't happen within Brooklyn, but handle gracefully)
      return false;
    }
  });

  if (nearbyHexes.length < DBSCAN_MIN_POINTS) {
    // Not enough points to form meaningful clusters
    return [];
  }

  // 3. Convert H3 indices to GeoJSON points for clustering
  const points = nearbyHexes.map((hex) => {
    const [lat, lng] = cellToLatLng(hex);
    return point([lng, lat], { h3Index: hex });
  });

  const pointCollection = featureCollection(points);

  // 4. Run DBSCAN clustering
  const clustered = clustersDbscan(pointCollection, DBSCAN_MAX_DISTANCE_KM, {
    minPoints: DBSCAN_MIN_POINTS,
  });

  // 5. Group points by cluster ID and compute metadata
  const clusterMap = new Map<number, typeof points>();

  for (const feature of clustered.features) {
    const clusterId = feature.properties?.cluster;
    // Skip noise points (cluster === undefined or -1)
    if (clusterId === undefined || clusterId < 0) continue;

    if (!clusterMap.has(clusterId)) {
      clusterMap.set(clusterId, []);
    }
    clusterMap.get(clusterId)!.push(feature);
  }

  // 6. Build FogZone objects
  const userPoint = point(userLocation);
  const fogZones: FogZone[] = [];

  let zoneIndex = 0;
  for (const [, clusterPoints] of clusterMap) {
    const hexCount = clusterPoints.length;

    // Compute center of mass for potentially irregular cluster shapes
    const clusterCollection = featureCollection(clusterPoints);
    const center = centerOfMass(clusterCollection);
    const centroid: [number, number] = center.geometry.coordinates as [number, number];

    // Calculate distance from user to cluster center
    const distanceFromUser = distance(userPoint, center, { units: "kilometers" });

    // Compute derived metrics
    const estimatedAreaKm2 = Math.round(hexCount * HEX_AREA_KM2 * 1000) / 1000;
    const priorityScore = Math.round((hexCount / (distanceFromUser + 1)) * 100) / 100;

    fogZones.push({
      id: `zone_${zoneIndex}`,
      centroid,
      hexCount,
      estimatedAreaKm2,
      distanceFromUser: Math.round(distanceFromUser * 100) / 100,
      priorityScore,
    });

    zoneIndex++;
  }

  // 7. Sort by priorityScore descending and limit results
  fogZones.sort((a, b) => b.priorityScore - a.priorityScore);

  return fogZones.slice(0, MAX_ZONES_RETURNED);
}
