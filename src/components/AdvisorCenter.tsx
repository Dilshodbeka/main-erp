import { useMemo, useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, Clock, Copy, Download, Eye, Lightbulb, MessageSquare, RotateCcw, TrendingUp } from 'lucide-react';
import { insightsFor, insightSummary, insightText, isHidden, type Insight, type InsightArea, type InsightMarks, type InsightMarkStatus, type InsightPriority } from '../insights';
import { tr } from '../translate';
import { Empty, money, Title } from '../ui';
import type { State } from '../types';

const AREAS: { id: InsightArea; title: string }[] = [
  { id: 'stock', title: 'Ombor' }, { id: 'production', title: 'Ishlab chiqarish' }, { id: 'staff', title: 'Xodimlar' }, { id: 'finance', title: 'Moliya' },
];
const PRIORITY: Record<InsightPriority, { title: string; icon: typeof CircleAlert }> = {
  critical: { title: 'Muhim', icon: CircleAlert },
  growth: { title: 'Daromad nuqtasi', icon: TrendingUp },
  attention: { title: 'E’tibor', icon: Eye },
};

interface Props {
  state: State;
  marks: InsightMarks;
  onMark: (insight: Insight, status: InsightMarkStatus | null) => void;
  onGo: (section: string, panel?: string) => void;
  onOrder: (orderId: string) => void;
  onChat: (orderId: string, text: string) => Promise<void>;
  onNotice: (message: string, error?: boolean) => void;
}

