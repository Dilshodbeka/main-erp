// Attendance discipline, KPI and advance requests: the database and Telegram side of src/staff-control.ts.
// Used by the scheduled pass (erp-watch?staff=1) and by the bot webhook. The rules themselves are pure
// and bundled in owner-bot.generated.js; this file only reads, writes and sends.
// Timepay: the platform owner's company uses the server secret; any other company its own token
// (table erp_integrations, set from the settings screen).
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  BTN, STAFF_DEFAULTS, WORKER_MENU, advanceForDirector, attendanceRows, directorDecision, fetchChecks, fetchPeople, kpiOwn, kpiReport,
  matchPeople, ownerErrorText, parseAdvanceDecision, parseAmount, parseDecision, shortCode, staffBalanceLine, staffTick, sum, workerAnswer,
} from './owner-bot.generated.js';
import { adminClientFor, adminSnapshotFor, ownerTargets, platformCompanyId, type AccessConfig } from './owner-access.ts';

export type Send = (chatId: string, text: string, keyboard?: string[][]) => Promise<boolean>;
type Row = Record<string, unknown>;

const PEOPLE_TTL_MS = 60 * 60 * 1000;

/** A company with its Timepay access: `words` pick its people in a Timepay account shared by several firms. */
export interface StaffCompany { id: string; token: string; words?: string[] }

/** The company's own token, or the server secret for the platform owner's company. Empty token = not connected. */
export async function staffCompany(service: SupabaseClient, companyId: string | null, envToken: string): Promise<StaffCompany | null> {
  const home = await platformCompanyId(service);
  const id = companyId ?? home;
  if (!id) return null;
  const row = await service.from('erp_integrations').select('timepay_token, timepay_words').eq('company_id', id).maybeSingle();
  const own = row.error ? null : row.data;
  const words = (own?.timepay_words as string[] | undefined)?.filter(Boolean) ?? [];
  if (own?.timepay_token) return { id, token: own.timepay_token as string, words };
  // Without its own words the platform company keeps the built-in ones (undefined), any other firm takes the whole account.
  return { id, token: id === home ? envToken : '', words: words.length ? words : id === home ? undefined : [] };
}

/** Owner chats of one company (the platform company also has the ids from the server secret). */
export async function directorChatsOf(service: SupabaseClient, legacyIds: string[], companyId: string): Promise<string[]> {
  const home = await platformCompanyId(service);
  const targets = await ownerTargets(service, legacyIds);
  return targets.find(target => (target.companyId ?? home) === companyId)?.chatIds ?? [];
}

interface Settings { enabled: boolean; base: number; perMinute: number; forgotFree: number; forgotFine: number; directorName: string }

/** null when the migration is not applied yet: the feature is simply off. */
export async function staffSettings(service: SupabaseClient, companyId: string): Promise<Settings | null> {
  const row = await service.from('erp_kpi_settings').select('*').eq('company_id', companyId).maybeSingle();
  if (row.error) return null;
  if (!row.data) return { ...STAFF_DEFAULTS };
  return { enabled: row.data.enabled, base: Number(row.data.base), perMinute: Number(row.data.per_minute), forgotFree: row.data.forgot_free,
    forgotFine: Number(row.data.forgot_fine), directorName: row.data.director_name ?? '' };
}

const toCase = (row: Row) => ({
  id: row.id as string, timepayId: Number(row.timepay_id), employeeId: (row.employee_id as string | null) ?? null, name: row.employee_name as string,
  workDate: row.work_date as string, kind: row.kind as string, atMinutes: row.at_minutes as number, minutes: row.minutes as number,
  final: row.final as boolean, status: row.status as string, claim: (row.claim as string | null) ?? null, fine: Number(row.fine), code: row.code as string,
  pings: row.pings as number, pingedAt: (row.pinged_at as string | null) ?? null, escalated: row.escalated as boolean,
});
const columns: Record<string, string> = {
  timepayId: 'timepay_id', employeeId: 'employee_id', name: 'employee_name', workDate: 'work_date', kind: 'kind', atMinutes: 'at_minutes',
  minutes: 'minutes', final: 'final', status: 'status', claim: 'claim', fine: 'fine', code: 'code', pings: 'pings', pingedAt: 'pinged_at', escalated: 'escalated',
};
const toRow = (item: Row): Row => Object.fromEntries(Object.entries(item).filter(([key]) => columns[key]).map(([key, value]) => [columns[key], value]));

