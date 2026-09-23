# Touliao component contracts — P1, 2026-09-19

This increment fixes the ten audited P1 issues in the shared React renderer. It
retains the existing native adapters and Icon System. It does not claim that all
P2 component families have been migrated.

| Role | React (Web / Windows) | iOS / Android |
| --- | --- | --- |
| Button | `ui-kit/Button.jsx`: primary, secondary, ghost, text, danger; loading preserves label width, disables activation | Existing VxinGradientButton / system Button / Material Button |
| IconButton | Re-export existing `ui-kit/Icon.jsx`; registry and geometry unchanged | Existing Touliao icon wrappers |
| Field | `ui-kit/Field.jsx`: TEXT, PASSWORD, SEARCH, CODE, MULTILINE; DEFAULT/FOCUSED/FILLED/ERROR/DISABLED/READONLY | Existing TouliaoField / platform text fields |
| Dialog | `ui-kit/Dialog.jsx`: CONFIRM, ALERT, DANGER, INPUT, PERMISSION, ERROR. INPUT uses Field children; callers own validation, callbacks and busy state | Native alert/confirmationDialog/AlertDialog retained |
| Switch | `ui-kit/Switch.jsx`: value, disabled, onChange, label or labelledBy; callers cannot override internal color/size | Native Toggle / Material Switch retained |
| Settings | SettingCell / SettingSection; optional subtitle, value, accessory, danger | Existing platform SettingsRow / Cell |
| Message menu | MessageActionMenu owns geometry + keyboard; ChatWindow owns available actions and callbacks | Native contextMenu / DropdownMenu |
| Feedback | Existing ToastRoot, EmptyState, ErrorState; file failures now consume ErrorState with explicit retry | Existing platform feedback retained |
| Media | Shared useFocusTrap for file/image/video and calls; nested layer stack, Escape, focus return, optional scroll lock | System media and file picker exceptions retained |

`showConfirm(message, options)` retains its Promise<boolean> contract. Existing
call sites remain valid. The cancellation control receives initial focus, Escape
cancels and destructive callers specify DANGER. No request, authorization, message
or signaling condition changes.

Composer has one `mode`: TEXT (idle), KEYBOARD (focused), VOICE, EMOJI or MORE.
Stickers are an EMOJI subpanel. Opening voice closes all attachment panels;
opening a panel leaves voice; edit/reply return to keyboard; conversation reset
clears display mode while restoring the existing draft. Recording and send/IME
handlers remain with ChatWindow.

File loading distinguishes pending, empty, data and error. Error stops the scroll
observer. Retry is explicit; global Axios's existing three bounded retries remain
unchanged. Aborted/old tab responses cannot replace the current list. Generic
file detail scrolls independently; header and download actions remain reachable.

Component tokens extend existing colors, spacing, typography, radius and shadows
in `ui-kit/components.css`. 44px is the minimum common touch target; controls are
40px desktop / 48px mobile, settings cells 64px desktop / 68px mobile. Native
44pt/48dp densities remain intentional. Fixed dark media surfaces have named
surface/text/control roles, independent of the page theme. Special optical values
(switch 44×26 track/20 thumb, file content widths) remain component-local.

## Duplicate families and deprecation

- DUP-01 MERGE: three local Switch renderers replaced. Their local JSX names have
  zero references. Legacy `.wc-switch` / `.gi-toggle` / `.wc-settings-toggle` CSS
  is deprecated for new use; retained until the wider CSS ownership migration.
- DUP-02 MERGE: local call focus hooks removed after import migration. Shared hook
  also covers dialogs/files/images/videos. RTC and call controls are unchanged.
- DUP-03 KEEP: Skeleton geometry/ARIA is P2; no blanket migration in this round.
- DUP-04 MERGE: Login/Register field and password wrappers consume TouliaoField.
  Legacy auth classes remain compatibility selectors for existing page layout.
- DUP-05 PARTIAL: ChatFiles consumes shared empty/error; contact/search remain P2.
- DUP-06 KEEP: one-to-one and group call controls/status contracts remain P2.

No existing public component or asset is removed while still referenced. Native
system file selectors/context menus are PLATFORM_NATIVE_EXCEPTION. Browser
fixture checks and simulator/emulator tests are NOT_DEVICE_VERIFIED.

## Regression closure

Additional boundaries found while validating the audited P1 paths are included:
Windows file drawers use their available parent height (the titlebar excludes
30px), so the paging sentinel remains visible. Chat row measurements continue
to follow the existing bottom-scroll intent after the initial settle window;
reading history still disables following. Neither change alters messages, retries
or transport. Auth and retry buttons explicitly use component height tokens.

Browser regression entry points: `scripts/design-system-p1-regression.cjs` and
`scripts/design-system-p1-edges.cjs`. Configure `UI_BUILD`, `UI_OUTPUT`, and
optionally `PLAYWRIGHT_MODULE` / `CHROMIUM_PATH`. All API/media/socket fixtures are
isolated. The existing four design-system suites remain additional gates.
