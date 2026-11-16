import { useState } from 'react';
import { ChevronDown, Ellipsis, X, type LucideIcon } from 'lucide-react';
import { panelsFor } from '../sections';

export interface MobileNavPage { id: string; title: string; icon: LucideIcon }

export interface MobileNavProps {
  pages: MobileNavPage[];
  current: string;
  panel: string;
  admin: boolean;
  badge?: number;
  onNavigate: (section: string, panel?: string) => void;
}

const primaryCount = 4;

export function MobileNav({ pages, current, panel, admin, badge = 0, onNavigate }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState('');
  const primary = pages.slice(0, primaryCount);
  const rest = pages.slice(primaryCount);
  const go = (section: string, target?: string) => { setOpen(false); onNavigate(section, target); };
  return (
    <>
      {open && <div className="mobile-sheet">
        <button className="mobile-sheet-shade" aria-label="Menyuni yopish" onClick={() => setOpen(false)} />
        <nav className="mobile-sheet-panel" aria-label="Boshqa bo‘limlar">
          <header><b>Bo‘limlar</b><button className="icon-button" aria-label="Menyuni yopish" onClick={() => setOpen(false)}><X size={18} /></button></header>
          {pages.map(page => {
            const panels = panelsFor(page.id, admin);
            const isExpanded = expanded === page.id;
            return <div className="mobile-sheet-group" key={page.id}>
              <div className="mobile-sheet-row">
                <button className={current === page.id ? 'mobile-sheet-item selected' : 'mobile-sheet-item'} onClick={() => go(page.id)}>
                  <page.icon size={19} /><span>{page.title}</span>{page.id === 'production' && badge > 0 && <b>{badge}</b>}
                </button>
                {panels.length > 1 && <button className="mobile-sheet-toggle" aria-label={`${page.title} panellarini ko‘rsatish`} aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? '' : page.id)}>
                  <ChevronDown size={18} />
                </button>}
              </div>
              {isExpanded && panels.length > 1 && <div className="mobile-sheet-sub">
                {panels.map(entry => <button key={entry.id} className={current === page.id && panel === entry.id ? 'selected' : ''} onClick={() => go(page.id, entry.id)}>{entry.title}</button>)}
              </div>}
            </div>;
          })}
        </nav>
      </div>}
      <nav className="mobile-nav" aria-label="Asosiy bo‘limlar">
        {primary.map(page => <button key={page.id} className={current === page.id ? 'mobile-nav-item selected' : 'mobile-nav-item'} aria-current={current === page.id ? 'page' : undefined} onClick={() => go(page.id)}>
          <page.icon size={20} /><span>{page.title}</span>{page.id === 'production' && badge > 0 && <b>{badge}</b>}
        </button>)}
        {rest.length > 0 && <button className={rest.some(page => page.id === current) ? 'mobile-nav-item selected' : 'mobile-nav-item'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          <Ellipsis size={20} /><span>Yana</span>
        </button>}
      </nav>
    </>
  );
}
