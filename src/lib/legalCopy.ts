export const PRIVACY_PARAGRAPHS = [
  'This policy covers the Cheetahs Cricket Club app at https://cheetahs-club.pages.dev.',
  'The app uses Google sign-in for YouTube only so club admins can start and end live broadcasts on the CricketCrazeUSA YouTube channel. That channel uses the Google account cricketcrazeusa@gmail.com.',
  'With that YouTube permission, the app reads the channel’s live broadcast list and changes a broadcast’s status. Start moves a broadcast to live. End marks it complete. The app does not upload videos, post comments, or change any other Google data.',
  'The YouTube refresh token is stored on the club’s server. It is not stored in the browser, and it is not shown to people using the app. A signed-in captain or admin can see whether YouTube is connected and which channel name came back.',
  'The club does not sell personal data. It does not share the YouTube token, club records, or the broadcast list with advertisers or data brokers. YouTube receives a status change only when a captain or admin starts or ends a broadcast.',
  'Club members sign in to the clubhouse with their own account. That sign-in is separate from this YouTube permission and does not grant access to the CricketCrazeUSA channel.',
  'You can revoke the club’s Google access at any time at https://myaccount.google.com/permissions. After it is revoked, the app cannot read or change broadcasts until an admin connects YouTube again.',
  'Questions: cricketcrazeusa@gmail.com.',
] as const

export const TERMS_PARAGRAPHS = [
  'These terms cover use of the Cheetahs Cricket Club app at https://cheetahs-club.pages.dev.',
  'The app is for club members and staff. YouTube controls are for club admins. Those controls start and end live broadcasts on the CricketCrazeUSA YouTube channel only.',
  'Connecting YouTube lets the app read that channel’s live broadcast list and change a broadcast’s status. Use Start and End only for the club’s own broadcasts.',
  'The club does not sell personal data. The token that keeps the YouTube connection is stored on the club’s server. An admin, or the owner of the Google account, can revoke that access at https://myaccount.google.com/permissions.',
  'The YouTube channel remains subject to YouTube’s own terms. This app does not replace them.',
  'Questions: cricketcrazeusa@gmail.com.',
] as const
