# Splitwise ledger and Venmo pay links

The Cheetahs Splitwise group is the ledger of record for expenses, splits, and balances. The clubhouse keeps a copy so each member can see what they owe, and so a captain can see the group, without putting the Splitwise key in the browser.

The in-app Expenses and Local charges tabs stay as a scratch pad. Saving there does not create a Splitwise expense. Captains log club costs in Splitwise, then refresh.

## What the app does after Venmo

Venmo pay links stay hidden until a build sets `VITE_VENMO_ENABLED=true` and a real club handle is configured. The old unset handle `cheetahs` is not used. While that is off, Dues still shows Splitwise balances and Refresh, with no pay button, pay link, or setup note.

Venmo has no consumer API on this project. When it is enabled, a pay link opens Venmo with the club handle, the amount, and a note such as `Cheetahs dues · Cheetahs`.

The app does not mark a Splitwise balance paid, and it does not offer "I paid" on that balance. Two ledgers for the same dollar would disagree until someone guessed which one was real.

After the player pays, a captain records the settlement in the Splitwise group (Settle up, or a payment from that member). The next refresh copies the new balance. The in-app "I paid" button remains only on scratch-pad charges.

The pay button uses the member's net USD balance when it is negative. Negative means that member owes the group. The link pays the club Venmo handle, which fits a group where the treasurer fronts costs. Simplified debts are shown to captains so they can see who Splitwise says should pay whom. Those debts are not separate Venmo buttons.

## API terms

Splitwise's Self-Serve API is for hobby, plugin, and internal use. It is not for a commercial or fee-based product, and its rate limits can change. Cheetahs is a club ledger. If Splitwise later treats dues collection as commercial, email [developers@splitwise.com](mailto:developers@splitwise.com) before relying on the key. Do not ship this integration as a product other clubs pay for.

The sync function only sends GET requests. It does not create expenses. Adding a person uses a separate function, `splitwise-ensure-member`, which can POST `add_user_to_group`. That call does not create an expense or record a payment.

## Map the group

1. Create a Splitwise group for the club, for example `Cheetahs`.
2. Add each player with the same email they use to sign in to the clubhouse.
3. The API key must belong to an account that is in that group. Use the treasurer's account.
4. Copy the group id from `https://secure.splitwise.com/groups/<id>` into `SPLITWISE_GROUP_ID`.
5. Or set `SPLITWISE_GROUP_NAME` to the exact name and leave the id unset. If both are set, the id wins. Group id `0` is Splitwise's bucket for non-group expenses. Do not use it.
6. A dummy Splitwise user with no email cannot be matched. Invite them with the club email.
7. On Dues, a captain uses **Refresh from Splitwise**. Unmapped rows are Splitwise members whose email did not match a club account. They are visible to captains only. The other list is club profiles that were not in the group.

Matching is email only, lowercased. Names are not used.

## Add a member on sign-in

`splitwise-ensure-member` runs after a successful sign-in and again when a saved session is restored, if that profile is not marked added yet. Password sign-in, the sign-in after an invite join, and Google sign-in all go through the same auth listener. The login screen does not wait on Splitwise. A failure stays on `splitwise_membership.last_error` and is not retried for ten minutes.

The function reads the caller's email from Auth and the name from `profiles.full_name` (Google given and family names are only a display fallback). It GETs `get_group/{SPLITWISE_GROUP_ID}`. If that email is already a member, it stores `splitwise_user_id` and `splitwise_added_at` and does not invite them again. Otherwise it POSTs `add_user_to_group` with `group_id`, `email`, `first_name`, and `last_name`. Splitwise creates or invites the account. A 200 response is not enough: the body must say `success: true`.

On success the function asks `sync-splitwise` to refresh, using the service role, so the Dues card can show the new balance. That internal call may bypass the short skip window. A browser request cannot. Players still cannot call `sync-splitwise` themselves.

Existing members are recorded the next time they sign in. An admin on Dues can use **Add all members to Splitwise** to run the same check for every profile. The button skips rows that are already recorded, stops on a rate limit, and shows a count of added, already in the group, failed, and skipped. It does not create expenses.

`splitwise_membership` is one row per profile. A member can read only their own row. They cannot write it, so they cannot mark themselves added. The API key is never stored or logged. Log lines strip the key, the service role, and email addresses.

## Secrets

Set these on project `lutcbvzunjcosncvdyke`. They are Edge Function secrets, not Vite env.

