import { useEffect, useState } from 'react';
import { dateLocale } from '../i18n';
import { CloudDownload, CloudUpload, Download, HardDriveDownload, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { backupName, downloadBackup, listSnapshots, readSnapshot, saveSnapshot, type BackupFile, type BackupMeta } from '../backup';
import { playbackCopy, type CopyMeta } from '../../supabase/functions/_shared/backup';
import {
  CONFIRM_WORD,
  CloudBackupError,
  cloudBackupErrorText,
  createCloudCopy,
  listCloudCopies,
  readCloudCopy,
  restoreCloudCopy,
  verifyCloudCopy,
  type CloudStatus,
} from '../cloudBackup';
import { copyBanner, isConfirmed, previewRows } from '../copyPanel';
import type { State } from '../types';
import { Empty, Section } from '../ui';

const kiloBytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
const stamp = (exportedAt: string) => {
  const parsed = Date.parse(exportedAt);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(dateLocale) : exportedAt;
};
const cloudErrorText = (error: unknown) =>
  error instanceof CloudBackupError ? cloudBackupErrorText(error.code) : error instanceof Error ? error.message : 'Nusxa bilan muammo chiqdi.';

function saveFile(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

interface Preview { key: string; ok: boolean; problems: string[]; rows: { table: string; rows: number }[] }

export function BackupPanel({ state, cloud, onRestored }: { state: State; cloud: boolean; onRestored?: () => void }) {
  const [snapshots, setSnapshots] = useState<BackupMeta[]>(() => listSnapshots(localStorage));
  const [note, setNote] = useState('');

  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [loading, setLoading] = useState(cloud);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [restoreKey, setRestoreKey] = useState('');
  const [word, setWord] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setStatus(await listCloudCopies());
    } catch (e) {
      setError(cloudErrorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (cloud) void refresh(); }, [cloud]);

  const store = async () => {
    setBusy('put');
    setError('');
    setNotice('');
    try {
      const copy = await createCloudCopy(state);
      setNotice(`Bulutga nusxa olindi: versiya ${copy.revision}, ${kiloBytes(copy.bytes)}.`);
      await refresh();
    } catch (e) {
      setError(cloudErrorText(e));
    } finally {
      setBusy('');
    }
  };

  const check = async (meta: CopyMeta) => {
    setBusy(meta.key);
    setError('');
    setNotice('');
    try {
      const [verified, document] = await Promise.all([verifyCloudCopy(meta.key), readCloudCopy(meta.key)]);
      const played = playbackCopy(document);
      setPreview({ key: meta.key, ok: verified.ok && played.ok, problems: verified.problems, rows: previewRows(played.counts) });
    } catch (e) {
      setError(cloudErrorText(e));
      setPreview(null);
    } finally {
      setBusy('');
    }
  };

  const download = async (meta: CopyMeta) => {
    setBusy(meta.key);
    setError('');
    try {
      const document = await readCloudCopy(meta.key);
      saveFile(meta.key.split('/').pop() || `aliya-erp-r${document.revision}.json`, JSON.stringify(document, null, 2));
    } catch (e) {
      setError(cloudErrorText(e));
    } finally {
      setBusy('');
    }
  };

  const restore = async (meta: CopyMeta) => {
    setBusy(`restore:${meta.key}`);
    setError('');
    setNotice('');
    try {
      const result = await restoreCloudCopy({ key: meta.key, expectedRevision: state.revision, confirm: word, state });
      setNotice(`Korxona ${stamp(meta.exportedAt)} nusxasidan qaytarildi. Hozirgi versiya ${result.revision}. Qaytarishdan oldingi holat ${result.safetyCopy ? `bulutga saqlandi (versiya ${result.safetyCopy.revision})` : 'saqlanmadi — ehtiyot chorasini qayta tekshiring'}.`);
      setRestoreKey('');
      setWord('');
      setPreview(null);
      await refresh();
      onRestored?.();
    } catch (e) {
      setError(cloudErrorText(e));
    } finally {
      setBusy('');
    }
  };

  const create = () => {
    const now = new Date().toISOString();
    const rows = saveSnapshot(localStorage, state, now);
    setSnapshots(rows);
    setNote(`Nusxa yaratildi. Brauzerda ${rows.length} ta nusxa saqlanadi.`);
  };
  const downloadLocal = (backup: BackupFile | null) => {
    if (!backup) { setNote('Nusxa o‘qilmadi — fayl shikastlangan bo‘lishi mumkin.'); return; }
    saveFile(backupName(backup), JSON.stringify(backup, null, 2));
  };

  const banner = copyBanner(status?.latest ?? null, new Date().toISOString());

  return <>
    <Section title="Bulut zaxira nusxasi" hint="Butun korxona fayli alohida yopiq saqlagichda turadi. Har kuni bitta nusxa: 30 kun davomida kunlik, keyin 12 oy davomida oyiga bittadan.">
      {!cloud
        ? <div className="info-note has-icon"><ShieldCheck size={18} />Demo rejimda bulutga chiqilmaydi: ma’lumotlar faqat shu brauzerda. Umumiy baza ulangach, bu bo‘lim avtomatik kunlik nusxa, tekshiruv va qaytarishni ko‘rsatadi.</div>
        : <>
          <div className={banner.tone === 'ok' ? 'info-note' : 'warning'}>
            {banner.tone === 'ok' ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}{banner.text}
          </div>
          <div className="data-actions">
            <button type="button" className="primary" disabled={!!busy || loading} onClick={() => void store()}>
              <CloudUpload size={16} />{busy === 'put' ? 'Saqlanmoqda…' : 'Bulutga nusxa olish'}
            </button>
            <button type="button" className="secondary small" disabled={!!busy || loading} onClick={() => void refresh()}><RefreshCw size={14} />Ro‘yxatni yangilash</button>
            <small>Versiya {state.revision} · {status?.copies.length ?? 0} ta bulut nusxasi</small>
          </div>
          {loading && <p className="subtle-note">Bulut nusxalari yuklanmoqda…</p>}
          {error && <div className="warning">{error}</div>}
          {notice && <div className="info-note has-icon"><ShieldCheck size={18} />{notice}</div>}
          {!loading && status && !status.copies.length && <Empty text="Bulutda hali nusxa yo‘q. Yuqoridagi tugma bilan birinchi nusxani oling." />}
          {status && status.copies.length > 0 && <div className="table-scroll cardable"><table>
            <thead><tr><th>Sana</th><th className="right">Versiya</th><th className="right">Hajm</th><th className="right">Amallar</th></tr></thead>
            <tbody>{status.copies.map(meta => <tr key={meta.key}>
              <td data-label="Sana"><b>{stamp(meta.exportedAt)}</b></td>
              <td data-label="Versiya" className="right">{meta.revision}</td>
              <td data-label="Hajm" className="right">{kiloBytes(meta.bytes)}</td>
              <td data-label="Amallar" className="right">
                <div className="access-actions">
                  <button type="button" className="secondary small" disabled={!!busy} onClick={() => void check(meta)}>{busy === meta.key ? 'Tekshirilmoqda…' : 'Tekshirish'}</button>
                  <button type="button" className="secondary small" disabled={!!busy} onClick={() => void download(meta)}><CloudDownload size={13} />Yuklab olish</button>
                  <button type="button" className="text-button danger-text" disabled={!!busy} onClick={() => { setRestoreKey(restoreKey === meta.key ? '' : meta.key); setWord(''); setError(''); setPreview(null); }}><RotateCcw size={14} />Qaytarish</button>
                </div>
              </td>
            </tr>)}
            {restoreKey && (() => { const meta = status.copies.find(row => row.key === restoreKey); return meta ? <tr key={`${meta.key}-restore`} className="access-editor"><td data-label="Qaytarish" colSpan={4}>
              <div className="access-inline">
                <b>{stamp(meta.exportedAt)} · versiya {meta.revision} nusxasi qaytariladi. Joriy {state.revision} versiyadagi holat butunlay almashtiriladi.</b>
                <input value={word} onChange={event => setWord(event.target.value)} placeholder={`Tasdiq: ${CONFIRM_WORD}`} aria-label="Tasdiq so‘zi" />
                <button type="button" className="danger-button small" disabled={!isConfirmed(word) || !!busy} onClick={() => void restore(meta)}>
                  {busy === `restore:${meta.key}` ? 'Qaytarilmoqda…' : 'Ha, qaytarish'}
                </button>
                <button type="button" className="secondary small" disabled={!!busy} onClick={() => { setRestoreKey(''); setWord(''); }}>Bekor qilish</button>
              </div>
              <p className="subtle-note">Qaytarishdan oldin joriy holat avtomatik tarzda bulutga nusxa bo‘lib saqlanadi. Tasdiq uchun oyinga aynan “{CONFIRM_WORD}” deb yozing.</p>
            </td></tr> : null; })()}
            </tbody>
          </table></div>}
          {preview && <div className={preview.ok ? 'info-note has-icon' : 'warning has-icon'}>
            {preview.ok ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
            {preview.ok
              ? <span>Sandbox tekshiruvi o‘tdi: {preview.rows.length} ta jadval, {preview.rows.reduce((sum, row) => sum + row.rows, 0)} ta satr qaytariladi ({preview.rows.map(row => `${row.table.replace('erp_', '')} ${row.rows}`).join(', ')}).</span>
              : <span>Sandbox tekshiruvi o‘tmadi. Bu nusxani qaytarmang: {preview.problems.join(' ')}</span>}
          </div>}
        </>}
    </Section>

    <Section title="Zaxira nusxalar (brauzer)" hint="JSON fayl — qo‘shimcha nusxa. Bu brauzerdagi nusxalar umumiy bazadagi zaxiraning o‘rnini bosmaydi.">
      <div className="data-actions">
        <button className="secondary" onClick={() => downloadBackup(state)}><Download size={16} />Joriy holatni yuklab olish</button>
        <button className="secondary" onClick={create}><HardDriveDownload size={16} />Brauzerda nusxa yaratish</button>
        <small>Versiya {state.revision} · {snapshots.length} ta saqlangan nusxa</small>
      </div>
      {note && <p className="subtle-note">{note}</p>}
      <div className="data-actions"><div className="info-note has-icon"><ShieldCheck size={17} />{cloud ? 'Bulut nusxasi yuqoridagi bo‘limda. Brauzerdagi nusxalar faqat shu qurilma uchun tezkor chora — telefon almashtirsangiz yo‘qoladi.' : 'Demo rejimda ma’lumotlar faqat shu brauzerda. Muhim ishni JSON faylga yuklab, xavfsiz joyda saqlang.'}</div></div>
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Sana</th><th className="right">Versiya</th><th className="right">Hajm</th><th /></tr></thead>
        <tbody>{snapshots.map(meta => <tr key={meta.key}>
          <td data-label="Sana"><b>{new Date(meta.exportedAt).toLocaleString(dateLocale)}</b></td>
          <td data-label="Versiya" className="right">{meta.revision}</td>
          <td data-label="Hajm" className="right">{kiloBytes(meta.bytes)}</td>
          <td data-label="Amallar"><button className="icon-button" aria-label={`Nusxani yuklab olish ${meta.exportedAt}`} title="Yuklab olish" onClick={() => downloadLocal(readSnapshot(localStorage, meta.key))}><Download size={16} /></button></td>
        </tr>)}</tbody>
      </table></div>
      {!snapshots.length && <Empty text="Brauzerda hali nusxa yo‘q. Har kuni ilova ochilganda avtomatik nusxa yaratiladi." />}
    </Section>
  </>;
}
