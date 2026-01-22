import type { FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import BoroughMap from "@/components/map/BoroughMap";
import brooklyn from "@/data/boroughs/brooklyn.json";

function asPolygonOrMultiPolygon(geometry: Geometry | null | undefined): Polygon | MultiPolygon {
  if (!geometry) {
    throw new Error("Brooklyn GeoJSON missing geometry");
  }
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    return geometry;
  }
  throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

export default function DashboardPage() {
  const brooklynCollection = brooklyn as FeatureCollection;
  const brooklynGeometry = asPolygonOrMultiPolygon(brooklynCollection.features?.[0]?.geometry);

  return (
    <div className="h-screen w-screen">
      <BoroughMap geometry={brooklynGeometry} boroughName="Brooklyn" />
    </div>
  );
}