| Secret | Purpose |
| --- | --- |
| `SPLITWISE_API_KEY` | Personal API key from [secure.splitwise.com/apps](https://secure.splitwise.com/apps). The function sends it as `Authorization: Bearer`. This is an access token for that Splitwise account. Treat it like a password. |
| `SPLITWISE_GROUP_ID` | Group id. Preferred. |
| `SPLITWISE_GROUP_NAME` | Exact group name, used only when the id is unset. |
| `VENMO_USERNAME` | Club handle without `@`. Written into `splitwise_meta` on a successful refresh. Not a secret, but keep it next to the other settings so a rebuild is not required. Leave it unset until the club wants pay links. The stored sentinel `cheetahs` is not shown. |
| `SPLITWISE_CRON_SECRET` | Optional shared secret for the scheduled job. Generate with `openssl rand -hex 32`. Do not reuse the service role key. |
| `SPLITWISE_CLIENT_ID` | Optional. OAuth client id. Ignored when `SPLITWISE_API_KEY` is set. |
| `SPLITWISE_CLIENT_SECRET` | Optional. OAuth client secret. |
| `SPLITWISE_REFRESH_TOKEN` | Optional. OAuth refresh token for the treasurer. If Splitwise returns a new refresh token, the function logs that you should update this secret. It does not log the token. |

Pay links, Venmo buttons, and the staff "set up Venmo" note stay off unless the Pages build sets `VITE_VENMO_ENABLED=true`. Unset means off.

`VITE_VENMO_USERNAME` is optional and public. Cloudflare Pages can set it at build time. When Venmo is enabled, pay links use it only until the first successful refresh that stored a real `VENMO_USERNAME`. The old placeholder `cheetahs` is not a handle. If neither a real secret nor a real build-time handle is set, the app shows no pay link and, while the flag is on, captains see a setup note on Dues. While the flag is off, that note is hidden too. Splitwise balances and Refresh do not depend on the flag.

```bash
supabase secrets set \
  SPLITWISE_API_KEY='the treasurer key' \
  SPLITWISE_GROUP_ID='12345678' \
  VENMO_USERNAME='the-club-handle' \
  SPLITWISE_CRON_SECRET="$(openssl rand -hex 32)" \
  --project-ref lutcbvzunjcosncvdyke

supabase functions deploy sync-splitwise --no-verify-jwt --project-ref lutcbvzunjcosncvdyke

# Gateway JWT check stays ON. Do not pass --no-verify-jwt.
# config.toml sets verify_jwt = true for this function.
supabase functions deploy splitwise-ensure-member --project-ref lutcbvzunjcosncvdyke
```

`verify_jwt` is off for `sync-splitwise` so pg_cron can call that function. The handler still rejects the request unless the caller is a signed-in captain or admin, the `x-splitwise-cron` header matches `SPLITWISE_CRON_SECRET`, or the caller is the service role (only `splitwise-ensure-member` uses that, to refresh after an add).

`verify_jwt` is on for `splitwise-ensure-member`. The gateway rejects a missing or invalid user JWT before the handler runs. The handler calls `getUser` again. `{ "all": true }` is rejected unless `profiles.role` is `admin`. Apply `supabase/migrations/20261107043000_splitwise_membership.sql` before deploying the function.

## Who can see what

`splitwise_balances` is the current copy. A player can select only the row whose `profile_id` is their user id. Captains and admins can select every row, including unmapped emails.

`splitwise_status` and `splitwise_debts` are staff-only. That is the club rollup (how much members owe, how much they are owed) and the simplified debts. Players do not get those totals.

`splitwise_meta` holds the group name, the Venmo handle, and `synced_at`. Any signed-in member can read it. It has no balances and no key.

`splitwise_membership` holds `splitwise_user_id`, `splitwise_added_at`, and `last_error` for one profile. A member can read only their own row. Writes are service role only, from `splitwise-ensure-member`.

Writes go through `public.replace_splitwise_snapshot`, executable by the service role only. The Edge Function uses the service role after the staff or cron check. Authenticated users cannot insert these rows.

A captain opening Dues refreshes when the copy is older than 15 minutes. The button forces a refresh, with a short pause so two clicks do not hammer Splitwise. A refresh within 60 seconds from cron or the automatic open is skipped.

The recent expense list is the latest USD rows from `get_expenses` (one page, then the newest 40). Balances come from `get_group` and are the full net, not a sum of that short list.

## Optional hourly refresh

`pg_cron` and `pg_net` were not enabled on the club project when this landed. Enable them under Database → Extensions, store the project URL and the cron secret in Vault, then schedule the call. Do not put the service role key in the cron header. The dedicated cron secret only authorizes this sync.

Supabase notes that `pg_net` can leave the header value in `net.http_request_queue` until the request is sent. That is why this job uses `SPLITWISE_CRON_SECRET` and not the database service role.

```sql
select vault.create_secret('https://lutcbvzunjcosncvdyke.supabase.co', 'project_url');
select vault.create_secret('the same value as SPLITWISE_CRON_SECRET', 'splitwise_cron_secret');

select cron.schedule(
  'sync-splitwise-hourly',
  '15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/sync-splitwise',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-splitwise-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'splitwise_cron_secret')
    ),
    body := '{"force":false}'::jsonb
  );
  $$
);
```

## Pay link shape

```
https://venmo.com/<username>?txn=pay&amount=12.50&note=Cheetahs+dues+…&audience=private
```

`audience=private` asks Venmo to keep the payment off the public feed. Venmo still has to accept the link in the app. There is no callback into the clubhouse.
