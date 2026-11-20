import { describe, expect, it } from 'vitest';
import { attendanceFindings, attendanceReport, attendanceRows, companyEmployees, minutesOf, shiftOn, type AttendanceData, type TimepayCheck, type TimepaySchedule } from './attendance';
import { ownerNeedsAttendance, ownerReply, watchRun } from './telegram-owner';
import { emptyState } from './domain';

const TODAY = '2026-11-20'; // Friday
const week = (start: string, end: string, off: number[] = [6]) =>
  Array.from({ length: 7 }, (_, day) => ({ day, is_working: !off.includes(day), start_time: `${start}:00`, end_time: `${end}:00` }));
const schedule = (over: Partial<TimepaySchedule> = {}): TimepaySchedule => ({
  id: 1, name: 'Asosiy', schedule_type: 'FIXED', schedule_cycle: 7, start_date: null, work_days: week('09:00', '18:00'), employee_ids: [1, 2, 3], ...over,
});
const employees = [
  { id: 1, first_name: 'Fayzullo', last_name: 'A', is_active: true },
  { id: 2, first_name: 'Sherali', last_name: 'B', is_active: true },
  { id: 3, first_name: 'Kamol', last_name: 'C', is_active: true },
  { id: 4, first_name: 'Ketgan', last_name: 'D', is_active: false },
];
let seq = 0;
const check = (employeeId: number, action: 'IN' | 'OUT', time: string, late = 0): TimepayCheck => ({
  id: ++seq, employee: { id: employeeId, first_name: employees[employeeId - 1].first_name, last_name: employees[employeeId - 1].last_name },
  action, status: action === 'IN' ? (late ? 'LATE' : 'ON_TIME') : null, created_at: `${TODAY}T${time}:00+05:00`, late_minutes: late,
});
const data = (checks: TimepayCheck[], schedules = [schedule()]): AttendanceData => ({ employees, schedules, checks });
const at = (time: string) => minutesOf(`${time}:00`)!;

