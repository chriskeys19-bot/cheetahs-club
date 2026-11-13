# Feedback sheet sync

App feedback lives in Supabase table `public.feedback`. The clubhouse writes that table from the browser and nowhere else. Do not call Google Sheets, Google Drive, or Apps Script from the client.

`sync-feedback-sheet` appends rows to the Google Sheet. The member's confirmation means the row is stored in Supabase. The sheet follows. If the sheet write fails, the row stays unsynced and a later run tries again.

## Why Apps Script

The sheet is owned by the club Google account. A bound Apps Script runs as that account, so there is no Google Cloud project and no service-account JSON key to store. The Edge Function POSTs to the script's web app URL with a shared secret. The secret is generated in Supabase Vault. The only value pasted by hand is that secret, once, into the Apps Script project, plus the web app URL back into Vault.

A stranger who finds the web app URL still needs the secret. The service role key is not sent to Google and is not stored in the cron job.

## Google account and sheet

Sign in as **cheetahscc123@gmail.com**. Do not use another Google account for the script, the deployment, or the sheet. Do not use the old cricketcrazeusa account.

The spreadsheet is:

https://docs.google.com/spreadsheets/d/1OjRuhozgCTz5myfPkYMjteSE50WeQVimS1dNL61mSpQ/edit

Rows are appended on the tab named **Feedback**, columns A–E. Open that file while signed in as cheetahscc123@gmail.com, then Extensions → Apps Script, so the script is bound to it. The script refuses to write if it is bound to a different file, or if the Feedback tab is missing. Do not commit the web app URL or the `SYNC_SECRET` value.

## Visible columns

On the Feedback tab, A1:E1 is:

| Timestamp | Submitter name | Submitter email | Role | Suggestion |

| Sheet column | Supabase column | Notes |
| --- | --- | --- |
| Timestamp | `created_at` | UTC timestamp from the database, ISO-8601. The stamp trigger sets this on insert. |
| Submitter name | `submitter_name` | Taken from `profiles.full_name`, or the email local-part when the profile has no name. |
| Submitter email | `submitter_email` | Taken from the auth user. |
| Role | `role` | `admin`, `captain`, or `player`, copied from `profiles` at insert time. |
| Suggestion | `body` | The text the member sent. Required, trimmed, 1–2000 characters. |

New rows start `body` with a category tag and one space: `[Feature] `, `[Bug] `, or `[Other] `, then the member's text. The sheet still has one Suggestion column, and that column is the full `body`, tag included. Rows saved before the tag have no prefix. Do not add a sixth visible column for category. `stamp_feedback` still overwrites identity fields and does not read or change `body`.

`id` is the stable primary key. The script stores it on a hidden sheet named `Sync ids`. The same note is not appended twice. It is not one of the five visible columns.

If A1:E1 on Feedback is empty, the script writes that header. Any other header on that tab is left alone and the write fails until A1:E1 matches. Other tabs are not used for feedback.

## Who can read and write

- A signed-in member can insert a row and read their own rows.
- The database overwrites `user_id`, name, email, role, and timestamp from the session. A client cannot file feedback as someone else.
- An admin can read every row.
- Anonymous users have no access.
- Members cannot update or delete rows through the API.
- `private.feedback_sheet_sync` records `synced_at`, `last_error`, and `attempt_count`. It is not in the API. Members cannot mark a row synced or clear a failure. Only the service role can, through `feedback_sheet_pending` and `feedback_sheet_result`.

## What runs after a save

1. The insert commits even if Google is down. The trigger uses `pg_net`, which does not wait on the response, and it swallows a queue error.
2. The trigger POSTs `{ "feedback_id": "<uuid>" }` to `sync-feedback-sheet` with header `x-feedback-sync`. The header is `feedback_sheet_secret` from Vault.
3. The function loads that row if it is still unsynced, POSTs it to the Apps Script, and on success sets `synced_at`. A duplicate id already on the hidden sheet counts as success.
4. The hourly job `sync-feedback-sheet-hourly` (minute 20) sends `{"backfill":true}` and copies any rows still waiting, oldest first, up to a short batch. That is the retry and the backfill of rows that existed before this job.

