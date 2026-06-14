-- =====================================================
-- DRAFT (DO NOT AUTO-APPLY) — second-pass hardening
--
-- Covers the follow-ups deferred from 20260613_fix_share_visibility_leaks.sql:
--   1. award_points  — bind caller identity + clamp points (anti-forgery)
--   2. get_leaderboard — mask raw emails in output (PII)
--   3. guest_claim_product — make the claim atomic (S9 TOCTOU)
--   4. RPC name mismatch — claim_product_as_guest / claim_product_guest
--      vs the canonical guest_claim_product
--
-- WHY THIS IS A DRAFT, NOT A MIGRATION:
-- These change function *bodies and behavior*, and the base schema
-- (lists/products/friends/users + their RLS) and the real deployed function
-- signatures live ONLY in the cloud project, not in this repo. Each section
-- below has a VERIFY block. Run those first, reconcile, THEN promote this
-- file into supabase/migrations/ and apply.
--
-- Pre-req: dump the live schema so the rest can be checked:
--   supabase db dump --schema public > supabase/schema.sql
-- =====================================================


-- =====================================================
-- 1. award_points — bind caller identity + clamp points
--
-- Problem (post-migration-1): award_points is SECURITY DEFINER and callable
-- by `authenticated`. It takes arbitrary p_user_id / p_email / p_points and
-- upserts user_stats keyed by email (ON CONFLICT (email)). A logged-in user
-- can therefore:
--   * award points to ANYONE (forge p_user_id),
--   * OVERWRITE another user's stats row (forge p_email -> hits their
--     ON CONFLICT (email) row, changing name/points),
--   * inflate points arbitrarily (forge p_points).
--
-- Fix: when a real end-user JWT is present (auth.uid() IS NOT NULL), ignore
-- client-supplied identity and bind it to the caller; clamp points to a sane
-- per-event ceiling. The edge functions call with the service role
-- (auth.uid() IS NULL) and keep full control.
--
-- VERIFY:
--   - Confirm the live award_points signature matches the one below
--     (arg names/order/defaults). `\df+ award_points` in psql.
--   - Decide the real per-event point values. The clamp here is a guard, not
--     a source of truth; ideally replace client-supplied p_points entirely
--     with a server-side lookup keyed by p_event_type.
-- =====================================================
CREATE OR REPLACE FUNCTION award_points(
  p_user_id UUID DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_event_type TEXT DEFAULT 'other',
  p_points INTEGER DEFAULT 0,
  p_description TEXT DEFAULT NULL,
  p_product_id UUID DEFAULT NULL,
  p_list_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_user_email TEXT;
  v_caller UUID := auth.uid();
BEGIN
  -- Identity binding: an end-user may only award points to themselves.
  -- Service-role callers (edge functions) have auth.uid() = NULL and are
  -- trusted to pass explicit identity.
  IF v_caller IS NOT NULL THEN
    p_user_id := v_caller;
    p_email   := (SELECT email FROM auth.users WHERE id = v_caller);
  END IF;

  -- Anti-inflation clamp. Adjust the ceiling to the real max single-event
  -- award once point values are finalized.
  IF p_points IS NULL OR p_points < 0 THEN
    p_points := 0;
  ELSIF p_points > 100 THEN
    p_points := 100;
  END IF;

  v_user_email := COALESCE(p_email, (SELECT email FROM auth.users WHERE id = p_user_id));

  IF v_user_email IS NULL AND p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No user identifier provided');
  END IF;

  INSERT INTO points_history (user_id, email, name, event_type, points, description, product_id, list_id)
  VALUES (p_user_id, v_user_email, p_name, p_event_type, p_points, p_description, p_product_id, p_list_id);

  INSERT INTO user_stats (user_id, email, name, total_points, last_active_date, streak_days,
    gifts_claimed, lists_created, items_added)
  VALUES (
    p_user_id,
    v_user_email,
    COALESCE(p_name, split_part(v_user_email, '@', 1)),
    p_points,
    v_today,
    1,
    CASE WHEN p_event_type = 'claim'       THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'create_list' THEN 1 ELSE 0 END,
    CASE WHEN p_event_type = 'add_item'    THEN 1 ELSE 0 END
  )
  ON CONFLICT (email) DO UPDATE SET
    user_id      = COALESCE(EXCLUDED.user_id, user_stats.user_id),
    name         = COALESCE(EXCLUDED.name, user_stats.name),
    total_points = user_stats.total_points + p_points,
    gifts_claimed = user_stats.gifts_claimed + CASE WHEN p_event_type = 'claim'       THEN 1 ELSE 0 END,
    lists_created = user_stats.lists_created + CASE WHEN p_event_type = 'create_list' THEN 1 ELSE 0 END,
    items_added   = user_stats.items_added   + CASE WHEN p_event_type = 'add_item'    THEN 1 ELSE 0 END,
    streak_days = CASE
      WHEN user_stats.last_active_date = v_today     THEN user_stats.streak_days
      WHEN user_stats.last_active_date = v_today - 1 THEN user_stats.streak_days + 1
      ELSE 1
    END,
    last_active_date = v_today,
    updated_at = NOW();

  RETURN json_build_object('success', true, 'points_awarded', p_points);
END;
$$;

-- Keep migration-1's grant posture (authenticated + service role; not anon).
REVOKE EXECUTE ON FUNCTION award_points FROM anon;


-- =====================================================
-- 2. get_leaderboard — mask raw emails in output
--
-- Problem: get_leaderboard returns a raw `email` column to any caller. Even
-- as a top-N list that's needless PII exposure. The current-user row can be
-- identified by `user_id` instead, so the email is only a display fallback.
--
-- Fix: a mask_email() helper, applied ONLY to the projected output column.
-- Internal JOINs still use the real email.
--
-- VERIFY:
--   - Confirm clients identify "me" by user_id, not by matching the returned
--     email. If any client matches on email, switch it to user_id first, or
--     this will break current-user highlighting.
--   - Confirm the live get_leaderboard body matches the base reproduced here
--     (this is copied from supabase-leaderboard.sql; reconcile any drift).
-- =====================================================
CREATE OR REPLACE FUNCTION mask_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' IN p_email) = 0 THEN NULL
    ELSE left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2)
  END;