describe('timepay attendance', () => {
  it('reads clock values from shift times and ISO stamps', () => {
    expect(minutesOf('09:05:00')).toBe(545);
    expect(minutesOf('2026-11-20T09:05:31+05:00')).toBe(545);
    expect(minutesOf(null)).toBeNull();
  });

  it('finds the shift of the day, days off and free schedules', () => {
    expect(shiftOn(schedule(), TODAY)).toEqual({ start: 540, end: 1080 });
    expect(shiftOn(schedule(), '2026-11-22')).toBeNull(); // Sunday is off
    expect(shiftOn(schedule({ schedule_type: 'FREE' }), TODAY)).toBeNull();
    // 2-on/2-off cycle counted from its start date
    const cycle = schedule({ schedule_cycle: 4, start_date: '2026-11-18', work_days: [0, 1, 2, 3].map(day => ({ day, is_working: day < 2, start_time: '08:00:00', end_time: '20:00:00' })) });
    expect(shiftOn(cycle, '2026-11-19')).toEqual({ start: 480, end: 1200 });
    expect(shiftOn(cycle, TODAY)).toBeNull();
  });

  it('nobody is absent before the grace time has passed', () => {
    expect(attendanceFindings(data([]), TODAY, at('09:20'))).toEqual([]);
    expect(attendanceRows(data([]), TODAY, at('09:20')).every(row => row.state === 'waiting')).toBe(true);
  });

  it('flags late arrival with the exact minutes and absence after 30 minutes', () => {
    const found = attendanceFindings(data([check(1, 'IN', '08:55'), check(2, 'IN', '09:05', 5)]), TODAY, at('09:40'));
    expect(found.map(row => row.key)).toEqual([`absent:3:${TODAY}`, `late:2:${TODAY}`]);
    expect(found[1].text).toContain('5 daqiqa kechikdi');
    expect(found[1].text).toContain('keldi 09:05');
    expect(found[0].text).toContain('Kamol');
    expect(found[0].text).toContain('40 daqiqa');
  });

  it('a lunch break is not an early leave; leaving for good is', () => {
    const lunch = data([check(1, 'IN', '08:55'), check(1, 'OUT', '13:00'), check(1, 'IN', '13:40')]);
    expect(attendanceFindings(lunch, TODAY, at('15:00')).some(row => row.key.startsWith('left:1'))).toBe(false);
    const gone = data([check(1, 'IN', '08:55'), check(1, 'OUT', '15:00')]);
    expect(attendanceFindings(gone, TODAY, at('15:30')).some(row => row.key.startsWith('left:1'))).toBe(false);
    const flagged = attendanceFindings(gone, TODAY, at('16:10')).find(row => row.key.startsWith('left:1'));
    expect(flagged?.text).toContain('15:00 da chiqib ketgan');
    // leaving at the end of the shift is normal
    const done = data([check(1, 'IN', '08:55'), check(1, 'OUT', '17:50')]);
    expect(attendanceFindings(done, TODAY, at('17:55')).some(row => row.key.startsWith('left:1'))).toBe(false);
  });

  it('inactive employees and days off are ignored', () => {
    const all = data([], [schedule({ employee_ids: [1, 4] })]);
    expect(attendanceRows(all, TODAY, at('10:00')).map(row => row.employeeId)).toEqual([1]); // 2 and 3 are on no shift, 4 is inactive
    expect(attendanceRows(all, '2026-11-22', at('10:00'))).toEqual([]);
  });

  it('works without schedules: usual hours 09:00–19:00, lateness counted from the arrival time', () => {
    const none = data([check(1, 'IN', '08:54'), { ...check(2, 'IN', '09:27'), status: null, late_minutes: 0 }], []);
    const rows = attendanceRows(none, TODAY, at('10:00'));
    expect(rows.map(row => [row.employeeId, row.state, row.lateMinutes])).toEqual([[1, 'on_time', 0], [3, 'absent', 0], [2, 'late', 27]]);
    expect(attendanceFindings(none, TODAY, at('10:00')).map(row => row.key.split(':')[0]).sort()).toEqual(['absent', 'late']);
    expect(attendanceRows(none, TODAY, at('09:10')).find(row => row.employeeId === 3)?.state).toBe('waiting');
  });

  it('reads records with other field names and never fails on odd data', () => {
    const odd = {
      employees: [{ id: 7, full_name: 'Zafar X', status: 'active' }, { id: 8, name: 'Ketgan', status: 'fired' }, { nothing: true }],
      schedules: [{ id: 1, name: 'x' }],
      checks: [{ employee_id: 7, type: 'check_in', time: '2026-11-20T09:05:00+05:00' }, { employee: 7, type: 'check_out', time: '2026-11-20T12:00:00+05:00' }, { broken: 1 }],
    } as unknown as AttendanceData;
    const rows = attendanceRows(odd, TODAY, at('14:00'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employeeId: 7, name: 'Zafar X', firstIn: 545, lateMinutes: 5, lastAction: 'OUT', state: 'left_early' });
    const empty = attendanceReport({ employees: [], schedules: [], checks: [{ id: 1, employee: { id: 1, first_name: 'Maxfiy', last_name: 'Ism' } }] } as unknown as AttendanceData, TODAY, at('10:00'));
    expect(empty).toContain('xodimlar: 0');
    expect(empty).toContain('employee: {id, first_name, last_name}');
    expect(empty).not.toContain('Maxfiy'); // field names only, no personal data
  });

  it('two shifts of the workshop (08:00–18:00 and 09:00–19:00) stored as one-day cycles without a start date', () => {
    const oneDay = (start: string, end: string) => [{ day: 0, is_working: true, start_time: `${start}:00`, end_time: `${end}:00` }];
    const early = schedule({ id: 1, name: 'Smena ( 8:00 - 18:00 )', schedule_cycle: 1, start_date: null, work_days: oneDay('08:00', '18:00'), employee_ids: [1] });
    const late = schedule({ id: 2, name: 'Smena ( 9:00 - 19:00 )', schedule_cycle: 1, start_date: null, work_days: oneDay('09:00', '19:00'), employee_ids: [2, 3] });
    expect(shiftOn(early, TODAY)).toEqual({ start: 480, end: 1080 });
    expect(shiftOn(late, '2026-11-18')).toEqual({ start: 540, end: 1140 });
    const day = data([check(1, 'IN', '08:01', 1), check(2, 'IN', '08:54'), check(2, 'OUT', '17:05')], [early, late]);
    const rows = attendanceRows(day, TODAY, at('18:30'));
    expect(rows.map(row => [row.employeeId, row.shiftStart, row.state])).toEqual([[1, 480, 'late'], [3, 540, 'absent'], [2, 540, 'left_early']]);
    const keys = attendanceFindings(day, TODAY, at('18:30')).map(row => row.key.split(':').slice(0, 2).join(':')).sort();
    expect(keys).toEqual(['absent:3', 'late:1', 'left:2']);
  });

  it('takes only the firm when the Timepay account holds several branches', () => {
    const mixed = {
      employees: [
        { id: 1, first_name: 'Ozoda', last_name: 'E', is_active: true, branches: [{ id: 1, name: 'Aliya Mebel' }], department: null },
        { id: 2, first_name: 'Begona', last_name: 'F', is_active: true, branches: [{ id: 2, name: 'Boshqa firma' }], department: { id: 9, name: 'Savdo' } },
        { id: 3, first_name: 'Kamol', last_name: 'X', is_active: true, branches: [], department: { id: 5, name: 'ALIYA mebel sexi' } },
      ],
      schedules: [schedule({ employee_ids: [1, 2, 3] })], checks: [],
    } as unknown as AttendanceData;
    expect(companyEmployees(mixed).map(row => row.id)).toEqual([1, 3]);
    expect(attendanceRows(mixed, TODAY, at('10:00')).map(row => row.employeeId)).toEqual([3, 1]);
    // an account with no such branch names is one firm: everybody is taken
    expect(companyEmployees(data([])).map(row => row.id)).toEqual([1, 2, 3]);
  });

  it('people on a free schedule or on no shift are listed only when they came', () => {
    const free = schedule({ id: 3, schedule_type: 'FREE', employee_ids: [3] });
    const day = data([check(3, 'IN', '11:00')], [schedule({ employee_ids: [1] }), free]);
    const rows = attendanceRows(day, TODAY, at('12:00'));
    expect(rows.map(row => [row.employeeId, row.state])).toEqual([[1, 'absent'], [3, 'on_time']]); // no lateness without a shift
  });

  it('"/timepay" shows the structure without people\'s names', () => {
    const text = ownerReply('/timepay', null, TODAY, false, { data: data([check(1, 'IN', '08:55')]), nowMinutes: at('10:00') }).text;
    expect(ownerNeedsAttendance('/timepay')).toBe(true);
    expect(text).toContain('Timepay tuzilmasi');
    expect(text).toContain('Asosiy · FIXED · sikl 7');
    expect(text).toContain('bugun: 09:00–18:00');
    expect(text).not.toContain('Fayzullo');
  });

  it('builds the on-demand report', () => {
    const text = attendanceReport(data([check(1, 'IN', '08:55'), check(2, 'IN', '09:05', 5)]), TODAY, at('09:40'));
    expect(text).toContain('Smenada: 3 · keldi: 2 · kelmadi: 1');
    expect(text).toContain('Kelmagan — 1');
    expect(text).toContain('Kechikkan — 1');
  });
});

