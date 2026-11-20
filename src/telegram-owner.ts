// Owner branch of the Telegram bot: turns one incoming text into one reply.
// Pure (no Deno, Supabase or DOM): the Edge Function loads the bundled copy
// (supabase/functions/_shared/owner-bot.generated.js, built by `npm run build:bot`).
import { translateError } from './i18n';
import { migrateState } from './migrations';
import { planOwnerAction } from './telegram-actions';
import type { Actor, Command } from './types';
import { attendanceFindings, attendanceReport, attendanceStructure, type AttendanceData } from './attendance';
import { dueFindings, isQuietHour, watchDigest, watchFindings, type Finding } from './watch';
import { ownerPush, workerNotices, type PushMessage, type WorkerNotice } from './push-messages';
import { buildInsights, insightDigest } from './insights';
import { esc, OWNER_COMMANDS, ownerMenuText, ownerReport, parseOwnerCommand, type ReportKey } from './telegram-reports';

export interface OwnerReply {
  text: string;
  /** Telegram reply keyboard rows; taps arrive as plain text equal to the label. */
  keyboard: string[][];
  /** ERP commands to run through erp_execute before answering (confirmed actions only). */
  commands?: Command[];
  /** Input to render with the fresh snapshot after the commands succeed. */
  followUp?: string;
}

/** Two buttons per row; a tap sends the label back as a normal message. */
export function ownerKeyboard(): string[][] {
  const rows: string[][] = [];
  for (let index = 0; index < OWNER_COMMANDS.length; index += 2) {
    rows.push(OWNER_COMMANDS.slice(index, index + 2).map(row => row.label));
  }
  return rows;
}

/** A slash command, a bare key, or a tapped keyboard label. */
export function resolveOwnerInput(input: string): ReportKey | 'menu' | null {
  const text = input.trim();
  const byLabel = OWNER_COMMANDS.find(row => row.label === text);
  if (byLabel) return byLabel.key;
  return parseOwnerCommand(text);
}

/** True when the reply is the attendance report, which needs Timepay data instead of the ERP snapshot. */
export function ownerNeedsAttendance(input: string): boolean {
  return resolveOwnerInput(input) === 'davomat' || isTimepayProbe(input);
}

