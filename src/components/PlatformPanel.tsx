import { useEffect, useState } from 'react';
import { dateLocale } from '../i18n';
import { Ban, CalendarPlus, Infinity as InfinityIcon, RefreshCw } from 'lucide-react';
import { Empty, Section } from '../ui';
import {
  OPTIONAL_MODULES, extendedUntil, loadPlatformCompanies, planLabel, savePlatformCompany,
  type PlatformChange, type PlatformCompany,
} from '../subscription';

const day = (value: string | null) => (value ? new Date(value).toLocaleDateString(dateLocale) : '—');

/** Seller's view of every company on the platform: plan, validity, modules, block switch. */
export function PlatformPanel({ onNotice }: { onNotice: (message: string, error?: boolean) => void }) {
  const [rows, setRows] = useState<PlatformCompany[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => { void loadPlatformCompanies().then(setRows).catch(error => onNotice(String(error.message ?? error), true)); };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async (company: PlatformCompany, patch: Partial<PlatformChange>, done: string) => {
    setBusy(true);
    try {
      const change: PlatformChange = {
        plan: company.plan, paidUntil: company.paidUntil, blocked: company.blocked,
        disabledModules: company.disabledModules, note: company.note, ...patch,
      };
      setRows(await savePlatformCompany(company.id, change));
      onNotice(done);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error), true);
    } finally { setBusy(false); }
  };

  const toggleModule = (company: PlatformCompany, moduleId: string) => {
    const off = company.disabledModules.includes(moduleId);
    const next = off ? company.disabledModules.filter(id => id !== moduleId) : [...company.disabledModules, moduleId];
    void apply(company, { disabledModules: next }, off ? 'Modul yoqildi.' : 'Modul o‘chirildi.');
  };

  return <Section title="Platforma · korxonalar" hint="Faqat platforma egasiga ko‘rinadi: har bir korxonaning tarifi, muddati va modullari."
    action={<button className="secondary small" onClick={reload} disabled={busy}><RefreshCw size={14} />Yangilash</button>}>
    {rows === null ? <Empty text="Yuklanmoqda…" /> : !rows.length ? <Empty text="Korxonalar yo‘q" /> : <div className="platform-list">
      {rows.map(company => <article className={`platform-company ${company.active ? '' : 'inactive'}`} key={company.id}>
        <header>
          <div><b>{company.name}</b><small>{company.ownerEmail ?? 'egasi topilmadi'}{company.phone ? ` · ${company.phone}` : ''}</small></div>
          <span className={`platform-plan ${company.active ? 'ok' : 'off'}`}>{company.blocked ? 'To‘xtatilgan' : company.active ? planLabel(company.plan) : 'Muddati tugagan'}</span>
        </header>
        <div className="platform-facts">
          <span>Yaratilgan<b>{day(company.createdAt)}</b></span>
          <span>Sinov tugaydi<b>{day(company.trialEndsAt)}</b></span>
          <span>To‘langan muddat<b>{company.plan === 'lifetime' ? 'muddatsiz' : day(company.paidUntil)}</b></span>
          <span>Foydalanuvchilar<b>{company.users}</b></span>
          <span>Buyurtmalar<b>{company.orders}</b></span>
          <span>Oxirgi faollik<b>{day(company.lastActivity)}</b></span>
        </div>
        <div className="platform-modules">
          {OPTIONAL_MODULES.map(module => <label key={module.id}>
            <input type="checkbox" checked={!company.disabledModules.includes(module.id)} disabled={busy} onChange={() => toggleModule(company, module.id)} />
            {module.title}
          </label>)}
        </div>
        <div className="data-actions">
          {[30, 365].map(days => <button key={days} className="secondary small" disabled={busy}
            onClick={() => void apply(company, { plan: 'paid', paidUntil: extendedUntil(company.paidUntil, days, new Date().toISOString()), blocked: false }, `Obuna ${days} kunga uzaytirildi.`)}>
            <CalendarPlus size={14} />+{days === 30 ? '30 kun' : '1 yil'}</button>)}
          <button className="secondary small" disabled={busy || company.plan === 'lifetime'}
            onClick={() => void apply(company, { plan: 'lifetime', blocked: false }, 'Muddatsiz tarif yoqildi.')}><InfinityIcon size={14} />Muddatsiz</button>
          <button className="text-button danger-text" disabled={busy}
            onClick={() => void apply(company, { blocked: !company.blocked }, company.blocked ? 'Korxona ochildi.' : 'Korxona to‘xtatildi.')}><Ban size={14} />{company.blocked ? 'Ochish' : 'To‘xtatish'}</button>
        </div>
      </article>)}
    </div>}
  </Section>;
}
