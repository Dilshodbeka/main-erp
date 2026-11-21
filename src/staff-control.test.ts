import { describe, expect, it } from 'vitest';
import { attendanceRows, type AttendanceData } from './attendance';
import {
  BTN, STAFF_DEFAULTS, advanceForDirector, directorDecision, forgotOutcome, kpiOf, kpiReport, matchPeople, nameWords, parseAdvanceDecision,
  parseAmount, parseDecision, advanceList, staffTick, workerAnswer, type StaffCase, type StaffPerson, type TickOutput,
} from './staff-control';

const TODAY = '2026-11-23'; // Monday
const settings = { ...STAFF_DEFAULTS, directorName: 'Dilshod' };
const at = (clock: string) => `${TODAY}T${clock}:00+05:00`;
const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const iso = (clock: string) => new Date(`${TODAY}T${clock}:00+05:00`).toISOString();

function timepay(checks: [number, 'IN' | 'OUT', string][]): AttendanceData {
  return {
    employees: [
      { id: 1, first_name: 'Fayzullo', last_name: 'Karimov', is_active: true },
      { id: 2, first_name: 'Сардор', last_name: 'Алиев', is_active: true },
      { id: 3, first_name: 'Dilshod', last_name: 'Boss', is_active: true, position: { name: 'Direktor' } } as never,
    ],
    schedules: [{ id: 1, name: 'Asosiy', schedule_type: 'fixed', schedule_cycle: 7, start_date: null, employee_ids: [1, 2, 3],
      work_days: [0, 1, 2, 3, 4, 5].map(day => ({ day, is_working: true, start_time: '09:00:00', end_time: '19:00:00' })) }],
    checks: checks.map(([id, action, clock], index) => ({ id: index + 1, employee: { id, first_name: '', last_name: '' }, action,
      status: null, created_at: at(clock), late_minutes: 0 })),
  };
}
const erp = [{ id: 'e-fayz', name: 'Fayzullo' }, { id: 'e-sardor', name: 'Sardor Aliyev' }];
const links = [{ employeeId: 'e-fayz', chatId: '111', timepayId: null }, { employeeId: 'e-sardor', chatId: null, timepayId: 2 }];

/** A tiny in-memory "database": applies what a tick returns, like the Edge Function does. */
function world(checks: [number, 'IN' | 'OUT', string][] = []) {
  const cases: StaffCase[] = [];
  let counter = 0;
  const state = { checks };
  const forgot = (): Record<number, number> => {
    const count: Record<number, number> = {};
    for (const row of cases) if (row.status === 'warned') count[row.timepayId] = (count[row.timepayId] ?? 0) + 1;
    return count;
  };
  const people = (): StaffPerson[] => matchPeople(timepay(state.checks), erp, links);
  const tick = (clock: string): TickOutput => {
    const data = timepay(state.checks);
    const out = staffTick({ rows: attendanceRows(data, TODAY, minutes(clock)), people: people(), cases: cases.map(row => ({ ...row })), forgot: forgot(),
      settings, today: TODAY, nowMinutes: minutes(clock), nowIso: iso(clock), newCode: () => `c${++counter}` });
    for (const row of out.create) cases.push({ ...row, id: `id${cases.length + 1}` });
    for (const row of out.update) Object.assign(cases.find(entry => entry.id === row.id)!, row.patch);
    return out;
  };
  const answer = (timepayId: number, text: string) => {
    const open = cases.find(row => row.timepayId === timepayId && row.status === 'asked') ?? null;
    const result = workerAnswer(text, open, settings);
    if (result?.patch && open) Object.assign(open, result.patch);
    return result;
  };
  const decide = (code: string, approve: boolean) => {
    const item = cases.find(row => row.code === code) ?? null;
    const result = directorDecision(approve, item, item ? forgot()[item.timepayId] ?? 0 : 0, settings);
    if (result.patch && item) Object.assign(item, result.patch);
    return result;
  };
  return { cases, state, tick, answer, decide, people };
}
const toWorker = (out: TickOutput) => out.messages.filter(row => row.to === 'worker');
const toDirector = (out: TickOutput) => out.messages.filter(row => row.to === 'director').map(row => row.text).join('\n');

