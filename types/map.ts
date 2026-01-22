import type { Polygon, MultiPolygon } from "geojson";

export interface BoroughMapProps {
  geometry: Polygon | MultiPolygon;
  boroughName: string;
}
