# Data declarations (drafts)

Answers for each store's privacy form, derived from
[privacy-policy.md](privacy-policy.md). The app collects nothing itself; the
one flow off the device is the optional AI assistant, which sends the user's
prompt and code to the provider the user picked, with the user's own key.

## Apple — App Privacy ("nutrition label", App Store Connect)
- **Data used to track you:** none.
- **Data linked to you:** none.
- **Data not linked to you:** *Other User Content* — collected by a third
  party at the user's direction when the AI assistant is used.
  - Purpose: App Functionality.
  - Linked to identity: no. Used for tracking: no.
  (Conservative answer. If Apple's definition of "collect" is read as "the
  developer or its partners can access", the answer becomes "Data Not
  Collected"; keep the conservative one unless review says otherwise.)
- Privacy policy URL: see listing.md.
- Privacy manifest: `store/playground/ios/PrivacyInfo.xcprivacy` (bundled in
  the iOS and macOS apps).

## Google Play — Data safety
- **Does your app collect or share any of the required user data types?**
  Yes, one type, and only when the user uses the AI assistant:
  - *App activity → Other user-generated content* (prompt, code, error).
    - Collected: yes. Shared: yes, with the AI provider the user selects,
      as part of the user-initiated request ("user-initiated action" — it
      counts as sharing on behalf of the user).
    - Processed ephemerally: yes (the app keeps no copy beyond the user's
      own file).
    - Required or optional: optional.
    - Purpose: App functionality.
- **Is all of the user data collected by your app encrypted in transit?**
  Yes (HTTPS to the providers).
- **Do you provide a way for users to request that their data is deleted?**
  Not applicable to the app (nothing is stored on our side); uninstalling
  deletes local data. Requests sent to an AI provider follow that provider's
  deletion process.
- Ads: no. Target audience: 13+ (programming tool; AI-generated text).

## Microsoft Store — Privacy
- Accesses the internet: yes (AI assistant, user-initiated).
- Privacy policy URL: required — see listing.md.
- Collects personal information: no.

## Flathub — permissions and metainfo
- `--share=network` (AI assistant), `--socket=wayland` / `--socket=fallback-x11`,
  `--device=dri`; files only through the portal (no `--filesystem`).
- `<content_rating type="oars-1.1">` with `social-info` none and
  `money-purchasing` none; the AI text is user-requested content.
