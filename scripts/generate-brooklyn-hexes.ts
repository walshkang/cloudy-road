/**
 * One-time script to generate all H3 hexagons for Brooklyn and insert into Supabase.
 *
 * Usage:
 *   NODE_OPTIONS="--max-old-space-size=4096" npx tsx scripts/generate-brooklyn-hexes.ts
 *
 * Prerequisites:
 *   1. SUPABASE_SERVICE_ROLE_KEY must be set in .env.local
 *   2. master_hexagons table must exist in Supabase (run migration first)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";
import { multiPolygonToH3Indices, H3_RESOLUTION } from "../lib/h3";

// Load environment variables from .env.local
import { config } from "dotenv";
config({ path: join(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface BrooklynGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      BoroCode: number;
      BoroName: string;
    };
    geometry: {
      type: "MultiPolygon";
      coordinates: number[][][][];
    };
  }>;
}

async function main() {
  console.log("=== Brooklyn H3 Hex Generation Script ===\n");

  // 1. Load Brooklyn GeoJSON
  console.log("1. Loading Brooklyn boundary GeoJSON...");
  const geoJsonPath = join(process.cwd(), "data", "boroughs", "brooklyn.json");
  const raw = readFileSync(geoJsonPath, "utf8");
  const geoJson: BrooklynGeoJSON = JSON.parse(raw);

  const brooklynFeature = geoJson.features.find(
    (f) => f.properties.BoroName === "Brooklyn" || f.properties.BoroCode === 3
  );

  if (!brooklynFeature) {
    console.error("Error: Could not find Brooklyn feature in GeoJSON");
    process.exit(1);
  }

  console.log(`   Found Brooklyn feature (BoroCode: ${brooklynFeature.properties.BoroCode})`);
  console.log(`   Geometry type: ${brooklynFeature.geometry.type}`);
  console.log(`   Number of polygons: ${brooklynFeature.geometry.coordinates.length}`);

  // 2. Generate H3 indices
  console.log(`\n2. Generating H3 indices at resolution ${H3_RESOLUTION}...`);
  console.log("   (This may take a minute for ~130k hexagons...)");

  const startTime = Date.now();
  const h3Indices = multiPolygonToH3Indices(brooklynFeature.geometry.coordinates);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`   Generated ${h3Indices.length.toLocaleString()} unique hexagons in ${duration}s`);

  // 3. Insert into Supabase in batches
  console.log("\n3. Inserting into Supabase master_hexagons table...");

  const BATCH_SIZE = 1000;
  const totalBatches = Math.ceil(h3Indices.length / BATCH_SIZE);
  let insertedCount = 0;

  for (let i = 0; i < h3Indices.length; i += BATCH_SIZE) {
    const batch = h3Indices.slice(i, i + BATCH_SIZE);
    const rows = batch.map((h3_index) => ({
      h3_index,
      borough: "Brooklyn",
      h3_resolution: H3_RESOLUTION,
    }));

    const { error } = await supabase
      .from("master_hexagons")
      .upsert(rows, { onConflict: "h3_index", ignoreDuplicates: true });

    if (error) {
      console.error(`   Error inserting batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
      process.exit(1);
    }

    insertedCount += batch.length;
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const progress = ((insertedCount / h3Indices.length) * 100).toFixed(1);
    process.stdout.write(`\r   Progress: ${progress}% (batch ${batchNum}/${totalBatches})`);
  }

  console.log("\n");
  console.log("=== Complete! ===");
  console.log(`   Total hexagons inserted: ${h3Indices.length.toLocaleString()}`);
  console.log(`   Borough: Brooklyn`);
  console.log(`   Resolution: ${H3_RESOLUTION}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
