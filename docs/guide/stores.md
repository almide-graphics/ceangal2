# Stores and signing

`ceangal build <target>` makes each store's package. Without signing keys
the packages are built anyway (unsigned, or with a debug key) and checked
as far as each store's checks run without an account, so CI shows from
the first commit whether the app will pass. Uploading needs the keys
below and a developer account per store.

## The store directory

`[store] dir` (default `store/`) holds what the stores show besides the
app:

```
store/
  icon-1024.png          the master icon (from [app] icon, or hand-made)
  ios/ macos/ android/ windows/ linux/ web/
                         every size each platform wants (`ceangal icons`)
  play-icon-512.png      Google Play's listing icon
  linux/<linux id>.metainfo.xml, .desktop, .yml
                         Flathub's files (generated when absent)
  privacy-policy.md, listing.md, screenshots/ …
                         listing texts: yours to write; the stores ask for them
```

`ceangal icons` (and every build) writes the icons that are missing.
Files already there are kept, so you can replace any size with a
hand-drawn one. The playground's store directory
([store/playground](../../store/playground)) is a complete example,
including a privacy policy, a listing and Play's data-safety answers.

## Versions

`[app] version` is what people see. `[app] build` must go up with every
upload to App Store Connect and Play. Change both in `ceangal.toml`.

## Signing

Locally, signing comes from environment variables. In CI it comes from
the repository's secrets, which `app.yml` passes to the builds.

### Apple (iOS and macOS)

Needs the [Apple Developer Program](https://developer.apple.com/programs/).

| secret / variable | |
|---|---|
| `IOS_TEAM_ID` | your team ID (Membership details) |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | an App Store Connect API key (Users and Access → Integrations, role App Manager). With it, Xcode creates the iOS certificate and profile itself, and the build exports the `.ipa` and validates it with App Store Connect |
| `MAC_CERTS_P12_B64`, `MAC_CERTS_PASS` | the Mac App Distribution and Mac Installer Distribution certificates exported together as a .p12, base64 |
| `MAC_APP_IDENTITY` | `3rd Party Mac Developer Application: Name (TEAMID)` |
| `MAC_INSTALLER_IDENTITY` | `3rd Party Mac Developer Installer: Name (TEAMID)` |
| `MAC_PROVISIONING_PROFILE_B64` | the Mac App Store provisioning profile for the app's ID, base64 (locally: `MAC_PROVISIONING_PROFILE`, its path) |

Register the app's ID (`[app] id`) under Identifiers, and create the app
in App Store Connect with the same bundle ID. Upload the `.ipa` and the
`.pkg` with Transporter or `xcrun altool --upload-app`. The macOS app runs
in the App Sandbox, with the network entitlement when `network = true`.
The privacy manifest declares the required-reason APIs the framework
itself uses (file timestamps, system boot time) and no data collection. An
app that collects data declares it in App Store Connect's privacy
answers.

### Google Play

Needs a [Play Console](https://play.google.com/console) account.

| secret / variable | |
|---|---|
| `ANDROID_KEYSTORE_B64` (CI) / `ANDROID_KEYSTORE` (a path, locally) | the upload key's keystore |
| `ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASS` | its passwords and alias |

Make an upload key once and keep it safe:

```sh
keytool -genkeypair -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
base64 -i upload.jks | pbcopy     # → the ANDROID_KEYSTORE_B64 secret
```

Play App Signing holds the real signing key. The `.aab` from
`ceangal build android` is what you upload. A new personal account
(not an organization's) must run a closed test with at least 12 testers
for 14 days before its first production release.

### Microsoft Store

Needs a [Partner Center](https://partner.microsoft.com/dashboard) developer
account.

| secret / variable | |
|---|---|
| `MSIX_PUBLISHER` | the publisher ID Partner Center shows for the app (Product identity: `CN=…`) |
| `MSIX_PFX`, `MSIX_PFX_PASS` | optional: a code-signing certificate for sideloading; the Store signs uploads itself |

Reserve the app's name in Partner Center, put its publisher in
`MSIX_PUBLISHER`, and upload `build/msix/<key>.msix`. The build runs the
Windows App Certification Kit when asked (`-Wack`), as this repository's
CI does.

### Flathub

No keys: Flathub builds the app from source. Submit the manifest from
`store/linux/` as a pull request to
[flathub/flathub](https://github.com/flathub/flathub). Flathub checks that
you control the domain of the app ID: `[linux] id =
"io.github.<user>.<app>"` works for a GitHub account. Write your own
`<id>.metainfo.xml` with a description and screenshots before
submitting. The generated one builds, but Flathub's linter wants more,
and once your own file is there the build fails on what the linter finds.

### The web

`build/web` is a static site: copy it to any host (GitHub Pages,
Netlify, an S3 bucket). It needs WebGPU, which current Chrome, Edge and
Safari have, and Firefox has on Windows. Browsers without it see a
message instead. The page has a web app manifest with the app's icons and
theme colour.

## What only you can do

The builds and checks are automated. Opening accounts, paying fees,
proving who you are, and pressing submit are not:

- Apple Developer Program, Play Console, Partner Center accounts (and
  their fees and identity checks)
- the listing in each store: description, screenshots, age rating,
  privacy answers, price
- the first upload and each release's submit for review
