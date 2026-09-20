import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { activateSession, captureSession, invalidateSession } from './sessionContext';
import { readDraft, writeDraft, clearDraft, readAllDrafts } from './draftStore';
beforeEach(() => {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k), key: i => [...values.keys()][i], get length() { return values.size; } };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  invalidateSession();
});
afterEach(() => vi.unstubAllGlobals());
function owner(id, server='https://one.test') { activateSession(server,id); return captureSession(); }
test.each(['group', 'dm-a-b'])('isolates %s through switch, delayed save, ABA, restart and environment', conv => {
  const a=owner('A');writeDraft(conv,'A draft',a);
  const b=owner('B');expect(readDraft(conv,b)).toBe('');expect(readAllDrafts()).toEqual({});
  writeDraft(conv,'late A',a);clearDraft(conv,a);writeDraft(conv,'B draft',b);
  expect(readDraft(conv,b)).toBe('B draft');
  const again=owner('A');expect(readDraft(conv,again)).toBe('A draft');
  writeDraft(conv,'old A after ABA',a);expect(readDraft(conv,again)).toBe('A draft');
  invalidateSession();expect(readDraft(conv,again)).toBe('');writeDraft(conv,'after logout',again);
  const restart=owner('A');expect(readDraft(conv,restart)).toBe('A draft');
  const other=owner('A','https://two.test');expect(readDraft(conv,other)).toBe('');
  expect(readDraft(conv,owner('B'))).toBe('B draft');
});
test('legacy unowned text remains quarantined and credential rotation preserves own draft', () => {
  localStorage.setItem('draft_group','unowned legacy');
  const a=owner('A');expect(readDraft('group',a)).toBe('');expect(readAllDrafts()).toEqual({});
  writeDraft('group','owned',a);localStorage.setItem('touliao_session_revision','rotated');
  expect(readDraft('group',a)).toBe('owned');writeDraft('group','after refresh',a);
  expect(readAllDrafts()).toEqual({group:'after refresh'});
  expect(localStorage.getItem('draft_group')).toBe('unowned legacy');
});