$$;
GRANT EXECUTE ON FUNCTION mask_email TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_leaderboard(
  p_timeframe TEXT DEFAULT 'all',
  p_limit INTEGER DEFAULT 10,
  p_friends_only BOOLEAN DEFAULT FALSE,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  name TEXT,
  points BIGINT,
  rank BIGINT,
  streak_days INTEGER,
  badges TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
BEGIN
  v_start_date := CASE p_timeframe
    WHEN 'today' THEN DATE_TRUNC('day', NOW())
    WHEN 'week'  THEN DATE_TRUNC('week', NOW())
    WHEN 'month' THEN DATE_TRUNC('month', NOW())
    ELSE '1970-01-01'::TIMESTAMPTZ
  END;

  IF p_friends_only AND p_user_id IS NOT NULL THEN
    RETURN QUERY
    WITH friend_ids AS (
      SELECT CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END AS fid
      FROM friends f
      WHERE (f.user_id = p_user_id OR f.friend_id = p_user_id)
        AND f.status = 'accepted'
      UNION
      SELECT p_user_id AS fid
    ),
    friend_points AS (
      SELECT ph.user_id, ph.email, ph.name, SUM(ph.points) AS total_points
      FROM points_history ph
      WHERE ph.created_at >= v_start_date
        AND (
          ph.user_id IN (SELECT fid FROM friend_ids)
          OR ph.email IN (SELECT u.email FROM auth.users u WHERE u.id IN (SELECT fid FROM friend_ids))
        )
      GROUP BY ph.user_id, ph.email, ph.name
    )
    SELECT
      fp.user_id,
      mask_email(fp.email) AS email,           -- masked output (was raw email)
      fp.name,
      fp.total_points AS points,
      ROW_NUMBER() OVER (ORDER BY fp.total_points DESC) AS rank,
      COALESCE(us.streak_days, 0) AS streak_days,
      COALESCE(us.badges, '{}') AS badges
    FROM friend_points fp
    LEFT JOIN user_stats us ON us.email = fp.email   -- JOIN uses real email
    ORDER BY fp.total_points DESC
    LIMIT p_limit;
  ELSE
    RETURN QUERY
    WITH ranked_users AS (
      SELECT ph.user_id, ph.email, ph.name, SUM(ph.points) AS total_points
      FROM points_history ph
      WHERE ph.created_at >= v_start_date
      GROUP BY ph.user_id, ph.email, ph.name
    )
    SELECT
      ru.user_id,
      mask_email(ru.email) AS email,           -- masked output (was raw email)
      ru.name,
      ru.total_points AS points,
      ROW_NUMBER() OVER (ORDER BY ru.total_points DESC) AS rank,
      COALESCE(us.streak_days, 0) AS streak_days,
      COALESCE(us.badges, '{}') AS badges
    FROM ranked_users ru
    LEFT JOIN user_stats us ON us.email = ru.email   -- JOIN uses real email
    ORDER BY ru.total_points DESC
    LIMIT p_limit;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION get_leaderboard TO anon, authenticated;


-- =====================================================
-- 3. guest_claim_product — atomic claim (S9 TOCTOU)
--
-- Problem: the original checks "already claimed?" with a SELECT and then
-- UPDATEs in a separate statement. Two simultaneous claims can both pass the
-- check and both write — last-writer-wins, double claim.
--
-- Fix: keep the existence/public checks for good error messages, but perform
-- the claim as a single conditional UPDATE guarded on the row still being
-- unclaimed, and detect a lost race via the affected row count.
--
-- VERIFY:
--   - Confirm the live guest_claim_product signature/return shape matches.
--   - Confirm column names (claimed_by, guest_claimer_email, unclaim_token).
-- =====================================================
CREATE OR REPLACE FUNCTION guest_claim_product(
  p_product_id UUID,
  p_claimer_name TEXT,
  p_claimer_email TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_product RECORD;
  v_unclaim_token TEXT;
  v_rows INTEGER;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Product ID required');
  END IF;
  IF TRIM(COALESCE(p_claimer_name, '')) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Name required');
  END IF;
  IF TRIM(COALESCE(p_claimer_email, '')) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Email required');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF v_product IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Product not found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM lists WHERE id = v_product.list_id AND is_public = true
  ) THEN
    RETURN json_build_object('success', false, 'error', 'List is not public');
  END IF;

  v_unclaim_token := encode(gen_random_bytes(24), 'base64');
  v_unclaim_token := replace(replace(v_unclaim_token, '+', ''), '/', '');

  -- Atomic claim: only succeeds if the row is still unclaimed at write time.
  UPDATE products
  SET
    guest_claimer_name  = TRIM(p_claimer_name),
    guest_claimer_email = LOWER(TRIM(p_claimer_email)),
    claimed_at          = NOW(),
    unclaim_token       = v_unclaim_token
  WHERE id = p_product_id
    AND claimed_by IS NULL
    AND guest_claimer_email IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Product already claimed');
  END IF;

  RETURN json_build_object('success', true, 'unclaim_token', v_unclaim_token);
END;
$$;
GRANT EXECUTE ON FUNCTION guest_claim_product TO anon, authenticated;


-- =====================================================
-- 4. RPC name mismatch (claim_product_as_guest / claim_product_guest)
--
-- Observed in the clients (verify against the live function list before
-- acting — getting arg NAMES wrong here creates a broken PostgREST overload):
--   * extension / hint-viewer-app.js : rpc 'claim_product_as_guest'
--         args { product_id, guest_name, guest_email }
--   * mobile / claim.service.ts      : rpc 'claim_product_guest'
--         args { product_id, claimer_name, claimer_email }
--   * repo SQL canonical             : guest_claim_product
--         args (p_product_id, p_claimer_name, p_claimer_email)
--
-- Two ways to reconcile:
--   (A) Rename the client calls to the canonical guest_claim_product and the
--       arg keys to p_*. Cleanest; one source of truth. Preferred.
--   (B) Keep clients as-is and add thin alias wrappers (below). Only do this
--       if you can't redeploy the clients.
--
-- VERIFY FIRST — list what actually exists in the project:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('guest_claim_product','claim_product_as_guest','claim_product_guest');
--
-- Only if option (B) and the name is confirmed MISSING, uncomment the matching
-- wrapper. Arg names MUST match what the client sends (PostgREST binds by name).
--
-- -- Alias for the extension / web viewer:
-- CREATE OR REPLACE FUNCTION claim_product_as_guest(
--   product_id UUID, guest_name TEXT, guest_email TEXT
-- ) RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
--   SELECT guest_claim_product(product_id, guest_name, guest_email);
-- $$;
-- GRANT EXECUTE ON FUNCTION claim_product_as_guest TO anon, authenticated;
--
-- -- Alias for the mobile app:
-- CREATE OR REPLACE FUNCTION claim_product_guest(
--   product_id UUID, claimer_name TEXT, claimer_email TEXT
-- ) RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
--   SELECT guest_claim_product(product_id, claimer_name, claimer_email);
-- $$;
-- GRANT EXECUTE ON FUNCTION claim_product_guest TO anon, authenticated;


-- =====================================================
-- END DRAFT. Promote to supabase/migrations/ after the VERIFY blocks pass.
-- =====================================================
