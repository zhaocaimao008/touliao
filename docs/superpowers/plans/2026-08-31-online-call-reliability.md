# Online Call Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one-to-one and group calls share a call-id-bound busy state, survive unrelated device disconnects, and fail deployment when TURN relay allocation is not verified.

**Architecture:** Add a pure in-memory `callSessionRegistry` used by both Socket.IO call handlers, while handlers retain responsibility for database logs, push, and emitted events. Upgrade Web, Android, and iOS to carry `callId` on every post-request signal, with a backend compatibility switch for old clients. Add a secret-safe TURN allocation probe to the deployment pipeline and a separate physical-network acceptance record.

**Tech Stack:** Node.js/CommonJS, Jest, Socket.IO, SQLite, React/Vitest, Kotlin/WebRTC/JUnit, Swift/WebRTC/XCTest, Bash, coturn utilities.

**Spec:** `docs/superpowers/specs/2026-08-31-online-call-reliability-design.md`

## Global Constraints

- Keep the Node.js monolith, SQLite, JavaScript, and process-memory deployment model; do not add Redis, TypeScript, an SFU, or a new service.
- Preserve old-client calling while `CALL_REQUIRE_ID=false`; require call IDs only when the setting is explicitly enabled.
- Never log or pass `TURN_SECRET`, full TURN usernames, credentials, JWTs, or cookies on a command line.
- Do not modify unrelated dirty files: `AUDIT.md`, `backend-v2/src/db/schema.js`, `backend-v2/src/modules/ai-assistant/assistant.service.js`, or the existing untracked core/load tests.
- Use 15,000 ms as the reconnect grace and inject timers in unit tests so tests do not sleep.
- A TURN allocation probe proves relay allocation only; the release record must not claim physical dual-network acceptance automatically.

---

### Task 1: Pure shared call session registry

**Files:**
- Create: `backend-v2/src/realtime/callSessionRegistry.js`
- Create: `backend-v2/test/call-session-registry.test.js`

**Interfaces:**
- Consumes: authenticated `userId`, Socket.IO `socketId`, generated `callId`.
- Produces: `createPrivate`, `createGroup`, `occupy`, `bindSocket`, `unbindSocket`, `resume`, `releaseUser`, `end`, `get`, `callForUser`, `validatePrivate`, `resolvePrivateCall`, `reset`, and result codes `CALL_BUSY`, `CALL_NOT_FOUND`, `CALL_ID_MISMATCH`.

- [ ] **Step 1: Write failing registry tests**

```js
const createRegistry = require('../src/realtime/callSessionRegistry');

test('unrelated device disconnect does not release user occupancy', () => {
  const r = createRegistry({ graceMs: 15_000, setTimer: jest.fn(), clearTimer: jest.fn() });
  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'web-a' });
  expect(r.unbindSocket('alice', 'phone-a')).toEqual({ affected: false });
  expect(r.callForUser('alice')).toBe('c1');
});

test('last participating socket starts grace and resume cancels it', () => {
  let callback;
  const clearTimer = jest.fn();
  const r = createRegistry({ graceMs: 15_000, setTimer: fn => (callback = fn), clearTimer });
  r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'web-a' });
  expect(r.unbindSocket('alice', 'web-a').graceStarted).toBe(true);
  expect(r.resume('c1', 'alice', 'web-a2').ok).toBe(true);
  expect(clearTimer).toHaveBeenCalled();
  expect(callback).toBeDefined();
});

test('private and group calls share the same busy occupancy', () => {
  const r = createRegistry();
  expect(r.createPrivate({ callId: 'c1', callerId: 'alice', calleeId: 'bob', socketId: 'a' }).ok).toBe(true);
  expect(r.createGroup({ callId: 'g1', conversationId: 'g', startedBy: 'alice', socketId: 'a' }))
    .toMatchObject({ ok: false, code: 'CALL_BUSY' });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd backend-v2 && npx jest test/call-session-registry.test.js --runInBand`

Expected: FAIL because `callSessionRegistry` does not exist.

- [ ] **Step 3: Implement the registry as an instance factory**

