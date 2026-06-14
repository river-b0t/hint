# Hint — Share/Visibility Security Findings

> Security/correctness pass over the share/visibility model (who can see whose
> list, claim-without-revealing-to-owner). Generated June 14, 2026.
>
> **Status legend** — migration fixes are *merged to `main` but not yet applied
> to the database*; client fixes are *merged but need a redeploy/rebuild to ship*.
> See `restart.md` for the apply/deploy runbook. Findings PR: #1 (`e99a9c9`).

## Share/visibility findings — S1–S9

| ID | Sev | Surface | Location | Issue | Status |
|----|-----|---------|----------|-------|--------|
| S1 | 🔴 Crit | DB RPC | `get_public_hintlist` | Returned `claimed_by`/`guest_claimer_name`/`guest_claimer_email` to anyone with the code → owner sees who claimed; emails harvestable | ✅ Fixed in migration — **apply to DB** |
| S2 | 🔴 Crit | DB / RLS | `points_history`, `user_stats` | World-readable (`USING(true)` + anon SELECT) → full user-base email harvest | ✅ Fixed in migration — **apply to DB** |
| S3 | 🔴 Crit | DB / RLS | `user_stats`, `award_points` | World-writable + `award_points` anon-callable → forge/overwrite any user's points/name/badges | ⚠️ Anon path fixed in migration; authenticated-caller forgery still open → identity-binding in draft |
| S4 | 🟠 High | mobile | `hint-mobile-test/src/screens/lists/ListDetailScreen.tsx:268` | Owner's own-list modal showed "✓ Claimed by {name}" → spoils surprise | ✅ Fixed in client — **rebuild mobile app** |
| S5 | 🟠 High | DB RPC | `check_price_alerts()` | Anon-callable; enumerates every alert product + `owner_id` cross-tenant | ✅ Fixed in migration — **apply to DB** |
| S6 | 🟡 Med | DB RPC | `get_public_hintlist` | Echoed both `access_code` and `share_code` → one reveals the other | ✅ Fixed in migration — **apply to DB** |
| S7 | 🟡 Med/Low | web | `github-pages-upload/app.js:92` | Unclaim page rendered `guest_claimer_name` | ✅ Fixed in client — **redeploy** |
| S8 | 🟡 Med/Low | extension | `hint-extension/modules/lists.js:~398` | CSV export included "Claimed By" identity | ✅ Fixed in client — **rebuild extension** |
| S9 | 🟢 Low | DB RPC | `guest_claim_product` | Check-then-update TOCTOU → double claim under race | 📝 Fixed in draft — **not applied** |

Not a finding: the hardcoded **anon key** in the extension/web is expected (anon
keys are public by design). It is only dangerous because RLS is the sole defense —
which is what S1–S3/S5 were about.

## Review-round findings (self-review on PR #1)

| ID | Sev | Location | Issue | Status |
|----|-----|----------|-------|--------|
| R1 | 🔴 High | `hint-gh-pages/index.html:710` + root `index.html` | S1's contract change dropped fields the viewer filtered on → claimed items showed as "available" | ✅ Fixed (now filters `is_claimed`) — **redeploy** |
| R2 | 🔴 High | `supabase/migrations/20260613_*.sql` revokes (`award_points`, `check_price_alerts`) | `REVOKE … FROM anon` left the default `PUBLIC` execute grant → still anon-callable | ✅ Fixed (`REVOKE FROM PUBLIC` + explicit re-grant) — **apply to DB** |
| R3 | 🟡 Med | draft `get_leaderboard` | Email masking may break current-user highlight if client keys on email | 📝 Draft — gated on client check |

## Still in the draft (not applied)

`supabase/drafts/20260614_harden_points_and_claims.DRAFT.sql` — run its VERIFY
blocks against the live schema before promoting:

- **Leaderboard raw email** in `get_leaderboard` output (S2-adjacent PII) → `mask_email()`.
- **`award_points` authenticated-caller forgery** (S3 tail) → bind `auth.uid() = p_user_id` + clamp points.
- **`guest_claim_product` TOCTOU** (S9) → atomic conditional UPDATE.
- **RPC name mismatch**: `claim_product_as_guest` / `claim_product_guest` / `guest_claim_product` → standardize on the canonical name.

## Where things stand

Every 🔴 is fixed in merged code; **none are live yet**. Two gates remain:

1. **Apply the migration to the DB** — `supabase/migrations/20260613_fix_share_visibility_leaks.sql` (after restoring the project and dumping the live schema; see `restart.md`).
2. **Redeploy web / rebuild apps** — GitHub Pages web viewer (R1, S7) + extension (S8) + mobile (S4).

Nothing applied to production has changed from this pass alone.
