import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

export interface BoroughMapProps {
  // STRICT CONSTRAINT: Accepts the full Feature, not just geometry
  feature: Feature<Polygon | MultiPolygon>;
  // GPX output is a FeatureCollection (may contain multiple tracks/routes)
  activityData?: FeatureCollection | null;
  // H3 hexagon indices that have been "cleared" by the user
  clearedHexagons?: string[];
}
