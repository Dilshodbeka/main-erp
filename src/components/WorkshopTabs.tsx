import type { WorkshopTab } from '../workshop-view';

export function WorkshopTabs({ tabs, value, onChange }: {
  tabs: WorkshopTab[]; value: string | null; onChange: (id: string | null) => void;
}) {
  if (tabs.length < 2) return null;
  return <div className="segmented tight sex-tabs" role="tablist" aria-label="Sex tanlovi">
    {tabs.map(tab => <button
      key={tab.id ?? 'all'}
      type="button"
      role="tab"
      aria-selected={value === tab.id}
      className={value === tab.id ? 'selected' : ''}
      onClick={() => onChange(tab.id)}
    >{tab.name}<b className="sex-tab-count">{tab.count}</b></button>)}
  </div>;
}