function downloadList(insight: Insight): void {
  const head = ['Nomi', 'Miqdor', 'Birlik', 'Qiymat', 'Chegirma bilan narx', 'Harakatsiz kun'].map(tr);
  const cell = (value: string | number) => typeof value === 'number' ? String(value) : `"${value.replace(/"/g, '""')}"`;
  const csv = [head.map(cell).join(';'), ...(insight.list ?? []).map(row => row.map(cell).join(';'))].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `sotuv-royxati-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function AdvisorCenter({ state, marks, onMark, onGo, onOrder, onChat, onNotice }: Props) {
  const [area, setArea] = useState<InsightArea | 'all'>('all');
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState('');
  const nowIso = useMemo(() => new Date().toISOString(), [state.revision, marks]);
  const all = insightsFor(state);
  const open = all.filter(row => !isHidden(marks[row.key], nowIso));
  const hidden = all.filter(row => isHidden(marks[row.key], nowIso));
  const summary = insightSummary(open);
  const shown = (showHidden ? hidden : open).filter(row => area === 'all' || row.area === area);

  const act = (insight: Insight) => {
    if (insight.orderId) onOrder(insight.orderId);
    else { const [section, panel] = insight.route.split('/'); onGo(section, panel); }
  };
  const copy = async (insight: Insight) => {
    try { await navigator.clipboard.writeText(insightText(insight, tr)); onNotice('Tavsiya matni nusxalandi.'); }
    catch { onNotice('Nusxalab bo‘lmadi. Matnni qo‘lda belgilang.', true); }
  };
  const chat = async (insight: Insight) => {
    if (!insight.orderId) return;
    setBusy(insight.key);
    try { await onChat(insight.orderId, insightText(insight, tr)); onNotice('Buyurtma chatiga yuborildi — ijrochilar ko‘radi.'); }
    catch { onNotice('Chatga yuborib bo‘lmadi. Qayta urinib ko‘ring.', true); }
    finally { setBusy(''); }
  };

  return <>
    <Title eyebrow="BOSHQARUV / TAVSIYALAR" title="Bugun nimaga e’tibor berish kerak." description="Tizim hisobdagi yozuvlarni tekshiradi: muzlagan pul, kechikayotgan buyurtma, ortiqcha yuklangan xodim, qarzdor mijoz. Har bir raqam — yozuvlardan, taxmin emas." />
    <div className="advisor-summary">
      <div className="advisor-stat critical"><span><CircleAlert size={16} />Muhim</span><strong>{summary.critical}</strong><small>{summary.atRisk > 0 ? <>Xavf ostida: {money(summary.atRisk)}</> : 'Shoshilinch holat yo‘q'}</small></div>
      <div className="advisor-stat growth"><span><TrendingUp size={16} />Daromad nuqtasi</span><strong>{summary.growth}</strong><small>{summary.toGain > 0 ? <>Ishga solish mumkin: {money(summary.toGain)}</> : 'Hozircha imkoniyat topilmadi'}</small></div>
      <div className="advisor-stat attention"><span><Eye size={16} />E’tibor</span><strong>{summary.attention}</strong><small>Kuzatib turish kerak</small></div>
    </div>
    <div className="advisor-filters">
      <div className="advisor-chips" role="group" aria-label="Bo‘lim bo‘yicha filtr">
        <button type="button" className={area === 'all' ? 'selected' : ''} onClick={() => setArea('all')}>Hammasi<i>{(showHidden ? hidden : open).length}</i></button>
        {AREAS.map(row => {
          const count = (showHidden ? hidden : open).filter(item => item.area === row.id).length;
          return <button type="button" key={row.id} className={area === row.id ? 'selected' : ''} onClick={() => setArea(row.id)}>{row.title}<i>{count}</i></button>;
        })}
      </div>
      {(hidden.length > 0 || showHidden) && <button type="button" className="text-button" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Faol tavsiyalar' : <>Yashirilganlar · {hidden.length}</>}</button>}
    </div>
    {!shown.length && <section className="panel"><Empty text={showHidden ? 'Yashirilgan tavsiyalar yo‘q' : all.length ? 'Bu bo‘limda tavsiya yo‘q' : 'Hozircha tavsiya yo‘q — hammasi rejada. Ma’lumot ko‘paygan sari tizim o‘zi xabar beradi.'} /></section>}
    <div className="advisor-list">
      {shown.map(insight => {
        const meta = PRIORITY[insight.priority];
        const mark = marks[insight.key];
        return <article className={`advisor-card ${insight.priority}`} key={insight.key}>
          <header>
            <span className="advisor-priority"><meta.icon size={14} />{meta.title}</span>
            <span className="advisor-area">{AREAS.find(row => row.id === insight.area)?.title}</span>
            {insight.effect > 0 && insight.effectLabel && <span className="advisor-effect"><small>{insight.effectLabel}</small><b>{money(insight.effect)}</b></span>}
          </header>
          <h3>{insight.title}</h3>
          <p className="advisor-facts">{insight.facts}</p>
          <p className="advisor-advice"><Lightbulb size={16} /><span>{insight.advice}</span></p>
          {insight.details.length > 0 && <details className="advisor-details"><summary>Tafsilotlar · {insight.details.length}</summary><ul>{insight.details.map((row, index) => <li key={index}><b>{row.label}</b><span>{row.value}</span></li>)}</ul></details>}
          <footer>
            <button type="button" className="primary" onClick={() => act(insight)}><ArrowUpRight size={15} />{insight.orderId ? 'Buyurtmani ochish' : 'Bo‘limga o‘tish'}</button>
            {insight.orderId && <button type="button" className="secondary" disabled={busy === insight.key} onClick={() => void chat(insight)}><MessageSquare size={15} />Chatga yuborish</button>}
            {insight.list && <button type="button" className="secondary" onClick={() => downloadList(insight)}><Download size={15} />Sotuv ro‘yxati</button>}
            <button type="button" className="secondary" onClick={() => void copy(insight)}><Copy size={15} />Nusxalash</button>
            <span className="advisor-spacer" />
            {showHidden
              ? <button type="button" className="text-button" onClick={() => onMark(insight, null)}><RotateCcw size={14} />{mark?.status === 'done' ? 'Bajarilgan — qaytarish' : 'Kechiktirilgan — qaytarish'}</button>
              : <><button type="button" className="text-button" onClick={() => onMark(insight, 'later')}><Clock size={14} />Keyinroq</button><button type="button" className="text-button done" onClick={() => onMark(insight, 'done')}><Check size={14} />Bajarildi</button></>}
          </footer>
        </article>;
      })}
    </div>
    <p className="subtle-note advisor-note">«Bajarildi» kartani 7 kunga, «Keyinroq» 2 kunga yashiradi. Muammo saqlanib qolsa, karta o‘zi qaytadi.</p>
  </>;
}
