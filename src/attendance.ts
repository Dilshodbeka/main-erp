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

/** One row per active employee who has a shift today. `nowMinutes` is the local time of day. */
export function attendanceRows(data: AttendanceData, today: string, nowMinutes: number, config: AttendanceConfig = ATTENDANCE_DEFAULTS): AttendanceRow[] {
  const rows: AttendanceRow[] = [];
  const seen = new Set<number>();
  for (const schedule of data.schedules) {
    const shift = shiftOn(schedule, today);
    if (!shift) continue;
    for (const employeeId of schedule.employee_ids) {
      const employee = data.employees.find(row => row.id === employeeId);
      if (!employee?.is_active || seen.has(employeeId)) continue;
      seen.add(employeeId);
      const events = data.checks
        .filter(row => row.employee.id === employeeId && row.action && minutesOf(row.created_at) !== null)
        .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
      const firstIn = events.find(row => row.action === 'IN');
      const last = events.at(-1);
      const firstInAt = firstIn ? minutesOf(firstIn.created_at) : null;
      const lastAt = last ? minutesOf(last.created_at) : null;
      const lateMinutes = firstIn?.status === 'LATE' ? Math.max(firstIn.late_minutes, 1) : 0;
      let state: AttendanceRow['state'];
      if (!firstIn) state = nowMinutes >= shift.start + config.absentAfterMinutes ? 'absent' : 'waiting';
      else if (last?.action === 'OUT' && shift.end !== null && lastAt !== null
        && lastAt <= shift.end - config.earlyLeaveMinutes && nowMinutes >= lastAt + config.earlyLeaveGraceMinutes
        && nowMinutes < shift.end) state = 'left_early';
      else state = lateMinutes > 0 ? 'late' : 'on_time';
      rows.push({ employeeId, name: fullName(employee), shiftStart: shift.start, shiftEnd: shift.end, firstIn: firstInAt, lateMinutes, lastAction: last?.action ?? null, lastAt, state });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
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
  if (!rows.length) return '🕘 <b>Davomat</b>\n\nBugun smenasi bor xodim yo‘q.';
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
