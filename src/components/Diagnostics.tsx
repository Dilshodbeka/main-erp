import { useState } from 'react';
import { CircleAlert, Download } from 'lucide-react';
import {
  clearDiagnostics, diagnosticChecks, diagnosticFileName, downloadDiagnosticReport,
  lastExportAt, listDiagnostics, reminderDue, type DiagnosticEntry, type ReportSync,
} from '../diagnostics';
import type { Actor, State } from '../types';
import { Empty, Section } from '../ui';

export function DiagnosticsPanel({ state, actor, mode, build, sync, onExported }: {
  state: State; actor: Actor; mode: string; build: string; sync: ReportSync; onExported?: () => void;
}) {
  const [entries, setEntries] = useState<DiagnosticEntry[]>(() => listDiagnostics(localStorage));
  const [note, setNote] = useState('');
  const [due, setDue] = useState(() => reminderDue(localStorage));
  const checks = diagnosticChecks(state);
  const failed = checks.filter(check => check.count > 0);
  const last = lastExportAt(localStorage);

  const download = () => {
    const at = new Date().toISOString();
    downloadDiagnosticReport({ state, actor, mode, build, entries, sync, at }, localStorage);
    setEntries(listDiagnostics(localStorage));
    setDue(reminderDue(localStorage));
    setNote(`${diagnosticFileName(at)} yuklandi. Faylni mutaxassisga yuboring.`);
    onExported?.();
  };
  const clear = () => {
    clearDiagnostics(localStorage);
    setEntries([]);
    setNote('Yig‘ilgan xatolar tozalandi.');
  };

  return <Section title="Diagnostika va xatolar" hint="Haftalik tekshiruv: xatolar, sinxronizatsiya navbati va ma’lumot izchilligi. Faylda ism, telefon, manzil va summa yo‘q.">
    <div className="settings-facts">
      <span>Oxirgi hisobot<b>{last ? new Date(last).toLocaleString('uz-UZ') : 'hali yo‘q'}</b></span>
      <span>Yig‘ilgan xatolar<b>{entries.length}</b></span>
      <span>Muammoli tekshiruvlar<b className={failed.length ? 'debt' : 'positive'}>{failed.length}</b></span>
      <span>Rejim<b>{mode === 'cloud' ? 'Umumiy baza' : 'Lokal demo'}</b></span>
    </div>
    {due && <div className="warning has-icon"><CircleAlert size={18} />Haftalik hisobot vaqti keldi: yuklab oling va mutaxassisga yuboring.</div>}
    <div className="data-actions">
      <button className="secondary" onClick={download}><Download size={16} />Diagnostika hisobotini yuklab olish</button>
      <button className="text-button danger-text" onClick={clear} disabled={!entries.length}>Xatolarni tozalash</button>
      <small>{diagnosticFileName(new Date().toISOString())} · {state.revision}-reviziya</small>
    </div>
    {note && <p className="subtle-note">{note}</p>}
    <div className="table-scroll cardable"><table>
      <thead><tr><th>Tekshiruv</th><th className="right">Holat</th><th>Maslahat</th></tr></thead>
      <tbody>{checks.map(check => <tr key={check.id}>
        <td data-label="Tekshiruv">{check.title}</td>
        <td data-label="Holat" className="right"><b className={check.count ? 'debt' : 'positive'}>{check.count ? check.count : 'OK'}</b></td>
        <td data-label="Maslahat">{check.count ? check.hint : '—'}</td>
      </tr>)}</tbody>
    </table></div>
    <h3>Oxirgi xatolar</h3>
    {entries.length ? <div className="table-scroll cardable"><table>
      <thead><tr><th>Sana</th><th>Turi</th><th>Xabar</th></tr></thead>
      <tbody>{entries.slice(0, 10).map((entry, index) => <tr key={`${entry.at}-${index}`}>
        <td data-label="Sana">{new Date(entry.at).toLocaleString('uz-UZ')}</td>
        <td data-label="Turi">{entry.kind === 'error' ? 'Skript' : 'Va’da'}</td>
        <td data-label="Xabar">{entry.message}{entry.detail && <small>{entry.detail}</small>}</td>
      </tr>)}</tbody>
    </table></div> : <Empty text="Yig‘ilgan xatolar yo‘q" />}
    {entries.length > 10 && <p className="subtle-note">Faylda barcha {entries.length} yozuv bor.</p>}
  </Section>;
}