const monthOf = (day: string): string => day.slice(0, 7);
function monthRange(month: string): [string, string] {
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return [`${month}-01`, next];
}

async function monthCases(service: SupabaseClient, companyId: string, month: string) {
  const [from, to] = monthRange(month);
  const rows = await service.from('erp_attendance_cases').select('*').eq('company_id', companyId).gte('work_date', from).lt('work_date', to);
  return (rows.data ?? []).map(toCase);
}
const forgotCounts = (cases: ReturnType<typeof toCase>[]): Record<number, number> => {
  const count: Record<number, number> = {};
  for (const row of cases) if (row.status === 'warned') count[row.timepayId] = (count[row.timepayId] ?? 0) + 1;
  return count;
};

/** Employees and schedules from the hourly cache, today's marks always fresh. */
async function attendanceData(service: SupabaseClient, company: StaffCompany, today: string) {
  const token = company.token;
  const key = `people:${company.id}`;
  const cached = await service.from('erp_timepay_cache').select('data, fetched_at').eq('key', key).maybeSingle();
  let people = cached.data && Date.now() - Date.parse(cached.data.fetched_at) < PEOPLE_TTL_MS ? cached.data.data as Row : null;
  if (!people) {
    people = await fetchPeople(token, fetch);
    await service.from('erp_timepay_cache').upsert({ key, data: people, fetched_at: new Date().toISOString() });
  }
  return { employees: people.employees, schedules: people.schedules, checks: await fetchChecks(token, today, fetch) };
}

async function peopleFor(service: SupabaseClient, company: StaffCompany, data: Row) {
  const companyId = company.id;
  const [employees, links] = await Promise.all([
    service.from('erp_employees').select('id, name').eq('company_id', companyId).eq('active', true),
    service.from('erp_staff_links').select('employee_id, chat_id, timepay_id').eq('company_id', companyId),
  ]);
  return matchPeople(data, employees.data ?? [],
    (links.data ?? []).map(row => ({ employeeId: row.employee_id, chatId: row.chat_id, timepayId: row.timepay_id === null ? null : Number(row.timepay_id) })), company.words);
}

