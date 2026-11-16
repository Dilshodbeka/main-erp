import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuidePanel, ManualPanel } from './components/Guide';
import { emptyState } from './domain';
import { pageGuide } from './guide';
import { manualTopics } from './manual';
import type { Actor } from './types';

const admin: Actor = { id: 'u1', name: 'Egasi', role: 'admin', companyId: 'c1' };

describe('manual panel', () => {
  it('renders every topic with its sections and steps', () => {
    const html = renderToStaticMarkup(createElement(ManualPanel, { topics: manualTopics }));
    for (const topic of manualTopics) {
      expect(html).toContain(topic.title);
      expect(html).toContain(topic.summary);
      for (const section of topic.sections) {
        expect(html).toContain(section.title);
        expect(html).toContain(section.body);
      }
    }
  });

  it('keeps the help panel open on steps and offers the manual tab', () => {
    const guide = pageGuide(emptyState(), 'dashboard', admin);
    const html = renderToStaticMarkup(createElement(GuidePanel, { guide, onAction: () => {}, close: () => {} }));
    expect(html).toContain('Yordamchi · Umumiy ko‘rinish');
    expect(html).toContain('Qadamlar');
    expect(html).toContain('Qo‘llanma');
    expect(html).toContain('role="tab"');
  });
});