/** "/timepay" — a service command: shows how the Timepay account is organised. */
export function isTimepayProbe(input: string): boolean {
  return input.trim().toLowerCase().replace(/^\//, '').split(/\s+/)[0] === 'timepay';
}

/** Only the menu is answered without ERP data. */
export function ownerNeedsState(input: string): boolean {
  return resolveOwnerInput(input) !== 'menu';
}

/**
 * rawSnapshot is the erp_snapshot RPC result for an admin profile: { actor, state }.
 * `today` is the local date (YYYY-MM-DD) stamped on shipments created from the bot.
 * `allowActions` turns on order cards and actions (launch, ship, payment); off = reports only.
 */
export function ownerReply(input: string, rawSnapshot: unknown, today = new Date().toISOString().slice(0, 10), allowActions = false,
  attendance: { data: AttendanceData; nowMinutes: number } | null = null): OwnerReply {
  const keyboard = ownerKeyboard();
  const target = resolveOwnerInput(input);
  if (target === 'menu') return { text: ownerMenuText(), keyboard };
  if (isTimepayProbe(input) && attendance) return { text: attendanceStructure(attendance.data, today), keyboard };
  if (target === 'davomat' && attendance) return { text: attendanceReport(attendance.data, today, attendance.nowMinutes), keyboard };
  const snapshot = rawSnapshot as { actor?: Actor; state?: unknown } | null;
  const state = migrateState(snapshot?.state);
  const actor = snapshot?.actor;
  if (!actor) throw new Error('owner_actor_missing');
  // Reports only by default. With actions on, "/buyurtmalar" shows the actionable list instead of totals.
  if (allowActions) {
    const action = planOwnerAction(target === 'buyurtmalar' ? '/buyurtmalar' : input, state, actor, today);
    if (action) return { ...action, keyboard };
  }
  if (target === null) return { text: `Bu buyruq tanilmadi.\n\n${ownerMenuText()}`, keyboard };
  return { text: ownerReport(state, target, today), keyboard };
}

/** "7135485514, 123" → ['7135485514', '123']; anything non-numeric is dropped. */
export function parseOwnerIds(value: string | undefined): string[] {
  return (value ?? '').split(/[\s,;]+/).map(part => part.trim()).filter(part => /^-?\d{3,20}$/.test(part));
}

/** Server-side refusal (erp_execute) as an Uzbek line for the owner. */
export function ownerErrorText(message: string): string {
  return `⚠️ Bajarilmadi: ${esc(translateError(message))}`;
}

export interface WatchRun {
  /** Message to send to the owner, or null when nothing new is due (or it is night). */
  text: string | null;
  /** Keys announced by this message — store them with the send time. */
  sentKeys: string[];
  /** Every situation that still exists — rows for other keys can be forgotten. */
  activeKeys: string[];
  /** The same news as a browser notification for the owner's devices (null when nothing is due). */
  push: PushMessage | null;
  /** "A task is waiting for you" notifications for workers that were not announced yet. */
  workers: WorkerNotice[];
  /** Morning recommendations: once a day, on the first run of the working morning. */
  digest: { key: string; text: string; push: PushMessage } | null;
}

/**
 * One scheduled watcher pass. `sent` maps finding key → ISO time it was last announced.
 * `localHour` is the hour in the company's time zone; at night nothing is sent and nothing is marked.
 * `attendance` is today's Timepay data (when the integration is configured): late, absent, left early.
 */
export function watchRun(rawSnapshot: unknown, sent: Record<string, string>, nowIso: string, today: string, localHour: number,
  attendance: { data: AttendanceData; nowMinutes: number } | null = null, hiddenInsights: string[] = []): WatchRun {
  const snapshot = rawSnapshot as { state?: unknown } | null;
  const staff: Finding[] = attendance ? attendanceFindings(attendance.data, today, attendance.nowMinutes) : [];
  const state = migrateState(snapshot?.state);
  const findings = [...staff, ...watchFindings(state, nowIso, today)];
  const tasks = workerNotices(state);
  const digestKey = `digest:${today}`;
  const activeKeys = [...findings.map(row => row.key), ...tasks.map(row => row.key), digestKey];
  if (isQuietHour(localHour)) return { text: null, sentKeys: [], activeKeys, push: null, workers: [], digest: null };
  const workers = tasks.filter(row => !sent[row.key]);
  let digest: WatchRun['digest'] = null;
  if (!sent[digestKey] && localHour < 12) {
    const insights = buildInsights(state, nowIso, today).filter(row => !hiddenInsights.includes(row.key));
    // A calm morning is not worth a message.
    if (insights.length) {
      digest = { key: digestKey, text: insightDigest(insights), push: { title: `Ertalabki tavsiyalar: ${insights.length} ta`, body: insights.slice(0, 3).map(row => row.title).join('\n'), url: '#/advisor', tag: 'digest' } };
    }
  }
  const due = dueFindings(findings, sent, nowIso);
  if (!due.length) return { text: null, sentKeys: [], activeKeys, push: null, workers, digest };
  return { text: watchDigest(due, '🔔 <b>Nazorat: e’tibor bering</b>'), sentKeys: due.map(row => row.key), activeKeys, push: ownerPush(due), workers, digest };
}

export { generateVapidKeys, pushRequest, pushGone, allowedPushEndpoint } from './webpush';
export { fetchAttendance } from './timepay';

/** "HH:MM" local clock → minutes from midnight (for the attendance rules). */
export function clockMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (hours % 24) * 60 + (minutes || 0);
}
