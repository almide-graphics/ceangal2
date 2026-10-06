# ADR 0021 — The system's text size, motion and contrast preferences

## Context
iOS (Dynamic Type), Android (font scale) and browsers (the default font
size) let a user ask for larger text. iOS, Android and browsers also have
settings for less motion and more contrast. ceangal drew every app at the
sizes and colors in its code, so none of these settings had any effect.

## Decision
- **Event 11 carries the preferences in `b`**: bit 1 reduce motion, bit 2
  more contrast, plus 256 × the text scale in % (0 means 100 %, so older
  hosts keep working). The hosts read them as follows:
  - web: `prefers-reduced-motion`, `prefers-contrast: more`, and the root
    font size against 16 px. The event is sent again when they change.
  - Android: `Configuration.fontScale`, `animator_duration_scale == 0`
    (animations off), and `UiModeManager.getContrast() > 0` on API 34+.
  - iOS: the preferred content size category, mapped to UIKit's body
    sizes (Large = 100 %), Reduce Motion and Increase Contrast.
  - desktop: none, so 1.0 and off.
- **`ceangal.font_scale()`** is clamped to 0.8–2.0. Above 2.0 most
  layouts made for phones stop working; iOS's largest accessibility sizes
  still get twice the size.
  - When it is not 1.0, every text view's size is multiplied before
    layout. Wrapping and two-pass layout (ADR 0017) then work as usual.
  - Editors and fields measure with the scaled size. Their row cache keys
    on it with the fonts.
  - Heights made for one line of text (fields, select triggers, virtual
    list rows) grow by as much as a line grows. At 1.0 nothing changes, so
    the pixel tests are untouched.
- **`ceangal.reduce_motion()`**: scroll and editor momentum stop when the
  finger lifts. Apps can check it to skip their own animations.
- **`ceangal.high_contrast()`**: `w.system()` applies `w.more_contrast`,
  which gives full-strength text, secondary text close to it, and darker
  (or lighter) borders.
- **`ceangal test` gets a `prefer` step**, for example
  `prefer 150 reduce-motion more-contrast`.
  - Natively it sends event 11.
  - On the web it uses CDP's emulated media features and the root font
    size, so the host's own reading is what gets tested.
  - `CEANGAL_PREFS` sets the native value from outside.

## Consequences
- `apps/gallery/tests/prefs.test`, web and native, sets the preferences,
  sees the gallery's caption report them, and takes a screenshot of the
  Languages card at 150 %.
- Android and iOS reading isn't tested on CI: the emulators' settings
  would have to be changed through adb or simctl.
- Sizes in an app's own code (padding, icons, fixed heights) don't
  scale. Apps that want them to can multiply by `font_scale()`.
- About 0.6 KB of optimized wasm in every app, which is within budgets.
