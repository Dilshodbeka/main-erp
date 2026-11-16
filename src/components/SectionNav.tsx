import { useEffect, useState } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { panelsFor } from '../sections';

export interface SectionNavPage { id: string; title: string; icon: LucideIcon; group?: string }

export interface SectionNavProps {
  pages: SectionNavPage[];
  current: string;
  panel: string;
  admin: boolean;
  badges: Record<string, number>;
  onNavigate: (section: string, panel?: string) => void;
}

export function SectionNav({ pages, current, panel, admin, badges, onNavigate }: SectionNavProps) {
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    setCollapsed(list => list.filter(id => id !== current));
  }, [current]);

  return <nav aria-label="ERP bo‘limlari">
    {pages.map(page => {
      const panels = panelsFor(page.id, admin);
      const foldable = panels.length > 1;
      const active = current === page.id;
      const expanded = active && foldable && !collapsed.includes(page.id);
      const badge = badges[page.id] ?? 0;
      const toggle = () => {
        if (active) {
          if (!foldable) return;
          setCollapsed(list => list.includes(page.id) ? list.filter(id => id !== page.id) : [...list, page.id]);
          return;
        }
        onNavigate(page.id);
      };
      return <div className={active ? 'nav-section active' : 'nav-section'} key={page.id}>
        {page.group && <div className="nav-group">{page.group}</div>}
        <button className={active ? 'nav-item selected' : 'nav-item'} aria-expanded={foldable ? expanded : undefined} aria-controls={foldable ? `nav-sub-${page.id}` : undefined} onClick={toggle}>
          <page.icon size={19} /><span>{page.title}</span>{badge > 0 && <b>{badge}</b>}{foldable && <ChevronRight size={14} className="nav-chevron" />}
        </button>
        {expanded && <div className="nav-sub" id={`nav-sub-${page.id}`}>
          {panels.map(entry => <button key={entry.id} className={panel === entry.id ? 'selected' : ''} aria-current={panel === entry.id ? 'page' : undefined} onClick={() => onNavigate(page.id, entry.id)}>{entry.title}</button>)}
        </div>}
      </div>;
    })}
  </nav>;
}