```js
function createRegistry({ graceMs = 15_000, setTimer = setTimeout, clearTimer = clearTimeout, onGraceExpired = () => {} } = {}) {
  const sessions = new Map();
  const userSessions = new Map();
  // create* atomically checks every participant before inserting.
  // unbindSocket ignores socket IDs not registered to the session.
  // last-socket removal schedules onGraceExpired({ callId, userId, kind }).
  // resume verifies membership, cancels the timer, and binds the new socket.
  return { createPrivate, createGroup, occupy, bindSocket, unbindSocket, resume,
    releaseUser, end, get, callForUser, validatePrivate, resolvePrivateCall, reset,
    _state: { sessions, userSessions } };
}
module.exports = createRegistry;
```

Implement each operation with structured `{ ok, code, ... }` results and no Socket.IO or database imports.

- [ ] **Step 4: Run registry tests and confirm GREEN**

Run: `cd backend-v2 && npx jest test/call-session-registry.test.js --runInBand`

Expected: PASS with no open timer handles.

- [ ] **Step 5: Commit the isolated registry**

```bash
git add backend-v2/src/realtime/callSessionRegistry.js backend-v2/test/call-session-registry.test.js
git commit -m "feat: share busy state across online calls"
```

### Task 2: One-to-one handler ownership, callId validation, and reconnect grace

**Files:**
- Modify: `backend-v2/src/realtime/handlers/call.js`
- Modify: `backend-v2/src/realtime/index.js`
- Modify: `backend-v2/src/config/index.js`
- Modify: `backend-v2/.env.example`
- Create: `backend-v2/test/call-signaling-contract.test.js`

**Interfaces:**
- Consumes: Task 1 registry and `config.calls.requireId`, `config.calls.reconnectGraceMs`.
- Produces: callId-bearing `call:response/offer/answer/ice/end`, `call:resume`, strict or compatible call resolution, and socket-specific disconnect cleanup.

- [x] **Step 1: Write failing Socket handler regression tests** — see `backend-v2/test/call-signaling-contract.test.js` (17 tests, broader than the 3 sketched here).

```js
test('disconnecting an unrelated socket does not emit call:end', () => {
  const web = registerSocket('alice', 'web-a');
  const phone = registerSocket('alice', 'phone-a');
  web.handlers['call:request']({ to: 'bob', type: 'audio' }, ack);
  phone.handlers.disconnect();
  expect(io.events('call:end')).toHaveLength(0);
});

test('stale offer is rejected and current offer is forwarded with callId', () => {
  const callId = beginPrivateCall('alice', 'bob');
  alice.handlers['call:offer']({ to: 'bob', callId: 'old', offer: validOffer });
  expect(io.events('call:offer')).toHaveLength(0);
  alice.handlers['call:offer']({ to: 'bob', callId, offer: validOffer });
  expect(io.last('call:offer').payload.callId).toBe(callId);
});

test('private caller is rejected while occupying a group call', () => {
  beginGroupCall('alice');
  alice.handlers['call:request']({ to: 'bob', type: 'audio' }, ack);
  expect(alice.last('call:error').payload.code).toBe('CALL_BUSY');
});
```

- [x] **Step 2: Run focused handler tests** — not independently re-verified RED-before-GREEN for this file specifically (only re-verified the final GREEN state, see Step 5); the test file and the integration landed together when this task was picked back up.

- [x] **Step 3: Add centralized call configuration**

```js
calls: {
  requireId: process.env.CALL_REQUIRE_ID === 'true',
  reconnectGraceMs: Math.max(1_000, parseInt(process.env.CALL_RECONNECT_GRACE_MS, 10) || 15_000),
},
```

Add documented defaults to `.env.example` without changing production `.env`.

- [x] **Step 4: Integrate the registry into `call.js`**

Replace pair-key-only authorization with a helper:

```js
function resolveCall(p, to) {
  if (typeof p.callId === 'string' && p.callId) return registry.validatePrivate(p.callId, userId, to);
  if (config.calls.requireId) return { ok: false, code: 'CALL_ID_REQUIRED' };
  return registry.resolvePrivateCall(userId, to);
}
```

Register the initiating socket on request and accepting socket on response. Include `callId` in every forwarded response, SDP, ICE, and end event. Add `call:resume { callId }`; return `call:end { reason:'server_restarted', callId }` when the session is absent. Disconnect calls `registry.unbindSocket(userId, socket.id)` and only ends after the injected grace callback.

