import { useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2, Tv, UserRound } from 'lucide-react';
import { accessErrorText as accessErrorLabel, resetPasswordError, validateAccessDraft, type AccessAccount, type AccessDraft } from '../access';
import { AccessError, createAccount, deleteAccount, listAccounts, resetAccountPassword } from '../accessApi';
import { PERMISSION_GROUPS, PERMISSION_LABEL, PRESETS, type Permission, type PresetKey } from '../permissions';
import type { Employee, Role, Workshop } from '../types';
import { activeWorkshops } from '../workshop-view';
import { Empty, Field, Section } from '../ui';

const emptyDraft: AccessDraft = {
  role: 'worker', employeeId: '', displayName: '', email: '', password: '', confirm: '',
  preset: '', permissions: [], scopeWorkshopIds: [], scopeWarehouseIds: [],
};

const roleLabel: Record<Role, string> = { admin: 'Egasi', worker: 'Xodim', display: 'TV ekran' };

export function presetName(permissions: string[] | null | undefined): string {
  if (!Array.isArray(permissions)) return 'Huquqlarsiz';
  const sorted = (items: string[]) => [...items].sort().join(',');
  for (const key of Object.keys(PRESETS) as PresetKey[]) {
    if (sorted(PRESETS[key]) === sorted(permissions)) return key;
  }
  return permissions.length ? 'Moslashtirilgan' : 'Huquqlarsiz';
}

function accessErrorText(error: unknown): string {
  const code = error instanceof AccessError ? error.code : '';
  return accessErrorLabel(code, error instanceof Error ? error.message : '');
}

