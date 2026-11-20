import { useEffect, useRef, type ReactNode } from 'react';
import { useSheetDrag } from './sheet-drag';
import { X, ArrowUpRight, Inbox, type LucideIcon } from 'lucide-react';
import type { Status } from './types';
import { formatDate, formatDateTime, formatMoney, formatQty, statusLabel, translateError } from './i18n';

export const money = formatMoney;
export const num = formatQty;
export const date = formatDate;
export const dateTime = formatDateTime;
export const statuses: Record<Status, string> = {
  draft: statusLabel('draft'), production: statusLabel('production'), ready: statusLabel('ready'),
  shipped: statusLabel('shipped'), delivered: statusLabel('delivered'), cancelled: statusLabel('cancelled'),
};
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Amalni bajarib bo‘lmadi';
  return translateError(message);
}
export function Badge({ status }: { status: Status }) { return <span className={`badge ${status}`}><i />{statuses[status]}</span>; }
export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel"><header className="panel-header"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{action}</header>{children}</section>;
}
export function Metric({ label, value, detail, icon: Icon, accent = false }: { label: string; value: ReactNode; detail: ReactNode; icon: LucideIcon; accent?: boolean }) {
  return <div className={`metric ${accent ? 'accent' : ''}`}><div className="metric-top"><span>{label}</span><Icon size={18} /></div><strong>{value}</strong><small>{detail}</small></div>;
}
export function Empty({ text = 'Hozircha yozuvlar yo‘q', action }: { text?: string; action?: ReactNode }) { return <div className="empty"><Inbox size={28} /><p>{text}</p>{action}</div>; }
export function Title({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
export function Dialog({ title, subtitle, close, children, wide = false, className = '' }: { title: string; subtitle?: string; close: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose.current();
      if (event.key !== 'Tab') return;
      const all = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
      if (!all?.length) return;
      const first = all[0]; const last = all[all.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { last.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  const sheetDrag = useSheetDrag(ref, () => onClose.current());
  return <div className="modal-backdrop"><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`dialog ${wide ? 'wide' : ''} ${className}`}><header {...sheetDrag}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Yopish" onClick={close}><X size={20} /></button></header>{children}</div></div>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
export function Amount({ name = 'amount', label = 'Summa, UZS', defaultValue, max }: { name?: string; label?: string; defaultValue?: number; max?: number }) { return <Field label={label}><input name={name} type="number" step="0.01" min="0.01" max={max} defaultValue={defaultValue} required /></Field>; }
export function AccountField({ name = 'account' }: { name?: string }) { return <Field label="Hisob"><select name={name}><option value="cash">Naqd pul</option><option value="bank">Bank / karta</option></select></Field>; }
export function GoButton({ onClick, children }: { onClick: () => void; children: ReactNode }) { return <button type="button" className="text-button" onClick={onClick}>{children}<ArrowUpRight size={15} /></button>; }
