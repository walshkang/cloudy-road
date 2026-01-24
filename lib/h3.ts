import { latLngToCell, cellToBoundary } from "h3-js";
import { distance } from "@turf/distance";
import { point } from "@turf/helpers";

export const H3_RESOLUTION = 10; // ~66m edge, good for NYC street grid
const MAX_GAP_METERS = 50; // Interpolate if gap > this

/**
 * Convert a track's coordinates to unique H3 hexagon indices.
 * Uses linear interpolation to fill gaps between GPS points,
 * ensuring solid path coverage without "breadcrumb" gaps.
 */
export function trackToH3Indices(coordinates: [number, number][]): string[] {
  if (coordinates.length === 0) return [];

  const indices = new Set<string>();

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[i + 1];

    // Add start point
    indices.add(latLngToCell(lat1, lng1, H3_RESOLUTION));

    // Calculate distance between points
    const dist = distance(point([lng1, lat1]), point([lng2, lat2]), {
      units: "meters",
    });

    // Interpolate if gap is too large
    if (dist > MAX_GAP_METERS) {
      const steps = Math.ceil(dist / MAX_GAP_METERS);
      for (let j = 1; j < steps; j++) {
        const t = j / steps;
        const interpLng = lng1 + (lng2 - lng1) * t;
        const interpLat = lat1 + (lat2 - lat1) * t;
        indices.add(latLngToCell(interpLat, interpLng, H3_RESOLUTION));
      }
    }
  }

  // Add final point
  if (coordinates.length > 0) {
    const lastCoord = coordinates[coordinates.length - 1];
    indices.add(latLngToCell(lastCoord[1], lastCoord[0], H3_RESOLUTION));
  }

  return Array.from(indices);
}

/**
 * Extract all LineString coordinates from a GeoJSON FeatureCollection.
 * Handles both LineString and MultiLineString geometries.
 */
export function extractLineCoordinates(
  featureCollection: GeoJSON.FeatureCollection
): [number, number][] {
  const allCoords: [number, number][] = [];

  for (const feature of featureCollection.features) {
    if (!feature.geometry) continue;

    if (feature.geometry.type === "LineString") {
      allCoords.push(
        ...(feature.geometry.coordinates as [number, number][])
      );
    } else if (feature.geometry.type === "MultiLineString") {
      for (const line of feature.geometry.coordinates) {
        allCoords.push(...(line as [number, number][]));
      }
    }
  }

  return allCoords;
}

export { cellToBoundary };
