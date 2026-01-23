import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import DashboardClient from "@/components/dashboard/DashboardClient";
import { readFile } from "node:fs/promises";
import path from "node:path";

function isPolygonFeature(feature: Feature): feature is Feature<Polygon | MultiPolygon> {
  return feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
}

export default async function DashboardPage() {
  // Server Component: load GeoJSON on the server and pass the Brooklyn feature to the client.
  const boroughGeoJsonPath = path.join(
    process.cwd(),
    "data",
    "boroughs",
    "Borough_Boundaries_20260122.geojson"
  );
  const raw = await readFile(boroughGeoJsonPath, "utf8");
  const collection = JSON.parse(raw) as FeatureCollection;

  // Locate the Brooklyn feature via explicit property keys (borocode 3 = Brooklyn).
  const brooklynFeature = collection.features.find((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    return props.boroname === "Brooklyn" || props.borocode === "3" || props.borocode === 3;
  });

  if (!brooklynFeature || !isPolygonFeature(brooklynFeature)) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-900 text-red-500">
        Error: Could not load Brooklyn boundary data.
      </div>
    );
  }

  return (
    <div className="h-screen w-screen">
      <DashboardClient boroughFeature={brooklynFeature} />
    </div>
  );
}
