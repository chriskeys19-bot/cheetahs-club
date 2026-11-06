# Continue with Google

`/login` and `/join/:token` both offer **Continue with Google** next to email and password. The button calls:

```ts
supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: window.location.origin + '/auth/callback',
    queryParams: { prompt: 'select_account' },
  },
})
```

`prompt=select_account` lets the player pick the Google account that matches the invite. The app uses the PKCE flow. `detectSessionInUrl` stays off, so only `/auth/callback` calls `exchangeCodeForSession`.

## Who gets into the clubhouse

The club stays invite-only.

| Situation | What happens |
| --- | --- |
| Email and password account, then Google with the same verified email | Same auth user and same `profiles` row. Supabase automatic linking adds the Google identity. The app does not call `linkIdentity()`. |
| New Google user who opened a join link | Token is stored in `localStorage` and `sessionStorage` (`cheetahs.oauth.invite`, 30 minutes). `finish-google-signin` checks that token, sets the player name from Google, marks the invite accepted, and adds the invited side. |
| Token lost on the way back from Google | If that verified email has one pending invite, the same player role and side are applied. |
| Google user with no invite and no existing account | They see **Ask your captain for an invite**. The function deletes that Google-only auth user so a later invite can still be created for the address. |
| Google account email differs from the join link | **Use the invited Google account.** The stray Google user is deleted. The invite stays pending. |
| Captain or admin, or a Google player whose invite was already accepted | They go straight to the clubhouse. Their role is not changed. |

Password signup is unchanged: `accept-invite` creates the user with `email_confirm: true`, and `handle_new_user` inserts `profiles.role = 'player'`.

`handle_new_user` reads `full_name`, then `name`, then the mailbox name. It copies `avatar_url` or `picture` only when the value is an `https` URL up to 2000 characters. A missing name becomes `Player`. It never reads a role from user metadata.

## Same email, one account

Supabase Auth links a new Google identity onto an existing user when the email addresses match and the existing email is verified. This is automatic linking. It is separate from manual linking (`linkIdentity()`), which this app does not use.

`accept-invite` confirms the email immediately, so a password member qualifies. Google reports the address as verified for the usual email and profile scopes. The callback then sees the original user id, the existing profile, and both identities. Role, sides, and dues stay on that row.

Automatic linking does not run for an unconfirmed email, because that would let someone seize an account. If Google returns "already registered", the password email was not confirmed or automatic linking is off. Sign in with the password. In the dashboard, leave automatic linking enabled if that toggle is shown (Authentication → Providers / Attack Protection, wording varies). Do not turn on a setting that blocks a second identity for a verified email.

Manual linking can stay off. SAML SSO users are never link targets. This club does not use SAML.

## Ben: Google Cloud and Supabase

Do these once on project `lutcbvzunjcosncvdyke`. The app code does not contain the Google client secret.

### 1. Google Auth Platform consent screen

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project for the club.
2. Go to **Google Auth Platform** → **Branding** (older consoles call this **APIs & Services → OAuth consent screen**).
3. User type: **External**. The club is not a Google Workspace organization that covers every player.
4. App name: `Cheetahs Cricket Club`. User support email: `cheetahscc123@gmail.com` (or your own).
5. App home page: `https://cheetahs-club.pages.dev`. Authorized domain: `cheetahs-club.pages.dev`. Do not add `supabase.co`. You do not control that domain, and the OAuth client redirect URI is enough.
6. Scopes: `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile` only. Those are non-sensitive. Do not add Gmail, Drive, or any other scope. Supabase requests this set by default.
7. Publishing status starts as **Testing**. In Testing, only listed test users can sign in, and Google expires the grant after 7 days. Add each captain and player Gmail while you are still testing.
8. When the roster should be able to use any invited Gmail, click **Publish app** so the status is **In production**. Email, profile, and openid do not normally require Google's verification review. Until you publish, a player who is not a test user gets an error from Google instead of a club account.

### 2. OAuth client

1. **Google Auth Platform → Clients → Create client** (or **Credentials → Create credentials → OAuth client ID**).
2. Application type: **Web application**.
3. Authorized JavaScript origins:
   - `https://cheetahs-club.pages.dev`
   - `http://localhost:5173`
   - `http://127.0.0.1:5173`
4. Authorized redirect URI (this is Supabase, not the clubhouse):
   - `https://lutcbvzunjcosncvdyke.supabase.co/auth/v1/callback`
5. Create the client and copy the client ID and client secret. The secret is shown once.

### 3. Supabase provider and URLs

1. Dashboard → **Authentication → Sign In / Providers → Google**. Enable it. Paste the client ID and secret. Save.
2. Dashboard → **Authentication → URL Configuration**.
   - Site URL: `https://cheetahs-club.pages.dev`
   - Redirect URLs:
     - `https://cheetahs-club.pages.dev/auth/callback`
     - `https://cheetahs-club.pages.dev/**`
     - `http://localhost:5173/auth/callback`
     - `http://localhost:5173/**`
     - `http://127.0.0.1:5173/auth/callback`
     - `http://127.0.0.1:5173/**`
3. Leave automatic identity linking on, as described above.

### 4. Database and Edge Function

```bash
supabase db push --project-ref lutcbvzunjcosncvdyke
supabase functions deploy finish-google-signin --project-ref lutcbvzunjcosncvdyke
```

The migration is `supabase/migrations/20261106041946_google_oauth_profile.sql`. The function keeps JWT verification on. Do not put the Google secret or the service role key in a `VITE_` variable.

Cloudflare Pages already rewrites every path to `index.html`, so `/auth/callback` survives a refresh. No new Pages environment variable is required.
