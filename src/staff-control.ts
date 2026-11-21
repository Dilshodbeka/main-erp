// Attendance discipline and KPI through the Telegram bot. Pure rules: the Edge Functions read Timepay
// and the database, call these functions and carry out what they return (rows to write, messages to send).
//
// A worker who has not checked in a minute after the shift start is asked what happened; every claim
// ("I am at work, forgot the face ID", "the director let me") goes to the director, so a claim alone
// never cancels a fine. No answer — the bot keeps asking and no fine is charged until somebody decides.
import { duration, type AttendanceData, type AttendanceRow, companyEmployees } from './attendance';

export interface StaffSettings { enabled: boolean; base: number; perMinute: number; forgotFree: number; forgotFine: number; directorName: string }
export const STAFF_DEFAULTS: StaffSettings = { enabled: true, base: 500000, perMinute: 1000, forgotFree: 3, forgotFine: 10000, directorName: '' };

export type CaseKind = 'late' | 'early' | 'no_out';
export type CaseStatus = 'asked' | 'claimed' | 'approved' | 'fined' | 'warned';
export type CaseClaim = 'leave' | 'forgot' | 'late' | null;
export interface StaffCase {
  id: string; timepayId: number; employeeId: string | null; name: string; workDate: string; kind: CaseKind;
  /** late: shift start; early: the minute the person left (local minutes from midnight). */
  atMinutes: number;
  minutes: number; final: boolean; status: CaseStatus; claim: CaseClaim; fine: number; code: string;
  pings: number; pingedAt: string | null; escalated: boolean;
}
export type NewCase = Omit<StaffCase, 'id'>;
export interface StaffPerson { timepayId: number; name: string; employeeId: string | null; chatId: string | null }
export type Outgoing =
  | { to: 'worker'; chatId: string; text: string; keyboard: string[][] }
  | { to: 'director'; text: string };

export const BTN = {
  forgot: '✅ Ishdaman, belgilashni unutdim', leave: '🙋 Ruxsat olganman', late: '⏱ Kechikyapman', no: '❌ Ruxsat olmaganman',
  kpi: '📊 Mening KPI', advance: '💵 Avans so‘rash', skip: 'O‘tkazib yuborish', cancel: 'Bekor qilish',
} as const;
export const WORKER_MENU: string[][] = [[BTN.kpi, BTN.advance]];

const PING_EVERY_MINUTES = 30;
const MAX_PINGS = 8;
const ESCALATE_AFTER_PINGS = 2;
const EARLY_GRACE_MINUTES = 60;
const NO_OUT_AFTER_MINUTES = 60;

const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const sum = (value: number): string => `${Math.round(value).toLocaleString('ru-RU').replace(/ /g, ' ')} so‘m`;
const director = (settings: StaffSettings): string => settings.directorName ? `direktor (${settings.directorName})` : 'direktor';

