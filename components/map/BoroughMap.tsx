"use client";

import { useRef, useCallback, useMemo } from "react";
import Map, { Layer, MapRef, Source } from "react-map-gl/mapbox";
import bbox from "@turf/bbox";
import type { BoroughMapProps } from "@/types/map";
import type { FillLayer, LineLayer } from "mapbox-gl";
import type { FeatureCollection, Polygon } from "geojson";
import { cellToBoundary } from "@/lib/h3";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const boroughFillLayer: FillLayer = {
  id: "borough-fill",
  type: "fill",
  paint: {
    "fill-color": "#3b82f6",
    "fill-opacity": 0.35,
  },
};

const boroughOutlineLayer: LineLayer = {
  id: "borough-outline",
  type: "line",
  paint: {
    "line-color": "#60a5fa",
    "line-width": 2,
  },
};

const activityLineLayer: LineLayer = {
  id: "activity-line",
  type: "line",
  filter: ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "MultiLineString"]],
  paint: {
    "line-color": "#22c55e",
    "line-width": 3,
    "line-opacity": 0.9,
  },
};

const clearedHexagonFillLayer: FillLayer = {
  id: "cleared-hexagon-fill",
  type: "fill",
  paint: {
    "fill-color": "#22c55e",
    "fill-opacity": 0.5,
  },
};

const clearedHexagonOutlineLayer: LineLayer = {
  id: "cleared-hexagon-outline",
  type: "line",
  paint: {
    "line-color": "#4ade80",
    "line-width": 1,
    "line-opacity": 0.7,
  },
};

export default function BoroughMap({ feature, activityData, clearedHexagons }: BoroughMapProps) {
  const mapRef = useRef<MapRef>(null);

  // Extract borough name from feature properties for aria-label
  const boroughName = useMemo(() => {
    const props = feature.properties ?? {};
    return (props.boroname as string) || (props.name as string) || "Borough";
  }, [feature]);

  // Convert H3 indices to polygon geometries (memoized to avoid expensive recalculation)
  const hexagonFeatures = useMemo<FeatureCollection<Polygon> | null>(() => {
    if (!clearedHexagons?.length) return null;

    return {
      type: "FeatureCollection",
      features: clearedHexagons.map((h3Index) => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "Polygon" as const,
          // cellToBoundary with true returns [lng, lat] pairs (GeoJSON format)
          coordinates: [cellToBoundary(h3Index, true)],
        },
      })),
    };
  }, [clearedHexagons]);

  const onMapLoad = useCallback(() => {
    if (!mapRef.current) return;

    // Calculate bounding box from the feature (Turf supports GeoJSON input)
    const [minLng, minLat, maxLng, maxLat] = bbox(feature);

    // Fit the map to the borough bounds
    mapRef.current.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding: 40,
        duration: 1000,
      }
    );
  }, [feature]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-400">
        <p>Mapbox token not configured. Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local</p>
      </div>
    );
  }

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{
        longitude: -73.9,
        latitude: 40.7,
        zoom: 10,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
      onLoad={onMapLoad}
      aria-label={`Map of ${boroughName}`}
    >
      {/* Borough boundary layer */}
      <Source id="borough" type="geojson" data={feature}>
        <Layer {...boroughFillLayer} />
        <Layer {...boroughOutlineLayer} />
      </Source>

      {/* Cleared hexagons layer (the "fog clearing" effect) */}
      {hexagonFeatures && (
        <Source id="cleared-hexagons" type="geojson" data={hexagonFeatures}>
          <Layer {...clearedHexagonFillLayer} />
          <Layer {...clearedHexagonOutlineLayer} />
        </Source>
      )}

      {/* Activity track layer (GPX data) */}
      {activityData && (
        <Source id="activity" type="geojson" data={activityData}>
          <Layer {...activityLineLayer} />
        </Source>
      )}
    </Map>
  );
}