describe('who is who', () => {
  it('reads Cyrillic and Latin names as the same words', () => {
    expect(nameWords('Сардор Алиев')).toEqual(['sardor', 'aliev']);
    expect(nameWords('Fayzullo KARIMOV')).toEqual(['fayzullo', 'karimov']);
    expect(nameWords('O‘ktam')).toEqual(['oktam']);
  });

  it('matches by name or by the explicit Timepay number and leaves the director out', () => {
    const people = matchPeople(timepay([]), erp, links);
    expect(people.map(row => [row.timepayId, row.employeeId, row.chatId])).toEqual([[1, 'e-fayz', '111'], [2, 'e-sardor', null]]);
  });

  it('does not guess when two ERP employees fit one Timepay name', () => {
    const people = matchPeople(timepay([]), [{ id: 'a', name: 'Fayzullo' }, { id: 'b', name: 'Karimov' }], []);
    expect(people.find(row => row.timepayId === 1)!.employeeId).toBeNull();
  });
});

describe('late arrival', () => {
  it('stays silent until one minute after the shift start, then asks the worker', () => {
    const w = world();
    expect(w.tick('09:00').create).toHaveLength(0);
    const out = w.tick('09:01');
    expect(out.create.map(row => [row.timepayId, row.kind, row.status])).toEqual([[1, 'late', 'asked'], [2, 'late', 'asked']]);
    expect(toWorker(out)).toHaveLength(1);
    expect(toWorker(out)[0]).toMatchObject({ chatId: '111', keyboard: [[BTN.forgot], [BTN.leave], [BTN.late]] });
    expect(toWorker(out)[0].text).toContain('direktor (Dilshod)');
    // The one without Telegram goes straight to the director with the decision links.
    expect(toDirector(out)).toContain('Сардор Алиев');
    expect(toDirector(out)).toContain('/ha_c2');
    expect(w.tick('09:03').messages).toHaveLength(0);
  });

  it('"I am late": fined by the real minutes once Timepay sees the arrival', () => {
    const w = world();
    w.tick('09:01');
    const reply = w.answer(1, BTN.late)!;
    expect(reply.director).toContain('ruxsatsiz');
    expect(w.cases[0]).toMatchObject({ status: 'fined', final: false });
    expect(kpiOf(w.cases.filter(row => row.timepayId === 1), settings).amount).toBe(500000);
    w.state.checks.push([1, 'IN', '09:20']);
    const out = w.tick('09:21');
    expect(w.cases[0]).toMatchObject({ status: 'fined', minutes: 20, final: true });
    expect(toDirector(out)).toContain('−20 000 so‘m');
    expect(kpiOf(w.cases.filter(row => row.timepayId === 1), settings)).toMatchObject({ minutes: 20, amount: 480000 });
  });

  it('"the director let me": nothing is cancelled until the director confirms', () => {
    const w = world();
    w.tick('09:01');
    expect(w.answer(1, BTN.leave)!.director).toContain('/ha_c1');
    expect(w.cases[0]).toMatchObject({ status: 'claimed', claim: 'leave' });
    w.state.checks.push([1, 'IN', '10:28']);
    w.tick('10:29');
    expect(w.cases[0]).toMatchObject({ minutes: 88, final: true, status: 'claimed' });
    const no = w.decide('c1', false);
    expect(no.director).toContain('−88 000 so‘m');
    expect(kpiOf(w.cases.filter(row => row.timepayId === 1), settings).amount).toBe(412000);
    expect(w.decide('c1', true).director).toContain('allaqachon');
  });

  it('confirmed leave costs nothing', () => {
    const w = world();
    w.tick('09:01');
    w.answer(1, BTN.leave);
    expect(w.decide('c1', true).worker).toContain('ushlanmaydi');
    w.state.checks.push([1, 'IN', '11:00']);
    w.tick('11:01');
    expect(kpiOf(w.cases.filter(row => row.timepayId === 1), settings)).toMatchObject({ minutes: 0, amount: 500000, open: 0 });
  });

  it('"forgot the face ID" needs the director; three warnings, then a fixed fine', () => {
    const w = world();
    w.tick('09:01');
    expect(w.answer(1, BTN.forgot)!.director).toContain('Rostdan ham ishdami');
    expect(w.decide('c1', true).director).toContain('ogohlantirish 1/3');
    expect(w.cases[0]).toMatchObject({ status: 'warned', fine: 0, minutes: 0 });
    expect(forgotOutcome(2, settings)).toEqual({ fine: 0, text: 'ogohlantirish 3/3' });
    expect(forgotOutcome(3, settings).fine).toBe(10000);
  });

  it('a false "forgot" is fined for the whole absence', () => {
    const w = world();
    w.tick('09:01');
    w.answer(1, BTN.forgot);
    w.decide('c1', false);
    w.tick('19:00');
    expect(w.cases[0]).toMatchObject({ status: 'fined', minutes: 600, final: true });
    expect(kpiOf(w.cases.filter(row => row.timepayId === 1), settings).amount).toBe(-100000);
  });

  it('no answer: keeps asking every half an hour, tells the director after an hour, charges nothing', () => {
    const w = world();
    w.tick('09:01');
    expect(w.tick('09:20').messages).toHaveLength(0);
    expect(toWorker(w.tick('09:31'))).toHaveLength(1);
    const hour = w.tick('10:01');
    expect(toWorker(hour)).toHaveLength(1);
    expect(toDirector(hour)).toContain('javob bermayapti');
    expect(toDirector(w.tick('10:31'))).toBe('');
    expect(kpiOf(w.cases.filter(row => row.timepayId === 1), settings)).toMatchObject({ amount: 500000, open: 1 });
    // The director can decide without the worker.
    expect(w.decide('c1', false).patch).toEqual({ status: 'fined' });
  });

  it('came late without a question yet: asked with the known minutes', () => {
    const w = world([[1, 'IN', '09:07']]);
    const out = w.tick('09:08');
    expect(w.cases[0]).toMatchObject({ kind: 'late', minutes: 7, final: true, status: 'asked' });
    expect(toWorker(out)[0]).toMatchObject({ keyboard: [[BTN.leave], [BTN.no]] });
    expect(w.answer(1, BTN.forgot)).toBeNull();
    expect(w.answer(1, BTN.no)!.worker.text).toContain('−7 000 so‘m');
  });

  it('on time: nothing happens', () => {
    const w = world([[1, 'IN', '08:55'], [2, 'IN', '09:00']]);
    expect(w.tick('09:05').create).toHaveLength(0);
  });
});

