# Winter dues sheet

My dues reads the Google Sheet **Cheetah CC Finance_2026**. The browser does not call Google. `sync-finance-sheet` copies three tabs into Supabase. Players see their own rows. Captains and admins see every row. The function only reads the sheet.

Splitwise keeps syncing. It stays on the Dues page under **Splitwise**. The winter sheet is what My dues, the Zelle memo, and the line items use. The in-app expenses and charges tabs stay a scratch pad and do not change the sheet.

## Sheet

https://docs.google.com/spreadsheets/d/1ny69ZpWL6c9r_1xofvROJfcVzWlviWAqKYKdvJtY-Ic/edit

| Tab | What is copied |
| --- | --- |
| `26 Winter Club Dues` | One row per player. B name, C club status, D club fee, E fee status, G umpiring fee, H umpiring status, I money received by Saro, J money received by Ben, K total received, L total game charges, M balance due, N payment notes, O automatic credit, P manual credit. |
| `26 Winter GC Splits` | Names in row 2, columns H through AS. Charge rows from row 4. A date, B type, C team, D ground, E cost, G split by, and each player's amount. Column AV is the recon status. Row 510 is a helper row and is skipped. |
| `Game Dues Ledger` | Row 1 title, row 2 totals, row 3 headers, one player-game from row 4. A date, B team, C game number, D ground, E player, F dues, G allocated paid, H unsettled, I status, J memo, K source. |

Balance due is column M. Negative means the player owes the club. Positive is a credit. A blank cell is treated as missing, not as a crash. A blank fee status does not mark the line paid.

The line under Balance due is the payment standing, the amount still owed, and one credit. That credit is column O plus column P. It is left off when the sum is zero. Column O can be positive while column M is negative. Game rows on My dues come from Game Dues Ledger. Payment status uses allocated paid and unsettled from that tab. A memo is copied as written and replaced on the next sync. Until that tab has been copied, My dues keeps the older game-charge list.

Each line is Paid only when recorded payments (column K) cover it. Payments apply to membership first, then the umpiring fee, then game charges oldest first. Membership, a positive umpiring fee, and each game charge (game dues, water, umpire share) are separate lines. Game rows that share a date, team, game, and ground are grouped.

## Who can read it

- A signed-in player reads only rows linked to their profile, plus the Zelle address and the reminder date.
- A captain or admin reads every row, including sheet names that did not match a member.
- An admin can sync, link a sheet name to a member, change the Zelle address and the MMDD, and set a memo token.
- Anonymous users have no access.
- Nobody can write the snapshot tables through the API. The service role writes them through `replace_finance_sheet` and `relink_finance_sheet`.

## URLs

Sign-in is required. A player who opens someone else's link still sees only their own dues.

| Page | URL |
| --- | --- |
| Signed-in player | `https://cheetahs-club.pages.dev/dues` |
| One member | `https://cheetahs-club.pages.dev/dues/<profile-uuid>` |

`<profile-uuid>` is `profiles.id`, the same id as the auth user. Club sheet on the Dues page has **Copy link** for each member. Example shape: `https://cheetahs-club.pages.dev/dues/11111111-1111-4111-8111-111111111111`.

## Zelle

When the balance due is negative, the page shows:

- Send to `treasurercheetahscricket@gmail.com` (admins can change this)
- Memo `CHW26` + name + `MMDD`, one uppercase string with no spaces

`MMDD` is the latest reminder date. It starts at `1114`. Admins change it under Club sheet. The two Srivatsans use `SRIVATSANSR` and `SRIVATSANSU` when their profile names contain those second names. An admin can save a different memo name per member. A settled or empty balance does not show the Zelle box. A fully covered balance says **All paid, thank you.**

## Name matching

Built-in spellings, applied when an admin has not saved a link:

| Sheet | Member name it looks for |
| --- | --- |
| Anamol | Anmol |
| Anirdh | Anirudh |
| Chris | Christopher Selvaraj |
| Saro | Saravanan Manickavasagam |
| Sankar | Shankar |
| Sai Saketh | Sai |
| Nalan (a trailing space is ignored) | Nalan Karuppaiah |
| Anuk | Anuj |

A full name matches that profile. A first name matches only when one profile has that first name. `Srivatsan` alone matches nobody, because Srivatsan Srinivasan and Srivatsan Sundararajan both exist. `Srivatsan Srini` and `Srivatsan Sundar` match the longer names and are not merged. Names that still do not match are listed for captains and admins. An admin links one under **Link a sheet name**. That link is used on the next sync and immediately on save, without a code change.

## Why Apps Script

