/**
 * Test script for calculateFlowScore function.
 *
 * Usage:
 *   npx tsx scripts/test-flow-score.ts
 *
 * Tests:
 * 1. Long zen route (20km with 20 turns = 1 turn/km = perfect score)
 * 2. Short choppy route (1km with 15 turns = 15 turns/km = worst score)
 * 3. NYC grid route (5km with 20 turns = 4 turns/km = good score)
 * 4. Real route from Mapbox API
 */

import { config } from "dotenv";
import { join } from "path";

// Load environment variables before importing server actions
config({ path: join(process.cwd(), ".env.local") });

import { getDirections } from "../lib/actions/directions";
import { calculateFlowScore } from "../lib/scoring";

// Test locations in Brooklyn
const PROSPECT_PARK: [number, number] = [-73.9712, 40.6602];
const WILLIAMSBURG: [number, number] = [-73.9565, 40.7081];
const DUMBO: [number, number] = [-73.9877, 40.7033];

async function main() {
  console.log("=== Flow Score Calculation Test ===\n");

  // Test 1: Real route from Mapbox
  console.log("1. Testing with real Mapbox route...");
  console.log(`   From: Prospect Park [${PROSPECT_PARK}]`);
  console.log(`   To:   Williamsburg  [${WILLIAMSBURG}]\n`);

  try {
    const route = await getDirections({
      start: PROSPECT_PARK,
      end: WILLIAMSBURG,
    });

    const flowScore = calculateFlowScore(route.steps, route.distance);

    console.log(`   ✓ Route analyzed`);
    console.log(`   Distance: ${(route.distance / 1000).toFixed(2)} km`);
    console.log(`   Turn count: ${flowScore.turnCount}`);
    console.log(`   Turns/km: ${flowScore.turnsPerKm}`);
    console.log(`   Flow penalty: ${flowScore.flowPenalty.toFixed(3)}`);

    // Verify thresholds
    if (flowScore.turnsPerKm < 3) {
      console.log(`   ✓ Zen flow (< 3 turns/km)`);
    } else if (flowScore.turnsPerKm > 12) {
      console.log(`   ⚠ Choppy maze (> 12 turns/km)`);
    } else {
      console.log(`   ✓ Moderate flow (3-12 turns/km)`);
    }
  } catch (error) {
    console.error(`   ✗ Error: ${error}`);
  }

  console.log("\n" + "=".repeat(50) + "\n");

  // Test 2: Loop route (should have more turns)
  console.log("2. Testing loop route (A → B → A)...");
  console.log(`   Start: Prospect Park [${PROSPECT_PARK}]`);
  console.log(`   Via:   DUMBO         [${DUMBO}]`);
  console.log(`   End:   Prospect Park [${PROSPECT_PARK}]\n`);

  try {
    const loopRoute = await getDirections({
      start: PROSPECT_PARK,
      waypoints: [DUMBO],
      end: PROSPECT_PARK,
    });

    const flowScore = calculateFlowScore(loopRoute.steps, loopRoute.distance);

    console.log(`   ✓ Loop route analyzed`);
    console.log(`   Distance: ${(loopRoute.distance / 1000).toFixed(2)} km`);
    console.log(`   Turn count: ${flowScore.turnCount}`);
    console.log(`   Turns/km: ${flowScore.turnsPerKm}`);
    console.log(`   Flow penalty: ${flowScore.flowPenalty.toFixed(3)}`);

    // Show breakdown of maneuver types
    const maneuverTypes = new Map<string, number>();
    for (const step of loopRoute.steps) {
      const type = step.maneuver.type;
      maneuverTypes.set(type, (maneuverTypes.get(type) || 0) + 1);
    }

    console.log(`\n   Maneuver breakdown:`);
    for (const [type, count] of Array.from(maneuverTypes).sort(
      (a, b) => b[1] - a[1]
    )) {
      // Check if this type is counted as a turn
      const isTurnType =
        type === "turn" ||
        type === "end of road" ||
        type === "rotary" ||
        type === "roundabout";
      
      // For "new name", check if any step with this type has a left/right modifier
      let isNewNameTurn = false;
      if (type === "new name") {
        isNewNameTurn = loopRoute.steps.some(
          (s) =>
            s.maneuver.type === "new name" &&
            s.maneuver.modifier &&
            (s.maneuver.modifier.toLowerCase().includes("left") ||
              s.maneuver.modifier.toLowerCase().includes("right"))
        );
      }
      
      const marker = isTurnType || isNewNameTurn ? "✓ (turn)" : "";
      console.log(`     - ${type}: ${count} ${marker}`);
    }
  } catch (error) {
    console.error(`   ✗ Error: ${error}`);
  }

  console.log("\n" + "=".repeat(50) + "\n");

  // Test 3: Edge cases with mock data
  console.log("3. Testing edge cases with mock data...\n");

  // Mock step data for testing
  const mockSteps = [
    {
      instruction: "Turn left",
      distance: 100,
      duration: 10,
      maneuver: { type: "turn", modifier: "left", location: [0, 0] },
    },
    {
      instruction: "Continue straight",
      distance: 200,
      duration: 20,
      maneuver: { type: "continue", modifier: "straight", location: [0, 0] },
    },
    {
      instruction: "Roundabout",
      distance: 150,
      duration: 15,
      maneuver: { type: "roundabout", modifier: "right", location: [0, 0] },
    },
  ];

  // Test: Long zen route (20km with 20 turns = 1 turn/km)
  const longZenTurns = Array(20).fill(mockSteps[0]);
  const longZenScore = calculateFlowScore(longZenTurns, 20000);
  console.log(`   Long zen route (20km, 20 turns):`);
  console.log(`     Turns/km: ${longZenScore.turnsPerKm}`);
  console.log(`     Flow penalty: ${longZenScore.flowPenalty.toFixed(3)}`);
  console.log(
    `     ${longZenScore.flowPenalty === 1.0 ? "✓" : "✗"} Expected: 1.0`
  );

  // Test: Short choppy route (1km with 15 turns = 15 turns/km)
  const shortChoppyTurns = Array(15).fill(mockSteps[0]);
  const shortChoppyScore = calculateFlowScore(shortChoppyTurns, 1000);
  console.log(`\n   Short choppy route (1km, 15 turns):`);
  console.log(`     Turns/km: ${shortChoppyScore.turnsPerKm}`);
  console.log(`     Flow penalty: ${shortChoppyScore.flowPenalty.toFixed(3)}`);
  console.log(
    `     ${shortChoppyScore.flowPenalty === 0.0 ? "✓" : "✗"} Expected: 0.0`
  );

  // Test: NYC grid route (5km with 20 turns = 4 turns/km)
  const nycGridTurns = Array(20).fill(mockSteps[0]);
  const nycGridScore = calculateFlowScore(nycGridTurns, 5000);
  console.log(`\n   NYC grid route (5km, 20 turns):`);
  console.log(`     Turns/km: ${nycGridScore.turnsPerKm}`);
  console.log(`     Flow penalty: ${nycGridScore.flowPenalty.toFixed(3)}`);
  const expectedNYC = 1.0 - (4 - 3) / (12 - 3);
  console.log(`     Expected: ${expectedNYC.toFixed(3)}`);
  console.log(
    `     ${Math.abs(nycGridScore.flowPenalty - expectedNYC) < 0.01 ? "✓" : "✗"} Within tolerance`
  );

  // Test: Zero distance edge case
  const zeroDistanceScore = calculateFlowScore(mockSteps, 0);
  console.log(`\n   Zero distance edge case:`);
  console.log(`     Turns/km: ${zeroDistanceScore.turnsPerKm}`);
  console.log(`     Flow penalty: ${zeroDistanceScore.flowPenalty.toFixed(3)}`);
  console.log(
    `     ${zeroDistanceScore.turnsPerKm === 0 ? "✓" : "✗"} Expected: 0`
  );

  console.log("\n=== All Tests Complete ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
