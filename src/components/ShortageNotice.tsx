import { CircleAlert } from 'lucide-react';
import { unitText } from '../i18n';
import { GoButton, num } from '../ui';
import type { ShortageRow } from '../shortage';

export function ShortageNotice({ rows, onGo }: { rows: ShortageRow[]; onGo?: (section: string, panel?: string) => void }) {
  if (!rows.length) return null;
  return <div className="shortage">
    <b><CircleAlert size={14} />Materiallar yetishmaydi ({rows.length}):</b>
    {rows.map(row => <span className="shortage-row" key={row.itemId}>{row.name} · kerak {num(row.needed)} {unitText(row.unit)} · omborda {num(row.stock)} · band {num(row.reserved)} · yetishmaydi <i>{num(row.short)}</i></span>)}
    {onGo && <span className="shortage-links"><GoButton onClick={() => onGo('warehouse', 'tasniflagich')}>Omborga</GoButton><GoButton onClick={() => onGo('purchases', 'xaridlar')}>Xaridga</GoButton></span>}
  </div>;
}