The sheet can live in Ben's Drive or in `cheetahscc123@gmail.com`. A standalone Apps Script, owned by an account that can open the file, runs as that account. There is no service-account JSON key in the repo. The Edge Function POSTs `{ "secret", "action": "read" }` to the web app. Google answers with a redirect, and the function GETs the echo URL with no body. The script uses the Sheets API read-only scope. It does not write cells.

Use **cheetahscc123@gmail.com** when that account can open the sheet. If the file is in another Drive, share it with `cheetahscc123@gmail.com` as **Viewer** first. Do not give the script edit access on the share. Do not commit the web app URL or the secret.

## What runs

1. Apply `supabase/migrations/20261114211000_sheet_dues.sql`, then `supabase/migrations/20261116154636_game_dues_ledger.sql`. The first stores `finance_sheet_secret` in Vault and schedules `sync-finance-sheet-hourly` at minute 40. It does not know the Apps Script URL yet. Until the URL is in Vault, the job returns without changing dues. The second stores Game Dues Ledger rows and the credit columns. A sync from the Apps Script before that script is redeployed still updates dues and leaves the ledger table as it is.
2. Deploy the function:

```bash
supabase functions deploy sync-finance-sheet --no-verify-jwt --project-ref lutcbvzunjcosncvdyke
```

`verify_jwt` is off so pg_cron can reach the handler. The handler still requires `x-finance-sync` (the Vault secret) or an admin JWT. A player or captain JWT is rejected. Deploy this after the migration, because the function calls `finance_sheet_target`, `replace_finance_sheet`, and `relink_finance_sheet`.

3. The hourly job and **Sync now** replace the stored rows. A failed read keeps the previous copy and records the error for captains and admins. **Last synced** is the last success, shown in Pacific time with the zone abbreviation.

## Setup

Do the Google steps while signed in as the account that can open the sheet, preferably cheetahscc123@gmail.com.

1. If that account cannot already open the spreadsheet, share the file with it as Viewer.
2. Open https://script.google.com/home and create a standalone project. Do not start it from Extensions → Apps Script on the spreadsheet.
3. Replace `Code.gs` with `google-apps-script/finance-sheet/Code.gs` from this repo. Replace `appsscript.json` with the copy in that folder. The manifest asks for `https://www.googleapis.com/auth/spreadsheets.readonly` and enables the Google Sheets advanced service. In the editor, if Services does not already list Google Sheets, add the Google Sheets API. The script only calls `Spreadsheets.Values.get`. It reads `'26 Winter Club Dues'!A1:P400`, `'26 Winter GC Splits'!A2:AV700`, and `'Game Dues Ledger'!A3:K2000`. The first two tab names start with an apostrophe, so those ranges double it. After this file changes, Deploy → Manage deployments → Edit → Version: New version → Deploy. Until that new version is live, the function still syncs dues and splits.
4. Project Settings → Script properties → Add property. Name `SYNC_SECRET`. The value is the Vault secret, from the SQL editor. This is not the feedback secret.

```sql
select decrypted_secret
from vault.decrypted_secrets
where name = 'finance_sheet_secret';
```

5. Deploy → New deployment → Web app.
6. Execute as: **Me** (the account that can read the sheet).
7. Who has access: **Anyone**. "Anyone with a Google account" rejects the Edge Function, because that call has no Google user. The secret is what keeps the URL from accepting other clients.
8. Authorize the script when Google asks. The consent screen is for viewing spreadsheets this account can open. Copy the web app URL. It ends in `/exec`.
9. Store that URL in Vault:

```sql
select vault.create_secret(
  'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
  'finance_sheet_url',
  'Apps Script web app that reads Cheetah CC Finance_2026'
);
```

10. On the Dues page, as an admin, choose **Sync now**. Or wait until minute 40.

When the script changes, use Deploy → Manage deployments → Edit → Version: New version → Deploy. That keeps the same URL. A brand-new deployment changes the URL. Update Vault without creating a second secret:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'finance_sheet_url'),
  'https://script.google.com/macros/s/NEW_DEPLOYMENT_ID/exec'
);
```

To rotate the shared secret, set the same new value in Script property `SYNC_SECRET` and in Vault. Copy the new value into the script property before the next run.

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'finance_sheet_secret'),
  encode(extensions.gen_random_bytes(32), 'hex')
);
```

To run one copy from the SQL editor before the next hour:

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
    || '/functions/v1/sync-finance-sheet',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-finance-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'finance_sheet_secret')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 55000
);
```

If `supabase db push` stops on `create extension`, enable `pg_cron` and `pg_net` under Database → Extensions, then run the migration again. Do not apply this migration twice.