describe('leaving', () => {
  it('a lunch break is not an early leave; an hour away is', () => {
    const w = world([[1, 'IN', '08:55'], [2, 'IN', '08:55'], [1, 'OUT', '13:00']]);
    expect(w.tick('13:40').create).toHaveLength(0);
    const out = w.tick('14:00');
    expect(w.cases[0]).toMatchObject({ kind: 'early', atMinutes: 780, status: 'asked', final: false });
    expect(toWorker(out)[0].text).toContain('13:00 da chiqdingiz');
    w.answer(1, BTN.no);
    w.state.checks.push([1, 'IN', '15:10']);
    const back = w.tick('15:11');
    expect(w.cases[0]).toMatchObject({ minutes: 130, final: true, status: 'fined' });
    expect(toDirector(back)).toContain('−130 000 so‘m');
  });

  it('left early and never came back: minutes until the end of the shift', () => {
    const w = world([[1, 'IN', '08:55'], [2, 'IN', '08:55'], [1, 'OUT', '17:30']]);
    w.tick('18:30');
    w.answer(1, BTN.leave);
    w.tick('19:00');
    expect(w.cases[0]).toMatchObject({ minutes: 90, final: true, status: 'claimed' });
    w.decide('c1', false);
    expect(kpiOf(w.cases, settings).amount).toBe(410000);
  });

  it('forgot to mark the exit: a warning an hour after the shift, once', () => {
    const w = world([[1, 'IN', '08:55'], [2, 'IN', '08:55'], [2, 'OUT', '19:02']]);
    expect(w.tick('19:30').create).toHaveLength(0);
    const out = w.tick('20:00');
    expect(w.cases).toHaveLength(1);
    expect(w.cases[0]).toMatchObject({ timepayId: 1, kind: 'no_out', status: 'warned', fine: 0 });
    expect(toDirector(out)).toContain('ogohlantirish 1/3');
    expect(w.tick('20:02').create).toHaveLength(0);
  });
});

