# Hint Project - Session Restart Guide

Quick reference for picking up where you left off.

**Last Updated:** June 14, 2026

---

## ⚠️ FIRST: Bring the backend back online

The Supabase project (`whbqyxtjmbordcjtqyoq`) has likely been **paused** (free tier
auto-pauses after ~7 days idle). Nothing in the app works until it's restored. Do
this before any other work.

### Step 1 — Restore the project
1. Open the Supabase dashboard → project `whbqyxtjmbordcjtqyoq`.
2. If it shows **Paused**, click **Restore** and wait for it to come back up.
3. **If it shows "deleted" / missing → STOP.** The authoritative schema lives
   only in the cloud, not in this repo (base `lists`/`products`/`friends`/`users`
   DDL + RLS and several RPCs are not committed). A deleted project cannot be
   rebuilt from this repo alone.
4. The anon key is valid until 2036 — no key rotation needed just to reconnect.

### Step 2 — Snapshot the live schema into the repo (closes the gap above)
```bash
supabase link --project-ref whbqyxtjmbordcjtqyoq
supabase db dump --schema public > supabase/schema.sql
```
Commit `supabase/schema.sql`. Confirm `lists`/`products` have tenant-scoped RLS.

### Step 3 — Apply the security migration (✅ merged to main — PR #1, commit e99a9c9)
`supabase/migrations/20260613_fix_share_visibility_leaks.sql` fixes the
share/visibility leaks (owner could see who claimed gifts; anon email harvest via
leaderboard tables). **Code is merged but NOT yet applied to the database.** Apply
via the SQL Editor or `supabase db push` **after** Step 2 so it can be verified
against the real base-table RLS.

