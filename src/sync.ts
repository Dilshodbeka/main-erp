import { applyCommand } from './domain';
import type { Actor, Command, Envelope, State } from './types';

export interface Snapshot { state: State; actor: Actor }
export interface Pending extends Envelope { status: 'queued' | 'uncertain' | 'rejected'; error: string; createdAt: string }
export interface SyncCache { snapshot: Snapshot | null; savedAt: number; pending: Pending[] }
export class TransportError extends Error {
  constructor(message: string, readonly kind: 'network' | 'rejected' | 'access') { super(message); }
}
interface Options {
  read: () => SyncCache;
  write: (cache: SyncCache) => void;
  lock: <T>(action: () => Promise<T>) => Promise<T>;
  online: () => boolean;
  fetch: () => Promise<Snapshot>;
  send: (envelope: Envelope) => Promise<Snapshot>;
}
const maxOfflineAge = 24 * 60 * 60 * 1000;

export function emptyCache(): SyncCache { return { snapshot: null, savedAt: 0, pending: [] }; }

function verifiedSnapshot(value: Snapshot): Snapshot {
  const state = value?.state;
  const actor = value?.actor;
  const arrays: (keyof State)[] = ['customers', 'suppliers', 'employees', 'machines', 'operations', 'items', 'recipes', 'orders', 'purchases', 'movements', 'cash', 'reports', 'defects', 'payroll', 'salaryPlans', 'expensePlans', 'loans', 'workerDeductions', 'shipments', 'tickets', 'audit'];
  if (!state || state.version !== 4 || typeof state.companyId !== 'string' || !state.companyId
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || arrays.some(key => !Array.isArray(state[key])) || !actor || typeof actor.id !== 'string'
    || typeof actor.companyId !== 'string' || actor.companyId !== state.companyId
    || typeof actor.name !== 'string' || !['admin', 'worker', 'display'].includes(actor.role)) {
    throw new TransportError('Server natijani to‘g‘ri snapshot bilan tasdiqlamadi. Yozuv avvalgi ID bilan navbatda qoladi.', 'network');
  }
  actor.permissions = Array.isArray(actor.permissions) ? actor.permissions : [];
  actor.workshopIds = Array.isArray(actor.workshopIds) ? actor.workshopIds : [];
  actor.warehouseIds = Array.isArray(actor.warehouseIds) ? actor.warehouseIds : [];
  return value;
}

export function createSync(options: Options) {
  const saveSnapshot = (cache: SyncCache, snapshot: Snapshot) => {
    cache.snapshot = verifiedSnapshot(snapshot);
    cache.savedAt = Date.now();
    options.write(cache);
  };
  const cached = (cache: SyncCache): Snapshot => {
    if (!cache.snapshot || Date.now() - cache.savedAt > maxOfflineAge) {
      throw new Error('Oflayn ishlash uchun onlayn kiring va ma’lumotlarni yangilang. Oflayn kirish muddati — 24 soat.');
    }
    return verifiedSnapshot(cache.snapshot);
  };
  const flush = async (cache: SyncCache) => {
    if (!options.online()) return;
    while (cache.pending.length && cache.pending[0].status !== 'rejected') {
      const request = cache.pending[0];
      // Persist uncertainty before sending: a crash may occur after the server commits.
      request.status = 'uncertain'; request.error = '';
      options.write(cache);
      let result: Snapshot;
      try { result = verifiedSnapshot(await options.send(request)); }
      catch (error) {
        if (!(error instanceof TransportError)) throw error;
        request.status = error.kind === 'network' ? 'uncertain' : 'rejected';
        request.error = error.message;
        if (error.kind === 'access') cache.snapshot = null;
        options.write(cache);
        if (error.kind === 'access') throw error;
        return;
      }
      cache.pending.shift();
      saveSnapshot(cache, result);
    }
  };
  const validate = (snapshot: Snapshot, pending: Pending[], command: Command) => {
    if (snapshot.actor.role === 'display') throw new Error('Ustaxona ekrani faqat kanbanni ko‘radi va amallarni bajara olmaydi.');
    if (pending.some(p => p.status !== 'queued')) throw new Error('Avval konfliktni hal qiling yoki yuborilgan amal natijasini sinxronizatsiyada aniqlang.');
    let projected = structuredClone(snapshot.state);
    const actor = snapshot.actor;
    const commands = [...pending.map(p => p.command), command];
    for (const next of commands) {
      projected = applyCommand(projected, { requestId: crypto.randomUUID(), expectedRevision: projected.revision, command: next }, actor);
    }
  };
  return {
    async snapshot(): Promise<Snapshot> {
      return options.lock(async () => {
        const cache = options.read();
        await flush(cache);
        if (options.online()) {
          try { saveSnapshot(cache, await options.fetch()); }
          catch (error) {
            if (!(error instanceof TransportError) || error.kind !== 'network') {
              if (error instanceof TransportError && error.kind === 'access') { cache.snapshot = null; options.write(cache); }
              throw error;
            }
          }
        }
        return cached(cache);
      });
    },
    async submit(state: State, command: Command, actor: Actor): Promise<Snapshot & { queued: boolean }> {
      return options.lock(async () => {
        const cache = options.read();
        const snapshot = cached(cache);
        if (snapshot.actor.id !== actor.id || snapshot.actor.role !== actor.role) throw new Error('Kirish profili o‘zgardi. Sahifani yangilang.');
        if (state.revision !== snapshot.state.revision) throw new Error('Ma’lumotlar boshqa varaqda o‘zgardi. Saqlashdan oldin ularni yangilang.');
        validate(snapshot, cache.pending, command);
        const request: Pending = { requestId: crypto.randomUUID(), expectedRevision: state.revision + cache.pending.length, command: structuredClone(command), status: 'queued', error: '', createdAt: new Date().toISOString() };
        cache.pending.push(request);
        options.write(cache);
        await flush(cache);
        const remaining = cache.pending.find(p => p.requestId === request.requestId);
        if (remaining?.status === 'rejected') throw new Error(remaining.error);
        return { ...cached(cache), queued: !!remaining };
      });
    },
    async discard(requestId: string): Promise<void> {
      return options.lock(async () => {
        const cache = options.read();
        const request = cache.pending.find(p => p.requestId === requestId);
        if (!request) return;
        if (request.status === 'uncertain') throw new Error('Natija noma’lum: avval avvalgi ID bilan sinxronizatsiyani takrorlang. O‘chirish hisobni ikkilantirishi mumkin.');
        cache.pending = cache.pending.filter(p => p.requestId !== requestId);
        options.write(cache);
      });
    },
    async retryRejected(requestId: string): Promise<Snapshot> {
      return options.lock(async () => {
        const cache = options.read();
        if (!options.online()) throw new Error('Konfliktni hal qilish uchun ulanish kerak.');
        const first = cache.pending[0];
        if (!first || first.requestId !== requestId || first.status !== 'rejected') throw new Error('Faqat birinchi rad etilgan amalni takrorlash mumkin.');
        const latest = await options.fetch();
        saveSnapshot(cache, latest);
        validate(latest, [], first.command);
        first.requestId = crypto.randomUUID();
        first.expectedRevision = latest.state.revision;
        first.status = 'queued'; first.error = '';
        options.write(cache);
        await flush(cache);
        return cached(cache);
      });
    },
  };
}
