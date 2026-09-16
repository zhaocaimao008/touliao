import { describe, expect, it } from 'vitest';
import {
  buildMessageSearchParams,
  formatSearchMessageSummary,
  MESSAGE_SEARCH_TYPES,
} from './messageSearchFilters';

const t = (key) => ({
  'gs.typeImage': 'Image',
  'gs.typeVoice': 'Voice',
  'gs.typeContactCard': 'Contact card',
  'gs.typeRedPacket': 'Red packet',
  'gs.typeMerged': 'Chat history',
}[key] || key);

describe('message search filters', () => {
  it('keeps the unfiltered request backward-compatible', () => {
    expect(buildMessageSearchParams({ query: 'hello' }, new Date('2026-09-05T12:00:00Z')))
      .toEqual({ q: 'hello', limit: 20 });
  });

  it('maps type, inclusive calendar range and sender to backend query parameters', () => {
    const now = new Date(2026, 8, 5, 15, 30, 0);
    const params = buildMessageSearchParams({
      query: 'phone', type: 'image', timeRange: '7d', senderId: 'u1',
    }, now);
    const expectedStart = new Date(2026, 7, 29, 0, 0, 0, 0);

    expect(params).toEqual({
      q: 'phone', limit: 20, type: 'image',
      from: Math.floor(expectedStart.getTime() / 1000),
      to: Math.floor(now.getTime() / 1000), senderId: 'u1',
    });
  });

  it('uses today local midnight for the today chip', () => {
    const now = new Date(2026, 8, 5, 15, 30, 0);
    const params = buildMessageSearchParams({ query: 'x', timeRange: 'today' }, now);
    const midnight = new Date(2026, 8, 5, 0, 0, 0, 0);

    expect(params.from).toBe(Math.floor(midnight.getTime() / 1000));
    expect(params.to).toBe(Math.floor(now.getTime() / 1000));
  });

  it('exposes every backend message type requested by the filter UI', () => {
    expect(MESSAGE_SEARCH_TYPES.map(option => option.value)).toEqual([
      '', 'text', 'image', 'voice', 'video', 'file', 'contact_card',
      'red_packet', 'transfer', 'merged', 'call',
    ]);
  });

  it('renders useful media and structured-message summaries without leaking raw JSON', () => {
    expect(formatSearchMessageSummary({ type: 'image', content: 'photo.png' }, t)).toBe('[Image] photo.png');
    expect(formatSearchMessageSummary({ type: 'voice', content: 'voice.webm' }, t)).toBe('[Voice]');
    expect(formatSearchMessageSummary({ type: 'contact_card', content: '{"username":"Alice"}' }, t)).toBe('[Contact card] Alice');
    expect(formatSearchMessageSummary({ type: 'red_packet', content: '{bad json' }, t)).toBe('[Red packet]');
    expect(formatSearchMessageSummary({ type: 'merged', content: '{"title":"Trip notes"}' }, t)).toBe('[Chat history] Trip notes');
  });
});
