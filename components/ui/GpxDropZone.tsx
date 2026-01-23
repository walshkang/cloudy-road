"use client";

import { useState, useCallback, type DragEvent } from "react";
import { gpx } from "@tmcw/togeojson";
import type { FeatureCollection } from "geojson";

interface GpxDropZoneProps {
  onDataLoaded: (data: FeatureCollection) => void;
}

export default function GpxDropZone({ onDataLoaded }: GpxDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      setError(null);

      const files = Array.from(e.dataTransfer.files);
      const gpxFile = files.find((f) => f.name.toLowerCase().endsWith(".gpx"));

      if (!gpxFile) {
        setError("Please drop a .gpx file");
        return;
      }

      try {
        const text = await gpxFile.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");

        // Check for XML parse errors
        const parseError = xmlDoc.querySelector("parsererror");
        if (parseError) {
          setError("Invalid GPX file format");
          return;
        }

        const geojson = gpx(xmlDoc);
        onDataLoaded(geojson);
      } catch (err) {
        console.error("GPX parsing error:", err);
        setError("Failed to parse GPX file");
      }
    },
    [onDataLoaded]
  );

  return (
    <div
      className={`absolute inset-0 z-10 flex items-center justify-center transition-all duration-200 ${
        isDragOver
          ? "pointer-events-auto bg-zinc-900/80"
          : "pointer-events-none bg-transparent"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      // Enable drag detection across the entire area
      style={{ pointerEvents: isDragOver ? "auto" : "none" }}
    >
      {/* Invisible drag detection layer - always active */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: "auto" }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />

      {/* Visual feedback when dragging */}
      {isDragOver && (
        <div className="rounded-xl border-2 border-dashed border-green-500 bg-zinc-800/90 px-12 py-8 text-center">
          <p className="text-lg font-medium text-green-400">Drop GPX file here</p>
          <p className="mt-1 text-sm text-zinc-400">Release to load your activity</p>
        </div>
      )}

      {/* Error message */}
      {error && !isDragOver && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-red-900/90 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
