# Unified Message Sync Design

## Status

Accepted by the user on 2026-08-31.

## Goal

Make the server database the durable source of truth for message creation and mutation across Web, Electron, Android, and iOS. Every conversation change receives a server-generated, strictly increasing sequence and every device catches up from its own persisted cursor.

## Data model

- `messages.server_sequence INTEGER`: creation sequence for the message. Historical rows are deterministically backfilled per conversation by `(created_at, rowid)`.
- `conversation_sequences(conversation_id PRIMARY KEY, last_sequence NOT NULL)`: atomic allocator state.
- `conversation_events(id PRIMARY KEY, conversation_id, server_sequence, event_type, message_id, actor_id, target_user_id, payload, created_at)`: append-only synchronization log with `UNIQUE(conversation_id, server_sequence)`.
- `idx_conversation_events_sync(conversation_id, server_sequence)` supports cursor scans.
- `idx_messages_conversation_sequence(conversation_id, server_sequence)` supports ordered history and diagnostics.

SQLite serializes writes, so allocation, domain mutation, and event insertion run in one writer transaction. The allocator uses UPSERT plus RETURNING, supported by the bundled SQLite version. Sources: https://www.sqlite.org/isolation.html, https://www.sqlite.org/lang_upsert.html, https://www.sqlite.org/lang_returning.html.

## Event contract

Event types in this increment:

- `message_created`
- `message_edited`
- `message_recalled`
- `message_deleted_for_me`
- `message_vanished`

Each sync envelope contains `server_sequence`, `event_type`, `message_id`, and a `message` snapshot when the event leaves a visible message. Personal deletion events set `target_user_id`; other users skip that event but advance to the conversation high-water mark without observing its payload.

## HTTP protocol

`GET /api/messages/:conversationId/sync?cursor=<non-negative integer>&limit=<1..500>`

Response:

```json
{
  "next_cursor": 42,
  "has_more": false,
  "messages": [
    {
      "server_sequence": 42,
      "event_type": "message_created",
      "message_id": "uuid",
      "message": {}
    }
  ]
}
```

The endpoint checks current conversation membership. Results are ordered by sequence and idempotent: clients reduce by `message_id`, apply mutations, and persist `next_cursor` only after the whole page is applied. `has_more` is computed against the last visible event; when only invisible per-user events remain, the response advances to the current high-water mark.

## Realtime protocol

Legacy realtime events remain for compatibility. After a committed event, the backend also emits `conversation_sync_available` with `{conversationId, server_sequence}`. Clients treat this only as an invalidation hint and call the HTTP sync endpoint; they never treat WebSocket delivery as completeness proof.

## Client persistence

- Web/Electron: IndexedDB message-cache record stores `lastSyncedSequence`, scoped by authenticated account and conversation.
- Android: account-scoped SharedPreferences cursor store.
- iOS: account-scoped UserDefaults cursor store.

Clients catch up on cold conversation load, WebSocket reconnect, foreground/resume, and `conversation_sync_available`. A single-flight loop requests pages until `has_more=false`, applies envelopes in sequence order, de-duplicates by message id, then persists the cursor.

## Compatibility and rollout

Existing history responses and legacy realtime events stay unchanged. New message responses add `server_sequence`. Migration is idempotent and is tested only against isolated databases in this work; production migration requires a backup and explicit deployment review.

## Verification

Tests cover strict allocation, deterministic backfill, 1/10/100/1,000/10,000-event pagination, duplicate page replay, out-of-order realtime hints, reconnect catch-up, multi-device independent cursors, and edit/recall/personal-delete synchronization. Existing suites remain mandatory.
