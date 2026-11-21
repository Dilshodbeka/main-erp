import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { WorkshopSettings } from './components/WorkshopSettings';
import { WorkshopTabs } from './components/WorkshopTabs';
import { workshopTabs } from './workshop-view';
import type { State } from './types';

const second = { id: '00000000-0000-4000-8000-00000000b002', name: 'Bo‘yash sehi', active: true };

function twoWorkshops(over: Partial<State> = {}): State {
  return { ...emptyState(), workshops: [...emptyState().workshops, second], ...over };
}

describe('workshop tabs', () => {
  it('render nothing while the company keeps a single workshop', () => {
    const tabs = workshopTabs(emptyState().workshops, []);
    expect(renderToStaticMarkup(createElement(WorkshopTabs, { tabs, value: null, onChange: () => {} }))).toBe('');
  });

  it('offer Barchasi and every active workshop with counts', () => {
    const tabs = workshopTabs(twoWorkshops().workshops, []);
    const html = renderToStaticMarkup(createElement(WorkshopTabs, { tabs, value: null, onChange: () => {} }));
    expect(html).toContain('Barchasi');
    expect(html).toContain('Bo‘yash sehi');
    expect(html).toContain('sex-tabs');
  });
});

describe('workshop settings panel', () => {
  it('offers rename, deactivate and create', () => {
    const html = renderToStaticMarkup(createElement(WorkshopSettings, {
      state: twoWorkshops(), busy: false, run: async () => true,
    }));
    expect(html).toContain('Sehlar');
    expect(html).toContain('Bo‘yash sehi');
    expect(html).toContain('Seh qo‘shish');
  });
});
