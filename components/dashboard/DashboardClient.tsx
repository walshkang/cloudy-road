"use client";

import { useState, useEffect, useCallback } from "react";
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from "geojson";
import BoroughMap from "@/components/map/BoroughMap";
import GpxDropZone from "@/components/ui/GpxDropZone";
import AuthButton from "@/components/ui/AuthButton";
import { trackToH3Indices, extractLineCoordinates } from "@/lib/h3";
import { saveHexagons, getUserHexagons, getCurrentUser, supabase } from "@/lib/supabase";

interface Props {
  boroughFeature: Feature<Polygon | MultiPolygon>;
}

export default function DashboardClient({ boroughFeature }: Props) {
  const [activityData, setActivityData] = useState<FeatureCollection | null>(null);
  const [clearedHexagons, setClearedHexagons] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Load user's existing hexagons on mount and auth state change
  useEffect(() => {
    if (!supabase) return;

    const loadHexagons = async () => {
      const user = await getCurrentUser();
      setIsAuthenticated(!!user);
      
      if (user) {
        try {
          const hexagons = await getUserHexagons();
          setClearedHexagons(hexagons);
        } catch (error) {
          console.error("Failed to load hexagons:", error);
        }
      }
    };

    loadHexagons();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setIsAuthenticated(!!session?.user);
      if (session?.user) {
        try {
          const hexagons = await getUserHexagons();
          setClearedHexagons(hexagons);
        } catch (error) {
          console.error("Failed to load hexagons:", error);
        }
      } else {
        setClearedHexagons([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle GPX data: convert to H3 and save
  const handleGpxLoaded = useCallback(
    async (data: FeatureCollection) => {
      // Always show the track on the map
      setActivityData(data);

      // Only process and save if authenticated
      if (!isAuthenticated) {
        console.log("Not authenticated - track shown but not saved");
        return;
      }

      setIsProcessing(true);
      try {
        // Extract coordinates from all LineString features
        const coordinates = extractLineCoordinates(data);
        
        if (coordinates.length === 0) {
          console.warn("No LineString coordinates found in GPX");
          return;
        }

        // Convert to H3 indices with interpolation
        const newIndices = trackToH3Indices(coordinates);
        console.log(`Converted ${coordinates.length} points to ${newIndices.length} H3 hexagons`);

        // Save to Supabase
        await saveHexagons(newIndices);

        // Update local state (merge with existing)
        setClearedHexagons((prev) => {
          const combined = new Set([...prev, ...newIndices]);
          return Array.from(combined);
        });

        console.log("Hexagons saved successfully!");
      } catch (error) {
        console.error("Failed to process GPX:", error);
      } finally {
        setIsProcessing(false);
      }
    },
    [isAuthenticated]
  );

  return (
    <div className="relative h-full w-full">
      <BoroughMap
        feature={boroughFeature}
        activityData={activityData}
        clearedHexagons={clearedHexagons}
      />
      <GpxDropZone onDataLoaded={handleGpxLoaded} />
      <AuthButton />
      
      {/* Processing indicator */}
      {isProcessing && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-800/90 px-4 py-2 text-sm text-zinc-200 backdrop-blur">
          Processing track...
        </div>
      )}
    </div>
  );
}
