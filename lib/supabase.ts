import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { H3_RESOLUTION } from "./h3";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase credentials not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
  );
} else {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Save H3 hexagon indices to the database for the current user.
 * Uses upsert with ignoreDuplicates — re-uploading same route is idempotent.
 */
export async function saveHexagons(h3Indices: string[]): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  if (h3Indices.length === 0) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const rows = h3Indices.map((h3) => ({
    user_id: user.id,
    h3_index: h3,
    h3_resolution: H3_RESOLUTION,
  }));

  // Batch upsert in chunks to avoid payload limits
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("cleared_hexagons")
      .upsert(chunk, { onConflict: "h3_index,user_id", ignoreDuplicates: true });

    if (error) throw error;
  }
}

/**
 * Fetch all cleared hexagon indices for the current user.
 */
export async function getUserHexagons(): Promise<string[]> {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("cleared_hexagons")
    .select("h3_index");

  if (error) throw error;
  return data?.map((row) => row.h3_index) ?? [];
}

/**
 * Get the current authenticated user, or null if not signed in.
 */
export async function getCurrentUser() {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export { supabase };
