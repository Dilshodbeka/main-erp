// Attendance control from Timepay (face-ID check-in/out): who is late, who has not come,
// who left early. Pure: the Edge Functions fetch the Timepay data and pass it in.
// Field names follow the Timepay Integration API (employees, schedules, checkinouts).
import type { Finding } from './watch';

export interface TimepayEmployee { id: number; first_name: string; last_name: string; is_active: boolean }
export interface TimepayWorkDay { day: number; is_working: boolean; start_time: string | null; end_time: string | null }
export interface TimepaySchedule {
  id: number; name: string; schedule_type: string; schedule_cycle: number; start_date: string | null;
  work_days: TimepayWorkDay[]; employee_ids: number[];
}
export interface TimepayCheck {
  id: number; employee: { id: number; first_name: string; last_name: string };
  action: 'IN' | 'OUT' | null; status: 'ON_TIME' | 'LATE' | null;
  created_at: string | null; late_minutes: number;
}
export interface AttendanceData { employees: TimepayEmployee[]; schedules: TimepaySchedule[]; checks: TimepayCheck[] }

export interface AttendanceConfig {
  absentAfterMinutes: number;   // no check-in this long after the shift start
  earlyLeaveMinutes: number;    // left this long before the shift end…
  earlyLeaveGraceMinutes: number; // …and has not come back for this long
}
export const ATTENDANCE_DEFAULTS: AttendanceConfig = { absentAfterMinutes: 30, earlyLeaveMinutes: 30, earlyLeaveGraceMinutes: 60 };

const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fullName = (row: { first_name: string; last_name: string }): string => esc(`${row.first_name} ${row.last_name}`.trim());
/** "09:05:00" or an ISO timestamp with the company offset → minutes from local midnight. */
export function minutesOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const clock = value.length > 8 ? value.slice(11, 16) : value.slice(0, 5);
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The shift of this schedule on the given date, or null on a day off / free schedule. */
export function shiftOn(schedule: TimepaySchedule, today: string): { start: number; end: number | null } | null {
  if (schedule.schedule_type !== 'FIXED' && schedule.schedule_type !== 'FLEXIBLE') return null;
  const cycle = schedule.schedule_cycle > 0 ? schedule.schedule_cycle : 7;
  const date = new Date(`${today}T00:00:00Z`).getTime();
  // Without a cycle start the week is assumed to begin on Monday (index 0).
  const index = schedule.start_date
    ? ((Math.round((date - new Date(`${schedule.start_date}T00:00:00Z`).getTime()) / 86_400_000) % cycle) + cycle) % cycle
    : (new Date(date).getUTCDay() + 6) % 7;
  const day = schedule.work_days.find(row => row.day === index);
  const start = minutesOf(day?.start_time);
  if (!day?.is_working || start === null) return null;
  return { start, end: minutesOf(day.end_time) };
}

export interface AttendanceRow {
  employeeId: number; name: string; shiftStart: number; shiftEnd: number | null;
  firstIn: number | null; lateMinutes: number; lastAction: 'IN' | 'OUT' | null; lastAt: number | null;
  state: 'on_time' | 'late' | 'absent' | 'waiting' | 'left_early';
}

/** Working hours used when Timepay gives no schedule for an employee (local time, minutes from midnight). */
export interface WorkHours { start: number; end: number }
export const DEFAULT_HOURS: WorkHours = { start: 9 * 60, end: 19 * 60 };

type Loose = Record<string, unknown>;
const pick = (row: Loose | null | undefined, ...names: string[]): unknown => {
  for (const name of names) if (row && row[name] !== undefined && row[name] !== null) return row[name];
  return undefined;
};

/** Timepay field names differ between API versions: read each record tolerantly. */
function readEmployee(raw: unknown): { id: number; name: string; active: boolean } | null {
  const row = raw as Loose;
  const id = Number(pick(row, 'id', 'employee_id'));
  if (!Number.isFinite(id)) return null;
  const name = String(pick(row, 'full_name', 'name') ?? `${pick(row, 'first_name') ?? ''} ${pick(row, 'last_name') ?? ''}`).trim();
  const status = String(pick(row, 'status') ?? '').toLowerCase();
  const active = pick(row, 'is_active', 'active') !== false && !['inactive', 'fired', 'deleted', 'archived'].includes(status) && !pick(row, 'deleted_at', 'fired_at');
  return { id, name: esc(name || `#${id}`), active };
}

