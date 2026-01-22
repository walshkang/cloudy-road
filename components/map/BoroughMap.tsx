"use client";

import { useRef, useCallback } from "react";
import Map, { MapRef } from "react-map-gl/mapbox";
import bbox from "@turf/bbox";
import type { BoroughMapProps } from "@/types/map";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

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
    />
  );
}
