# PageFlow Pilot

A lightweight, mobile-first read-along sandbox designed for fast social and in-app-browser visits. It carries PageFlow's editorial cream/stone palette, serif-led branding, full-document active-word highlighting, and punctuation-aware pacing into a purpose-built static pilot.

## Local development

Requirements: Node.js 20.19+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

The reader works without environment variables. Anonymous analytics and feedback remain unavailable until Supabase is configured. The full-product CTA uses `VITE_MAIN_SITE_URL` with the verified PageFlow production URL as its fallback.

## Production

- Pilot: <https://pageflow-pilot.vercel.app>
- Full PageFlow: <https://pageflow-speed-reader.vercel.app>
- Deployments: connected to the `Vish6300/PageFlow-Pilot` GitHub repository through Vercel
- Analytics: connected to the existing `pageflow-speed-reader` Supabase project

## Supabase setup

1. Open the existing Supabase project's SQL Editor.
2. Run `supabase/migrations/20260819000000_create_pilot_analytics.sql`.
3. Add the project URL and anon key to `.env.local` or the Vercel environment.
4. Use `supabase/admin_queries.sql` only from SQL Editor or a trusted server-side connection.

The migration keeps all records in an unexposed `pilot_private` schema. Anonymous users receive no table privileges and no `SELECT`, `UPDATE`, or `DELETE` policies. Three narrowly scoped `SECURITY DEFINER` RPCs accept writes only when a per-session 256-bit secret matches its stored SHA-256 hash. Events and feedback revisions are append-only, bounded, validated, and idempotent where retries need it. Feedback updates become new revisions; the private `pilot_feedback_current` view resolves the latest response.

The browser stores a random session UUID and write secret in local storage. Collected fields are limited to compact product events, sample/topic, WPM, active seconds, viewport category/width, referrer hostname, and supplied UTM values. The app does not submit raw IP addresses, user-agent strings, article text, names, or email addresses. Supabase infrastructure may still process network metadata under the project's own platform settings.

## Analytics semantics

Activation is the first `play_started`. Primary meaningful engagement is emitted once per anonymous session after at least 10 seconds of active playback **and** either 50% progress in one sample or opening a second sample. Milestones are recorded once per sample at 25%, 50%, 75%, and true completion.

Telemetry is queued in local storage, retried when connectivity returns, capped at 50 client events, and never blocks reading. Feedback shows honest success/error state. If Supabase is not configured, feedback reports that it cannot be saved.

## Test and build

```bash
npm test
npm run lint
npm run build
```

Tests cover whitespace tokenization, sentence grouping, ORP logic retained for future modes, punctuation pacing, completion progress, the meaningful-engagement threshold, and event deduplication.

## Deploy to Vercel

1. Import this repository as a Vite project.
2. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_MAIN_SITE_URL` for Production and Preview as appropriate.
3. Deploy. Vercel uses `npm run build`, serves `dist`, and applies the SPA rewrite and security/cache headers from `vercel.json`.

The Supabase migration has been applied and the Vercel production, preview, and development environments are configured.