function readCheck(raw: unknown): { employeeId: number; action: 'IN' | 'OUT'; at: number; late: number } | null {
  const row = raw as Loose;
  const person = pick(row, 'employee', 'employee_id', 'user', 'user_id');
  const employeeId = Number(typeof person === 'object' && person ? pick(person as Loose, 'id') : person);
  const kind = String(pick(row, 'action', 'type', 'event', 'direction', 'check_type') ?? '').toUpperCase();
  const action = /OUT|EXIT|LEAVE|CHIQ/.test(kind) ? 'OUT' : /IN|ENTER|KIR/.test(kind) ? 'IN' : null;
  const at = minutesOf(String(pick(row, 'created_at', 'time', 'timestamp', 'check_time', 'datetime', 'date_time') ?? ''));
  if (!Number.isFinite(employeeId) || !action || at === null) return null;
  const status = String(pick(row, 'status') ?? '').toUpperCase();
  const late = Number(pick(row, 'late_minutes', 'late', 'delay_minutes') ?? 0) || 0;
  return { employeeId, action, at, late: action === 'IN' && (status === 'LATE' || late > 0) ? Math.max(late, 1) : 0 };
}

/**
 * One row per active employee. The shift comes from the Timepay schedule when there is one for today,
 * otherwise from `hours` (the workshop's usual day). `nowMinutes` is the local time of day.
 */
