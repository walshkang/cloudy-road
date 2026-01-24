/**
 * Test script for getFogZones clustering function.
 *
 * Usage:
 *   npx tsx scripts/test-fog-zones.ts
 *
 * Uses a random UUID to simulate a user with no cleared hexes,
 * which tests the full 130k hex → spatial filter → DBSCAN pipeline.
 */

import { config } from "dotenv";
import { join } from "path";

// Load environment variables before importing server actions
config({ path: join(process.cwd(), ".env.local") });

import { getFogZones, getUnclearedHexes } from "../lib/actions/fogAnalysis";
import { latLngToCell, cellToLatLng, gridDistance } from "h3-js";
import { H3_RESOLUTION } from "../lib/h3";

// Two test locations for comparison
const PROSPECT_PARK: [number, number] = [-73.9712, 40.6602];
const SOUTH_BROOKLYN: [number, number] = [-73.868696, 40.585145]; // Near existing hexes

// Random UUID to simulate a "fresh" user with no cleared hexes
const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

async function main() {
  console.log("=== Fog Zone Clustering Test ===\n");

  // 1. First, check how many uncleared hexes exist
  console.log("1. Fetching uncleared hexes count...");
  const startFetch = Date.now();
  const allHexes = await getUnclearedHexes(TEST_USER_ID, "Brooklyn");
  const fetchDuration = Date.now() - startFetch;
  console.log(`   Total uncleared hexes: ${allHexes.length.toLocaleString()}`);
  console.log(`   Fetch time: ${fetchDuration}ms\n`);

  // Use location near where hexes exist
  const TEST_LOCATION = SOUTH_BROOKLYN;
  
  // 2. Debug: Check spatial filtering
  console.log("2. Debugging spatial filtering...");
  const userHex = latLngToCell(TEST_LOCATION[1], TEST_LOCATION[0], H3_RESOLUTION);
  console.log(`   User hex: ${userHex}`);
  
  let nearbyCount = 0;
  let minDist = Infinity;
  let maxDist = 0;
  
  for (const hex of allHexes.slice(0, 100)) {
    try {
      const dist = gridDistance(userHex, hex);
      if (dist <= 50) nearbyCount++;
      minDist = Math.min(minDist, dist);
      maxDist = Math.max(maxDist, dist);
    } catch {
      // Skip
    }
  }
  
  console.log(`   Sample of first 100 hexes:`);
  console.log(`   - Min grid distance: ${minDist}`);
  console.log(`   - Max grid distance: ${maxDist}`);
  console.log(`   - Within search radius (50): ${nearbyCount}\n`);

  // Check a sample hex location
  if (allHexes.length > 0) {
    const sampleHex = allHexes[0];
    const [lat, lng] = cellToLatLng(sampleHex);
    console.log(`   Sample hex location: [${lng.toFixed(6)}, ${lat.toFixed(6)}]\n`);
  }

  // 3. Run clustering
  console.log("3. Running getFogZones clustering...");
  console.log(`   User location: [${TEST_LOCATION[0]}, ${TEST_LOCATION[1]}]`);
  console.log(`   Search radius: 50 grid steps (~3-5km)\n`);

  const startCluster = Date.now();
  const fogZones = await getFogZones(TEST_USER_ID, TEST_LOCATION);
  const clusterDuration = Date.now() - startCluster;

  console.log(`   Clustering time: ${clusterDuration}ms`);
  console.log(`   Fog zones found: ${fogZones.length}\n`);

  // 4. Display results
  if (fogZones.length > 0) {
    console.log("4. Top fog zones (sorted by priority score):\n");
    console.log(
      "   ID          | Hex Count | Area (km²) | Distance (km) | Priority"
    );
    console.log(
      "   ------------|-----------|------------|---------------|----------"
    );

    for (const zone of fogZones.slice(0, 10)) {
      const id = zone.id.padEnd(11);
      const count = zone.hexCount.toString().padStart(9);
      const area = zone.estimatedAreaKm2.toFixed(3).padStart(10);
      const dist = zone.distanceFromUser.toFixed(2).padStart(13);
      const priority = zone.priorityScore.toFixed(2).padStart(9);
      console.log(`   ${id} | ${count} | ${area} | ${dist} | ${priority}`);
    }

    if (fogZones.length > 10) {
      console.log(`   ... and ${fogZones.length - 10} more zones`);
    }

    console.log("\n5. Sample centroid coordinates (for map verification):");
    for (const zone of fogZones.slice(0, 3)) {
      console.log(`   ${zone.id}: [${zone.centroid[0].toFixed(6)}, ${zone.centroid[1].toFixed(6)}]`);
    }
  } else {
    console.log("4. No fog zones found (area may be fully explored or too sparse)");
  }

  console.log("\n=== Test Complete ===");
  console.log(`   Total execution time: ${fetchDuration + clusterDuration}ms`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