export function AccessPanel({ cloud, employees, workshops }: { cloud: boolean; employees: Employee[]; workshops: Workshop[] }) {
  const [accounts, setAccounts] = useState<AccessAccount[]>([]);
  const [loading, setLoading] = useState(cloud);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<AccessDraft>(emptyDraft);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');
  const [resetId, setResetId] = useState('');
  const [reset, setReset] = useState({ password: '', confirm: '' });
  const [deleteId, setDeleteId] = useState('');
  const available = employees.filter(employee => employee.active && !accounts.some(account => account.employeeId === employee.id));

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setAccounts(await listAccounts());
    } catch (e) {
      setError(accessErrorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (cloud) void load(); }, [cloud]);

  const submit = async () => {
    const problem = validateAccessDraft(draft, employees, accounts);
    setFormError(problem);
    setNotice('');
    if (problem) return;
    setBusy('create');
    try {
      await createAccount(draft);
      setNotice(`${draft.role === 'display' ? 'TV ekrani' : 'Xodim'} hisobi yaratildi. Endi shu email va parol bilan kirish mumkin.`);
      setDraft(emptyDraft);
      await load();
    } catch (e) {
      setFormError(accessErrorText(e));
    } finally {
      setBusy('');
    }
  };

  const savePassword = async (account: AccessAccount) => {
    const problem = resetPasswordError(reset.password, reset.confirm);
    setFormError(problem);
    setNotice('');
    if (problem) return;
    setBusy(account.id);
    try {
      await resetAccountPassword(account.id, reset.password);
      setNotice(`${account.name} uchun yangi parol saqlandi.`);
      setResetId('');
      setReset({ password: '', confirm: '' });
    } catch (e) {
      setFormError(accessErrorText(e));
    } finally {
      setBusy('');
    }
  };

  const remove = async (account: AccessAccount) => {
    setBusy(account.id);
    setFormError('');
    setNotice('');
    try {
      await deleteAccount(account.id);
      setNotice(`${account.name} hisobi o‘chirildi. Bu email bilan kirish yopildi.`);
      setDeleteId('');
      await load();
    } catch (e) {
      setFormError(accessErrorText(e));
    } finally {
      setBusy('');
    }
  };

  const applyPreset = (preset: PresetKey | '') => {
    setDraft({ ...draft, preset, permissions: preset ? [...PRESETS[preset]] : draft.permissions });
  };

  const togglePermission = (key: Permission) => {
    const permissions = draft.permissions.includes(key)
      ? draft.permissions.filter(perm => perm !== key)
      : [...draft.permissions, key];
    setDraft({ ...draft, preset: '', permissions });
  };

  return <Section title="Kirish huquqlari" hint="Xodim va TV hisobini yarating, parolni almashtiring yoki kirishni o‘chiring. Egasi hisobi o‘zgarmaydi."
    action={cloud ? <button type="button" className="secondary small" disabled={loading} onClick={() => void load()}><RefreshCw size={14} />Yangilash</button> : undefined}>
    {!cloud
      ? <div className="info-note has-icon"><ShieldCheck size={18} />Demo rejimda hisoblar yaratilmaydi. Umumiy bazaga ulangach, bu yerda xodim va TV uchun email-parol yaratiladi, parol almashtiriladi va kirish o‘chiriladi.</div>
      : <>
        {loading && <p className="subtle-note access-note">Ro‘yxat yuklanmoqda…</p>}
        {error && <div className="warning access-note">{error}</div>}
        {!loading && !error && !accounts.length && <Empty text="Hisoblar topilmadi. Pastdan birinchi xodim hisobini yarating." />}
        {accounts.length > 0 && <div className="table-scroll cardable"><table>
          <thead><tr><th>Hisob</th><th>Rol</th><th>Xodim</th><th className="right">Amallar</th></tr></thead>
          <tbody>{accounts.map(account => <tr key={account.id}>
            <td data-label="Hisob"><b>{account.name}</b><small>{account.email || 'Email noma’lum'}</small></td>
            <td data-label="Rol"><span className={`badge access-role ${account.role}`}>{account.role === 'admin' ? <ShieldCheck size={12} /> : account.role === 'display' ? <Tv size={12} /> : <UserRound size={12} />}{roleLabel[account.role]}</span>{account.role === 'worker' && <small className="muted">{presetName(account.permissions)}</small>}</td>
            <td data-label="Xodim">{account.employeeName || <span className="muted">—</span>}</td>
            <td data-label="Amallar" className="right">
              {account.role === 'admin'
                ? <small className="muted">O‘zgartirilmaydi</small>
                : <div className="access-actions">
                  <button type="button" className="secondary small" disabled={!!busy} onClick={() => { setResetId(resetId === account.id ? '' : account.id); setDeleteId(''); setReset({ password: '', confirm: '' }); setFormError(''); }}><KeyRound size={13} />Parol</button>
                  <button type="button" className="text-button danger-text" disabled={!!busy} onClick={() => { setDeleteId(deleteId === account.id ? '' : account.id); setResetId(''); setFormError(''); }}><Trash2 size={14} />O‘chirish</button>
                </div>}
            </td>
          </tr>)}
          {resetId && (() => { const account = accounts.find(row => row.id === resetId); return account ? <tr key={`${account.id}-reset`} className="access-editor"><td data-label="Parolni yangilash" colSpan={4}>
            <div className="access-inline">
              <b>Yangi parol · {account.name}</b>
              <input type="password" autoComplete="new-password" placeholder="Yangi parol (8+ belgi)" value={reset.password} onChange={event => setReset({ ...reset, password: event.target.value })} aria-label="Yangi parol" />
              <input type="password" autoComplete="new-password" placeholder="Parolni qaytaring" value={reset.confirm} onChange={event => setReset({ ...reset, confirm: event.target.value })} aria-label="Parolni qaytaring" />
              <button type="button" className="primary small" disabled={!!busy} onClick={() => void savePassword(account)}>{busy === account.id ? 'Saqlanmoqda…' : 'Saqlash'}</button>
            </div>
          </td></tr> : null; })()}
          {deleteId && (() => { const account = accounts.find(row => row.id === deleteId); return account ? <tr key={`${account.id}-delete`} className="access-editor"><td data-label="Hisobni o‘chirish" colSpan={4}>
            <div className="access-inline">
              <b>{account.name} kirishi butunlay o‘chiriladi. Davom etasizmi?</b>
              <button type="button" className="danger-button small" disabled={!!busy} onClick={() => void remove(account)}>{busy === account.id ? 'O‘chirilmoqda…' : 'Ha, o‘chirish'}</button>
              <button type="button" className="secondary small" disabled={!!busy} onClick={() => setDeleteId('')}>Bekor qilish</button>
            </div>
          </td></tr> : null; })()}
          </tbody>
        </table></div>}
        <div className="access-create">
          <div className="form-section-title"><div><h3>Yangi kirish</h3><small>Xodim yoki seh televizori uchun alohida email va parol</small></div></div>
          <div className="segmented tight access-role-switch">
            <button type="button" className={draft.role === 'worker' ? 'selected' : ''} onClick={() => setDraft({ ...draft, role: 'worker' })}><UserRound size={14} />Xodim</button>
            <button type="button" className={draft.role === 'display' ? 'selected' : ''} onClick={() => setDraft({ ...draft, role: 'display' })}><Tv size={14} />TV ekran</button>
          </div>
          <div className="form-grid">
            {draft.role === 'worker'
              ? <Field label="Xodim"><select value={draft.employeeId} onChange={event => setDraft({ ...draft, employeeId: event.target.value })}><option value="">Xodimni tanlang</option>{available.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></Field>
              : <Field label="Ekran nomi"><input value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} placeholder="Masalan, Seh ekrani" maxLength={120} /></Field>}
            <Field label="Email"><input type="email" autoComplete="off" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} placeholder="xodim@korxona.uz" maxLength={254} /></Field>
            <Field label="Parol"><input type="password" autoComplete="new-password" value={draft.password} onChange={event => setDraft({ ...draft, password: event.target.value })} placeholder="Kamida 8 belgi" /></Field>
            <Field label="Parolni qaytaring"><input type="password" autoComplete="new-password" value={draft.confirm} onChange={event => setDraft({ ...draft, confirm: event.target.value })} placeholder="Parolni qayta kiriting" /></Field>
          </div>
          {draft.role === 'worker' && <>
            <Field label="Huquqlar to‘plami (preset)">
              <select value={draft.preset} onChange={event => applyPreset(event.target.value as PresetKey | '')}>
                <option value="">Moslashtirilgan</option>
                {(Object.keys(PRESETS) as PresetKey[]).map(key => <option key={key} value={key}>{key}</option>)}
              </select>
            </Field>
            <div className="perm-groups">
              {PERMISSION_GROUPS.map(group => (
                <fieldset key={group.title}><legend>{group.title}</legend>
                  {group.keys.map(key => (
                    <label key={key}><input type="checkbox" checked={draft.permissions.includes(key)} onChange={() => togglePermission(key)} />{PERMISSION_LABEL[key]}</label>
                  ))}
                </fieldset>
              ))}
            </div>
          </>}
          {(draft.role === 'display' || draft.preset === 'Seh boshlig‘i') && activeWorkshops(workshops).length > 0 && <div className="scope-picker">
            <div className="form-section-title"><div><h3>Sehlar</h3><small>{draft.role === 'display' ? 'Bo‘sh qoldirilsa, ekran barcha sehlarni ko‘rsatadi' : 'Boshliq faqat tanlangan sehlarni boshqaradi'}</small></div></div>
            <div className="employee-picker">{activeWorkshops(workshops).map(ws => <label key={ws.id}>
              <input type="checkbox" checked={draft.scopeWorkshopIds.includes(ws.id)} onChange={event => setDraft({
                ...draft,
                scopeWorkshopIds: event.target.checked
                  ? [...draft.scopeWorkshopIds, ws.id]
                  : draft.scopeWorkshopIds.filter(id => id !== ws.id),
              })} />
              {ws.name}
            </label>)}</div>
          </div>}
          {draft.role === 'worker' && !available.length && <p className="subtle-note">Barcha faol xodimlar allaqachon bog‘langan. Avval «Xodimlar» bo‘limida yangi xodim qo‘shing.</p>}
          {formError && <div className="warning">{formError}</div>}
          {notice && <div className="info-note has-icon"><ShieldCheck size={18} />{notice}</div>}
          <div className="access-create-actions"><button type="button" className="primary" disabled={!!busy} onClick={() => void submit()}><Plus size={15} />{busy === 'create' ? 'Yaratilmoqda…' : 'Hisob yaratish'}</button></div>
        </div>
      </>}
  </Section>;
}
