# Cheetah Cricket Club

Clubhouse for Cheetah Cricket Club. Members sign in with email and password, read announcements, activities, the winter schedule, and polls, and send a suggestion. The crest in `public/crest.jpg` is the brand mark.

Suggestions are stored in Supabase. The browser does not call Google Sheets. See [docs/feedback-sync.md](docs/feedback-sync.md) for the sheet columns a later sync should write.

## Stack

- Vite, React, TypeScript
- React Router (`/login`, `/`, `/announcements`, `/activities`, `/schedules`, `/polls`, `/feedback`, `/admin`)
- Supabase Auth and Postgres (`@supabase/supabase-js`)
- Static hosting on Cloudflare Pages

The Supabase project is [https://lutcbvzunjcosncvdyke.supabase.co](https://lutcbvzunjcosncvdyke.supabase.co). Teams Alpha, Beta, and Gamma, plus `profiles` and `team_members`, are already there.

## Brand

| Token | Hex |
| --- | --- |
| Navy | `#202050` |
| Gold | `#D0A050` |
| Cream | `#F7F4EA` |
| White | `#FFFFFF` |
| Near-black | `#0A0A0A` |

## Local development

```bash
cp .env.example .env.local
```

Set both variables from the Supabase project's API settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` — the anon (publishable) key

Never put the service role key in a `VITE_` variable. Vite inlines these values into the browser bundle at build time.

```bash
npm install
npm run dev
```

Accounts are email and password. The app restores the session on reload and signs out from the clubhouse header. The role badge reads `public.profiles` (`admin`, `captain`, or `player`). New signups are stored as `player`.

The same two variables power announcements, activities, schedules, and polls. Do not add a service role key or a Google Sheets credential to the Vite env. Schedule rows are seeded in Postgres; the browser only reads and writes Supabase.

## Production build

```bash
npm run build
```

Output directory: `dist`.

## Cloudflare Pages

This is a static single-page app.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node | 20 or newer |

Set these environment variables on the Pages project **before** the build. Vite reads them at build time, not at request time:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`public/_redirects` is copied into `dist` and sends every path to `index.html` with status 200 so `/login`, `/announcements`, `/activities`, `/schedules`, `/polls`, `/feedback`, and `/admin` survive a refresh:

```
/*    /index.html   200
```

## Database

SQL lives in `supabase/migrations` and is already applied on the club project. Filename order matches the remote migration history. On a brand-new database, apply that directory with the Supabase CLI (`supabase db push`). Do not re-apply the files by hand against the existing project.

`public.feedback` holds suggestions. Signed-in members insert their own rows. Admins can read all of them. Row level security enforces that.

Phase 2 adds `announcements`, `activities`, `schedule_events`, `polls`, `poll_options`, and `poll_votes`. Signed-in members can read them. Admins and captains can change announcements, activities, fixtures, and polls. Any signed-in member can vote once on an open poll. Vote totals come from `public.poll_tallies()`, which does not return voter ids. `schedule_events` is seeded with the Winter 2026-27 league games and umpiring duties. `game_date` and `start_time` are Pacific wall-clock values. `starts_at` is the matching UTC instant.
