/**
 * Test script for getDirections Mapbox wrapper.
 *
 * Usage:
 *   npx tsx scripts/test-directions.ts
 *
 * Tests:
 * 1. Simple A → B route
 * 2. Loop route (A → B → A) to verify multi-leg flattening
 * 3. Error handling for invalid coordinates
 */

import { config } from "dotenv";
import { join } from "path";

// Load environment variables before importing server actions
config({ path: join(process.cwd(), ".env.local") });

import { getDirections } from "../lib/actions/directions";

// Test locations in Brooklyn
const PROSPECT_PARK: [number, number] = [-73.9712, 40.6602];
const WILLIAMSBURG: [number, number] = [-73.9565, 40.7081];
const DUMBO: [number, number] = [-73.9877, 40.7033];

async function main() {
  console.log("=== Mapbox Directions Wrapper Test ===\n");

  // Test 1: Simple A → B route
  console.log("1. Testing simple A → B route...");
  console.log(`   From: Prospect Park [${PROSPECT_PARK}]`);
  console.log(`   To:   Williamsburg  [${WILLIAMSBURG}]\n`);

  try {
    const startTime = Date.now();
    const simpleRoute = await getDirections({
      start: PROSPECT_PARK,
      end: WILLIAMSBURG,
    });
    const duration = Date.now() - startTime;

    console.log(`   ✓ Route found in ${duration}ms`);
    console.log(`   Distance: ${(simpleRoute.distance / 1000).toFixed(2)} km`);
    console.log(`   Duration: ${Math.round(simpleRoute.duration / 60)} minutes`);
    console.log(`   Steps: ${simpleRoute.steps.length}`);
    console.log(`   Geometry points: ${simpleRoute.geometry.coordinates.length}`);
    
    // Show first and last step
    if (simpleRoute.steps.length > 0) {
      console.log(`\n   First step: "${simpleRoute.steps[0].instruction}"`);
      console.log(`   Last step:  "${simpleRoute.steps[simpleRoute.steps.length - 1].instruction}"`);
    }
  } catch (error) {
    console.error(`   ✗ Error: ${error}`);
  }

  console.log("\n" + "=".repeat(50) + "\n");

  // Test 2: Loop route (A → B → A) - CRITICAL TEST
  console.log("2. Testing loop route (A → B → A)...");
  console.log(`   Start: Prospect Park [${PROSPECT_PARK}]`);
  console.log(`   Via:   DUMBO         [${DUMBO}]`);
  console.log(`   End:   Prospect Park [${PROSPECT_PARK}]\n`);

  try {
    const startTime = Date.now();
    const loopRoute = await getDirections({
      start: PROSPECT_PARK,
      waypoints: [DUMBO],
      end: PROSPECT_PARK,
    });
    const duration = Date.now() - startTime;

    console.log(`   ✓ Loop route found in ${duration}ms`);
    console.log(`   Distance: ${(loopRoute.distance / 1000).toFixed(2)} km`);
    console.log(`   Duration: ${Math.round(loopRoute.duration / 60)} minutes`);
    console.log(`   Steps: ${loopRoute.steps.length}`);
    console.log(`   Geometry points: ${loopRoute.geometry.coordinates.length}`);

    // Verify steps cover both legs
    // Count "arrive" maneuvers - should be 2 for a loop (arrive at waypoint + arrive at end)
    const arriveSteps = loopRoute.steps.filter(
      (s) => s.maneuver.type === "arrive"
    );
    console.log(`\n   Arrive maneuvers: ${arriveSteps.length} (expected: 2 for loop)`);

    if (arriveSteps.length >= 2) {
      console.log(`   ✓ Multi-leg flattening working correctly!`);
    } else {
      console.log(`   ⚠ WARNING: May be missing steps from second leg!`);
    }

    // Show step breakdown
    console.log(`\n   Step breakdown by maneuver type:`);
    const maneuverTypes = new Map<string, number>();
    for (const step of loopRoute.steps) {
      const type = step.maneuver.type;
      maneuverTypes.set(type, (maneuverTypes.get(type) || 0) + 1);
    }
    for (const [type, count] of maneuverTypes) {
      console.log(`     - ${type}: ${count}`);
    }

    // Show first few and last few instructions
    console.log(`\n   First 3 instructions:`);
    for (const step of loopRoute.steps.slice(0, 3)) {
      console.log(`     • ${step.instruction}`);
    }
    console.log(`   ...`);
    console.log(`   Last 3 instructions:`);
    for (const step of loopRoute.steps.slice(-3)) {
      console.log(`     • ${step.instruction}`);
    }
  } catch (error) {
    console.error(`   ✗ Error: ${error}`);
  }

  console.log("\n" + "=".repeat(50) + "\n");

  // Test 3: Error handling - invalid coordinates (in the ocean)
  console.log("3. Testing error handling (invalid coordinates in ocean)...");
  const ATLANTIC_OCEAN: [number, number] = [-40.0, 35.0];
  console.log(`   Coordinates: [${ATLANTIC_OCEAN}]\n`);

  try {
    await getDirections({
      start: ATLANTIC_OCEAN,
      end: PROSPECT_PARK,
    });
    console.log(`   ⚠ Expected error but got success`);
  } catch (error) {
    console.log(`   ✓ Correctly threw error: ${error}`);
  }

  console.log("\n=== All Tests Complete ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