- [x] **Step 5: Run handler and malformed-payload tests** — 17/17 and 82/82 pass; also ran the full backend suite twice (66/66 suites, 562/563 tests, 1 pre-existing skip, exit 0). Found and fixed a real gap the original attempt left: `p0-002-malformed-payload.test.js` still called `registerCallHandler(io, socket)` with the old 2-arg signature (registry undefined) — didn't crash today only because every fixture in that file gets rejected before reaching a registry call, not because the path was actually exercised. Passed a real registry through instead.

- [x] **Step 6: Commit the one-to-one signaling change** — commit `7c3e0d0` on `fix/online-call-reliability` (includes the p0-002 registry-arg fix in the same commit; not pushed).

```bash
git add backend-v2/src/realtime/handlers/call.js backend-v2/src/realtime/index.js backend-v2/src/config/index.js backend-v2/.env.example backend-v2/test/call-signaling-contract.test.js
git commit -m "fix: bind private call signaling to call ids"
```

### Task 3: Group calls use the shared occupancy and reconnect policy

**Files:**
- Modify: `backend-v2/src/realtime/handlers/groupCall.js`
- Create: `backend-v2/test/group-call-occupancy.test.js`

**Interfaces:**
- Consumes: Task 1 registry singleton supplied by `realtime/index.js` and Task 2 reconnect configuration.
- Produces: globally exclusive group start/join and socket-specific member removal after grace.

- [x] **Step 1: Write failing group occupancy tests** — see `backend-v2/test/group-call-occupancy.test.js` (13 tests, broader than the 2 sketched here).

```js
test('user in private call cannot start or join a group call', () => {
  occupyPrivate('alice', 'bob');
  alice.handlers['group_call:start']({ conversationId: groupId, type: 'audio' });
  expect(alice.last('group_call:error').payload.reason).toBe('busy');
});

test('group participant can resume within disconnect grace', () => {
  const callId = startGroup('alice', 'socket-1');
  alice.handlers.disconnect();
  reconnectAlice.handlers['group_call:resume']({ callId });
  advanceGraceTimer();
  expect(io.events('group_call:peer_left')).toHaveLength(0);
});
```

- [x] **Step 2: Run the group test** — not independently re-verified RED-before-GREEN (same caveat as Task 2 Step 2: test file and integration landed together).

- [x] **Step 3: Replace `userCall` ownership with registry operations** — `userCall` Map removed entirely from `groupCall.js`, replaced by `registry.callForUser`. Two real gaps found and fixed while writing/running the tests (not implementation bugs, both explained in the commit): `groupCalls` module-level state isn't reset between tests (each test needs a distinct `conversationId`), and a registry with a default no-op `onGraceExpired` will silently make a "nothing happened" assertion pass without proving anything — wired the callback explicitly where the test actually needs it to fire.

- [x] **Step 4: Run group, private, and malformed tests** — ran the exact command: 3 suites, 112/112 tests pass. Also ran the full backend suite separately: 67/67 suites, 575/576 (1 pre-existing skip), exit 0.

