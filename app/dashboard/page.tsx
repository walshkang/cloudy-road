import type { Polygon } from "geojson";
import BoroughMap from "@/components/map/BoroughMap";

// Mock GeoJSON polygon for testing (roughly Brooklyn area)
const MOCK_BOROUGH_GEOMETRY: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-73.95, 40.65],
      [-73.85, 40.65],
      [-73.85, 40.7],
      [-73.95, 40.7],
      [-73.95, 40.65],
    ],
  ],
};

export default function DashboardPage() {
  return (
    <div className="h-screen w-screen">
      <BoroughMap geometry={MOCK_BOROUGH_GEOMETRY} boroughName="Brooklyn" />
    </div>
  );
}
