"use client";

import { useState } from "react";
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from "geojson";
import BoroughMap from "@/components/map/BoroughMap";
import GpxDropZone from "@/components/ui/GpxDropZone";

interface Props {
  boroughFeature: Feature<Polygon | MultiPolygon>;
}

export default function DashboardClient({ boroughFeature }: Props) {
  const [activityData, setActivityData] = useState<FeatureCollection | null>(null);

  return (
    <div className="relative h-full w-full">
      <BoroughMap feature={boroughFeature} activityData={activityData} />
      <GpxDropZone onDataLoaded={setActivityData} />
    </div>
  );
}
