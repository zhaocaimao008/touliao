# Touliao token source and platform adapters

`web/src/ui-kit/tokens.json` is the normative semantic source. File timestamps do
not select a source. Its status describes implemented adapters, not completion of
every audited component migration. The owner is the client UI maintainer role.

- `generate-ui-tokens.cjs` produces Web/Windows `tokens.css`, including colors,
  spacing, typography, geometry, motion, component roles and the deployed layer order.
- `generate-native-design.py` produces native palettes and the existing Icon System.
  This follow-up does not change its geometry, registry, icons or generated icon files.
- `generate-component-tokens.py` produces native `ComponentTokens.swift/.kt` and
  Swift text-role definitions. Theme, components and views reference those values.
- `node scripts/check-design-sync.cjs` runs exact read-only comparisons for all
  three generators. `python3 scripts/test-component-tokens.py` checks units and
  semantic roles with deliberately non-round fixture values. Vitest also tests
  that removing either theme's generated on-dark/on-light tokens fails the check.

Run all generators when the source changes, then run the checker twice. No
allowlist or comparison normalization hides drift. CI/deployment configuration is
not changed by this UI task; these checks are standalone and part of UI tests.

Layout: one logical px maps to one SwiftUI pt or Compose dp. Do not multiply by
screen density. Fonts map to scaled pt / sp; Swift roles explicitly select Dynamic
Type categories. Durations are ms in the source/CSS/Kotlin and seconds in Swift.
Reduced motion is a platform preference; it suppresses UI animation, never call
timeouts, media playback, transfer progress or other business clocks.

Platform density exceptions preserve existing layouts: settings rows are minimum
64px desktop / 68px mobile Web, 57pt iOS / 56dp Android; native touch minimum is
44pt / 48dp. Avatar roles preserve native list 44 and profile hero 66 versus Web
list 40 and hero 92; call remains native 96 / desktop video placeholder 88. These
are named roles, not competing unnamed size tables. Material compact heading
`headlineSmall` retains 20sp; the main title/headline/body/caption roles use the
shared hierarchy. Native system fonts, native alert/menu/file-picker structures
and native loading indicators remain platform adapters.

Layer values retain the production-tested ordering (modal 1000, call 2000,
top overlay 9999, Electron chrome 100000). The old unused ordinal 0…70 table has
been replaced by the actual shared source. `design-tokens.css` no longer owns a
second set of layer numbers. Components may use local relative offsets when their
stacking context requires them, without inventing new global semantic levels.

The P1 component dimensions (40/48 controls, 420 dialog width, readable danger,
fixed dark media canvas) are preserved. Theme switching re-resolves semantic CSS
and native adaptive colors; no component caches resolved colors.
