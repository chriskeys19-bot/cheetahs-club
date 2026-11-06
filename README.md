# Cheetahs Cricket Club

Clubhouse for Cheetahs Cricket Club. Members sign in with Google or with email and password, read announcements, activities, the winter schedule, and polls, check dues, and send feedback on the app. The crest in `public/crest.jpg` is the brand mark.

Feedback is stored in Supabase. The browser does not call Google Sheets. See [docs/feedback-sync.md](docs/feedback-sync.md) for the sheet columns a later sync should write.

## Stack

- Vite, React, TypeScript
- React Router (`/login`, `/auth/callback`, `/join/:token`, `/`, `/announcements`, `/activities`, `/schedules`, `/polls`, `/dues`, `/feedback`, `/invites`, `/admin`, `/admin/members`)
- Supabase Auth and Postgres (`@supabase/supabase-js`)
- Static hosting on Cloudflare Pages

The Supabase project is [https://lutcbvzunjcosncvdyke.supabase.co](https://lutcbvzunjcosncvdyke.supabase.co). Teams Alpha, Beta, and Gamma, plus `profiles` and `team_members`, are already there.

## Brand

Sampled from `public/crest.jpg` (region medians) and stored as CSS variables in `src/index.css`.

| Sample | Hex | Token |
| --- | --- | --- |
| Navy banner plate | `#28264C` | `--crest-navy`, `--color-primary` |
| Gold outline | `#D4A05C` | `--crest-gold`, `--color-secondary`, `--color-accent` |
| Gold outline mode | `#D8A050` | `--crest-gold-bright` |
| Cream field | `#FCF6EE` | `--crest-cream`, `--color-surface` |
| White field / letters | `#FFFFFF`, `#F9F9FE` | `--crest-white`, `--crest-letter` |
| Spot black | `#241720` | `--crest-ink`, `--color-text` |
| Fur | `#B17B4A` | `--crest-fur` |

`--color-accent-ink` (`#8E6944`) is the crest gold darkened toward the spot black so small text on cream and white clears WCAG AA. Buttons, the header, and Win chips keep the sampled gold.

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

Accounts are invite-only. `/login` has Continue with Google and the existing email and password form. There is no public sign-up. A Google account with no invite and no existing club profile sees **Ask your captain for an invite** and is not left signed in. A join link (`/join/:token`) can use Google or a password. The Google button keeps the invite token in `localStorage` and `sessionStorage` under `cheetahs.oauth.invite` until `/auth/callback` finishes. If that token is lost, a verified Google email that matches one pending invite still joins as a player on that side. Setup for Ben is in [docs/google-sign-in.md](docs/google-sign-in.md).

The app restores the session on reload and signs out from the clubhouse header. The role badge reads `public.profiles` (`admin`, `captain`, or `player`). New accounts are stored as `player`. Google name and picture are copied when they are present (`full_name` or `name`, and an https `avatar_url` or `picture`). Missing metadata does not block the profile row.

`VITE_ROLE_SWITCH_EMAILS` is an optional comma-separated allowlist. When it is unset, only `chriskeys19@gmail.com` sees **View as: Admin | Captain | Player** in the header, and in the bottom menu on a phone. The choice is stored in `localStorage` under `cheetahs.role-view`. While it differs from the saved role, a banner says which role is on screen and **Reset** clears it. Nav items, staff panels, and buttons follow that view. Feedback still records the saved role. Postgres permissions do not change: a preview cannot do anything row level security would deny. On project `lutcbvzunjcosncvdyke` that email already has a `profiles` row with role `admin`. If a profile is missing, invite the address or, as an admin in the SQL editor, set `profiles.role` to `admin` for that user id. Do not create the account from the app.

Captains and admins both open **Invites**. The nav link and the invite policies use the same staff check (`admin` or `captain`). Creating an invite stores a single-use token and emails `https://cheetahs-club.pages.dev/join/<token>` from `cheetahscc123@gmail.com` (display name Cheetahs Cricket Club). The recipient opens the link, then either continues with Google or enters a name and password. Password signup uses the `accept-invite` Edge Function. Google signup returns through `/auth/callback`, and `finish-google-signin` marks the same invite accepted, keeps `profiles.role` as `player`, and adds the invited side. `handle_new_user` still inserts the player row. The link cannot grant admin or captain. After a password signup they sign in on `/login`. Google leaves them in the clubhouse when the invite matches. If the email does not send, the invite stays and the captain can still copy the link. An email that already has an account is rejected here. Use **Add to a side** on the same page instead of another join link.

**Add to a side** places someone who already signed in onto Alpha, Beta, or Gamma, including a player who is already on another side. Captains and admins can add or remove those memberships. Players cannot. The club role does not change.

Admins open **Admin → Members** to see each member's name, email, and role (`player`, `captain`, or `admin`). They can switch a member between player and captain. An admin cannot change their own role, and the last admin cannot be removed. Captains and players cannot change roles. Captains still use **Invites** to invite players and to add an existing member to a side.

The same two variables power announcements, activities, schedules, polls, and dues. Do not add a service role key or a Google Sheets credential to the Vite env. Schedule rows are seeded in Postgres; the browser only reads and writes Supabase.

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
- `VITE_VENMO_ENABLED` — set to `true` to show Venmo pay buttons. Unset or any other value keeps Venmo hidden. Defaults to off.
- `VITE_VENMO_USERNAME` — optional public Venmo handle, without `@`. Used only when Venmo is enabled, and only until the first Splitwise refresh stores a real `VENMO_USERNAME`. The old placeholder `cheetahs` is ignored. Do not put Splitwise keys here.

`public/_redirects` is copied into `dist` and sends every path to `index.html` with status 200 so `/login`, `/auth/callback`, `/join/:token`, `/announcements`, `/activities`, `/schedules`, `/polls`, `/dues`, `/feedback`, `/invites`, `/admin`, and `/admin/members` survive a refresh:

```
/*    /index.html   200
```

## Database

SQL lives in `supabase/migrations`. Files through the invite workflow are already applied on the club project. Filename order matches the remote migration history. On a brand-new database, apply that directory with the Supabase CLI (`supabase db push`). Do not re-apply a file that is already in the remote history.

Phase 3 dues live in `supabase/migrations/20261106010000_phase3_dues.sql`. Amounts are USD cents. That in-app ledger is a scratch pad. The Cheetahs Splitwise group is the ledger of record, with Venmo pay links. Setup is in [docs/splitwise-venmo.md](docs/splitwise-venmo.md).

Apply `supabase/migrations/20261106180000_splitwise_snapshot.sql` on project `lutcbvzunjcosncvdyke` (`supabase db push`, or paste the file into the SQL editor). Do not put `SPLITWISE_API_KEY`, an OAuth secret, or the service role key in a `VITE_` variable or in git.

| Secret | Value |
| --- | --- |
| `SPLITWISE_API_KEY` | Personal API key from the treasurer's app at [secure.splitwise.com/apps](https://secure.splitwise.com/apps). Sent as `Authorization: Bearer`. Prefer this over OAuth. |
| `SPLITWISE_GROUP_ID` | Numeric id from `https://secure.splitwise.com/groups/<id>`. Not `0` (that id is non-group expenses). |
| `SPLITWISE_GROUP_NAME` | Optional exact group name if `SPLITWISE_GROUP_ID` is unset. The id wins when both are set. |
| `VENMO_USERNAME` | Club Venmo handle, without `@`. Public. After a refresh, pay links use this when `VITE_VENMO_ENABLED=true`. The placeholder `cheetahs` is not a handle. |
| `SPLITWISE_CRON_SECRET` | Optional. Long random string for the hourly job. Not the service role key. |
| `SPLITWISE_CLIENT_ID`, `SPLITWISE_CLIENT_SECRET`, `SPLITWISE_REFRESH_TOKEN` | Optional OAuth refresh, used only when `SPLITWISE_API_KEY` is unset. |

Venmo pay buttons stay hidden until a Pages build sets `VITE_VENMO_ENABLED=true` and a real handle is available. `VITE_VENMO_USERNAME` is the public fallback handle baked in at build time, before the first refresh. It is ignored when it is unset or still `cheetahs`. After a refresh, pay links use `VENMO_USERNAME` only when that secret is a real handle and Venmo is enabled. Pages build vars are the two Supabase values plus these Venmo settings. Never add a Splitwise secret there.

```bash
supabase functions deploy sync-splitwise --no-verify-jwt --project-ref lutcbvzunjcosncvdyke
supabase secrets set \
  SPLITWISE_API_KEY='the treasurer key' \
  SPLITWISE_GROUP_ID='12345678' \
  VENMO_USERNAME='the-club-handle' \
  SPLITWISE_CRON_SECRET="$(openssl rand -hex 32)" \
  --project-ref lutcbvzunjcosncvdyke
```

The handler still requires a captain or admin JWT, or the `x-splitwise-cron` header. `--no-verify-jwt` only lets the cron request reach that check. Map members by using the same email in Splitwise and in the clubhouse. A captain opens Dues and refreshes. Players read only their mapped balance row.

`public.feedback` holds app feedback. Signed-in members insert their own rows. Admins can read all of them. Row level security enforces that. A category tag (`[Feature] `, `[Bug] `, or `[Other] `) is stored at the start of `body`. The insert still uses the same columns, and `stamp_feedback` still stamps identity.

Phase 2 adds `announcements`, `activities`, `schedule_events`, `polls`, `poll_options`, and `poll_votes`. Signed-in members can read them. Admins and captains can change announcements, activities, schedule events, and polls. Any signed-in member can vote once on an open poll. Vote totals come from `public.poll_tallies()`, which does not return voter ids.

`schedule_events` holds league games, umpiring duties, practice, and other events (`event_type` is `league_game`, `umpiring`, `practice`, or `other`). `game_date`, `start_time`, and optional `end_time` are Pacific wall-clock values. `starts_at` and `ends_at` are the matching UTC instants. A null `team_id` on practice or other means the event is club-wide. `created_by` is stamped from the signed-in user on insert. Signed-in members can read every row. Admins and captains can insert. Admins, captains, and the creating user can update and delete. The schedules screen shows create, edit, and delete only to admins and captains, and delete asks for confirmation. Players stay read-only in the UI. The winter league games are seeded from the Alpha, Beta, and Gamma tabs of the winter sheet. Schedules and This Week list only those Cheetahs league games. Wednesday practice is a separate filter. Umpiring duties are not shown as games. Completed lists league games whose `match_status` is `completed` or that have a posted result, with the Win or Loss chip and scorecard link. Upcoming lists league games that have not started and have no result. A past start by itself does not put a game in Completed.

The home page section **What's happening this week** lists events whose `game_date` falls in the current club week. A week is Monday through Sunday in America/Los_Angeles.

Wednesday Cheetahs practice is seeded from the next Wednesday after 2026-11-05 (2026-11-11) through 2027-03-31, 8:30–10:00 PM Pacific, at US Cricket Store, 121 Ranch Dr, Milpitas, CA 95035. Those rows are club-wide (`team_id` null, `event_type` `practice`).

On create, admins and captains can mark a schedule event or an activity as recurring: Daily, Weekly, Biweekly, or Monthly, in America/Los_Angeles civil dates. They choose an inclusive end date or a number of occurrences. The app writes one row per date, up to 52. A longer range is rejected and nothing is saved. Rows from one save share `series_id`. Editing or deleting one row does not change the others.

League games store `venue_side` (`home` or `away`). The winter sheet has no home/away column, so seeded rows stay null and the cards show — until a captain sets them. `ball_color` and `dress_code` are optional overrides. When they are null, Alpha and Beta display White Ball and Cheetahs Colors, and Gamma displays Pink Ball and Whites. `result` is `win`, `loss`, `draw`, or `nr`. `scorecard_url` is an http(s) link. `match_status` is `scheduled` or `completed`. A past start is treated as completed even when the status is still scheduled. Result and scorecard show on completed league games. Players can read these fields. Admins and captains write them.

Scorecard links are public `https://cricclubs.com` URLs. Captains paste or edit them on the game. The only stream links on record here are the three CricketCraze setup links Ben supplied, matched by side, opponent, and Pacific date. `result` stays null because those pages did not return a verifiable win or loss. The matches are Beta vs Livermore Monks on 1 Nov 2026, Alpha vs Cougars Black on 1 Nov 2026, and Alpha vs BT Knights on 25 Oct 2026 at Caroline Davis School. That October game was not on the winter sheet, so the migration adds the row. No other scorecards were invented, and no Gamma link was on record.

`public.invites` holds player join links. Admins and captains can insert, read, and revoke pending rows (`private.is_staff()`). Players cannot read the table, so tokens are not listed to them. Accepting a link is `accept-invite` (service role). `preview-invite` checks a token before the form is shown. Both functions authenticate with the token itself (`verify_jwt` is off; see `supabase/config.toml`). Deploy them with the Supabase CLI if they are not already on the project:

```bash
supabase functions deploy preview-invite --no-verify-jwt --project-ref lutcbvzunjcosncvdyke
supabase functions deploy accept-invite --no-verify-jwt --project-ref lutcbvzunjcosncvdyke
supabase functions deploy send-invite-email --project-ref lutcbvzunjcosncvdyke
supabase functions deploy finish-google-signin --project-ref lutcbvzunjcosncvdyke
```

`finish-google-signin` keeps JWT verification on. Apply `supabase/migrations/20261106041946_google_oauth_profile.sql` before relying on the avatar column. Google Cloud and Supabase URL steps are in [docs/google-sign-in.md](docs/google-sign-in.md).

`send-invite-email` keeps JWT verification on. Only a signed-in captain or admin can call it. It loads the pending invite with that user's row level security, then sends the join link. It does not take an email address or token from the browser.

Set these secrets on project `lutcbvzunjcosncvdyke` before sends will work. Do not put them in Vite env or in git.

| Secret | Value |
| --- | --- |
| `INVITE_SMTP_USER` | `cheetahscc123@gmail.com` |
| `INVITE_SMTP_PASS` | Gmail App Password for that mailbox (2-Step Verification required). Not the normal Gmail password. |
| `INVITE_FROM_NAME` | Optional. Defaults to `Cheetahs Cricket Club`. |
| `APP_ORIGIN` | Optional. Defaults to `https://cheetahs-club.pages.dev`. |

```bash
supabase secrets set \
  INVITE_SMTP_USER=cheetahscc123@gmail.com \
  INVITE_SMTP_PASS='the app password' \
  INVITE_FROM_NAME='Cheetahs Cricket Club' \
  --project-ref lutcbvzunjcosncvdyke
```

The function uses Gmail SMTP on port 465. Supabase Edge blocks outbound ports 25 and 587. Until `INVITE_SMTP_PASS` is set, captains still get the copyable join link.

Admins list members with `public.list_club_members()` and change a role with `public.set_member_role(target_id, new_role)`. Both are security-invoker wrappers. The privileged work runs in `private`, and only an admin can call it successfully. `authenticated` cannot update `profiles.role` directly. Trigger `profiles_guard_role` rejects a role change from anyone except an admin changing someone else, and it rejects removing the last admin. Signup and invite acceptance still store `player`.

`public.team_members` is who plays for which side. Signed-in members can read it. Insert and delete are allowed only when `private.is_staff()` is true, so an admin or captain can add an existing member to Alpha, Beta, or Gamma, and a player cannot add themselves. There is no update policy. `anon` cannot insert, update, delete, or truncate the table, because truncate ignores row level security. Row level security is forced. `accept-invite` still inserts the new player's side with the service role, which bypasses those policies. The migration is `20261105192141_staff_team_membership.sql`, applied on project `lutcbvzunjcosncvdyke`.

Captains and admins load that picker with `public.list_team_roster()`. It is a security-invoker wrapper around `private.list_team_roster()`, which is security definer, checks `private.is_staff()`, and reads email from `auth.users`. Players cannot call it. `public.list_club_members()` stays admin-only and is still what **Admin → Members** uses for role changes.
