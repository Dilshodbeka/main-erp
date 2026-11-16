import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LayoutDashboard, Settings, Users } from 'lucide-react';
import { SectionNav } from './components/SectionNav';

const pages = [
  { id: 'dashboard', title: 'Umumiy ko‘rinish', icon: LayoutDashboard },
  { id: 'orders', title: 'Savdo va CRM', icon: Users },
  { id: 'settings', title: 'Sozlamalar', icon: Settings },
];

const html = (current: string, panel: string) => renderToStaticMarkup(createElement(SectionNav, {
  pages, current, panel, admin: true, badges: {}, onNavigate: () => {},
}));

describe('sidebar submenu', () => {
  it('marks the open section and links its submenu', () => {
    const markup = html('settings', 'baza');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-controls="nav-sub-settings"');
    expect(markup).toContain('id="nav-sub-settings"');
  });

  it('keeps other sections collapsed and exposes the toggle contract', () => {
    const markup = html('dashboard', '');
    expect(markup).toContain('aria-controls="nav-sub-settings"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('id="nav-sub-settings"');
  });
});