describe('month', () => {
  it('report lists everyone, worst first, and counts fixed fines', () => {
    const base = { employeeId: null, atMinutes: 540, final: true, claim: null, pings: 0, pingedAt: null, escalated: true } as const;
    const cases: StaffCase[] = [
      { ...base, id: '1', timepayId: 1, name: 'Fayzullo Karimov', workDate: '2026-11-03', kind: 'late', minutes: 88, status: 'fined', fine: 0, code: 'a' },
      { ...base, id: '2', timepayId: 1, name: 'Fayzullo Karimov', workDate: '2026-11-04', kind: 'no_out', minutes: 0, status: 'warned', fine: 10000, code: 'b' },
      { ...base, id: '3', timepayId: 1, name: 'Fayzullo Karimov', workDate: '2026-11-05', kind: 'late', minutes: 30, status: 'approved', fine: 0, code: 'c' },
    ];
    expect(kpiOf(cases, settings)).toEqual({ minutes: 88, minuteFine: 88000, warnings: 1, forgotFine: 10000, open: 0, amount: 402000 });
    const text = kpiReport([{ timepayId: 1, name: 'Fayzullo Karimov' }, { timepayId: 2, name: 'Sardor' }], cases, settings, '2026-11');
    expect(text.indexOf('Fayzullo')).toBeLessThan(text.indexOf('Sardor'));
    expect(text).toContain('402 000 so‘m');
    expect(text).toContain('Jami: 902 000 so‘m');
  });

  it('switched off: no questions at all', () => {
    const out = staffTick({ rows: attendanceRows(timepay([]), TODAY, 600), people: matchPeople(timepay([]), erp, links), cases: [], forgot: {},
      settings: { ...settings, enabled: false }, today: TODAY, nowMinutes: 600, nowIso: iso('10:00'), newCode: () => 'x' });
    expect(out).toEqual({ create: [], update: [], messages: [] });
  });
});

describe('commands and amounts', () => {
  it('parses decisions', () => {
    expect(parseDecision('/ha_k3f9a2')).toEqual({ approve: true, code: 'k3f9a2' });
    expect(parseDecision('/yoq_K3F9A2')).toEqual({ approve: false, code: 'k3f9a2' });
    expect(parseDecision('/ha')).toBeNull();
    expect(parseAdvanceDecision('/avans_naqd_abc234')).toEqual({ action: 'cash', code: 'abc234' });
    expect(parseAdvanceDecision('/avans_yoq_abc234')).toEqual({ action: 'reject', code: 'abc234' });
  });

  it('reads amounts the way people type them', () => {
    expect(parseAmount('500 000')).toBe(500000);
    expect(parseAmount('500.000 so‘m')).toBe(500000);
    expect(parseAmount('500ming')).toBe(500000);
    expect(parseAmount('300k')).toBe(300000);
    expect(parseAmount('1.5 mln')).toBe(1500000);
    expect(parseAmount('2 млн')).toBe(2000000);
    expect(parseAmount('kerak')).toBeNull();
    expect(parseAmount('500')).toBeNull();
  });

  it('shows the director the request with three answers', () => {
    const text = advanceForDirector({ code: 'abc234', name: 'Fayzullo', amount: 500000, reason: 'to‘y' }, 'Hisoblangan, to‘lanmagan: 1 200 000 so‘m');
    expect(text).toContain('500 000 so‘m');
    expect(text).toContain('Sabab: to‘y');
    expect(text).toContain('/avans_naqd_abc234');
    expect(text).toContain('/avans_bank_abc234');
    expect(text).toContain('/avans_yoq_abc234');
  });
});

describe('advance paid later', () => {
  it('parses the «later» answer and lists open requests, promised first', () => {
    expect(parseAdvanceDecision('/avans_keyin_abc234')).toEqual({ action: 'later', code: 'abc234' });
    const text = advanceList([
      { code: 'aaa111', name: 'Sardor', amount: 300000, reason: '', status: 'pending', createdAt: '2026-11-20' },
      { code: 'bbb222', name: 'Fayzullo', amount: 500000, reason: 'to‘y', status: 'promised', createdAt: '2026-11-21' },
    ]);
    expect(text).toContain('va’da qilingan: 500 000 so‘m');
    expect(text.indexOf('Fayzullo')).toBeLessThan(text.indexOf('Sardor'));
    expect(text).toContain('/avans_keyin_aaa111');
    expect(text).not.toContain('/avans_keyin_bbb222');
    expect(advanceList([])).toContain('yo‘q');
  });
});