describe('attendance in the bot and the watcher', () => {
  const snapshot = () => {
    const state = JSON.parse(JSON.stringify(emptyState()));
    return { actor: { id: 'a', name: 'Egasi', role: 'admin', companyId: state.companyId }, state };
  };
  it('the bot answers /davomat from Timepay data and explains when it is not connected', () => {
    expect(ownerNeedsAttendance('/davomat')).toBe(true);
    expect(ownerNeedsAttendance('/kassa')).toBe(false);
    const live = ownerReply('/davomat', snapshot(), TODAY, false, { data: data([check(1, 'IN', '08:55')]), nowMinutes: at('09:40') });
    expect(live.text).toContain('Davomat · 2026-11-20');
    expect(ownerReply('/davomat', snapshot(), TODAY).text).toContain('TIMEPAY_TOKEN');
  });
  it('the watcher announces a late arrival once', () => {
    const now = `${TODAY}T04:40:00.000Z`;
    const attendance = { data: data([check(1, 'IN', '08:55'), check(2, 'IN', '09:05', 5), check(3, 'IN', '09:00')]), nowMinutes: at('09:40') };
    const first = watchRun(snapshot(), {}, now, TODAY, 9, attendance);
    expect(first.text).toContain('Xodimlar davomati');
    expect(first.text).toContain('Sherali');
    expect(first.sentKeys).toEqual([`late:2:${TODAY}`]);
    const again = watchRun(snapshot(), { [`late:2:${TODAY}`]: now }, `${TODAY}T05:10:00.000Z`, TODAY, 10, attendance);
    expect(again.text).toBeNull();
  });
});

describe('timepay client', () => {
  it('sends the bearer token, follows pagination on the same host only', async () => {
    const { fetchAttendance, TIMEPAY_BASE, TimepayError } = await import('./timepay');
    const calls: { url: string; auth: string }[] = [];
    const pages: Record<string, unknown> = {
      [`${TIMEPAY_BASE}/employees/?limit=100`]: { results: [{ id: 1 }], next: `${TIMEPAY_BASE}/employees/?limit=100&offset=100` },
      [`${TIMEPAY_BASE}/employees/?limit=100&offset=100`]: { results: [{ id: 2 }], next: 'https://evil.example/steal' },
      [`${TIMEPAY_BASE}/schedules/?limit=100`]: { results: [], next: null },
      [`${TIMEPAY_BASE}/checkinouts/?date=2026-11-20&limit=100`]: { results: [{ id: 9 }], next: null },
    };
    const fake = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, auth: init.headers.Authorization });
      return { ok: url in pages, status: url in pages ? 200 : 401, json: async () => pages[url] ?? { error_code: 'integration_auth_failed' } };
    };
    const result = await fetchAttendance('timepay_x:y', '2026-11-20', fake);
    expect(result.employees.map(row => row.id)).toEqual([1, 2]);
    expect(result.checks).toHaveLength(1);
    expect(calls.every(call => call.auth === 'Bearer timepay_x:y')).toBe(true);
    expect(calls.some(call => call.url.includes('evil.example'))).toBe(false);
    await expect(fetchAttendance('bad', '2026-11-21', fake)).rejects.toBeInstanceOf(TimepayError);
  });
});
