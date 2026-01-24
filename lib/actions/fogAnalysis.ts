"use server";

import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using service role key.
 * This bypasses RLS for administrative operations.
 * NEVER expose this client to the browser.
 */
function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Server Supabase client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, serviceRoleKey);
}

/**
 * Summary stats for fog coverage - lightweight payload for UI.
 */
export interface FogSummary {
  totalHexes: number;
  clearedHexes: number;
  unclearedHexes: number;
  percentComplete: number;
}

/**
 * Returns summary stats for UI display.
 * Lightweight payload (~100 bytes) - safe to send to client.
 *
 * @param userId - The user's UUID
 * @param borough - Borough name (default: "Brooklyn")
 */
export async function getUnclearedHexesSummary(
  userId: string,
  borough: string = "Brooklyn"
): Promise<FogSummary> {
  const supabase = getServerSupabase();

  const { data, error } = await supabase.rpc("get_fog_summary", {
    p_user_id: userId,
    p_borough: borough,
  });

  if (error) {
    throw new Error(`Failed to get fog summary: ${error.message}`);
  }

  return data as FogSummary;
}

/**
 * Returns full list of uncleared H3 indices via RPC.
 *
 * WARNING: Returns ~130k strings (~5MB) for Brooklyn.
 * Use server-side only (for Agent/clustering). Do NOT send to client.
 *
 * Uses NOT EXISTS pattern to avoid WHERE IN limits.
 *
 * @param userId - The user's UUID
 * @param borough - Borough name (default: "Brooklyn")
 */
export async function getUnclearedHexes(
  userId: string,
  borough: string = "Brooklyn"
): Promise<string[]> {
  const supabase = getServerSupabase();

  const { data, error } = await supabase.rpc("get_uncleared_hex_list", {
    p_user_id: userId,
    p_borough: borough,
  });

  if (error) {
    throw new Error(`Failed to get uncleared hexes: ${error.message}`);
  }

  return data?.map((row: { h3_index: string }) => row.h3_index) ?? [];
}