// ── Scheduled pass ───────────────────────────────────────────────────────────────────────────────
export async function staffPass(service: SupabaseClient, company: StaffCompany, directorChats: string[], send: Send,
  clock: { today: string; minutes: number; nowIso: string }, dry: boolean): Promise<Record<string, unknown>> {
  const companyId = company.id;
  if (!company.token) return { staff: 'not_configured' };
  const settings = await staffSettings(service, companyId);
  if (!settings) return { staff: 'migration_missing' };
  if (!settings.enabled) return { staff: 'off' };
  const data = await attendanceData(service, company, clock.today);
  const people = await peopleFor(service, company, data);
  const cases = await monthCases(service, companyId, monthOf(clock.today));
  const result = staffTick({
    rows: attendanceRows(data, clock.today, clock.minutes, undefined, undefined, company.words), people, cases: cases.filter(row => row.workDate === clock.today),
    forgot: forgotCounts(cases), settings, today: clock.today, nowMinutes: clock.minutes, nowIso: clock.nowIso, newCode: () => shortCode(),
  });
  if (dry) return { staff: 'dry', people: people.length, linked: people.filter((row: Row) => row.chatId).length, create: result.create.length, update: result.update.length, messages: result.messages.length };
  if (result.create.length) {
    const inserted = await service.from('erp_attendance_cases')
      .upsert(result.create.map((row: Row) => ({ ...toRow(row), company_id: companyId })), { onConflict: 'company_id,timepay_id,work_date,kind', ignoreDuplicates: true });
    if (inserted.error) throw new Error('staff_case_insert_failed');
  }
  for (const change of result.update) await service.from('erp_attendance_cases').update(toRow(change.patch)).eq('id', change.id).eq('company_id', companyId);
  for (const message of result.messages) {
    if (message.to === 'worker') await send(message.chatId, message.text, message.keyboard);
    else await Promise.all(directorChats.map(chatId => send(chatId, message.text)));
  }
  // The finished month: once, on the first working morning of the new one.
  const day = Number(clock.today.slice(8, 10));
  if (day <= 3 && clock.minutes >= 9 * 60) {
    const previous = new Date(Date.UTC(Number(clock.today.slice(0, 4)), Number(clock.today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const key = `kpi:${previous}`;
    const done = await service.from('erp_watch_sent').select('key').eq('company_id', companyId).eq('key', key).maybeSingle();
    if (!done.data) {
      const closed = await monthCases(service, companyId, previous);
      const text = `🏁 Oy yakuni\n${kpiReport(people, closed, settings, previous)}`;
      if ((await Promise.all(directorChats.map(chatId => send(chatId, text)))).some(Boolean)) {
        await service.from('erp_watch_sent').upsert({ company_id: companyId, key, sent_at: clock.nowIso }, { onConflict: 'company_id,key' });
      }
    }
  }
  return { staff: 'ok', people: people.length, created: result.create.length, updated: result.update.length, messages: result.messages.length };
}

// ── Worker's chat ────────────────────────────────────────────────────────────────────────────────
export interface StaffChat { companyId: string; employeeId: string; name: string }

export async function staffOfChat(service: SupabaseClient, chatId: string): Promise<StaffChat | null> {
  const link = await service.from('erp_staff_links').select('company_id, employee_id').eq('chat_id', chatId).maybeSingle();
  if (link.error || !link.data) return null;
  const employee = await service.from('erp_employees').select('name').eq('company_id', link.data.company_id).eq('id', link.data.employee_id).maybeSingle();
  return { companyId: link.data.company_id, employeeId: link.data.employee_id, name: String(employee.data?.name ?? '').replace(/[<>&]/g, ' ') };
}

/** "/start w…" from the link in the employee's card. Returns false when the code is not a staff code. */
export async function linkStaffChat(service: SupabaseClient, code: string, chatId: string, send: Send): Promise<boolean> {
  if (!/^w[0-9a-f]{32}$/.test(code)) return false;
  const found = await service.from('erp_staff_links').select('company_id, employee_id, link_expires_at, chat_id').eq('link_code', code).maybeSingle();
  if (found.error || !found.data || Date.parse(found.data.link_expires_at ?? '') <= Date.now()) {
    await send(chatId, 'Havola topilmadi yoki muddati tugagan. Rahbardan yangi havola so‘rang.');
    return true;
  }
  // One Telegram account — one employee.
  await service.from('erp_staff_links').update({ chat_id: null, linked_at: null }).eq('chat_id', chatId);
  const saved = await service.from('erp_staff_links').update({ chat_id: chatId, link_code: null, link_expires_at: null, linked_at: new Date().toISOString() })
    .eq('company_id', found.data.company_id).eq('employee_id', found.data.employee_id);
  if (saved.error) { await send(chatId, 'Xatolik. Keyinroq qayta urinib ko‘ring.'); return true; }
  const employee = await service.from('erp_employees').select('name').eq('company_id', found.data.company_id).eq('id', found.data.employee_id).maybeSingle();
  await send(chatId, `✅ ${employee.data?.name ?? 'Xodim'}, Telegram ulandi.\nBu yerda davomat bo‘yicha savollar keladi, KPI’ni ko‘rish va avans so‘rash mumkin.`, WORKER_MENU);
  return true;
}

const tashkent = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());

export async function handleWorker(service: SupabaseClient, config: AccessConfig, staff: StaffChat, chatId: string, text: string,
  directorChats: string[], send: Send): Promise<void> {
  const settings = await staffSettings(service, staff.companyId) ?? { ...STAFF_DEFAULTS };
  const toDirectors = (message: string) => Promise.all(directorChats.map(id => send(id, message)));
  const input = text.trim();

  // 1. Advance request in progress
  const dialog = await service.from('erp_staff_dialogs').select('step, data').eq('chat_id', chatId).maybeSingle();
  if (dialog.data) {
    if (input === BTN.cancel) {
      await service.from('erp_staff_dialogs').delete().eq('chat_id', chatId);
      await send(chatId, 'Bekor qilindi.', WORKER_MENU);
      return;
    }
    if (dialog.data.step === 'advance_amount') {
      const amount = parseAmount(input);
      if (amount === null) { await send(chatId, 'Summani raqam bilan yozing. Masalan: 500 000', [[BTN.cancel]]); return; }
      await service.from('erp_staff_dialogs').upsert({ chat_id: chatId, step: 'advance_reason', data: { amount }, updated_at: new Date().toISOString() });
      await send(chatId, `Summa: ${sum(amount)}.\nSababini yozing yoki «${BTN.skip}» ni bosing.`, [[BTN.skip], [BTN.cancel]]);
      return;
    }
    if (dialog.data.step === 'advance_reason') {
      const amount = Number((dialog.data.data as Row)?.amount);
      const reason = input === BTN.skip ? '' : input.replace(/[<>&]/g, ' ').slice(0, 300);
      const code = shortCode();
      const saved = await service.from('erp_advance_requests').insert({ company_id: staff.companyId, employee_id: staff.employeeId, employee_name: staff.name, amount, reason, code });
      await service.from('erp_staff_dialogs').delete().eq('chat_id', chatId);
      if (saved.error) { await send(chatId, 'So‘rov saqlanmadi. Qayta urinib ko‘ring.', WORKER_MENU); return; }
      let balance = '';
      try { balance = staffBalanceLine(await adminSnapshotFor(service, config, staff.companyId), staff.employeeId); } catch { /* the request goes out without the balance */ }
      await toDirectors(advanceForDirector({ code, name: staff.name, amount, reason }, balance));
      await send(chatId, `💵 So‘rov direktorga yuborildi: ${sum(amount)}. Javobi shu yerga keladi.`, WORKER_MENU);
      return;
    }
    await service.from('erp_staff_dialogs').delete().eq('chat_id', chatId);
  }

  // 2. An answer to the bot's question (the oldest one still open)
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const open = await service.from('erp_attendance_cases').select('*').eq('company_id', staff.companyId).eq('employee_id', staff.employeeId)
    .eq('status', 'asked').gte('work_date', since).order('created_at', { ascending: true }).limit(1).maybeSingle();
  const answer = workerAnswer(input, open.data ? toCase(open.data) : null, settings);
  if (answer) {
    if (answer.patch && open.data) await service.from('erp_attendance_cases').update(toRow(answer.patch)).eq('id', open.data.id).eq('status', 'asked');
    await send(chatId, answer.worker.text, answer.worker.keyboard);
    if (answer.director) await toDirectors(answer.director);
    return;
  }

  // 3. Menu
  if (input === BTN.kpi || /^\/?kpi$/i.test(input)) {
    const month = monthOf(tashkent());
    const own = (await monthCases(service, staff.companyId, month)).filter(row => row.employeeId === staff.employeeId);
    await send(chatId, kpiOwn(own, settings, month), WORKER_MENU);
    return;
  }
  if (input === BTN.advance || /^\/?avans$/i.test(input)) {
    await service.from('erp_staff_dialogs').upsert({ chat_id: chatId, step: 'advance_amount', data: {}, updated_at: new Date().toISOString() });
    await send(chatId, 'Qancha avans kerak? Summani yozing. Masalan: 500 000', [[BTN.cancel]]);
    return;
  }
  if (open.data) {
    await send(chatId, 'Iltimos, quyidagi tugmalardan birini bosing — savol javobsiz qolmoqda.',
      toCase(open.data).kind === 'late' && !open.data.final ? [[BTN.forgot], [BTN.leave], [BTN.late]] : [[BTN.leave], [BTN.no]]);
    return;
  }
  await send(chatId, `Assalomu alaykum, ${staff.name}.\n📊 KPI — shu oydagi holatingiz.\n💵 Avans — direktorga so‘rov yuborish.`, WORKER_MENU);
}

// ── Director's commands ──────────────────────────────────────────────────────────────────────────
/** Returns false when the text is not one of the staff commands (the usual owner bot answers then). */
export async function handleDirectorStaff(service: SupabaseClient, config: AccessConfig, company: StaffCompany | null, chatId: string, text: string,
  directorChats: string[], send: Send, requestId: () => Promise<string>): Promise<boolean> {
  const decision = parseDecision(text);
  const advance = parseAdvanceDecision(text);
  const wantsKpi = /^\/?kpi$/i.test(text.trim());
  if (!decision && !advance && !wantsKpi) return false;
  const companyId = company?.id ?? null;
  const settings = companyId ? await staffSettings(service, companyId) : null;
  if (!companyId || !settings) { await send(chatId, 'Davomat nazorati hali yoqilmagan (bazada jadval yo‘q).'); return true; }
  const others = directorChats.filter(id => id !== chatId);
  const workerChat = async (employeeId: string | null): Promise<string | null> => {
    if (!employeeId) return null;
    const link = await service.from('erp_staff_links').select('chat_id').eq('company_id', companyId).eq('employee_id', employeeId).maybeSingle();
    return link.data?.chat_id ?? null;
  };

  if (wantsKpi) {
    const today = tashkent();
    const cases = await monthCases(service, companyId, monthOf(today));
    let people: Row[] = [];
    try { people = company!.token ? await peopleFor(service, company!, await attendanceData(service, company!, today)) : []; } catch { /* the report is built from the cases alone */ }
    await send(chatId, kpiReport(people, cases, settings, monthOf(today)));
    return true;
  }

  if (decision) {
    const found = await service.from('erp_attendance_cases').select('*').eq('company_id', companyId).eq('code', decision.code).maybeSingle();
    const item = found.data ? toCase(found.data) : null;
    const forgot = item ? forgotCounts(await monthCases(service, companyId, monthOf(item.workDate)))[item.timepayId] ?? 0 : 0;
    const result = directorDecision(decision.approve, item, forgot, settings);
    if (result.patch && item) {
      const saved = await service.from('erp_attendance_cases')
        .update({ ...toRow(result.patch), decided_by: chatId, decided_at: new Date().toISOString() }).eq('id', item.id).in('status', ['asked', 'claimed']).select('id');
      if (!saved.data?.length) { await send(chatId, 'Qaror allaqachon berilgan.'); return true; }
      const chat = await workerChat(item.employeeId);
      if (chat && result.worker) await send(chat, result.worker, WORKER_MENU);
      await Promise.all(others.map(id => send(id, result.director)));
    }
    await send(chatId, result.director);
    return true;
  }

  const request = await service.from('erp_advance_requests').select('*').eq('company_id', companyId).eq('code', advance!.code).maybeSingle();
  if (!request.data) { await send(chatId, 'Bunday avans so‘rovi topilmadi.'); return true; }
  if (request.data.status !== 'pending') {
    await send(chatId, `Bu so‘rov bo‘yicha qaror allaqachon berilgan: ${request.data.status === 'approved' ? 'berilgan' : 'rad etilgan'}.`);
    return true;
  }
  const amount = Number(request.data.amount);
  const name = request.data.employee_name as string;
  const chat = await workerChat(request.data.employee_id);
  if (advance!.action === 'reject') {
    await service.from('erp_advance_requests').update({ status: 'rejected', decided_by: chatId, decided_at: new Date().toISOString() }).eq('id', request.data.id).eq('status', 'pending');
    if (chat) await send(chat, `❌ Avans so‘rovingiz (${sum(amount)}) rad etildi.`, WORKER_MENU);
    const note = `❌ <b>${name}</b> — avans ${sum(amount)} rad etildi.`;
    await Promise.all([send(chatId, note), ...others.map(id => send(id, note))]);
    return true;
  }
  // Paid: the payout goes through the same command as in the cash screen, so the cash book and the
  // employee's balance change together.
  try {
    const snapshot = await adminSnapshotFor(service, config, companyId) as { state?: { revision?: number } } | null;
    const scoped = await adminClientFor(service, config, companyId);
    const executed = await scoped.rpc('erp_execute', {
      p_request_id: await requestId(),
      p_expected_revision: snapshot?.state?.revision ?? -1,
      p_command: { type: 'salary.pay', employeeId: request.data.employee_id, amount, account: advance!.action, kind: 'advance',
        note: `Avans (Telegram so‘rovi)${request.data.reason ? `: ${String(request.data.reason).slice(0, 150)}` : ''}`, allowPrepay: true },
    });
    if (executed.error) { await send(chatId, `${ownerErrorText(executed.error.message ?? '')}\nSo‘rov ochiq qoldi.`); return true; }
  } catch {
    await send(chatId, 'To‘lovni yozib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring — so‘rov ochiq qoldi.');
    return true;
  }
  await service.from('erp_advance_requests').update({ status: 'approved', account: advance!.action, decided_by: chatId, decided_at: new Date().toISOString() })
    .eq('id', request.data.id).eq('status', 'pending');
  const how = advance!.action === 'cash' ? 'naqd' : 'kartaga';
  if (chat) await send(chat, `✅ Avans tasdiqlandi: ${sum(amount)} (${how}).`, WORKER_MENU);
  const note = `✅ <b>${name}</b> — avans ${sum(amount)} ${how} berildi, kassaga yozildi.`;
  await Promise.all([send(chatId, note), ...others.map(id => send(id, note))]);
  return true;
}