// ── Who is who: Timepay people ↔ ERP employees ↔ Telegram chats ─────────────────────────────────
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};
/** "Файзулло Каримов" and "Fayzullo KARIMOV" → the same set of words. */
export function nameWords(name: string): string[] {
  const latin = name.toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[ʻʼ‘’'`]/g, '')
    .replace(/[а-яёўқғҳ]/g, letter => CYRILLIC[letter] ?? letter).replace(/kh/g, 'x');
  return latin.split(/[^a-z0-9]+/).filter(word => word.length > 1);
}
const within = (small: string[], big: string[]): boolean => small.length > 0 && small.every(word => big.includes(word));

/**
 * The people to control (the firm's active Timepay employees, without the director), each with the ERP
 * employee and Telegram chat when they can be told for sure: an explicit Timepay number on the link wins,
 * otherwise the names must match and the match must be the only one.
 */
export function matchPeople(data: AttendanceData, employees: { id: string; name: string }[],
  links: { employeeId: string; chatId: string | null; timepayId: number | null }[], words?: string[]): StaffPerson[] {
  const staff = companyEmployees(data, words).filter(row => !row.manager);
  const byEmployee = new Map(links.map(link => [link.employeeId, link]));
  const taken = new Set<string>();
  const people: StaffPerson[] = staff.map(row => ({ timepayId: row.id, name: row.name, employeeId: null, chatId: null }));
  for (const person of people) {
    const explicit = links.find(link => link.timepayId === person.timepayId);
    if (explicit) { person.employeeId = explicit.employeeId; taken.add(explicit.employeeId); }
  }
  for (const person of people) {
    if (person.employeeId) continue;
    const words = nameWords(person.name);
    const candidates = employees.filter(row => !taken.has(row.id) && byEmployee.get(row.id)?.timepayId == null)
      .filter(row => { const own = nameWords(row.name); return within(own, words) || within(words, own); });
    const rivals = people.filter(other => other !== person && !other.employeeId && candidates.length === 1
      && (() => { const own = nameWords(candidates[0].name); const theirs = nameWords(other.name); return within(own, theirs) || within(theirs, own); })());
    if (candidates.length === 1 && !rivals.length) { person.employeeId = candidates[0].id; taken.add(candidates[0].id); }
  }
  for (const person of people) person.chatId = person.employeeId ? byEmployee.get(person.employeeId)?.chatId ?? null : null;
  return people;
}

// ── Texts ────────────────────────────────────────────────────────────────────────────────────────
const decideLinks = (code: string): string => `✅ Ha, uzrli: /ha_${code}\n❌ Yo‘q, jarima: /yoq_${code}`;

function question(item: Pick<StaffCase, 'kind' | 'atMinutes' | 'minutes' | 'final'>, shiftEnd: number | null, settings: StaffSettings): { text: string; keyboard: string[][] } {
  if (item.kind === 'early') {
    return { text: `🚪 Siz ${hhmm(item.atMinutes)} da chiqdingiz${shiftEnd !== null ? `, smena ${hhmm(shiftEnd)} gacha` : ''}.\nSiz ${director(settings)}dan ruxsat olganmisiz?`,
      keyboard: [[BTN.leave], [BTN.no]] };
  }
  if (item.final) {
    return { text: `⏱ Siz bugun ${duration(item.minutes)} kechikdingiz.\nSiz ${director(settings)}dan ruxsat olganmisiz?`, keyboard: [[BTN.leave], [BTN.no]] };
  }
  return { text: `⏱ Smena ${hhmm(item.atMinutes)} da boshlandi, Timepay’da kelganingiz belgilanmagan.\nIshga kelib Face ID’ni unutdingizmi yoki ${director(settings)}dan ruxsat olganmisiz?`,
    keyboard: [[BTN.forgot], [BTN.leave], [BTN.late]] };
}

function situation(item: Pick<StaffCase, 'kind' | 'atMinutes' | 'minutes' | 'final'>): string {
  if (item.kind === 'early') return `${hhmm(item.atMinutes)} da chiqib ketgan${item.final ? ` (${duration(item.minutes)})` : ''}`;
  return item.final ? `${duration(item.minutes)} kechikdi` : `ishga kelmagan (smena ${hhmm(item.atMinutes)})`;
}

const fineLine = (item: Pick<StaffCase, 'minutes' | 'final'>, settings: StaffSettings): string =>
  item.final ? `KPI’dan −${sum(item.minutes * settings.perMinute)} (${item.minutes} daqiqa × ${sum(settings.perMinute)}).`
    : `Har daqiqa uchun KPI’dan −${sum(settings.perMinute)}; aniq summa Timepay belgisi bo‘yicha hisoblanadi.`;

/** The n-th "forgot to mark" of the month: the first ones are warnings, then each costs a fixed fine. */
export function forgotOutcome(alreadyThisMonth: number, settings: StaffSettings): { fine: number; text: string } {
  const number = alreadyThisMonth + 1;
  return number <= settings.forgotFree
    ? { fine: 0, text: `ogohlantirish ${number}/${settings.forgotFree}` }
    : { fine: settings.forgotFine, text: `${number}-marta — jarima ${sum(settings.forgotFine)}` };
}

// ── The scheduled pass ───────────────────────────────────────────────────────────────────────────
export interface TickInput {
  rows: AttendanceRow[]; people: StaffPerson[]; cases: StaffCase[];
  /** Per Timepay id: "forgot to mark" cases already counted this month. */
  forgot: Record<number, number>;
  settings: StaffSettings; today: string; nowMinutes: number; nowIso: string;
  newCode: () => string;
}
export interface TickOutput { create: NewCase[]; update: { id: string; patch: Partial<StaffCase> }[]; messages: Outgoing[] }

const lateOf = (row: AttendanceRow): number | null => row.firstIn === null ? null : Math.max(row.lateMinutes, row.firstIn - row.shiftStart, 0);

export function staffTick(input: TickInput): TickOutput {
  const out: TickOutput = { create: [], update: [], messages: [] };
  const { settings, today, nowMinutes, nowIso } = input;
  if (!settings.enabled) return out;
  const forgot = { ...input.forgot };
  const ask = (person: StaffPerson, item: NewCase | StaffCase, shiftEnd: number | null): boolean => {
    if (!person.chatId) return false;
    out.messages.push({ to: 'worker', chatId: person.chatId, ...question(item, shiftEnd, settings) });
    return true;
  };
  const toDirector = (person: StaffPerson, item: NewCase | StaffCase, lead: string): void => {
    out.messages.push({ to: 'director', text: `${lead}\n<b>${person.name}</b> — ${situation(item)}.\n${decideLinks(item.code)}` });
  };
  const blank = (person: StaffPerson, kind: CaseKind, atMinutes: number): NewCase => ({
    timepayId: person.timepayId, employeeId: person.employeeId, name: person.name, workDate: today, kind, atMinutes,
    minutes: 0, final: false, status: 'asked', claim: null, fine: 0, code: input.newCode(), pings: 0, pingedAt: nowIso, escalated: false,
  });
  const settled = (person: StaffPerson, item: StaffCase): void => {
    // The minutes of a fine became known: tell both sides the amount once.
    const text = `<b>${person.name}</b> — ${situation(item)}. ${fineLine(item, settings)}`;
    out.messages.push({ to: 'director', text: `📌 ${text}` });
    if (person.chatId) out.messages.push({ to: 'worker', chatId: person.chatId, text: `📌 ${situation(item)}. ${fineLine(item, settings)}`, keyboard: WORKER_MENU });
  };

  for (const row of input.rows) {
    if (!row.hasShift) continue;
    const person = input.people.find(entry => entry.timepayId === row.employeeId);
    if (!person) continue;
    const own = input.cases.filter(entry => entry.timepayId === row.employeeId && entry.workDate === today);
    const shiftEnd = row.shiftEnd;
    const late = lateOf(row);

    // 1. Arrival
    const arrival = own.find(entry => entry.kind === 'late');
    if (!arrival) {
      if ((late === null && nowMinutes >= row.shiftStart + 1) || (late !== null && late > 0)) {
        const item = blank(person, 'late', row.shiftStart);
        if (late !== null) { item.minutes = late; item.final = true; }
        if (!ask(person, item, shiftEnd)) { item.escalated = true; toDirector(person, item, '🕘 Xodim Telegram’ga ulanmagan — qarorni o‘zingiz bering.'); }
        out.create.push(item);
      }
    } else if (!arrival.final) {
      const patch: Partial<StaffCase> = {};
      if (late !== null) {
        Object.assign(patch, { minutes: late, final: true });
        if (late === 0) Object.assign(patch, { status: 'approved' as const });
      } else if (nowMinutes >= (shiftEnd ?? 23 * 60)) {
        // Never came: the whole shift.
        Object.assign(patch, { minutes: Math.max(0, (shiftEnd ?? 23 * 60) - row.shiftStart), final: true });
      }
      if (patch.final) {
        const next = { ...arrival, ...patch };
        if (next.status === 'fined') settled(person, next);
        else if (next.status === 'asked' && late !== null && late > 0 && ask(person, next, shiftEnd)) Object.assign(patch, { pings: arrival.pings + 1, pingedAt: nowIso });
        out.update.push({ id: arrival.id, patch });
      }
    }

    // 2. Left before the end of the shift and has not come back for an hour (a lunch break is shorter)
    const early = own.find(entry => entry.kind === 'early');
    if (shiftEnd !== null && row.firstIn !== null) {
      if (!early && row.lastAction === 'OUT' && row.lastAt !== null && row.lastAt < shiftEnd
        && (nowMinutes >= row.lastAt + EARLY_GRACE_MINUTES || nowMinutes >= shiftEnd)) {
        const item = blank(person, 'early', row.lastAt);
        item.minutes = shiftEnd - row.lastAt;
        item.final = nowMinutes >= shiftEnd;
        if (!ask(person, item, shiftEnd)) { item.escalated = true; toDirector(person, item, '🚪 Xodim Telegram’ga ulanmagan — qarorni o‘zingiz bering.'); }
        out.create.push(item);
      } else if (early && !early.final) {
        const back = row.lastAction === 'IN' && row.lastAt !== null && row.lastAt > early.atMinutes;
        if (back || nowMinutes >= shiftEnd) {
          const patch: Partial<StaffCase> = { minutes: back ? Math.max(0, row.lastAt! - early.atMinutes) : shiftEnd - early.atMinutes, final: true };
          const next = { ...early, ...patch };
          if (next.status === 'fined') settled(person, next);
          out.update.push({ id: early.id, patch });
        }
      }
    }

    // 3. Came, worked, did not mark the exit
    if (shiftEnd !== null && row.firstIn !== null && row.lastAction === 'IN' && nowMinutes >= shiftEnd + NO_OUT_AFTER_MINUTES
      && !own.some(entry => entry.kind === 'no_out')) {
      const outcome = forgotOutcome(forgot[row.employeeId] ?? 0, settings);
      forgot[row.employeeId] = (forgot[row.employeeId] ?? 0) + 1;
      out.create.push({ ...blank(person, 'no_out', shiftEnd), status: 'warned', final: true, fine: outcome.fine, escalated: true });
      out.messages.push({ to: 'director', text: `🔕 <b>${person.name}</b> — ketishni Timepay’da belgilamadi: ${outcome.text}.` });
      if (person.chatId) out.messages.push({ to: 'worker', chatId: person.chatId, keyboard: WORKER_MENU,
        text: `🔕 Bugun ketishni Timepay’da belgilamadingiz: ${outcome.text}.\nHar kuni kelish va ketishni Face ID orqali belgilang.` });
    }
  }

  // Unanswered questions: keep asking; after an hour of silence the director decides.
  const patched = new Set(out.update.map(row => row.id));
  for (const item of input.cases) {
    if (item.status !== 'asked' || item.workDate !== today) continue;
    const person = input.people.find(entry => entry.timepayId === item.timepayId);
    if (!person) continue;
    const silent = item.pingedAt ? (Date.parse(nowIso) - Date.parse(item.pingedAt)) / 60000 : Infinity;
    if (silent < PING_EVERY_MINUTES || patched.has(item.id)) continue;
    const row = input.rows.find(entry => entry.employeeId === item.timepayId);
    const patch: Partial<StaffCase> = {};
    if (item.pings < MAX_PINGS && ask(person, item, row?.shiftEnd ?? null)) Object.assign(patch, { pings: item.pings + 1, pingedAt: nowIso });
    if (!item.escalated && item.pings + 1 >= ESCALATE_AFTER_PINGS) {
      toDirector(person, item, '🤷 Xodim botga javob bermayapti.');
      patch.escalated = true;
    }
    if (Object.keys(patch).length) out.update.push({ id: item.id, patch });
  }
  return out;
}

// ── The worker answers ───────────────────────────────────────────────────────────────────────────
export interface AnswerResult { patch?: Partial<StaffCase>; worker: { text: string; keyboard: string[][] }; director?: string }

/** `open` is the worker's oldest question still waiting for an answer; null when there is none. */
export function workerAnswer(text: string, open: StaffCase | null, settings: StaffSettings): AnswerResult | null {
  const choice = text.trim();
  if (!open || ![BTN.forgot, BTN.leave, BTN.late, BTN.no].includes(choice as never)) return null;
  if (choice === BTN.forgot && (open.kind !== 'late' || open.final)) return null;
  if (choice === BTN.forgot) {
    return { patch: { status: 'claimed', claim: 'forgot' },
      worker: { text: `Qabul qilindi. ${director(settings)} tasdiqlashi kutilmoqda. Hozir Timepay’da belgilab qo‘ying.`, keyboard: WORKER_MENU },
      director: `❓ <b>${open.name}</b>: «Ishdaman, Face ID’ni unutdim» deydi (${situation(open)}).\nRostdan ham ishdami?\n✅ Ha, ishda: /ha_${open.code}\n❌ Yo‘q: /yoq_${open.code}` };
  }
  if (choice === BTN.leave) {
    return { patch: { status: 'claimed', claim: 'leave' },
      worker: { text: `Qabul qilindi. ${director(settings)} tasdiqlasa — KPI’dan ushlanmaydi.`, keyboard: WORKER_MENU },
      director: `❓ <b>${open.name}</b>: «Ruxsat olganman» deydi (${situation(open)}).\nSizdan ruxsat olganmi?\n${decideLinks(open.code)}` };
  }
  return { patch: { status: 'fined', claim: choice === BTN.late ? 'late' : open.claim },
    worker: { text: `Qayd etildi. ${fineLine(open, settings)}`, keyboard: WORKER_MENU },
    director: `📌 <b>${open.name}</b> — ${situation(open)}, ruxsatsiz. ${fineLine(open, settings)}` };
}

// ── The director decides ─────────────────────────────────────────────────────────────────────────
export interface DecisionResult { patch?: Partial<StaffCase>; director: string; worker?: string }

/** "/ha_CODE" (approve) or "/yoq_CODE" (reject). `forgotThisMonth` — warnings the person already has. */
export function directorDecision(approve: boolean, item: StaffCase | null, forgotThisMonth: number, settings: StaffSettings): DecisionResult {
  if (!item) return { director: 'Bunday so‘rov topilmadi.' };
  if (item.status !== 'asked' && item.status !== 'claimed') {
    return { director: `<b>${item.name}</b> bo‘yicha qaror allaqachon berilgan: ${statusLabel(item)}.` };
  }
  if (approve && item.claim === 'forgot') {
    const outcome = forgotOutcome(forgotThisMonth, settings);
    return { patch: { status: 'warned', fine: outcome.fine, minutes: 0, final: true },
      director: `✅ <b>${item.name}</b> — ishda edi, belgilashni unutgan: ${outcome.text}.`,
      worker: `✅ Direktor tasdiqladi: kechikish hisoblanmaydi. Belgilashni unutganingiz uchun — ${outcome.text}.` };
  }
  if (approve) {
    return { patch: { status: 'approved' }, director: `✅ <b>${item.name}</b> — uzrli deb belgilandi, KPI’dan ushlanmaydi.`,
      worker: '✅ Direktor tasdiqladi: KPI’dan ushlanmaydi.' };
  }
  return { patch: { status: 'fined' }, director: `❌ <b>${item.name}</b> — uzrsiz. ${fineLine(item, settings)}`,
    worker: `❌ Direktor tasdiqlamadi. ${fineLine(item, settings)}` };
}

export function statusLabel(item: Pick<StaffCase, 'status' | 'claim' | 'fine'>): string {
  if (item.status === 'approved') return 'uzrli';
  if (item.status === 'fined') return 'jarima';
  if (item.status === 'warned') return item.fine > 0 ? `unutgan — jarima ${sum(item.fine)}` : 'unutgan — ogohlantirish';
  if (item.status === 'claimed') return item.claim === 'forgot' ? 'direktor javobi kutilmoqda (unutgan)' : 'direktor javobi kutilmoqda (ruxsat)';
  return 'xodim javobi kutilmoqda';
}

/** "/ha_k3f9a2" → { approve: true, code: 'k3f9a2' } */
export function parseDecision(text: string): { approve: boolean; code: string } | null {
  const match = /^\/(ha|yoq)_([a-z0-9]{4,12})$/.exec(text.trim().toLowerCase());
  return match ? { approve: match[1] === 'ha', code: match[2] } : null;
}

// ── KPI of a month ───────────────────────────────────────────────────────────────────────────────
export interface KpiLine { minutes: number; minuteFine: number; warnings: number; forgotFine: number; open: number; amount: number }

export function kpiOf(cases: StaffCase[], settings: StaffSettings): KpiLine {
  const fined = cases.filter(row => row.status === 'fined' && row.final && row.kind !== 'no_out');
  const minutes = fined.reduce((total, row) => total + row.minutes, 0);
  const forgotten = cases.filter(row => row.status === 'warned');
  const forgotFine = forgotten.reduce((total, row) => total + row.fine, 0);
  const minuteFine = minutes * settings.perMinute;
  return { minutes, minuteFine, warnings: forgotten.length, forgotFine,
    open: cases.filter(row => row.status === 'asked' || row.status === 'claimed' || (row.status === 'fined' && !row.final)).length,
    amount: settings.base - minuteFine - forgotFine };
}

const kpiDetails = (line: KpiLine, settings: StaffSettings): string => [
  line.minutes ? `kechikish/erta ketish ${line.minutes} daqiqa (−${sum(line.minuteFine)})` : '',
  line.warnings ? `belgilashni unutgan ${line.warnings} marta${line.forgotFine ? ` (−${sum(line.forgotFine)})` : ''}` : '',
  line.open ? `hal qilinmagan ${line.open} ta` : '',
].filter(Boolean).join(', ') || 'kamchiliksiz';

/** The director's month report: one line per person. */
export function kpiReport(people: Pick<StaffPerson, 'timepayId' | 'name'>[], cases: StaffCase[], settings: StaffSettings, month: string): string {
  const names = new Map<number, string>(people.map(row => [row.timepayId, row.name]));
  for (const row of cases) if (!names.has(row.timepayId)) names.set(row.timepayId, row.name);
  const lines = [...names].map(([id, name]) => ({ name, line: kpiOf(cases.filter(row => row.timepayId === id), settings) }))
    .sort((a, b) => a.line.amount - b.line.amount || a.name.localeCompare(b.name));
  if (!lines.length) return `📊 <b>KPI · ${month}</b>\n\nXodimlar topilmadi.`;
  return [`📊 <b>KPI · ${month}</b>`, `Asos ${sum(settings.base)} · 1 daqiqa = ${sum(settings.perMinute)}`, '',
    ...lines.map(row => `• <b>${row.name}</b> — ${sum(row.line.amount)}\n   ${kpiDetails(row.line, settings)}`),
    '', `Jami: ${sum(lines.reduce((total, row) => total + row.line.amount, 0))}`].join('\n');
}

/** The worker's own KPI. */
export function kpiOwn(cases: StaffCase[], settings: StaffSettings, month: string): string {
  const line = kpiOf(cases, settings);
  return `📊 <b>KPI · ${month}</b>\nHozircha: <b>${sum(line.amount)}</b> (asos ${sum(settings.base)})\n${kpiDetails(line, settings)}`;
}

// ── Advance requests ─────────────────────────────────────────────────────────────────────────────
/** "500 000", "500ming", "1.5 mln", "300k" → so‘m; null when it is not an amount. */
export function parseAmount(text: string): number | null {
  const clean = text.trim().toLowerCase().replace(/so[‘'ʻ`]?m|sum|сум|uzs/g, '').trim();
  const match = /^(\d[\d\s.,]*)\s*(mln|million|млн|ming|мин|минг|тыс|k|к|m)?$/.exec(clean);
  if (!match) return null;
  const unit = match[2] ?? '';
  const scale = /^(mln|million|млн|m)$/.test(unit) ? 1_000_000 : unit ? 1000 : 1;
  const digits = match[1].replace(/\s/g, '');
  // With a unit "1.5" is a fraction; without one dots and commas only group thousands.
  const value = scale > 1 ? Number(digits.replace(',', '.')) * scale : Number(digits.replace(/[.,]/g, ''));
  return Number.isFinite(value) && value >= 1000 && value <= 1_000_000_000 ? Math.round(value) : null;
}

export interface AdvanceRequest { code: string; name: string; amount: number; reason: string }

export function advanceForDirector(request: AdvanceRequest, balance: string): string {
  return [`💵 <b>Avans so‘rovi</b>`, `<b>${request.name}</b> — ${sum(request.amount)}`,
    ...(request.reason ? [`Sabab: ${request.reason}`] : []), ...(balance ? [balance] : []), '',
    `✅ Naqd berildi: /avans_naqd_${request.code}`, `✅ Kartaga o‘tkazildi: /avans_bank_${request.code}`, `❌ Rad etish: /avans_yoq_${request.code}`,
  ].join('\n');
}

/** "/avans_naqd_CODE" | "/avans_bank_CODE" | "/avans_yoq_CODE" */
export function parseAdvanceDecision(text: string): { action: 'cash' | 'bank' | 'reject'; code: string } | null {
  const match = /^\/avans_(naqd|bank|yoq)_([a-z0-9]{4,12})$/.exec(text.trim().toLowerCase());
  return match ? { action: match[1] === 'naqd' ? 'cash' : match[1] === 'bank' ? 'bank' : 'reject', code: match[2] } : null;
}

/** Six characters without look-alikes, for links the director taps. */
export function shortCode(random: () => number = Math.random): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
}

export const isStaffDirectorCommand = (text: string): boolean =>
  parseDecision(text) !== null || parseAdvanceDecision(text) !== null || /^\/?kpi$/i.test(text.trim());
