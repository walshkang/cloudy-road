"use client";

import { useRef, useCallback } from "react";
import Map, { Layer, MapRef, Source } from "react-map-gl/mapbox";
import bbox from "@turf/bbox";
import type { BoroughMapProps } from "@/types/map";
import type { Feature } from "geojson";
import type { FillLayer, LineLayer } from "mapbox-gl";

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

export default function BoroughMap({ geometry, boroughName }: BoroughMapProps) {
  const mapRef = useRef<MapRef>(null);

  const onMapLoad = useCallback(() => {
    if (!mapRef.current) return;

    // Calculate bounding box from geometry using Turf.js
    const [minLng, minLat, maxLng, maxLat] = bbox(geometry);

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
  }, [geometry]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-400">
        <p>Mapbox token not configured. Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local</p>
      </div>
    );
  }

  const boroughFeature: Feature = {
    type: "Feature",
    properties: { name: boroughName },
    geometry,
  };

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
      <Source id="borough" type="geojson" data={boroughFeature}>
        <Layer {...boroughFillLayer} />
        <Layer {...boroughOutlineLayer} />
      </Source>
    </Map>
  );
}
