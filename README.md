# Cheetahs Cricket Club

Clubhouse for Cheetahs Cricket Club. Members sign in with email and password, read announcements, activities, the winter schedule, and polls, and send feedback on the app. The crest in `public/crest.jpg` is the brand mark.

Feedback is stored in Supabase. The browser does not call Google Sheets. See [docs/feedback-sync.md](docs/feedback-sync.md) for the sheet columns a later sync should write.

## Stack

- Vite, React, TypeScript
- React Router (`/login`, `/join/:token`, `/`, `/announcements`, `/activities`, `/schedules`, `/polls`, `/feedback`, `/invites`, `/admin`)
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

Accounts are email and password. There is no public sign-up on `/login`. The app restores the session on reload and signs out from the clubhouse header. The role badge reads `public.profiles` (`admin`, `captain`, or `player`). New accounts are stored as `player`.

Captains and admins invite players from **Invites**. Creating an invite stores a single-use token and shows `https://cheetahs-club.pages.dev/join/<token>` to copy. The app does not send that email yet. A later mailer (Resend or SMTP) can send the same URL; do not block the invite on club Gmail. The recipient opens the link, enters their name and a password, and the `accept-invite` Edge Function creates the auth user. `handle_new_user` sets `profiles.role` to `player`. The link cannot grant admin or captain. After that they sign in on `/login`.

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

`public/_redirects` is copied into `dist` and sends every path to `index.html` with status 200 so `/login`, `/join/:token`, `/announcements`, `/activities`, `/schedules`, `/polls`, `/feedback`, `/invites`, and `/admin` survive a refresh:

```
/*    /index.html   200
```

## Database

SQL lives in `supabase/migrations` and is already applied on the club project. Filename order matches the remote migration history. On a brand-new database, apply that directory with the Supabase CLI (`supabase db push`). Do not re-apply the files by hand against the existing project.

`public.feedback` holds app feedback. Signed-in members insert their own rows. Admins can read all of them. Row level security enforces that. A category tag (`[Feature] `, `[Bug] `, or `[Other] `) is stored at the start of `body`. The insert still uses the same columns, and `stamp_feedback` still stamps identity.

Phase 2 adds `announcements`, `activities`, `schedule_events`, `polls`, `poll_options`, and `poll_votes`. Signed-in members can read them. Admins and captains can change announcements, activities, schedule events, and polls. Any signed-in member can vote once on an open poll. Vote totals come from `public.poll_tallies()`, which does not return voter ids.

`schedule_events` holds league games, umpiring duties, practice, and other events (`event_type` is `league_game`, `umpiring`, `practice`, or `other`). `game_date`, `start_time`, and optional `end_time` are Pacific wall-clock values. `starts_at` and `ends_at` are the matching UTC instants. A null `team_id` on practice or other means the event is club-wide. `created_by` is stamped from the signed-in user on insert. Signed-in members can read every row. Admins and captains can insert. Admins, captains, and the creating user can update and delete. The schedules screen shows create, edit, and delete only to admins and captains, and delete asks for confirmation. Players stay read-only in the UI. The winter league games and umpiring duties are seeded.

The home page section **What's happening this week** lists events whose `game_date` falls in the current club week. A week is Monday through Sunday in America/Los_Angeles.

Wednesday Cheetahs practice is seeded from the next Wednesday after 2026-11-05 (2026-11-11) through 2027-03-31, 8:30–10:00 PM Pacific, at US Cricket Store, 121 Ranch Dr, Milpitas, CA 95035. Those rows are club-wide (`team_id` null, `event_type` `practice`).

`public.invites` holds player join links. Admins and captains can insert, read, and revoke pending rows. Players cannot read the table, so tokens are not listed to them. Accepting a link is `accept-invite` (service role). `preview-invite` checks a token before the form is shown. Both functions authenticate with the token itself (`verify_jwt` is off; see `supabase/config.toml`). Deploy them with the Supabase CLI if they are not already on the project:

```bash
supabase functions deploy preview-invite --no-verify-jwt --project-ref lutcbvzunjcosncvdyke
supabase functions deploy accept-invite --no-verify-jwt --project-ref lutcbvzunjcosncvdyke
```
