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
/** 45 → "45 daqiqa", 60 → "1 soat", 361 → "6 soat 1 daqiqa". */
export function duration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} daqiqa`;
  const rest = total % 60;
  return rest ? `${Math.floor(total / 60)} soat ${rest} daqiqa` : `${Math.floor(total / 60)} soat`;
}
const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The shift of this schedule on the given date, or null on a day off / free schedule. */
export function shiftOn(schedule: TimepaySchedule, today: string): { start: number; end: number | null } | null {
  // Timepay sends the type in lower case ("flexible"), the documentation shows upper case.
  const type = String(schedule.schedule_type ?? '').toUpperCase();
  if (type !== 'FIXED' && type !== 'FLEXIBLE') return null;
  const cycle = schedule.schedule_cycle > 0 ? schedule.schedule_cycle : 7;
  const date = new Date(`${today}T00:00:00Z`).getTime();
  // Without a cycle start the week is assumed to begin on Monday (index 0).
  const weekday = (new Date(date).getUTCDay() + 6) % 7;
  const index = schedule.start_date
    ? ((Math.round((date - new Date(`${schedule.start_date}T00:00:00Z`).getTime()) / 86_400_000) % cycle) + cycle) % cycle
    : weekday % cycle;
  // A "same hours every day" shift is often stored as a single day.
  const day = schedule.work_days.find(row => row.day === index) ?? (schedule.work_days.length === 1 ? schedule.work_days[0] : undefined);
  const start = minutesOf(day?.start_time);
  if (!day?.is_working || start === null) return null;
  return { start, end: minutesOf(day.end_time) };
}

export interface AttendanceRow {
  employeeId: number; name: string; shiftStart: number; shiftEnd: number | null;
  firstIn: number | null; lateMinutes: number; lastAction: 'IN' | 'OUT' | null; lastAt: number | null;
  state: 'on_time' | 'late' | 'absent' | 'waiting' | 'left_early';
  /** The shift comes from the person's own Timepay schedule (or the usual hours when Timepay has no schedules at all). */
  hasShift: boolean;
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
function readEmployee(raw: unknown): { id: number; name: string; active: boolean; places: string[]; manager: boolean } | null {
  const row = raw as Loose;
  const id = Number(pick(row, 'id', 'employee_id'));
  if (!Number.isFinite(id)) return null;
  const name = String(pick(row, 'full_name', 'name') ?? `${pick(row, 'first_name') ?? ''} ${pick(row, 'last_name') ?? ''}`).trim();
  const status = String(pick(row, 'status') ?? '').toLowerCase();
  const active = pick(row, 'is_active', 'active') !== false && !['inactive', 'fired', 'deleted', 'archived'].includes(status) && !pick(row, 'deleted_at', 'fired_at');
  const named = (value: unknown): string[] => (Array.isArray(value) ? value : value ? [value] : []).map(entry => String((entry as Loose)?.name ?? '')).filter(Boolean);
  // The director is not a shift worker: no "absent" alarms about them.
  const manager = named(pick(row, 'position')).some(title => /direktor|директор|rahbar|руководител/i.test(title));
  return { id, name: esc(name || `#${id}`), active, places: [...named(pick(row, 'branches', 'branch')), ...named(pick(row, 'department'))], manager };
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

/** Which part of the Timepay account is this workshop: words looked for in branch and department names. */
export const COMPANY_WORDS = ['aliya', 'алия', 'алиа'];

/**
 * The employees to control. When the Timepay account holds several firms as branches or departments,
 * only those whose branch/department name contains one of `words` are kept; an account without such
 * names is one firm and is taken whole.
 */
export function companyEmployees(data: AttendanceData, words: string[] = COMPANY_WORDS): { id: number; name: string; manager: boolean }[] {
  const all = (data.employees ?? []).map(readEmployee).filter((row): row is NonNullable<ReturnType<typeof readEmployee>> => row !== null && row.active);
  const lower = words.map(word => word.toLowerCase()).filter(Boolean);
  const ours = all.filter(row => row.places.some(place => lower.some(word => place.toLowerCase().includes(word))));
  return (ours.length ? ours : all).map(row => ({ id: row.id, name: row.name, manager: row.manager }));
}

