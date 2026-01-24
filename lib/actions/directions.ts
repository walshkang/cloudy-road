"use server";

/**
 * Mapbox Directions API Wrapper (P2_T003)
 *
 * Internal helper function that wraps the Mapbox Directions API v5.
 * This is a stateless utility - the Agent Tool (P2_T005) will call this
 * and add scoring/DB logic.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Input parameters for the directions request.
 */
export interface GetDirectionsParams {
  /** Starting point as [longitude, latitude] */
  start: [number, number];
  /** Optional intermediate waypoints for loop routes */
  waypoints?: [number, number][];
  /** Ending point as [longitude, latitude] */
  end: [number, number];
  /** Routing profile (default: 'walking') */
  profile?: "walking" | "cycling" | "driving";
}

/**
 * A single step in the route with turn-by-turn instructions.
 */
export interface RouteStep {
  /** Human-readable instruction (e.g., "Turn left onto Main St") */
  instruction: string;
  /** Distance for this step in meters */
  distance: number;
  /** Duration for this step in seconds */
  duration: number;
  /** Maneuver details */
  maneuver: {
    /** Type of maneuver (turn, depart, arrive, etc.) */
    type: string;
    /** Direction modifier (left, right, straight, etc.) */
    modifier?: string;
    /** Location of the maneuver as [longitude, latitude] */
    location: [number, number];
  };
}

/**
 * Result from the Mapbox Directions API.
 */
export interface DirectionsResult {
  /** Full route geometry as GeoJSON LineString */
  geometry: GeoJSON.LineString;
  /** Total distance in meters */
  distance: number;
  /** Total duration in seconds */
  duration: number;
  /** Flattened turn-by-turn instructions from ALL legs */
  steps: RouteStep[];
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Fetches walking/cycling/driving directions from Mapbox Directions API.
 *
 * Supports loop routes by flattening steps from ALL legs.
 * For example, a route A → B → A returns steps for both legs combined.
 *
 * @param params - The directions request parameters
 * @returns DirectionsResult with geometry, distance, duration, and steps
 * @throws Error if token is missing, API fails, or no route is found
 *
 * @example
 * // Simple A → B route
 * const route = await getDirections({
 *   start: [-73.9857, 40.7484],
 *   end: [-73.9654, 40.7829],
 * });
 *
 * @example
 * // Loop route: Home → FogZone → Home
 * const loopRoute = await getDirections({
 *   start: [-73.9857, 40.7484],
 *   waypoints: [[-73.9654, 40.7829]],
 *   end: [-73.9857, 40.7484],
 * });
 */
export async function getDirections({
  start,
  end,
  waypoints = [],
  profile = "walking",
}: GetDirectionsParams): Promise<DirectionsResult> {
  // 1. Validate environment
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    throw new Error(
      "Missing NEXT_PUBLIC_MAPBOX_TOKEN environment variable"
    );
  }

  // 2. Construct coordinate string (Start → Waypoints → End)
  const allPoints = [start, ...waypoints, end];
  const coordinatesString = allPoints
    .map((pt) => `${pt[0]},${pt[1]}`)
    .join(";");

  // 3. Build API URL
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinatesString}`
  );
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");
  url.searchParams.set("access_token", token);

  // 4. Fetch from Mapbox
  const res = await fetch(url.toString());

  if (!res.ok) {
    throw new Error(`Mapbox API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  // 5. Handle API-level errors
  if (data.code !== "Ok") {
    // Mapbox returns specific error codes: NoRoute, NoSegment, InvalidInput, etc.
    const errorMessage = data.message || `Mapbox error: ${data.code}`;
    throw new Error(errorMessage);
  }

  if (!data.routes || data.routes.length === 0) {
    throw new Error("No route found for the given coordinates");
  }

  const route = data.routes[0];

  // 6. CRITICAL: Flatten steps from ALL legs for loop support
  // When route has waypoints (e.g., A → B → A), Mapbox returns multiple legs:
  //   legs[0]: A → B
  //   legs[1]: B → A
  // We must combine them for continuous turn-by-turn instructions.
  const allSteps: RouteStep[] = route.legs.flatMap((leg: MapboxLeg) =>
    leg.steps.map((step: MapboxStep) => ({
      instruction: step.maneuver.instruction,
      distance: step.distance,
      duration: step.duration,
      maneuver: {
        type: step.maneuver.type,
        modifier: step.maneuver.modifier,
        location: step.maneuver.location as [number, number],
      },
    }))
  );

  return {
    geometry: route.geometry as GeoJSON.LineString,
    distance: route.distance,
    duration: route.duration,
    steps: allSteps,
  };
}

// =============================================================================
// Internal Types (Mapbox API Response Shapes)
// =============================================================================

/** Mapbox API leg structure */
interface MapboxLeg {
  steps: MapboxStep[];
  distance: number;
  duration: number;
}

/** Mapbox API step structure */
interface MapboxStep {
  maneuver: {
    instruction: string;
    type: string;
    modifier?: string;
    location: number[];
  };
  distance: number;
  duration: number;
}
