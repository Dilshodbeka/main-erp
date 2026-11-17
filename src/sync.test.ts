import { describe, expect, it } from 'vitest';
import { applyCommand, cashBalance, emptyState } from './domain';
import { createSync, TransportError, type Snapshot, type SyncCache } from './sync';
import { DEMO_COMPANY_ID } from './migrations';
import type { Actor, Command, Envelope, State } from './types';

const actor: Actor = { id: 'owner', name: 'Владелец', role: 'admin', companyId: DEMO_COMPANY_ID };
const receipt: Command = { type: 'cash.post', direction: 'in', amount: 100, account: 'cash', toAccount: null, category: 'Средства владельца', note: 'Opening' };
function setup() {
  let server: Snapshot = { state: emptyState(), actor };
  let persisted: SyncCache = { snapshot: structuredClone(server), savedAt: Date.now(), pending: [] };
  let online = false;
  let failure: 'network' | 'lostAck' | 'access' | 'malformed' | null = null;
  let writesFail = false;
  const sent: Envelope[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  const options = {
    read: () => structuredClone(persisted),
    write: (cache: SyncCache) => { if (writesFail) throw new Error('Storage full'); persisted = structuredClone(cache); },
    lock: <T>(action: () => Promise<T>): Promise<T> => { const result = tail.then(action); tail = result.catch(() => undefined); return result; },
    online: () => online,
    fetch: async () => {
      if (failure === 'access') throw new TransportError('Access denied', 'access');
      if (failure === 'network') throw new TransportError('No network', 'network');
      return structuredClone(server);
    },
    send: async (envelope: Envelope) => {
      sent.push(structuredClone(envelope));
      if (failure === 'network') throw new TransportError('No network', 'network');
      if (failure === 'access') throw new TransportError('Access denied', 'access');
      try { server.state = applyCommand(server.state, envelope, server.actor); }
      catch (error) { throw new TransportError((error as Error).message, 'rejected'); }
      if (failure === 'lostAck') { failure = null; throw new TransportError('Lost response', 'network'); }
      if (failure === 'malformed') return '<html>Bad gateway</html>' as unknown as Snapshot;
      return structuredClone(server);
    },
  };
  return {
    engine: () => createSync(options),
    cache: () => structuredClone(persisted), server: () => structuredClone(server), sent,
    online: (value: boolean) => { online = value; },
    fail: (value: typeof failure) => { failure = value; },
    full: () => { writesFail = true; },
    modify: (command: Command) => { server.state = applyCommand(server.state, { requestId: crypto.randomUUID(), expectedRevision: server.state.revision, command }, actor); },
    age: () => { persisted.savedAt = Date.now() - 25 * 60 * 60 * 1000; },
    strip: (key: string) => { delete (server.state as unknown as Record<string, unknown>)[key]; },
    worker: () => {
      const state = emptyState();
      state.employees.push({ id: 'worker', name: 'Работник', active: true });
      state.operations.push({ id: 'operation', name: 'Paint', unit: 'piece', salePrice: 2, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: ['worker'], active: true, autoAccept: false, norms: [] });
      state.orders.push({ id: 'order', number: '1', customerId: 'hidden', title: 'Task', qty: 10, price: 0, overhead: 0, dueDate: '', createdAt: '', kind: 'service', outputItemId: null, recipeVersionId: null, substitutions: {}, status: 'production', lines: [{ id: 'order-line', kind: 'service', title: 'Task', qty: 10, total: 0, status: 'production' }], materials: [], route: [{ id: 'task', lineId: 'order-line', operationId: 'operation', name: 'Paint', executorKind: 'employee', employeeId: 'worker', supplierId: null, planned: 10, completed: 0, rate: 2, status: 'in_progress' }] });
      state.tickets.push({
        id: 'ticket', authorId: 'worker', authorName: 'Работник', authorRole: 'worker', status: 'open',
        createdAt: '2026-11-12T08:00:00.000Z', updatedAt: '2026-11-12T08:00:00.000Z', closedAt: null, closedByName: null,
        messages: [{
          id: 'ticket-message', authorId: 'worker', authorName: 'Работник', authorRole: 'worker',
          at: '2026-11-12T08:00:00.000Z', text: 'Savol', context: null,
        }],
      });
      persisted.snapshot = { state, actor: { id: 'worker', name: 'Работник', role: 'worker', companyId: state.companyId } };
    },
  };
}

describe('durable offline synchronization', () => {
  it('queues offline without changing confirmed balances and sends once when online', async () => {
    const f = setup();
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(cashBalance(result.state, 'cash')).toBe(0);
    expect(f.sent).toHaveLength(0);
    f.online(true);
    const synced = await f.engine().snapshot();
    expect(cashBalance(synced.state, 'cash')).toBe(100);
    expect(f.cache().pending).toHaveLength(0);
  });
  it('survives reload and retries lost acknowledgements using exactly the same ID and revision', async () => {
    const f = setup(); f.online(true); f.fail('lostAck');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    const first = f.sent[0];
    expect(f.cache().pending[0].status).toBe('uncertain');
    await f.engine().snapshot();
    expect(f.sent[1].requestId).toBe(first.requestId);
    expect(f.sent[1].expectedRevision).toBe(first.expectedRevision);
    expect(cashBalance(f.server().state, 'cash')).toBe(100);
    expect(f.server().state.cash).toHaveLength(1);
  });
  it('keeps a malformed server acknowledgement uncertain and retries the same ID', async () => {
    const f = setup(); f.online(true); f.fail('malformed');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
    expect(f.cache().snapshot!.state.cash).toHaveLength(0);
    f.fail(null); await f.engine().snapshot();
    expect(f.sent[1].requestId).toBe(f.sent[0].requestId);
    expect(f.server().state.cash).toHaveLength(1);
  });
  it('does not discard or replace an uncertain request', async () => {
    const f = setup(); f.online(true); f.fail('network');
    await f.engine().submit(f.server().state, receipt, actor);
    const id = f.cache().pending[0].requestId;
    await expect(f.engine().discard(id)).rejects.toThrow('Natija noma’lum');
    await expect(f.engine().retryRejected(id)).rejects.toThrow();
    await expect(f.engine().submit(f.cache().snapshot!.state, receipt, actor)).rejects.toThrow('Avval');
    expect(f.cache().pending[0].requestId).toBe(id);
  });
  it('stops on another user revision conflict, keeps the command and loads current data', async () => {
    const f = setup();
    await f.engine().submit(f.server().state, receipt, actor);
    await f.engine().submit(f.server().state, { type: 'employee.create', name: 'Employee' }, actor);
    f.modify({ type: 'customer.create', name: 'Concurrent', phone: '', address: '', kind: 'customer' });
    f.online(true);
    const result = await f.engine().snapshot();
    expect(result.state.customers).toHaveLength(1);
    expect(f.cache().pending[0].status).toBe('rejected');
    expect(f.sent).toHaveLength(1);
    expect(f.server().state.cash).toHaveLength(0);
    await f.engine().snapshot();
    expect(f.sent).toHaveLength(1);
  });
  it('allows only explicit revalidation and a new ID after a definitive rejection', async () => {
    const f = setup();
    await f.engine().submit(f.server().state, receipt, actor);
    const previous = f.cache().pending[0].requestId;
    f.modify({ type: 'employee.create', name: 'Concurrent' }); f.online(true);
    await f.engine().snapshot();
    await f.engine().retryRejected(previous);
    expect(f.sent[1].requestId).not.toBe(previous);
    expect(f.sent[1].expectedRevision).toBe(1);
    expect(cashBalance(f.server().state, 'cash')).toBe(100);
  });
  it('validates cumulative pending expenses before accepting another offline command', async () => {
    const f = setup(); f.modify(receipt); f.online(true); await f.engine().snapshot(); f.online(false);
    const expense: Command = { ...receipt, direction: 'out', amount: 70 };
    const state = f.cache().snapshot!.state;
    await f.engine().submit(state, expense, actor);
    await expect(f.engine().submit(state, expense, actor)).rejects.toThrow('Insufficient account balance');
    expect(f.cache().pending).toHaveLength(1);
    expect(cashBalance(f.cache().snapshot!.state, 'cash')).toBe(100);
  });
  it('orders several offline requests against consecutive server revisions', async () => {
    const f = setup();
    await f.engine().submit(f.server().state, receipt, actor);
    await f.engine().submit(f.server().state, { ...receipt, direction: 'out', amount: 30 }, actor);
    expect(f.cache().pending.map(p => p.expectedRevision)).toEqual([0, 1]);
    f.online(true); await f.engine().snapshot();
    expect(cashBalance(f.server().state, 'cash')).toBe(70);
    expect(f.cache().pending).toHaveLength(0);
  });
  it('preserves safely cancelled pending requests without treating them as postings', async () => {
    const f = setup(); await f.engine().submit(f.server().state, receipt, actor);
    await f.engine().discard(f.cache().pending[0].requestId);
    f.online(true); await f.engine().snapshot();
    expect(f.sent).toHaveLength(0);
    expect(f.server().state.cash).toHaveLength(0);
  });
  it('never falls back to cached permissions after an authoritative access denial', async () => {
    const f = setup(); f.online(true); f.fail('access');
    await expect(f.engine().snapshot()).rejects.toThrow('Access denied');
    expect(f.cache().snapshot).toBeNull();
  });
  it('retains pending records but hides the snapshot when the server denies an operation', async () => {
    const f = setup(); await f.engine().submit(f.server().state, receipt, actor);
    f.online(true); f.fail('access');
    await expect(f.engine().snapshot()).rejects.toThrow('Access denied');
    expect(f.cache().snapshot).toBeNull();
    expect(f.cache().pending[0].status).toBe('rejected');
  });
  it('expires offline cache without destroying pending business records', async () => {
    const f = setup(); await f.engine().submit(f.server().state, receipt, actor); f.age();
    await expect(f.engine().snapshot()).rejects.toThrow('24 soat');
    expect(f.cache().pending).toHaveLength(1);
  });
  it('does not send if durable persistence fails', async () => {
    const f = setup(); f.online(true); f.full();
    await expect(f.engine().submit(f.server().state, receipt, actor)).rejects.toThrow('Storage full');
    expect(f.sent).toHaveLength(0);
  });
  it('rejects different actors and stale tabs before queueing', async () => {
    const f = setup();
    await expect(f.engine().submit(f.server().state, receipt, { ...actor, id: 'another' })).rejects.toThrow('Kirish profili');
    await expect(f.engine().submit({ ...f.server().state, revision: 5 }, receipt, actor)).rejects.toThrow('Ma’lumotlar boshqa varaqda');
    expect(f.cache().pending).toHaveLength(0);
  });
  it('supports a redacted worker snapshot and prevents excess and privileged commands offline', async () => {
    const f = setup(); f.worker(); const snapshot = f.cache().snapshot!;
    const excess: Command = { type: 'work.submit', orderId: 'order', taskId: 'task', qty: 11, note: 'Too much' };
    await expect(f.engine().submit(snapshot.state, excess, snapshot.actor)).rejects.toThrow('exceeds');
    const command: Command = { type: 'work.submit', orderId: 'order', taskId: 'task', qty: 6, note: 'Done' };
    await f.engine().submit(snapshot.state, command, snapshot.actor);
    await expect(f.engine().submit(snapshot.state, command, snapshot.actor)).rejects.toThrow('started');
    await expect(f.engine().submit(snapshot.state, receipt, snapshot.actor)).rejects.toThrow('Administrator action required');
    expect(f.cache().pending).toHaveLength(1);
  });
  it('serializes concurrent tabs so a durable ID is never sent twice as different requests', async () => {
    const f = setup(); f.online(true);
    const state = f.server().state;
    const results = await Promise.allSettled([f.engine().submit(state, receipt, actor), f.engine().submit(state, receipt, actor)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.server().state.cash).toHaveLength(1);
  });
});

describe('salaryPlans snapshot contract', () => {
  it('keeps the cached snapshot when the server omits salaryPlans', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect(first.state.salaryPlans).toEqual([]);
    f.strip('salaryPlans');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without salaryPlans', async () => {
    const f = setup(); f.online(true); f.strip('salaryPlans');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});

describe('expensePlans snapshot contract', () => {
  it('keeps the cached snapshot when the server omits expensePlans', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect(first.state.expensePlans).toEqual([]);
    f.strip('expensePlans');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without expensePlans', async () => {
    const f = setup(); f.online(true); f.strip('expensePlans');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});

describe('loans snapshot contract', () => {
  it('keeps the cached snapshot when the server omits loans', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect(first.state.loans).toEqual([]);
    f.strip('loans');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without loans', async () => {
    const f = setup(); f.online(true); f.strip('loans');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});

describe('workerDeductions snapshot contract', () => {
  it('keeps the cached snapshot when the server omits workerDeductions', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect((first.state as State & { workerDeductions?: unknown }).workerDeductions).toEqual([]);
    f.strip('workerDeductions');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without workerDeductions', async () => {
    const f = setup(); f.online(true); f.strip('workerDeductions');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});

describe('tickets snapshot contract', () => {
  it('keeps the cached snapshot when the server omits tickets', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect(first.state.tickets).toEqual([]);
    f.strip('tickets');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without tickets', async () => {
    const f = setup(); f.online(true); f.strip('tickets');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});

describe('worker ticket permissions', () => {
  it('normalizes missing actor scopes to empty arrays', async () => {
    const f = setup(); f.worker(); f.online(false);
    const snap = await f.engine().snapshot();
    expect(snap.actor.permissions).toEqual([]);
    expect(snap.actor.workshopIds).toEqual([]);
    expect(snap.actor.warehouseIds).toEqual([]);
  });
  it('allows a reply to the own ticket but rejects closing', async () => {
    const f = setup(); f.worker(); f.online(false);
    const snapshot = await f.engine().snapshot();
    await expect(f.engine().submit(snapshot.state, { type: 'ticket.close', ticketId: 'ticket' }, snapshot.actor))
      .rejects.toThrow('Administrator action required');
    const queued = await f.engine().submit(snapshot.state, { type: 'ticket.reply', ticketId: 'ticket', text: 'Qo‘shimcha' }, snapshot.actor);
    expect(queued.queued).toBe(true);
  });
});

describe('defects snapshot contract', () => {
  it('keeps the cached snapshot when the server omits defects', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect(first.state.defects).toEqual([]);
    f.strip('defects');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without defects', async () => {
    const f = setup(); f.online(true); f.strip('defects');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});
