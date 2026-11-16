import type { Panel } from '../sections';

export function PanelBar({ panels, current, onSelect }: { panels: Panel[]; current: string; onSelect: (id: string) => void }) {
  if (panels.length < 2) return null;
  return <div className="panel-bar" role="tablist" aria-label="Bo‘lim panellari">
    {panels.map(panel => <button key={panel.id} role="tab" aria-selected={current === panel.id} className={current === panel.id ? 'selected' : ''} onClick={() => onSelect(panel.id)}>{panel.title}</button>)}
  </div>;
}