export function attendanceRows(data: AttendanceData, today: string, nowMinutes: number, config: AttendanceConfig = ATTENDANCE_DEFAULTS, hours: WorkHours = DEFAULT_HOURS): AttendanceRow[] {
  const shifts = new Map<number, { start: number; end: number | null }>();
  const dayOff = new Set<number>();
  for (const schedule of data.schedules ?? []) {
    const ids = Array.isArray(schedule?.employee_ids) ? schedule.employee_ids : [];
    const shift = Array.isArray(schedule?.work_days) ? shiftOn(schedule, today) : null;
    for (const id of ids) { if (shift) shifts.set(Number(id), shift); else if (Array.isArray(schedule?.work_days) && schedule.work_days.length) dayOff.add(Number(id)); }
  }
  const checks = (data.checks ?? []).map(readCheck).filter((row): row is NonNullable<ReturnType<typeof readCheck>> => row !== null).sort((a, b) => a.at - b.at);
  const rows: AttendanceRow[] = [];
  const seen = new Set<number>();
  const sunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;
  for (const raw of data.employees ?? []) {
    const employee = readEmployee(raw);
    if (!employee || !employee.active || seen.has(employee.id)) continue;
    seen.add(employee.id);
    const events = checks.filter(row => row.employeeId === employee.id);
    // A scheduled day off stays a day off unless the person actually came.
    if (!shifts.has(employee.id) && dayOff.has(employee.id) && !events.length) continue;
    // Without a schedule the usual hours apply; Sunday is a day off unless the person came.
    if (!shifts.has(employee.id) && sunday && !events.length) continue;
    const shift = shifts.get(employee.id) ?? { start: hours.start, end: hours.end };
    const firstIn = events.find(row => row.action === 'IN');
    const last = events.at(-1);
    // Timepay's own lateness wins; without it the arrival is compared with the shift start.
    const lateMinutes = firstIn ? (firstIn.late > 0 ? firstIn.late : Math.max(0, firstIn.at - shift.start)) : 0;
    let state: AttendanceRow['state'];
    if (!firstIn) state = nowMinutes >= shift.start + config.absentAfterMinutes ? 'absent' : 'waiting';
    else if (last?.action === 'OUT' && shift.end !== null
      && last.at <= shift.end - config.earlyLeaveMinutes && nowMinutes >= last.at + config.earlyLeaveGraceMinutes
      && nowMinutes < shift.end) state = 'left_early';
    else state = lateMinutes > 0 ? 'late' : 'on_time';
    rows.push({ employeeId: employee.id, name: employee.name, shiftStart: shift.start, shiftEnd: shift.end, firstIn: firstIn?.at ?? null, lateMinutes, lastAction: last?.action ?? null, lastAt: last?.at ?? null, state });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** What Timepay actually returned, without any personal data: only counts and field names. */
export function attendanceDiagnostics(data: AttendanceData): string {
  const keys = (rows: unknown[] | undefined) => rows?.length && typeof rows[0] === 'object' && rows[0] ? Object.keys(rows[0] as object).slice(0, 25).join(', ') : '—';
  const nested = (data.checks?.[0] as unknown as Loose | undefined)?.employee;
  return [
    `xodimlar: ${data.employees?.length ?? 0} [${keys(data.employees)}]`,
    `jadvallar: ${data.schedules?.length ?? 0} [${keys(data.schedules)}]`,
    `belgilar: ${data.checks?.length ?? 0} [${keys(data.checks)}]${nested && typeof nested === 'object' ? ` · employee: {${Object.keys(nested as object).slice(0, 10).join(', ')}}` : ''}`,
  ].join('\n');
}

/** Watcher findings: each situation is announced once a day. */
export function attendanceFindings(data: AttendanceData, today: string, nowMinutes: number, config: AttendanceConfig = ATTENDANCE_DEFAULTS): Finding[] {
  const found: Finding[] = [];
  for (const row of attendanceRows(data, today, nowMinutes, config)) {
    if (row.state === 'absent') {
      found.push({ key: `absent:${row.employeeId}:${today}`, group: 'staff', repeatHours: 24,
        text: `🚫 <b>${row.name}</b> — ishga kelmagan, smena ${hhmm(row.shiftStart)} da boshlangan (${nowMinutes - row.shiftStart} daqiqa o‘tdi)` });
    }
    if (row.lateMinutes > 0 && row.firstIn !== null) {
      found.push({ key: `late:${row.employeeId}:${today}`, group: 'staff', repeatHours: 24,
        text: `⏱ <b>${row.name}</b> — ${row.lateMinutes} daqiqa kechikdi (keldi ${hhmm(row.firstIn)}, smena ${hhmm(row.shiftStart)})` });
    }
    if (row.state === 'left_early' && row.lastAt !== null && row.shiftEnd !== null) {
      found.push({ key: `left:${row.employeeId}:${today}`, group: 'staff', repeatHours: 24,
        text: `🚪 <b>${row.name}</b> — ${hhmm(row.lastAt)} da chiqib ketgan, qaytmagan (smena ${hhmm(row.shiftEnd)} gacha)` });
    }
  }
  return found;
}

/** On-demand summary for the owner bot. */
export function attendanceReport(data: AttendanceData, today: string, nowMinutes: number): string {
  const rows = attendanceRows(data, today, nowMinutes);
  if (!rows.length) return `🕘 <b>Davomat</b>\n\nTimepay’dan faol xodim topilmadi.\n\n<code>${esc(attendanceDiagnostics(data))}</code>`;
  const list = (state: AttendanceRow['state'], render: (row: AttendanceRow) => string) => rows.filter(row => row.state === state).map(render);
  const onTime = list('on_time', row => `• ${row.name} — ${row.firstIn !== null ? hhmm(row.firstIn) : ''}`);
  const late = list('late', row => `• ${row.name} — ${row.firstIn !== null ? hhmm(row.firstIn) : ''}, ${row.lateMinutes} daqiqa kechikdi`);
  const absent = list('absent', row => `• ${row.name} — smena ${hhmm(row.shiftStart)}`);
  const waiting = list('waiting', row => `• ${row.name} — smena ${hhmm(row.shiftStart)}`);
  const left = list('left_early', row => `• ${row.name} — ${row.lastAt !== null ? hhmm(row.lastAt) : ''} da chiqqan`);
  const block = (title: string, lines: string[]) => (lines.length ? ['', `<b>${title} — ${lines.length}</b>`, ...lines] : []);
  return [
    `🕘 <b>Davomat · ${today}</b>`,
    `Smenada: ${rows.length} · keldi: ${onTime.length + late.length + left.length} · kelmadi: ${absent.length}`,
    ...block('Kelmagan', absent), ...block('Kechikkan', late), ...block('Erta ketgan', left),
    ...block('Vaqtida kelgan', onTime), ...block('Hali smena boshlanmagan', waiting),
  ].join('\n');
}