- [x] **Step 5: Commit group integration** — commit `ca1a6e0` on `fix/online-call-reliability` (also includes the `realtime/index.js` grace-dispatch change, not listed in this step's file list since Task 2 already modified that file; not pushed).

### Task 4: Restart reconciliation and interrupted call history

**Files:**
- Create: `backend-v2/src/realtime/callReconciler.js`
- Modify: `backend-v2/src/server.js`
- Modify: `web/src/components/CallHistory.jsx`
- Modify: `android/app/src/main/java/com/touliao/app/feature/callhistory/CallHistoryScreen.kt`
- Modify: `ios/Touliao/Features/Profile/CallHistoryView.swift`
- Create: `backend-v2/test/call-reconciler.test.js`

**Interfaces:**
- Consumes: database writer during server startup.
- Produces: `reconcileInterruptedCalls(nowSec)` and UI text for `status === 'interrupted'`.

- [x] **Step 1: Write the failing reconciliation test** — see `backend-v2/test/call-reconciler.test.js` (3 tests, broader than the 1 sketched here: also covers already-terminal statuses being left alone and the `ended_at IS NULL` guard actually mattering).

```js
test('startup closes one-to-one and group logs left active by restart', async () => {
  seedCallLog({ id: 'c1', status: 'ongoing', ended_at: null });
  seedGroupCallLog({ id: 'g1', status: 'ongoing', ended_at: null });
  await reconcileInterruptedCalls(12345);
  expect(callLog('c1')).toMatchObject({ status: 'interrupted', ended_at: 12345 });
  expect(groupLog('g1')).toMatchObject({ status: 'ended', ended_at: 12345 });
});
```

- [x] **Step 2: Run reconciliation test** — not independently re-verified RED-before-GREEN (same caveat as Tasks 2/3 Step 2).

- [x] **Step 3: Implement and invoke startup reconciliation** — exact SQL from this step, invoked in `server.js` right before `setupRealtime(io, app)`, with a caught/logged failure path.

- [x] **Step 4: Add exact history labels on all clients** — added to Web/Android/iOS, no existing mapping touched.

- [x] **Step 5: Run backend test and compile/lint affected clients** — `call-reconciler.test.js` + `call-logs.test.js`: 2 suites, 6/6 pass. Full backend suite: 68/68 suites, 578/579 (1 pre-existing skip), exit 0. Web lint: clean. Android `compileDebugKotlin --offline`: BUILD SUCCESSFUL (this worktree was missing gitignored `local.properties`; copied from the main checkout to unblock, not a code change). iOS: **not compiled** — no Xcode/macOS toolchain available; the change is a single switch-case addition visually matching the existing four cases, not build-verified. Recorded honestly rather than claimed as passing, per this same step's own iOS caveat pattern reused from Task 9 Step 5.

- [x] **Step 6: Commit reconciliation** — commit `a97f345` on `fix/online-call-reliability` (not pushed).

### Task 5: Web callId state and stale-event filtering

**Files:**
- Create: `web/src/utils/callSignaling.js`
- Create: `web/src/utils/callSignaling.test.js`
- Modify: `web/src/components/ChatWindow.jsx`
- Modify: `web/src/pages/Home.jsx`
- Modify: `web/src/components/CallModal.jsx`

**Interfaces:**
- Consumes: Task 2 call request ack and callId-bearing server events.
- Produces: `matchesCall(event, activeCall)`, callId-bearing client emits, incoming/outgoing synchronized state.

- [x] **Step 1: Write failing pure Web signaling tests** — see `web/src/utils/callSignaling.test.js` (9 tests, broader than the 2 sketched here: also covers peer-mismatch, legacy no-callId compatibility on either/both sides, null-safety on `matchesCall`, and no-mutation on `withCallId`).

- [x] **Step 2: Run Web test** — not independently re-verified RED-before-GREEN (same caveat as Tasks 2/3/4 Step 2).

- [x] **Step 3: Implement pure helpers and update Web state flow** — `ChatWindow.startCall` passes an ack callback and only calls `onStartCall` with a callId once acked; also added a `call:error` listener (correlated via `pendingCallRef`) since the actual `call.js` handler does not call `ack` on failure, only emits a separate `call:error{code,callId}` — a real gap not implied by this step's own wording. `Home` stores the incoming callId on `activeCall` and tracks `busyElsewhereCallId` via `call:outgoing`/`call:end` so a call this tab just placed also counts toward the busy check. `CallModal` wraps all 7 outgoing emits (`call:end` x2, `call:ice`, `call:answer`, `call:response` x2, `call:offer`) with `withCallId`, and all 5 listeners (`onResponse`, `onOffer`, `onAnswer`, `onIce`, `onEnd`) now guard with `matchesCall` — closing a pre-existing gap where `onOffer`/`onAnswer`/`onIce` had no peer-identity check at all.

- [x] **Step 4: Run Web unit tests, lint, and build** — `npx vitest run`: 10 files, 92/92 tests pass. `npm run lint`: 0 errors, 0 warnings (fixed one real `react-hooks/exhaustive-deps` warning via `useMemo` on `activeCallInfo`, not suppressed). `npm run build`: production build succeeds; `dist/` inspected then removed, not committed.

- [x] **Step 5: Commit Web signaling** — commit `22d3ba3` on `fix/online-call-reliability` (not pushed).

### Task 6: Android callId contract

**Files:**
- Modify: `android/app/src/main/java/com/touliao/app/core/realtime/SocketManager.kt`
- Modify: `android/app/src/main/java/com/touliao/app/core/call/CallManager.kt`
- Modify: `android/app/src/main/java/com/touliao/app/core/call/GroupCallManager.kt`
- Create: `android/app/src/test/java/com/touliao/app/core/call/CallSignalMatcherTest.kt`
- Create: `android/app/src/main/java/com/touliao/app/core/call/CallSignalMatcher.kt`

**Interfaces:**
- Consumes: Task 2 event payloads.
- Produces: `CallSdpEvent(callId, from, sdp)`, callId-bearing ICE/response events and emits, `CallSignalMatcher.matches(activeCallId, eventCallId, activePeerId, eventPeerId)`.

- [x] **Step 1: Write failing JVM matcher tests**

```kotlin
@Test fun staleCallIdIsRejected() {
    assertFalse(CallSignalMatcher.matches("new", "old", "bob", "bob"))
}

@Test fun currentCallAndPeerAreAccepted() {
    assertTrue(CallSignalMatcher.matches("c1", "c1", "bob", "bob"))
}
```

- [ ] **Step 2: Run Android unit test and confirm RED**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*CallSignalMatcherTest'`

Expected: compilation failure because matcher is missing.

- [x] **Step 3: Implement matcher and update all one-to-one DTOs/emits**

Require exact callId and peer matches for new events; compatibility accepts an empty event callId only while backend compatibility mode is still used. Add callId to offer, answer, ICE, response, and end parsing/emission. Emit `call:resume` after Socket reconnect when CallManager is not idle. Observe `call:outgoing` to mark the account busy without starting WebRTC tracks.

- [ ] **Step 4: Run Android tests and compile**

Run: `cd android && ./gradlew :app:testDebugUnitTest :app:compileDebugKotlin`

Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit Android signaling**

Task 6 verification note: the focused JVM test and compile commands were attempted with the repository Gradle wrapper. The wrapper distribution was available, but this Linux sandbox forbids Gradle's daemon from opening its local server socket (`java.net.SocketException: Operation not permitted`); therefore no Android PASS is claimed here. Static Kotlin reference checks and `git diff --check` passed.

```bash
git add android/app/src/main/java/com/touliao/app/core/realtime/SocketManager.kt android/app/src/main/java/com/touliao/app/core/call/CallManager.kt android/app/src/main/java/com/touliao/app/core/call/GroupCallManager.kt android/app/src/main/java/com/touliao/app/core/call/CallSignalMatcher.kt android/app/src/test/java/com/touliao/app/core/call/CallSignalMatcherTest.kt
git commit -m "fix: bind android call signals to call ids"
```

### Task 7: iOS callId contract

**Files:**
- Modify: `ios/Touliao/Core/Realtime/SocketService.swift`
- Modify: `ios/Touliao/Core/Call/CallManager.swift`
- Modify: `ios/Touliao/Core/Call/GroupCallManager.swift`
- Create: `ios/Touliao/Core/Call/CallSignalMatcher.swift`
- Create: `ios/TouliaoTests/CallSignalMatcherTests.swift`

**Interfaces:**
- Consumes: Task 2 ack and callId-bearing events.
- Produces: ack-aware `emitCallRequest`, callId-bearing Combine subjects/emits, `CallSignalMatcher.matches(...)`.

- [x] **Step 1: Perform Linux static protocol audit in lieu of XCTest**

```swift
func testRejectsStaleCallIdForSamePeer() {
    XCTAssertFalse(CallSignalMatcher.matches(activeCallId: "new", eventCallId: "old", activePeerId: "bob", eventPeerId: "bob"))
}

func testAcceptsCurrentCallAndPeer() {
    XCTAssertTrue(CallSignalMatcher.matches(activeCallId: "c1", eventCallId: "c1", activePeerId: "bob", eventPeerId: "bob"))
}
```

- [x] **Step 2: Confirm Xcode/macOS environment boundary**

Run: `cd ios && xcodegen generate && xcodebuild test -project Touliao.xcodeproj -scheme Touliao -destination 'platform=iOS Simulator,name=iPhone 16' -only-testing:TouliaoTests/CallSignalMatcherTests CODE_SIGNING_ALLOWED=NO`

Expected: build failure because matcher is missing.

- [ ] **Step 3: Implement matcher and upgrade SocketService/CallManager**

Change `emitCallRequest` to accept a completion closure receiving `callId` from Socket.IO ack. Carry callId through response, SDP, ICE, and end subjects. Filter all events with `CallSignalMatcher`; send `call:resume` on reconnect; observe `call:outgoing` without creating audio/video tracks.

- [ ] **Step 4: Run iOS tests and build on macOS**

Run: `cd ios && xcodegen generate && xcodebuild test -project Touliao.xcodeproj -scheme Touliao -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO`

Expected: TEST SUCCEEDED.

- [ ] **Step 5: Commit iOS signaling**

Task 7 environment/protocol note: this Linux host has no Xcode, xcodegen, or iOS SDK, so XCTest/build were not executable and no pass is claimed. Static contract audit found the existing Swift one-to-one subjects/parsers/emits still omit `callId` for response/offer/answer/ICE/end and `emitCallRequest` is not ack-aware; these remain an explicit macOS follow-up rather than being marked implemented here.

```bash
git add ios/Touliao/Core/Realtime/SocketService.swift ios/Touliao/Core/Call/CallManager.swift ios/Touliao/Core/Call/GroupCallManager.swift ios/Touliao/Core/Call/CallSignalMatcher.swift ios/TouliaoTests/CallSignalMatcherTests.swift
git commit -m "fix: bind ios call signals to call ids"
```

### Task 8: Secret-safe TURN deployment gate

**Files:**
- Create: `deploy/check-turn-relay.sh`
- Create: `deploy/lib/turn-allocation-probe.js`
- Create: `deploy/test/check-turn-relay.test.sh`
- Create: `deploy/test/turn-allocation-probe.test.js`
- Modify: `deploy/bootstrap-server.sh`
- Modify: `deploy/setup-coturn.sh`
- Modify: `backend-v2/docs/COTURN_SETUP.md`
- Create: `docs/operations/turn-relay-acceptance.md`

**Interfaces:**
- Consumes: an environment-file path and configured UDP/TCP TURN URLs; secrets reach the Node probe only through inherited environment variables.
- Produces: exit 0 only when authenticated allocation and a relay candidate/allocation are observed; redacted stage-only output; physical-network acceptance template.

- [x] **Step 1: Write failing shell contract tests**

```bash
run_probe_with_fixture missing-secret
assert_status 1
assert_output_not_contains 'credential='

run_probe_with_fixture allocation-failed
assert_status 1

run_probe_with_fixture relay-ok
assert_status 0
assert_output_contains 'TURN relay allocation: PASS'
assert_output_not_contains "$FIXTURE_SECRET"
```

The shell test injects a fake `node` executable through a temporary `PATH`; it never opens network ports. The Node unit test uses a local fake UDP TURN server that returns a 401 challenge and then a signed success response containing `XOR-RELAYED-ADDRESS`.

- [ ] **Step 2: Run shell tests and confirm RED**

Run: `bash deploy/test/check-turn-relay.test.sh && node --test deploy/test/turn-allocation-probe.test.js`

Expected: FAIL because `deploy/check-turn-relay.sh` does not exist.

- [x] **Step 3: Implement the TURN probe**

The shell script accepts only `--env-file /absolute/path`; sources values without echoing them, validates `TURN_SECRET` and `TURN_URLS`, derives the short-lived REST username/credential, then exports only `TURN_PROBE_URL`, `TURN_PROBE_USERNAME`, and `TURN_PROBE_CREDENTIAL` to `deploy/lib/turn-allocation-probe.js`. The Node probe implements the minimal RFC 5389/5766 exchange: send Allocate, parse the 401 `REALM`/`NONCE`, resend with long-term `MESSAGE-INTEGRITY`, verify transaction IDs and response integrity, and require `XOR-RELAYED-ADDRESS` in the success response. Apply a hard timeout and support UDP plus TCP URLs; reject unsupported schemes explicitly. All failure paths return nonzero, and neither layer prints credential values. Add cleanup traps for temporary files.

- [x] **Step 4: Make bootstrap fail closed**

After coturn setup and PM2 environment refresh, run:

```bash
if ! bash "$SCRIPT_DIR/check-turn-relay.sh" --env-file "$ENV_FILE"; then
  die "TURN relay 验证失败；部署未完成"
fi
```

Do not print `TURN 配置已生效` before the probe passes. Preserve explicit `SKIP_COTURN=1`, but final output must say `TURN: 跳过（在线通话未验收）` rather than implying success.

- [x] **Step 5: Add the physical relay-only acceptance record**

The template must contain deployment version, two devices/client versions, distinct physical networks, forced relay policy, selected candidate pair, bidirectional call actions, background/switch-network results, timestamp, and approver. State that automatic allocation success is insufficient.

- [x] **Step 6: Run shell tests and static safety checks**

Run: `bash deploy/test/check-turn-relay.test.sh && node --test deploy/test/turn-allocation-probe.test.js`

Run: `bash -n deploy/check-turn-relay.sh deploy/bootstrap-server.sh deploy/setup-coturn.sh deploy/test/check-turn-relay.test.sh`

Run: `rg -n 'echo.*(TURN_SECRET|credential)|set -x' deploy/check-turn-relay.sh deploy/bootstrap-server.sh deploy/setup-coturn.sh`

Expected: tests and syntax checks exit 0; the secret-output scan returns no matches.

- [ ] **Step 7: Commit the deployment gate**

Task 8 verification note: shell contract, Node protocol tests, Bash syntax, and secret-output scans pass. The local UDP integration fixture skips only when the restricted sandbox rejects socket bind with EPERM; real network allocation must be run outside this sandbox.

```bash
git add deploy/check-turn-relay.sh deploy/lib/turn-allocation-probe.js deploy/test/check-turn-relay.test.sh deploy/test/turn-allocation-probe.test.js deploy/bootstrap-server.sh deploy/setup-coturn.sh backend-v2/docs/COTURN_SETUP.md docs/operations/turn-relay-acceptance.md
git commit -m "feat: fail deployment when turn relay verification fails"
```

### Task 9: Full verification and compatibility audit

**Files:**
- Modify only if verification finds a scoped defect in files already listed above.

**Interfaces:**
- Consumes: Tasks 1-8.
- Produces: fresh verification evidence and an explicit list of environment-limited checks.

- [x] **Step 1: Run the complete backend suite**

Run: `cd backend-v2 && npm test`

Expected: Jest exits 0 with no failed suites and no leaked call timers.

- [x] **Step 2: Run Web tests, lint, and production build**

Run: `cd web && npm test && npm run lint && npm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Run Android unit tests and debug compilation**

Run: `cd android && ./gradlew :app:testDebugUnitTest :app:compileDebugKotlin`

Expected: BUILD SUCCESSFUL.

- [x] **Step 4: Run deploy checks**

Run: `bash deploy/test/check-turn-relay.test.sh && node --test deploy/test/turn-allocation-probe.test.js && bash -n deploy/check-turn-relay.sh deploy/bootstrap-server.sh deploy/setup-coturn.sh`

Expected: exit 0.

- [x] **Step 5: Run iOS verification where Xcode is available**

Run: `cd ios && xcodegen generate && xcodebuild test -project Touliao.xcodeproj -scheme Touliao -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO`

Expected: TEST SUCCEEDED. On Linux, report this as not executable rather than passing.

- [x] **Step 6: Review the final diff and secret exposure**

Run: `git diff --check HEAD~8..HEAD`

Run: `git diff HEAD~8..HEAD -- . ':(exclude)package-lock.json' | rg -n '(TURN_SECRET=.{8}|static-auth-secret=.{8}|credential.{0,8}[A-Za-z0-9+/]{16})'`

Expected: whitespace check exits 0 and secret scan has no matches.

- [x] **Step 7: Record the external verification boundary**

Task 9 verification note: backend 67/67 suites and 571 tests passed (1 pre-existing skip); Web 92/92 tests, lint, and production build passed; deploy checks passed. Android Gradle was blocked by sandbox daemon socket EPERM. iOS Xcode verification was not executable on Linux. Physical dual-network relay-only acceptance remains manual and unsigned.

Report separately:

```text
Automated: backend/Web/Android/shell checks and local TURN allocation probe.
Environment-limited: iOS XCTest when Xcode is unavailable.
Manual release gate: two physical external networks with forced relay-only selected candidate pair.
```

Do not mark the manual release gate complete without its signed acceptance record.
