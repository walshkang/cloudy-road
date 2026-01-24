/**
 * Route Scoring Heuristics (P2_T007, T008, T009, T010)
 *
 * Pure functions that analyze route quality for the Pathfinder Agent.
 * These heuristics help the Agent select optimal fog-clearing routes.
 */

import type { RouteStep } from "./actions/directions";

// =============================================================================
// Flow Score (P2_T007)
// =============================================================================

/**
 * Result of flow score calculation based on turn density.
 */
export interface FlowScore {
  /** Total number of turn maneuvers in the route */
  turnCount: number;
  /** Turns per kilometer (density metric) */
  turnsPerKm: number;
  /** Flow penalty score: 0.0 (choppy) to 1.0 (zen flow) */
  flowPenalty: number;
}

/**
 * Determines if a route step represents a turn that interrupts running flow.
 *
 * Counts explicit turns, traffic circles, and road name changes with direction changes.
 */
function isTurnManeuver(step: RouteStep): boolean {
  const { type, modifier } = step.maneuver;

  // Explicit turns
  if (type === "turn" || type === "end of road") {
    return true;
  }

  // Traffic circles (major flow interruptions, e.g., Grand Army Plaza)
  if (type === "rotary" || type === "roundabout") {
    return true;
  }

  // Road name change with direction change
  // Example: "Continue onto Broadway" where Broadway is a 90-degree left
  if (type === "new name" && modifier) {
    const modLower = modifier.toLowerCase();
    if (modLower.includes("left") || modLower.includes("right")) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates flow score based on turn density (turns per kilometer).
 *
 * Uses NYC-specific thresholds optimized for the grid system:
 * - < 3 turns/km: Zen flow (1.0) - Straight, flowing routes
 * - > 12 turns/km: Choppy maze (0.0) - Too many interruptions
 * - Between 3-12: Linear interpolation
 *
 * @param steps - Array of route steps from Mapbox Directions API
 * @param distanceMeters - Total route distance in meters
 * @returns FlowScore with turnCount, turnsPerKm, and flowPenalty
 *
 * @example
 * // Long zen route: 20km with 20 turns = 1 turn/km = perfect score
 * const score = calculateFlowScore(steps, 20000);
 * // Returns: { turnCount: 20, turnsPerKm: 1.0, flowPenalty: 1.0 }
 *
 * @example
 * // Short choppy route: 1km with 15 turns = 15 turns/km = worst score
 * const score = calculateFlowScore(steps, 1000);
 * // Returns: { turnCount: 15, turnsPerKm: 15.0, flowPenalty: 0.0 }
 */
export function calculateFlowScore(
  steps: RouteStep[],
  distanceMeters: number
): FlowScore {
  const turnCount = steps.filter(isTurnManeuver).length;
  const distanceKm = distanceMeters / 1000;
  const turnsPerKm = distanceKm > 0 ? turnCount / distanceKm : 0;

  // NYC thresholds: < 3 = perfect, > 12 = choppy
  let flowPenalty: number;
  if (turnsPerKm < 3) {
    flowPenalty = 1.0;
  } else if (turnsPerKm > 12) {
    flowPenalty = 0.0;
  } else {
    // Linear interpolation between 3 and 12
    // At 3 turns/km: flowPenalty = 1.0
    // At 12 turns/km: flowPenalty = 0.0
    flowPenalty = 1.0 - (turnsPerKm - 3) / (12 - 3);
  }

  return {
    turnCount,
    turnsPerKm: Math.round(turnsPerKm * 100) / 100, // Round to 2 decimals
    flowPenalty: Math.round(flowPenalty * 1000) / 1000, // Round to 3 decimals
  };
}