After applying, also redeploy the **web viewer** (GitHub Pages) so the updated
`is_claimed` filter ships, and rebuild the **extension + mobile** apps to pick up
the client-side claim-privacy fixes (also merged in PR #1).

### Step 4 — Reconcile + apply the draft hardening (after Step 2)
`supabase/drafts/20260614_harden_points_and_claims.DRAFT.sql` — run the VERIFY
blocks inside it first (award_points signature, leaderboard email usage,
guest_claim_product signature, the claim RPC name mismatch), then promote it into
`supabase/migrations/` and apply.

### Step 5 — Deploy the edge functions (never deployed)
Set function secrets first (`ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`), then:
```bash
supabase functions deploy send-notification
supabase functions deploy check-price-alerts
supabase functions deploy check-due-date-reminders
```

### Step 6 — Mobile build env
Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ONESIGNAL_APP_ID` before EAS builds
(`hint-mobile-test/app.config.js`). Mobile reads these from env (not hardcoded).

---

## Current Status: Push Notifications In Progress

**Phase:** Mobile App - Build 15 deploying with Push Notifications

---

## Push Notifications - Current Progress

**Completed:**
- OneSignal account created (App ID: `839a97a7-f36e-4732-bb20-85dff738c657`)
- iOS APNs .p8 key configured in OneSignal
- App Groups created in Apple Developer Portal (`group.com.wahans.hint.onesignal`)
- `react-native-onesignal` and `onesignal-expo-plugin` installed
- OneSignal plugin enabled in app.config.js
- Database migration run (`user_push_tokens` and `notification_history` tables)
- Notification service updated with `syncPushToken()` function
- NotificationContext updated to sync tokens on auth
- Edge Functions created (not yet deployed):
  - `supabase/functions/send-notification/`
  - `supabase/functions/check-price-alerts/`
  - `supabase/functions/check-due-date-reminders/`

**Still TODO:**
1. Submit Build 15 to TestFlight (building now)
2. Add Supabase Edge Function secrets:
   - `ONESIGNAL_APP_ID` = `839a97a7-f36e-4732-bb20-85dff738c657`
   - `ONESIGNAL_REST_API_KEY` = (get from OneSignal > Settings > Keys & IDs)
3. Deploy Edge Functions to Supabase
4. Test push notifications from OneSignal dashboard
5. Set up cron jobs for automated notifications (optional)

**To continue tomorrow:**
```
Read restart.md. Continue with push notifications setup.
```

---

## What's Working (In Production)

- **Chrome Extension v1.1.0** - Full functionality with Manifest V3
- **Core Features** - Auth, multiple hintlists, product capture from 20+ retailers
- **Friends & Sharing** - Friend requests, public/private lists, 8-char share codes, QR codes
- **Claiming** - Secret claims, guest claiming (no account needed), notifications
- **Price Tracking** - Daily cron jobs for Amazon/Walmart/Target, alerts
- **Emails** - Key date reminders (60/30/15 days), claim notifications, price drops
- **Branding** - Green theme (#228855), "wishlist" terminology, dark mode
- **Web Viewer** - Working with access code validation
- **Mobile App** - React Native/Expo with full API integration

---

## Mobile App Status (TestFlight Build 15)

**Build 15 (In Progress):**
- Push notification support via OneSignal
- Added NSLocationWhenInUseUsageDescription for App Store compliance
- Push token sync to database on login

**Build 14:**
- OneSignal SDK integrated
- First push notification build (had missing location permission warning)

**Build 9:**
- Improved modal and card UI styling
- Better header icon centering (marginRight offset)
- ProductCard with 72x72 images and chips row layout

**Earlier Builds:** See git history

**Deploy to TestFlight:**
```bash
cd hint-mobile-test
eas build --platform ios --profile production
eas submit --platform ios --latest --non-interactive
```

---

## Next Up (After Push Notifications)

1. **Share Extension** - Receive shares from other apps
2. **Barcode Scanning** - Nice-to-have for in-store use
3. **Production Launch** - Move from TestFlight to App Store

**Completed:** Account Settings, Deep Linking, Push Notifications (mobile side)

---

## Quick Start Prompts

**Continue push notifications:**
```
Read restart.md. Continue with push notifications setup.
```

**Test push from OneSignal:**
1. Go to OneSignal Dashboard > Messages > Push > New Push
2. Send test to yourself

**Deploy Edge Functions:**
```bash
npm install -g supabase
supabase link --project-ref whbqyxtjmbordcjtqyoq
supabase functions deploy send-notification
supabase functions deploy check-price-alerts
supabase functions deploy check-due-date-reminders
```

**Build & deploy to TestFlight:**
```bash
cd hint-mobile-test
eas build --platform ios --profile production
eas submit --platform ios --latest --non-interactive
```

---

## Project Locations

| Project | Path |
|---------|------|
| Main Backlog | backlog.md |
| Chrome Extension | hint-extension/ |
| Mobile App | hint-mobile-test/ |
| Web Viewer | hint-gh-pages/ |
| Supabase Functions | supabase/functions/ |
| Push Notifications SQL | supabase/migrations/push-notifications.sql |
| This File | restart.md |

---

## Tech Stack Quick Reference

| Layer | Technology |
|-------|------------|
| Extension | JavaScript/HTML/CSS, Manifest V3 |
| Mobile | React Native 0.81.5, Expo 54, React Native Paper |
| Push Notifications | OneSignal |
| Backend | Supabase (PostgreSQL + Auth + Edge Functions) |
| Theme | #228855 primary, #f0f9f4 background |
| Fonts | Leckerli One (logo), Bradley Hand (emails) |
| Deploy | EAS Build + Submit, App Store Connect ID: 6757765732 |

---

## Key Credentials

| Service | ID |
|---------|-----|
| OneSignal App ID | `839a97a7-f36e-4732-bb20-85dff738c657` |
| Supabase Project | `whbqyxtjmbordcjtqyoq` |
| App Store Connect | `6757765732` |
| Bundle ID | `com.wahans.hint` |
| EAS Project ID | `8a0f6e96-2ac1-471c-964a-cfa7d5b53393` |

---

## Git Repo

**GitHub:** https://github.com/wahans/hint

Key commits:
- `527916b` - Improve modal and card UI styling (Build 9)
- (pending) - Push notifications implementation (Build 15)

---

*Update this file at the end of each session.*
