# YouTube broadcast controls

Staff open **Broadcasts** in the clubhouse (`https://cheetahs-club.pages.dev/broadcasts`) to list every live broadcast on the CricketCrazeUSA channel, test the connection, and start or end a broadcast. The public Streams list at `/streams` is unchanged. The CricketCraze Live Stream Bot still uses the existing pop-up and `stream_jobs` queue.

Times on the page are Central (`America/Chicago`). A row whose title or stream key looks like Pulse Play or PSD also shows Pacific time.

Start asks for confirmation only when it is more than 15 minutes before the scheduled start. That dialog names the game, the Central time, and the stream key. End always asks, and the dialog names the game. The buttons stay disabled while a request is in flight.

A matched `game_streams` row is marked `ended` only after YouTube confirms the broadcast is complete. The same update writes a done `end` job, which is what keeps End stream hidden in the schedule pop-up (the rule from the end-stream change). A broadcast that goes live does not overwrite a setup step the bot still owns.

## Google Cloud

The OAuth client already exists.

| Setting | Value |
| --- | --- |
| Google Cloud project | `cheetahs-youtube-controls` |
| YouTube Data API v3 | Enable it on that project (APIs & Services → Library → YouTube Data API v3) |
| OAuth client type | Web application |
| Authorized JavaScript origin | `https://cheetahs-club.pages.dev` |
| Authorized redirect URI | `https://lutcbvzunjcosncvdyke.supabase.co/functions/v1/youtube-oauth-callback` |
| Scope | `https://www.googleapis.com/auth/youtube` |
| App homepage | `https://cheetahs-club.pages.dev` |
| Privacy policy | `https://cheetahs-club.pages.dev/privacy` |
| Terms of service | `https://cheetahs-club.pages.dev/terms` |

Those three URLs are what the consent screen asks for before the app can be published to Production. `/privacy` and `/terms` are public static pages. They load without signing in. The files are `public/privacy.html` and `public/terms.html`. Pages serves those clean URLs itself. Do not add a `_redirects` rule that points them back at the `.html` files. That loops.

The redirect URI is the Edge Function, not the clubhouse. Do not add `https://cheetahs-club.pages.dev/broadcasts` as a Google redirect URI. After Google returns the code, the function sends the browser to the Broadcasts page.

### Consent screen and the 7-day token

1. Open the consent screen for project `cheetahs-youtube-controls`.
2. User type: External.
3. Add the homepage, privacy policy, and terms URLs above.
4. Add the scope `https://www.googleapis.com/auth/youtube`. This scope is sensitive.
5. While the publishing status is **Testing**, add `cricketcrazeusa@gmail.com` as a test user. Google expires refresh tokens from a Testing app after 7 days.
6. Publish the app to **Production**. That stops the 7-day expiry. Until Google finishes any verification review, an admin may see an unverified-app warning and can continue. The clubhouse shows a reconnect message when a token is expired or revoked. Revoke access any time at `https://myaccount.google.com/permissions`.

Connect from an admin account in the clubhouse, and choose the Google account `cricketcrazeusa@gmail.com` so the channel is CricketCrazeUSA.

## Supabase

Project `lutcbvzunjcosncvdyke`. Apply the migration before deploying the functions. The Cloudflare Pages deploy does not run SQL.

1. Apply `supabase/migrations/20261122120000_youtube_broadcast_oauth.sql`.
2. Set Edge Function secrets (do not commit them):
   - `YT_OAUTH_CLIENT_ID`
   - `YT_OAUTH_CLIENT_SECRET`
3. Deploy:
   - `youtube-oauth-start` (`verify_jwt` on)
   - `youtube-oauth-callback` (`verify_jwt` off — Google’s redirect has no Supabase JWT)
   - `youtube-broadcasts` (`verify_jwt` on)

`supabase/config.toml` records those flags. If a deploy ignores the file, publish the callback with JWT verification disabled. The callback still requires a signed, 10-minute, single-use `state` value tied to the admin who pressed Connect.

The refresh token is stored in `private.youtube_connections`. Row level security is forced on, there is no policy for signed-in users, and the read function is granted only to `service_role`. The browser receives the channel name and connection status, never the token.

## Check that it works

1. Sign in as an admin and open Broadcasts.
2. Press Connect YouTube and accept the consent screen with `cricketcrazeusa@gmail.com`.
3. The page should say it is connected as CricketCrazeUSA.
4. Press **Test connection**. It calls `liveBroadcasts.list` and does not start or end anything. A success message means the token and the YouTube Data API are working.
5. Use **Today & upcoming**. Pulse Play rows for Thu Nov 26 should show Central and Pacific times, the full `https://www.youtube.com/watch?v=…` address, and a stream key name when a `game_streams` row has the same video id.
6. Press Start only after the encoder (Pulse Play or OBS) is already sending video. If YouTube is not receiving video, the button returns an error and does not change the broadcast. Auto-start off means Start must move the broadcast through testing and then to live.
7. End always asks for confirmation. The club row is marked ended only after YouTube reports the broadcast complete.

Do not start a real match broadcast while testing the button. Test connection is the safe check.
