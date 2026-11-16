import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './mobileStyle';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function rulesFor(selector: string) {
  return cssRules(css).filter(r => r.selector === selector);
}

describe('pwa styles', () => {
  it('определяет shimmer-анимацию скелетона', () => {
    expect(css).toMatch(/@keyframes\s+shimmer/);
    const row = rulesFor('.skeleton-row');
    expect(row.some(r => r.body.includes('animation'))).toBe(true);
  });

  it('отключает shimmer при reduced-motion', () => {
    const reduced = cssRules(css).filter(r => r.media.includes('prefers-reduced-motion'));
    expect(reduced.some(r => r.body.includes('animation:none'))).toBe(true);
  });

  it('добавляет микроанимации и глушит их при reduced-motion', () => {
    expect(css).toContain('.kanban-card:active');
    expect(css).toContain('.mobile-nav-item:active');
    const reduced = cssRules(css).filter(r => r.media.includes('prefers-reduced-motion'));
    expect(reduced.some(r => r.body.includes('transform:none'))).toBe(true);
  });
});
