# 20-Robot Quality Pass — v信 web (react-hooks warnings → 0)
Baseline: build OK, lint 0 err / 51 warn, backend 119 tests pass.
Rule: each robot owns files below, fixes warnings WITHOUT changing behavior. Verify per-file lint after.

R01  components/AddFriendModal.jsx        (1)  set-state-in-effect
R02  components/AuthImage.jsx             (1)  set-state-in-effect
R03  components/Avatar.jsx                (1)  set-state-in-effect
R04  components/CallHistory.jsx           (1)  set-state-in-effect
R05  components/CallModal.jsx             (3)  set-state, exhaustive-deps
R06  components/ChatWindow.jsx            (11) mixed
R07  components/Collections.jsx           (2)  set-state-in-effect
R08  components/ContactList.jsx           (1)  set-state-in-effect
R09  components/EmojiPicker.jsx           (1)  globals
R10  components/GlobalSearch.jsx          (1)  set-state-in-effect
R11  components/GroupCallModal.jsx        (4)  immutability, deps, memo, refs
R12  components/GroupInfo.jsx             (5)  set-state, deps
R13  components/ImagePreview.jsx          (1)  set-state-in-effect
R14  components/Moments.jsx               (1)  set-state-in-effect
R15  components/Profile.jsx               (3)  set-state, refs
R16  components/UserProfile.jsx           (1)  set-state-in-effect
R17  components/VoicePlayer.jsx           (1)  exhaustive-deps
R18  contexts/SocketContext.jsx          (2)  set-state, deps
R19  hooks/usePushNotification.js         (1)  exhaustive-deps
R20  pages/Home.jsx + pages/Register.jsx  (9)  mixed
