# Almide Playground — Privacy Policy

Effective 2026-10-04. Applies to Almide Playground on the web, iOS, iPadOS,
macOS, Android, Windows and Linux.

**In short: we do not collect any data.** The app has no accounts, no
analytics, no advertising and no tracking. What you write stays on your
device unless you choose to send it somewhere.

## What stays on your device
- **Your code and files**, so they are there when you come back. They are
  stored in the app's private storage (in the browser's local storage on the
  web) and never uploaded by the app.
- **Your settings** (theme, selected AI provider and model).
- **Your AI API key**, if you enter one. It is kept in the system keychain
  (Keychain on Apple platforms, Credential Manager on Windows, Secret Service
  on Linux) or in the app's private storage where no keychain is available.

Uninstalling the app deletes all of it.

## What leaves your device, and only when you ask
- **AI assistant (optional).** When you press Generate or Fix with AI, the
  app sends your request — your prompt, the code in the current tab and, for
  a fix, the error message — directly to the AI provider you selected
  (Anthropic, OpenAI or Google), authenticated with your own API key. We do
  not receive or store these requests. The provider's own privacy policy
  applies to them:
  - Anthropic: https://www.anthropic.com/legal/privacy
  - OpenAI: https://openai.com/policies/privacy-policy
  - Google: https://policies.google.com/privacy
- **Share links.** Share puts your project into the link itself (after the
  `#`), so the code travels only to the people you send the link to; it is
  not stored on any server.
- **Export.** Export saves a zip file where you choose.

## Programs you run
Your programs run inside a sandbox in the app. They cannot read your files,
contacts or other apps' data, and they have no network access.

## Web version
The web version is served by GitHub Pages, which may log basic request data
(such as IP addresses) as described in GitHub's privacy statement:
https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement

## Children
The app does not collect personal information from anyone, including
children.

## Changes and contact
Changes to this policy are published at this address with a new effective
date. Questions: https://github.com/almide/almide/issues
