import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Copy, Link2, Unlink } from 'lucide-react';
import { kpiOf, statusLabel, type StaffCase, type StaffSettings } from '../staff-control';
import { decideCase, loadStaffOverview, previousMonth, saveStaffSettings, staffLink, staffUnlink, timepaySave, timepayStatus, type StaffOverview, type TimepayStatus } from '../staff-store';
import { duration } from '../attendance';
import { Empty, Field, Section, date, errorText, money, num } from '../ui';
import type { State } from '../types';

const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const kindLabel = (row: StaffCase): string => row.kind === 'early' ? `Erta ketgan · ${hhmm(row.atMinutes)}`
  : row.kind === 'no_out' ? 'Ketishni belgilamagan' : row.final ? 'Kechikkan' : 'Kelmagan';
const open = (row: StaffCase): boolean => (row.status === 'asked' || row.status === 'claimed') && row.kind !== 'no_out';

// Davomat va KPI: Telegram-bot yig‘gan holatlar, oy hisobi, avans so‘rovlari va qoidalar.
export function StaffControl({ state, supabase, today }: { state: State; supabase: SupabaseClient | null; today: string }) {
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const [data, setData] = useState<StaffOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ employeeId: string; url: string } | null>(null);
  const [rules, setRules] = useState<StaffSettings | null>(null);
  const [copied, setCopied] = useState(false);
  const [timepay, setTimepay] = useState<TimepayStatus | null>(null);
  const [token, setToken] = useState('');
  const [words, setWords] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    try { setData(await loadStaffOverview(supabase, month)); setTimepay(await timepayStatus(supabase)); setError(''); } catch (e) { setError(errorText(e)); }
  }, [supabase, month]);
  useEffect(() => { void load(); }, [load]);
  const act = async (job: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await job(); await load(); setError(''); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const employees = useMemo(() => state.employees.filter(row => row.active), [state.employees]);
  if (!supabase) return <Section title="Davomat va KPI"><Empty text="Bu bo‘lim umumiy bazada ishlaydi: Telegram-bot va Timepay ulangan korxona uchun." /></Section>;
  if (!data) return <Section title="Davomat va KPI"><Empty text={error ? `Ma’lumot olinmadi: ${error}` : 'Yuklanmoqda…'} /></Section>;

  const settings = data.settings;
  const linked = new Set(data.links.filter(row => row.linked).map(row => row.employeeId));
  const known = new Set(employees.map(row => row.id));
  const strangers = [...new Map(data.cases.filter(row => !row.employeeId || !known.has(row.employeeId)).map(row => [row.timepayId, row.name])).entries()];
  const lines = [
    ...employees.map(row => ({ key: row.id, name: row.name, employeeId: row.id as string | null, kpi: kpiOf(data.cases.filter(item => item.employeeId === row.id), settings) })),
    ...strangers.map(([id, name]) => ({ key: `tp${id}`, name, employeeId: null, kpi: kpiOf(data.cases.filter(item => item.timepayId === id && (!item.employeeId || !known.has(item.employeeId))), settings) })),
  ];
  const cases = [...data.cases].sort((a, b) => b.workDate.localeCompare(a.workDate));
  const waiting = data.cases.filter(open).length;
  const draft = rules ?? settings;
  const setRule = (patch: Partial<StaffSettings>) => setRules({ ...draft, ...patch });
  const amount = (label: string, key: 'base' | 'perMinute' | 'forgotFine' | 'forgotFree') =>
    <Field label={label}><input type="number" min="0" step="1" value={draft[key]} onChange={event => setRule({ [key]: Number(event.target.value) })} /></Field>;

  return <>
    <Section title="Davomat va KPI" hint={`Asos ${money(settings.base)} · 1 daqiqa = ${money(settings.perMinute)}`}
      action={<div className="section-tools"><select aria-label="Oy" value={month} onChange={event => setMonth(event.target.value)}>
        {[current, previousMonth(current), previousMonth(previousMonth(current))].map(row => <option key={row} value={row}>{row}</option>)}</select></div>}>
      {error && <p className="warning">{error}</p>}
      {!settings.enabled && <p className="warning">Nazorat o‘chirilgan: bot savol bermaydi va hisoblamaydi.</p>}
      {waiting > 0 && <p className="info-note">{`Hal qilinmagan holatlar: ${waiting} ta — qaror berilmaguncha jarima hisoblanmaydi.`}</p>}
      <div className="table-scroll cardable"><table><thead><tr><th>Xodim</th><th>Telegram</th><th className="right">Daqiqa</th><th className="right">Unutgan</th><th className="right">Ochiq</th><th className="right">KPI</th></tr></thead><tbody>
        {lines.map(row => <tr key={row.key}>
          <td data-label="Xodim"><b>{row.name}</b>{!row.employeeId && <small> · tizimda topilmadi</small>}</td>
          <td data-label="Telegram">{!row.employeeId ? <small>—</small> : linked.has(row.employeeId)
            ? <span className="staff-linked">Ulangan<button type="button" className="icon-button" title="Uzish" aria-label={`${row.name}: Telegramni uzish`} disabled={busy} onClick={() => { if (window.confirm('Xodimning Telegrami uzilsinmi?')) void act(() => staffUnlink(supabase, row.employeeId!)); }}><Unlink size={14} /></button></span>
            : <button type="button" className="text-button" disabled={busy} onClick={() => void act(async () => { setLink({ employeeId: row.employeeId!, url: await staffLink(supabase, row.employeeId!) }); setCopied(false); })}><Link2 size={14} />Havola</button>}</td>
          <td data-label="Daqiqa" className="right">{row.kpi.minutes ? num(row.kpi.minutes) : '—'}</td>
          <td data-label="Unutgan" className="right">{row.kpi.warnings ? num(row.kpi.warnings) : '—'}</td>
          <td data-label="Ochiq" className="right">{row.kpi.open || '—'}</td>
          <td data-label="KPI" className="right"><b className={row.kpi.amount < settings.base ? 'staff-cut' : ''}>{money(row.kpi.amount)}</b></td>
        </tr>)}
        {!lines.length && <tr><td colSpan={6}><small>Faol xodim yo‘q.</small></td></tr>}
      </tbody></table></div>
      {link && <div className="staff-link"><small>{`${employees.find(row => row.id === link.employeeId)?.name ?? ''}: havolani xodimga yuboring — u ochib «Start» bosadi. 7 kun amal qiladi.`}</small>
        <div><input readOnly value={link.url} aria-label="Xodim havolasi" onFocus={event => event.target.select()} />
          <button type="button" className="secondary small" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => setCopied(true)).catch(() => undefined); }}><Copy size={14} />{copied ? 'Nusxalandi' : 'Nusxa'}</button></div></div>}
    </Section>

    <Section title="Holatlar" hint="Kechikish, erta ketish va belgilashni unutish. Ochiq holatni shu yerda ham hal qilish mumkin.">
      {cases.length ? <div className="table-scroll cardable"><table><thead><tr><th>Sana</th><th>Xodim</th><th>Holat</th><th className="right">Daqiqa</th><th>Qaror</th><th></th></tr></thead><tbody>
        {cases.map(row => <tr key={row.id}>
          <td data-label="Sana">{date(row.workDate)}</td>
          <td data-label="Xodim"><b>{row.name}</b></td>
          <td data-label="Holat">{kindLabel(row)}</td>
          <td data-label="Daqiqa" className="right">{row.kind === 'no_out' ? '—' : row.final ? duration(row.minutes) : 'aniqlanmoqda'}</td>
          <td data-label="Qaror"><span className={`staff-status ${row.status}`}>{statusLabel(row)}</span></td>
          <td className="right">{open(row) && <span className="button-group"><button type="button" className="secondary small" disabled={busy} onClick={() => void act(() => decideCase(supabase, row.id, true))}>Uzrli</button><button type="button" className="secondary small" disabled={busy} onClick={() => void act(() => decideCase(supabase, row.id, false))}>Jarima</button></span>}</td>
        </tr>)}
      </tbody></table></div> : <Empty text="Bu oyda holat yo‘q." />}
    </Section>

    <div className="dashboard-grid">
      <Section title="Avans so‘rovlari" hint="Xodim botga yozadi, direktor Telegramda javob beradi. Tasdiqlangani kassaga yoziladi.">
        {data.advances.length ? <div className="staff-advances">{data.advances.map(row => <article key={row.id}>
          <div><b>{row.name}</b><small>{date(row.createdAt.slice(0, 10))}{row.reason ? ` · ${row.reason}` : ''}</small></div>
          <b>{money(row.amount)}</b>
          <span className={`staff-status ${row.status === 'approved' ? 'approved' : row.status === 'rejected' ? 'fined' : 'asked'}`}>{row.status === 'approved' ? (row.account === 'bank' ? 'Kartaga berildi' : 'Naqd berildi') : row.status === 'rejected' ? 'Rad etildi' : 'Kutilmoqda'}</span>
        </article>)}</div> : <Empty text="So‘rov yo‘q." />}
      </Section>
      <Section title="Qoidalar" hint="Bot shu qoidalar bo‘yicha so‘raydi va hisoblaydi.">
        <form className="staff-rules" onSubmit={event => { event.preventDefault(); void act(async () => { await saveStaffSettings(supabase, draft); setRules(null); }); }}>
          <label className="check-inline"><input type="checkbox" checked={draft.enabled} onChange={event => setRule({ enabled: event.target.checked })} />Nazorat yoqilgan</label>
          <div className="order-grid-3">{amount('KPI asosi, so‘m', 'base')}{amount('1 daqiqa jarimasi, so‘m', 'perMinute')}
            <Field label="Direktor ismi (savolda chiqadi)"><input maxLength={80} value={draft.directorName} onChange={event => setRule({ directorName: event.target.value })} /></Field></div>
          <div className="order-grid-3">{amount('Unutganda ogohlantirishlar soni', 'forgotFree')}{amount('Undan keyingi jarima, so‘m', 'forgotFine')}
            <div className="staff-save"><button className="primary small" disabled={busy || (!rules && data.saved)}>Saqlash</button></div></div>
        </form>
      </Section>
    </div>
    {timepay && <Section title="Timepay ulanishi" hint="Kelish-ketish Timepay (Face ID) dan olinadi. Token faqat serverda saqlanadi va qayta ko‘rsatilmaydi.">
      <form className="staff-rules" onSubmit={event => { event.preventDefault(); void act(async () => { await timepaySave(supabase, token.trim() ? token.trim() : null, words ?? timepay.words.join(', ')); setToken(''); setWords(null); }); }}>
        <p className={timepay.connected ? 'info-note' : 'warning'}>{timepay.connected ? 'Timepay ulangan: korxonaning o‘z tokeni ishlatilmoqda.' : 'Korxonaning o‘z tokeni kiritilmagan. Timepay kabinetidan integratsiya tokenini oling va shu yerga yozing.'}</p>
        <div className="order-grid-3">
          <Field label={timepay.connected ? 'Yangi token (o‘zgartirish uchun)' : 'Timepay tokeni'}><input type="password" autoComplete="off" maxLength={400} value={token} placeholder="timepay_…" onChange={event => setToken(event.target.value)} /></Field>
          <Field label="Filial yoki bo‘lim nomidagi so‘zlar"><input maxLength={200} value={words ?? timepay.words.join(', ')} placeholder="Bo‘sh — butun akkaunt" onChange={event => setWords(event.target.value)} /></Field>
          <div className="staff-save button-group"><button className="primary small" disabled={busy || (!token.trim() && words === null)}>Saqlash</button>
            {timepay.connected && <button type="button" className="secondary small" disabled={busy} onClick={() => { if (window.confirm('Timepay uzilsinmi? Davomat nazorati to‘xtaydi.')) void act(() => timepaySave(supabase, '', '')); }}>Uzish</button>}</div>
        </div>
      </form>
    </Section>}
  </>;
}