The function accepts the Vault header, the service role key, or an admin JWT. It does not accept a player's JWT. `verify_jwt` is off so the trigger can reach the handler. The handler still rejects everyone else.

## Setup

Apply `supabase/migrations/20261113043100_feedback_google_sheet.sql` first. It enables `pg_cron` and `pg_net` if the Splitwise migration has not already, generates `feedback_sheet_secret` in Vault, and schedules the hourly retry. It does not know the Apps Script URL yet.

Deploy the function:

```bash
supabase functions deploy sync-feedback-sheet --no-verify-jwt --project-ref lutcbvzunjcosncvdyke
```

While signed in as cheetahscc123@gmail.com, open the spreadsheet linked above (the one whose tab is Feedback). Do this in that account. The Apps Script project, the web app deployment, and the authorization prompt all have to be that same account.

1. Extensions → Apps Script.
2. Replace the default script with `google-apps-script/feedback-sheet/Code.gs` from this repo. If the project has an `appsscript.json`, replace it with the copy in that folder. The timezone in that file is only for the script editor.
3. Project Settings → Script properties → Add property. Name `SYNC_SECRET`. The value is the Vault secret, from the SQL editor:

```sql
select decrypted_secret
from vault.decrypted_secrets
where name = 'feedback_sheet_secret';
```

4. Deploy → New deployment → Select type: Web app.
5. Execute as: **Me** (cheetahscc123@gmail.com).
6. Who has access: **Anyone**. "Anyone with a Google account" rejects the Edge Function, because that call has no Google user. The secret is what keeps the URL from accepting other clients.
7. Authorize the script when Google asks. Copy the web app URL. It ends in `/exec`.
8. Store that URL in Vault:

```sql
select vault.create_secret(
  'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
  'feedback_sheet_url',
  'Apps Script web app for Cheetahs Club feedback'
);
```

When the script changes, use Deploy → Manage deployments → Edit → Version: New version → Deploy. That keeps the same URL. A brand-new deployment changes the URL. Update Vault without creating a second secret:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'feedback_sheet_url'),
  'https://script.google.com/macros/s/NEW_DEPLOYMENT_ID/exec'
);
```

To rotate the shared secret, set the same new value in Script property `SYNC_SECRET` and in Vault:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'feedback_sheet_secret'),
  encode(extensions.gen_random_bytes(32), 'hex')
);
```

Copy the new `decrypted_secret` into the script property before the next retry. Until those two match, new notes stay in Supabase and `last_error` records the rejection.

## Backfill

Rows already in `public.feedback` have no sync row, so they count as unsynced. After the URL is in Vault, either wait for the next minute-20 run or start a pass from the SQL editor. This uses the Vault secret inside the database. You do not paste it into the command.

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
    || '/functions/v1/sync-feedback-sheet',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-feedback-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'feedback_sheet_secret')
  ),
  body := '{"backfill":true}'::jsonb,
  timeout_milliseconds := 55000
);
```

One pass sends up to a few batches. If feedback was already pasted onto the sheet by hand, clear those data rows first (keep the header) or the backfill will append them again. The hidden `Sync ids` sheet is the checkpoint. Run the statement again until this returns no rows:

```sql
select feedback.id, feedback.created_at, sync.last_error, sync.attempt_count
from public.feedback as feedback
left join private.feedback_sheet_sync as sync
  on sync.feedback_id = feedback.id
where sync.synced_at is null
   or sync.feedback_id is null
order by feedback.created_at;
```

`last_error` is null until a real attempt fails. A missing URL does not stamp an error. The function log says the URL or secret is not in Vault yet, and the rows stay unsynced.

If `supabase db push` stops on `create extension`, enable `pg_cron` and `pg_net` under Database → Extensions, then run the migration again.