/**
 * One row per employee of the firm who has a shift today (FIXED/FLEXIBLE schedule from Timepay), plus
 * anyone else of the firm who checked in. Only when Timepay gives no schedules at all are the usual
 * `hours` applied to everybody. `nowMinutes` is the local time of day.
 */
export function attendanceRows(data: AttendanceData, today: string, nowMinutes: number, config: AttendanceConfig = ATTENDANCE_DEFAULTS, hours: WorkHours = DEFAULT_HOURS, words: string[] = COMPANY_WORDS): AttendanceRow[] {
  const shifts = new Map<number, { start: number; end: number | null }>();
  let scheduled = false;
  const sunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;
  for (const schedule of data.schedules ?? []) {
    const ids = Array.isArray(schedule?.employee_ids) ? schedule.employee_ids : [];
    if (ids.length) scheduled = true;
    // A cycle that is not a week (e.g. 6 working days) has no day off of its own: Sunday is the day off.
    const rolling = Number(schedule?.schedule_cycle) > 0 && Number(schedule?.schedule_cycle) !== 7;
    const shift = Array.isArray(schedule?.work_days) && !(rolling && sunday) ? shiftOn(schedule, today) : null;
    if (shift) for (const id of ids) shifts.set(Number(id), shift);
  }
  const checks = (data.checks ?? []).map(readCheck).filter((row): row is NonNullable<ReturnType<typeof readCheck>> => row !== null).sort((a, b) => a.at - b.at);
  const rows: AttendanceRow[] = [];
  const seen = new Set<number>();
  for (const employee of companyEmployees(data, words)) {
    if (seen.has(employee.id)) continue;
    seen.add(employee.id);
    const events = checks.filter(row => row.employeeId === employee.id);
    const own = employee.manager ? undefined : shifts.get(employee.id);
    // No shift today (day off, free schedule, not on a schedule): shown only if the person came.
    if (!own && !events.length && (scheduled || sunday || employee.manager)) continue;
    const shift = own ?? { start: hours.start, end: hours.end };
    const firstIn = events.find(row => row.action === 'IN');
    const last = events.at(-1);
    // Timepay's own lateness wins; without schedules the arrival is compared with the usual start.
    const lateMinutes = firstIn ? (firstIn.late > 0 ? firstIn.late : own || scheduled ? 0 : Math.max(0, firstIn.at - shift.start)) : 0;
    let state: AttendanceRow['state'];
    if (!firstIn) state = nowMinutes >= shift.start + config.absentAfterMinutes ? 'absent' : 'waiting';
    else if (last?.action === 'OUT' && (own || !scheduled) && shift.end !== null
      && last.at <= shift.end - config.earlyLeaveMinutes && nowMinutes >= last.at + config.earlyLeaveGraceMinutes
      && nowMinutes < shift.end) state = 'left_early';
    else state = lateMinutes > 0 ? 'late' : 'on_time';
    rows.push({ employeeId: employee.id, name: employee.name, shiftStart: shift.start, shiftEnd: shift.end, firstIn: firstIn?.at ?? null, lateMinutes, lastAction: last?.action ?? null, lastAt: last?.at ?? null, state, hasShift: Boolean(own) || !scheduled });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "/timepay" in the owner bot: how the Timepay account is organised — branches, departments, shifts and
 * how many people are on each. Names of people are not printed.
 */
export function attendanceStructure(data: AttendanceData, today: string): string {
  const people = (data.employees ?? []).map(readEmployee).filter((row): row is NonNullable<ReturnType<typeof readEmployee>> => row !== null);
  const active = people.filter(row => row.active);
  const ours = new Set(companyEmployees(data).map(row => row.id));
  const places = new Map<string, number>();
  for (const row of active) for (const place of row.places.length ? row.places : ['—']) places.set(place, (places.get(place) ?? 0) + 1);
  const lines = [
    '🛠 <b>Timepay tuzilmasi</b>',
    `Xodimlar: ${people.length} (faol ${active.length}) · nazoratda: ${ours.size}`,
    '', '<b>Filial / bo‘lim</b>',
    ...[...places].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => `• ${esc(name)} — ${count}`),
    '', `<b>Smenalar (${(data.schedules ?? []).length})</b>`,
    ...(data.schedules ?? []).slice(0, 20).map(schedule => {
      const ids = Array.isArray(schedule?.employee_ids) ? schedule.employee_ids.map(Number) : [];
      const shift = Array.isArray(schedule?.work_days) ? shiftOn(schedule, today) : null;
      const todayText = shift ? `${hhmm(shift.start)}–${shift.end !== null ? hhmm(shift.end) : '?'}` : 'bugun yo‘q';
      return `• ${esc(String(schedule?.name ?? '?'))} · ${esc(String(schedule?.schedule_type ?? '?'))} · sikl ${schedule?.schedule_cycle ?? '?'} · boshi ${schedule?.start_date ?? '—'} · kunlar ${Array.isArray(schedule?.work_days) ? schedule.work_days.length : 0} · xodim ${ids.length} (bizniki ${ids.filter(id => ours.has(id)).length}) · bugun: ${todayText}`;
    }),
    '', `Bugungi belgilar: ${(data.checks ?? []).length}`,
  ];
  return lines.join('\n');
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
        text: `🚫 <b>${row.name}</b> — ishga kelmagan, smena ${hhmm(row.shiftStart)} da boshlangan (${duration(nowMinutes - row.shiftStart)} o‘tdi)` });
    }
    if (row.lateMinutes > 0 && row.firstIn !== null) {
      found.push({ key: `late:${row.employeeId}:${today}`, group: 'staff', repeatHours: 24,
        text: `⏱ <b>${row.name}</b> — ${duration(row.lateMinutes)} kechikdi (keldi ${hhmm(row.firstIn)}, smena ${hhmm(row.shiftStart)})` });
    }
    if (row.state === 'left_early' && row.lastAt !== null && row.shiftEnd !== null) {
      found.push({ key: `left:${row.employeeId}:${today}`, group: 'staff', repeatHours: 24,
        text: `🚪 <b>${row.name}</b> — ${hhmm(row.lastAt)} da chiqib ketgan, qaytmagan (smena ${hhmm(row.shiftEnd)} gacha — ${duration(row.shiftEnd - row.lastAt)} erta)` });
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
  const late = list('late', row => `• ${row.name} — ${row.firstIn !== null ? hhmm(row.firstIn) : ''}, ${duration(row.lateMinutes)} kechikdi`);
  const absent = list('absent', row => `• ${row.name} — smena ${hhmm(row.shiftStart)}`);
  const waiting = list('waiting', row => `• ${row.name} — smena ${hhmm(row.shiftStart)}`);
  const left = list('left_early', row => `• ${row.name} — ${row.lastAt !== null ? hhmm(row.lastAt) : ''} da chiqqan${row.lastAt !== null && row.shiftEnd !== null ? `, ${duration(row.shiftEnd - row.lastAt)} erta` : ''}`);
  const block = (title: string, lines: string[]) => (lines.length ? ['', `<b>${title} — ${lines.length}</b>`, ...lines] : []);
  return [
    `🕘 <b>Davomat · ${today}</b>`,
    `Smenada: ${rows.length} · keldi: ${onTime.length + late.length + left.length} · kelmadi: ${absent.length}`,
    ...block('Kelmagan', absent), ...block('Kechikkan', late), ...block('Erta ketgan', left),
    ...block('Vaqtida kelgan', onTime), ...block('Hali smena boshlanmagan', waiting),
  ].join('\n');
}
