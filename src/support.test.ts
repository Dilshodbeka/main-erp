import { describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID } from './migrations';
import {
  BUILD_MAX, ERROR_MAX, ERRORS_MAX, PAGE_MAX, PENDING_MAX, buildTicketContext, hasUnread, lastMessage,
  needsReply, normalizeTicketContext, readSeen, seenStorageKey, sortedTickets, supportAlerts, visibleTickets, writeSeen,
} from './support';
import type { Actor, SupportTicket, TicketRole, TicketStatus } from './types';

const admin: Actor = { id: 'owner', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
const worker: Actor = { id: 'worker-1', name: 'Kamol', role: 'worker', companyId: DEMO_COMPANY_ID };
const other: Actor = { id: 'worker-2', name: 'Aziz', role: 'worker', companyId: DEMO_COMPANY_ID };

function message(id: string, role: TicketRole, actorId: string, at: string) {
  return { id, authorId: actorId, authorName: actorId, authorRole: role, at, text: 'Xabar', context: null };
}

function ticket(id: string, authorId: string, lastRole: TicketRole, updatedAt: string, status: TicketStatus = 'open'): SupportTicket {
  return {
    id, authorId, authorName: authorId, authorRole: 'worker', status, createdAt: updatedAt, updatedAt,
    closedAt: status === 'closed' ? updatedAt : null, closedByName: status === 'closed' ? 'Egasi' : null,
    messages: [message(`${id}-m1`, 'worker', authorId, updatedAt), message(`${id}-m2`, lastRole, lastRole === 'admin' ? admin.id : authorId, updatedAt)],
  };
}

const valid = {
  page: 'orders', revision: 12, sync: 'offline' as const, pending: 2, build: 'dev-42', errors: ['Xato 1234'],
};

describe('ticket context', () => {
  it('accepts boundaries and returns a trimmed fresh object', () => {
    const input = {
      page: ' orders ', revision: 0, sync: 'offline' as const, pending: PENDING_MAX,
      build: ` ${'b'.repeat(BUILD_MAX - 2)} `, errors: Array.from({ length: ERRORS_MAX }, () => 'x'.repeat(ERROR_MAX)),
    };
    const context = normalizeTicketContext(input)!;
    expect(context).toEqual({
      page: 'orders', revision: 0, sync: 'offline', pending: PENDING_MAX,
      build: 'b'.repeat(BUILD_MAX - 2), errors: Array.from({ length: ERRORS_MAX }, () => 'x'.repeat(ERROR_MAX)),
    });
    expect(context).not.toBe(input);
  });

  it('accepts the maximum safe revision and an empty error string', () => {
    expect(normalizeTicketContext({ ...valid, revision: Number.MAX_SAFE_INTEGER, errors: [''] })).toMatchObject({
      revision: Number.MAX_SAFE_INTEGER, errors: [''],
    });
  });

  it('treats null and undefined as no context', () => {
    expect(normalizeTicketContext(null)).toBeNull();
    expect(normalizeTicketContext(undefined)).toBeNull();
  });

  it('rejects every malformed field with the contract error', () => {
    const cases: unknown[] = [
      { ...valid, page: '' },
      { ...valid, page: 'p'.repeat(PAGE_MAX + 1) },
      { ...valid, page: 5 },
      { ...valid, revision: -1 },
      { ...valid, revision: 1.5 },
      { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, revision: '5' },
      { ...valid, sync: 'later' },
      { ...valid, pending: -1 },
      { ...valid, pending: PENDING_MAX + 1 },
      { ...valid, pending: 1.5 },
      { ...valid, build: '' },
      { ...valid, build: 'b'.repeat(BUILD_MAX + 1) },
      { ...valid, errors: ['x'.repeat(ERROR_MAX + 1)] },
      { ...valid, errors: Array.from({ length: ERRORS_MAX + 1 }, () => 'x') },
      { ...valid, errors: [5] },
      { ...valid, errors: 'Xato' },
      { ...valid, errors: undefined },
      'strong',
      ['errors'],
      { ...valid, page: undefined },
      { page: 'orders', revision: 0, sync: 'offline', pending: 0, build: 'dev' },
    ];
    for (const value of cases) expect(() => normalizeTicketContext(value)).toThrow('Invalid ticket context');
  });

  it('masks diagnostics and clamps them to the last five, 300 characters each', () => {
    const context = buildTicketContext({
      page: '', revision: 3, online: false, pending: 4, build: 'dev',
      errors: ['1', '2', '3', '4', '5', 'Xato 1234', 'y'.repeat(400)],
    });
    expect(context.page).toBe('app');
    expect(context.sync).toBe('offline');
    expect(context.pending).toBe(4);
    expect(context.errors).toHaveLength(5);
    expect(context.errors[0]).toBe('3');
    expect(context.errors[3]).toBe('Xato [son]');
    expect(context.errors[4]).toBe('y'.repeat(ERROR_MAX));
  });

  it('marks the connection when online', () => {
    expect(buildTicketContext({ page: 'cash', revision: 1, online: true, pending: 0, build: 'dev', errors: [] }).sync).toBe('online');
  });
});

describe('ticket visibility and alerts', () => {
  const ownUnread = ticket('t-own-unread', worker.id, 'admin', '2026-11-12T10:00:00.000Z');
  const ownClosed = ticket('t-own-closed', worker.id, 'worker', '2026-11-12T09:00:00.000Z', 'closed');
  const foreign = ticket('t-foreign', other.id, 'worker', '2026-11-12T11:00:00.000Z');

  it('shows workers only their own tickets and the owner everything', () => {
    expect(visibleTickets([ownUnread, ownClosed, foreign], worker).map(row => row.id)).toEqual(['t-own-unread', 't-own-closed']);
    expect(visibleTickets([ownUnread, ownClosed, foreign], admin)).toHaveLength(3);
    expect(visibleTickets([ownUnread], { ...worker, role: 'display' })).toEqual([]);
  });

  it('sorts by the latest update, then id', () => {
    expect(sortedTickets([ownClosed, foreign, ownUnread]).map(row => row.id)).toEqual(['t-foreign', 't-own-unread', 't-own-closed']);
    const tieA = { ...ownUnread, id: 'a' };
    const tieB = { ...ownUnread, id: 'b' };
    expect(sortedTickets([tieB, tieA]).map(row => row.id)).toEqual(['a', 'b']);
  });

  it('reads the last message and unread state', () => {
    expect(lastMessage(ownUnread)?.id).toBe('t-own-unread-m2');
    expect(lastMessage({ ...ownUnread, messages: [] })).toBeNull();
    expect(hasUnread(ownUnread, worker, {})).toBe(true);
    expect(hasUnread(ownUnread, worker, { 't-own-unread': 't-own-unread-m2' })).toBe(false);
    expect(hasUnread(ownUnread, admin, {})).toBe(false);
    expect(hasUnread(ownClosed, worker, {})).toBe(false);
  });

  it('counts owner replies and worker messages needing an answer', () => {
    expect(needsReply(ownClosed)).toBe(false);
    expect(needsReply(foreign)).toBe(true);
    expect(needsReply(ownUnread)).toBe(false);
    expect(supportAlerts([ownUnread, ownClosed, foreign], worker, {})).toBe(1);
    expect(supportAlerts([ownUnread, ownClosed, foreign], worker, { 't-own-unread': 't-own-unread-m2' })).toBe(0);
    expect(supportAlerts([ownUnread, ownClosed, foreign], admin, {})).toBe(1);
    expect(supportAlerts([ownUnread], { ...worker, role: 'display' }, {})).toBe(0);
  });
});

describe('seen storage', () => {
  function storage(initial: string | null = null) {
    let value = initial;
    return {
      getItem: () => value,
      setItem: (_key: string, next: string) => { value = next; },
      value: () => value,
    };
  }

  it('builds a per-company, per-actor key', () => {
    expect(seenStorageKey(DEMO_COMPANY_ID, worker.id)).toBe(`aliya-erp-support-seen:${DEMO_COMPANY_ID}:${worker.id}`);
  });

  it('round-trips and survives broken JSON', () => {
    const store = storage();
    writeSeen(store, 'key', { 't-1': 'm-1' });
    expect(readSeen(store, 'key')).toEqual({ 't-1': 'm-1' });
    expect(readSeen(storage('{oops'), 'key')).toEqual({});
    expect(readSeen(storage('["t-1"]'), 'key')).toEqual({});
    expect(readSeen(storage('{"t-1":5,"t-2":"m-2"}'), 'key')).toEqual({ 't-2': 'm-2' });
  });
});
