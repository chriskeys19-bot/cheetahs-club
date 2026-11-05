# Feedback sheet sync

App feedback lives in Supabase table `public.feedback`. The clubhouse writes that table from the browser and nowhere else. Do not call Google Sheets, Google Drive, or Apps Script from the client.

A later job can copy new rows onto a Google Sheet. That job is not part of this phase.

## Google account

The club app account that should own the sheet and any later sync credentials is **cheetahscc123@gmail.com**.

Do not use the old cricketcrazeusa account for this app. Do not commit service-account keys, OAuth secrets, or sheet IDs that are private.

## Visible columns

The sheet header, in this order:

| Timestamp | Submitter | Email | Role | Suggestion |

| Sheet column | Supabase column | Notes |
| --- | --- | --- |
| Timestamp | `created_at` | UTC timestamp from the database. The stamp trigger sets this on insert. |
| Submitter | `submitter_name` | Taken from `profiles.full_name`, or the email local-part when the profile has no name. |
| Email | `submitter_email` | Taken from the auth user. |
| Role | `role` | `admin`, `captain`, or `player`, copied from `profiles` at insert time. |
| Suggestion | `body` | The text the member sent. Required, trimmed, 1–2000 characters. |

New rows start `body` with a category tag and one space: `[Feature] `, `[Bug] `, or `[Other] `, then the member's text. The sheet still has one Suggestion column, and that column is the full `body`, tag included. Rows saved before the tag have no prefix. Do not add a sixth column for category. `stamp_feedback` still overwrites identity fields and does not read or change `body`.

`id` is the stable primary key. Keep it in the sync job (a hidden column or a checkpoint table) so the same note is not appended twice. It is not one of the five visible columns.

## Who can read and write

- A signed-in member can insert a row and read their own rows.
- The database overwrites `user_id`, name, email, role, and timestamp from the session. A client cannot file feedback as someone else.
- An admin can read every row.
- Anonymous users have no access.
- Members cannot update or delete rows through the API.

## Sync shape

When the sync is built, it should:

1. Read `public.feedback` with a server-side key, ordered by `created_at`.
2. Append only rows whose `id` is not already recorded.
3. Write the five columns above.
4. Leave the Supabase row as the source of truth if the sheet write fails.

Until that job exists, the clubhouse confirmation means the feedback is stored in Supabase only.
