-- =====================================================
-- FIX: share/visibility model leaks (S1, S2, S3, S5, S6)
-- Run in the Supabase SQL Editor AFTER restoring the project.
--
-- Context: the entire security boundary for Hint is RLS + a handful of
-- SECURITY DEFINER RPCs. This migration closes the holes that leak the one
-- thing the app exists to protect (who claimed which gift) plus the user
-- base's emails. See the improvement report for severity ranking.
--
-- VERIFY BEFORE/AFTER: the base RLS for `lists` and `products` is NOT in
-- version control. After applying this, dump the live schema into the repo:
--   supabase db dump --schema public > supabase/schema.sql
-- and confirm `lists`/`products`/`friends`/`users` have tenant-scoped RLS.
-- =====================================================


-- -----------------------------------------------------
-- S1 + S6: get_public_hintlist must NOT return claimer PII,
--          and must NOT echo back the access/share codes.
--
-- Before: returned claimed_by, guest_claimer_name, guest_claimer_email,
-- claimed_at for every product to ANY anon caller holding the code — so the
-- owner (who holds their own code) could see who bought what, and any
-- code-holder could harvest claimer names+emails. Also echoed both
-- access_code and share_code, so looking up by one revealed the other.
--
-- After: products expose only an `is_claimed` boolean. No codes in the
-- payload. The web viewer already filters claimed items out of the DOM;
-- now the data simply isn't shipped to the browser at all.
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION get_public_hintlist(p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_list RECORD;
  v_products JSON;
BEGIN
  p_code := UPPER(TRIM(p_code));

  SELECT * INTO v_list
  FROM lists
  WHERE (access_code = p_code OR share_code = p_code)
    AND is_public = true
  LIMIT 1;

  IF v_list IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Hintlist not found or not public'
    );
  END IF;

  -- Only non-identifying fields. `is_claimed` lets the viewer hide/disable
  -- claimed items without ever revealing the claimer.
  SELECT json_agg(row_to_json(p))
  INTO v_products
  FROM (
    SELECT
      id,
      list_id,
      name,
      url,
      image_url,
      current_price,
      target_price,
      notes,
      created_at,
      (claimed_by IS NOT NULL OR guest_claimer_email IS NOT NULL) AS is_claimed
    FROM products
    WHERE list_id = v_list.id
    ORDER BY created_at DESC
  ) p;

  RETURN json_build_object(
    'success', true,
    'list', json_build_object(
      'id', v_list.id,
      'name', v_list.name,
      'user_id', v_list.user_id,
      'is_public', v_list.is_public,
      'key_date', v_list.key_date,
      'notification_level', v_list.notification_level,
      'created_at', v_list.created_at
      -- access_code / share_code intentionally omitted (S6)
    ),
    'products', COALESCE(v_products, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_hintlist TO anon, authenticated;


-- -----------------------------------------------------
-- S2 + S3: points_history / user_stats are PII (every user's email + name)
-- and were world-readable AND world-writable by anon.
--
--   * "Anyone can view ... USING (true)"  + GRANT SELECT TO anon
--       -> full email harvest of the user base.
--   * GRANT INSERT,UPDATE TO anon + "FOR ALL USING (true)" + award_points
--     EXECUTE to anon -> anyone could overwrite any user's points/name/badges.
--
-- Fix: revoke all direct anon/authenticated table access and drop the
-- permissive policies. The leaderboard RPCs are SECURITY DEFINER (run as the
-- function owner) so they keep working without any direct grants.
-- -----------------------------------------------------

-- Drop the permissive policies (names from supabase-leaderboard.sql).
DROP POLICY IF EXISTS "Anyone can view points_history"          ON points_history;
DROP POLICY IF EXISTS "Service role can insert points_history"  ON points_history;
DROP POLICY IF EXISTS "Anyone can view user_stats"              ON user_stats;
DROP POLICY IF EXISTS "Service role can manage user_stats"      ON user_stats;

-- RLS stays enabled with NO permissive policy -> direct client access denied.
-- SECURITY DEFINER RPCs bypass RLS as the table owner, so reads still work
-- through get_leaderboard / get_user_rank / get_user_stats.
ALTER TABLE points_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats     ENABLE ROW LEVEL SECURITY;

-- Remove the direct table grants that bypassed the intent above.
REVOKE SELECT, INSERT, UPDATE, DELETE ON points_history FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON user_stats     FROM anon, authenticated;

-- award_points takes arbitrary (p_user_id, p_points, ...) — must not be
-- callable by unauthenticated clients. Keep it for authenticated callers only.
-- NB: CREATE FUNCTION grants EXECUTE to PUBLIC by default, so revoking only
-- `anon` leaves the PUBLIC grant and anon retains access. Revoke PUBLIC, then
-- re-grant explicitly to the roles that should keep it (authenticated clients +
-- service role) so we don't depend on the default PUBLIC grant.
REVOKE EXECUTE ON FUNCTION award_points FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION award_points TO authenticated, service_role;
-- NOTE (follow-up, not done here to avoid an untested signature change):
-- award_points still trusts its params, so a logged-in user can still forge
-- points for themselves or others. Harden it to require
-- auth.uid() = p_user_id (or move point-awarding fully server-side).


-- -----------------------------------------------------
-- S5: check_price_alerts() is a cron/edge-function helper that returns EVERY
-- alert-enabled product and its owner_id across all tenants. It must not be
-- reachable by anon/authenticated clients — only the service role (used by
-- the check-price-alerts edge function) should call it.
-- -----------------------------------------------------
-- Revoke PUBLIC too (default grant), then re-grant only to service_role so the
-- check-price-alerts edge function (which uses the service role key) still works.
REVOKE EXECUTE ON FUNCTION check_price_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_price_alerts() TO service_role;


-- =====================================================
-- DONE. Remaining follow-ups tracked in the report:
--   * Harden award_points caller validation (auth.uid() = p_user_id).
--   * Mask/remove raw email in get_leaderboard / get_user_rank output.
--   * Make guest_claim_product claim-update atomic (S9 TOCTOU).
--   * Reconcile claim_product_as_guest vs guest_claim_product naming.
-- =====================================================
