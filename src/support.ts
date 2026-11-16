import type { Actor, SupportTicket, TicketContext, TicketMessage } from './types';
import { redact } from './diagnostics';

export type SeenMap = Record<string, string>;
export interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const PAGE_MAX = 40;
export const BUILD_MAX = 60;
export const PENDING_MAX = 999;
export const ERROR_MAX = 300;
export const ERRORS_MAX = 5;
const REVISION_MAX = Number.MAX_SAFE_INTEGER;

function invalid(): never {
  throw new Error('Invalid ticket context');
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string') invalid();
  const text = value.trim();
  if (text.length < 1 || text.length > max) invalid();
  return text;
}

function errorText(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const text = value.trim();
  if (text.length > ERROR_MAX) invalid();
  return text;
}

export function normalizeTicketContext(value: unknown): TicketContext | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  const page = requiredText(row.page, PAGE_MAX);
  const revision = boundedInteger(row.revision, 0, REVISION_MAX);
  const sync = row.sync === 'online' ? 'online' : row.sync === 'offline' ? 'offline' : invalid();
  const pending = boundedInteger(row.pending, 0, PENDING_MAX);
  const build = requiredText(row.build, BUILD_MAX);
  if (!Array.isArray(row.errors) || row.errors.length > ERRORS_MAX) invalid();
  const errors = row.errors.map(errorText);
  return { page, revision, sync, pending, build, errors };
}

export function buildTicketContext(input: {
  page: string; revision: number; online: boolean; pending: number; build: string; errors: string[];
}): TicketContext {
  const errors = input.errors.slice(-ERRORS_MAX).map(error => redact(String(error ?? '').trim()).slice(0, ERROR_MAX));
  return normalizeTicketContext({
    page: String(input.page ?? '').trim() || 'app',
    revision: input.revision,
    sync: input.online ? 'online' : 'offline',
    pending: input.pending,
    build: input.build,
    errors,
  }) as TicketContext;
}

export function visibleTickets(tickets: SupportTicket[], actor: Actor): SupportTicket[] {
  if (actor.role === 'admin') return tickets;
  if (actor.role === 'worker') return tickets.filter(ticket => ticket.authorId === actor.id);
  return [];
}

export function sortedTickets(tickets: SupportTicket[]): SupportTicket[] {
  return [...tickets].sort((left, right) => left.updatedAt === right.updatedAt
    ? left.id.localeCompare(right.id)
    : right.updatedAt.localeCompare(left.updatedAt));
}

export function lastMessage(ticket: SupportTicket): TicketMessage | null {
  return ticket.messages[ticket.messages.length - 1] ?? null;
}

export function hasUnread(ticket: SupportTicket, actor: Actor, seen: SeenMap): boolean {
  if (actor.role !== 'worker') return false;
  const last = lastMessage(ticket);
  return !!last && last.authorRole === 'admin' && seen[ticket.id] !== last.id;
}

export function needsReply(ticket: SupportTicket): boolean {
  return ticket.status === 'open' && lastMessage(ticket)?.authorRole === 'worker';
}

export function supportAlerts(tickets: SupportTicket[], actor: Actor, seen: SeenMap): number {
  if (actor.role === 'worker') return tickets.filter(ticket => hasUnread(ticket, actor, seen)).length;
  if (actor.role === 'admin') return tickets.filter(needsReply).length;
  return 0;
}

export function seenStorageKey(companyId: string, actorId: string): string {
  return `aliya-erp-support-seen:${companyId}:${actorId}`;
}

export function readSeen(storage: Pick<SeenStorage, 'getItem'>, key: string): SeenMap {
  try {
    const value = JSON.parse(storage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

export function writeSeen(storage: Pick<SeenStorage, 'setItem'>, key: string, seen: SeenMap): void {
  try {
    storage.setItem(key, JSON.stringify(seen));
  } catch {
    return;
  }
}
