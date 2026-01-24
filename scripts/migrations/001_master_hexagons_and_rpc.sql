-- Migration: Create master_hexagons table and RPC functions for fog analysis
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- ============================================
-- 1. Create master_hexagons table
-- ============================================
CREATE TABLE IF NOT EXISTS master_hexagons (
  h3_index TEXT PRIMARY KEY,
  borough TEXT NOT NULL,
  h3_resolution INTEGER NOT NULL DEFAULT 10
);

-- Index for filtering by borough
CREATE INDEX IF NOT EXISTS idx_master_hexagons_borough ON master_hexagons(borough);

-- ============================================
-- 2. Optimize cleared_hexagons for NOT EXISTS
-- ============================================
CREATE INDEX IF NOT EXISTS idx_cleared_hexagons_h3_user 
ON cleared_hexagons(h3_index, user_id);

-- ============================================
-- 3. RPC: get_fog_summary (for UI)
-- Returns lightweight stats: { totalHexes, clearedHexes, unclearedHexes, percentComplete }
-- ============================================
CREATE OR REPLACE FUNCTION get_fog_summary(p_user_id UUID, p_borough TEXT)
RETURNS JSON AS $$
DECLARE
  v_total INTEGER;
  v_cleared INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total 
  FROM master_hexagons WHERE borough = p_borough;
  
  SELECT COUNT(*) INTO v_cleared 
  FROM cleared_hexagons c
  WHERE c.user_id = p_user_id 
  AND EXISTS (
    SELECT 1 FROM master_hexagons m 
    WHERE m.h3_index = c.h3_index AND m.borough = p_borough
  );
  
  RETURN json_build_object(
    'totalHexes', v_total,
    'clearedHexes', v_cleared,
    'unclearedHexes', v_total - v_cleared,
    'percentComplete', ROUND((v_cleared::NUMERIC / NULLIF(v_total, 0)) * 100, 2)
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. RPC: get_uncleared_hex_list (for Agent)
-- Returns full array of uncleared H3 indices
-- Uses NOT EXISTS to avoid WHERE IN limits (~65k cap)
-- ============================================
CREATE OR REPLACE FUNCTION get_uncleared_hex_list(p_user_id UUID, p_borough TEXT)
RETURNS TABLE(h3_index TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT m.h3_index 
  FROM master_hexagons m
  WHERE m.borough = p_borough
  AND NOT EXISTS (
    SELECT 1 FROM cleared_hexagons c 
    WHERE c.h3_index = m.h3_index AND c.user_id = p_user_id
  );
END;
$$ LANGUAGE plpgsql;
