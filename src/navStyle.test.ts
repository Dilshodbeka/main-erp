import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './mobileStyle';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function rulesFor(selector: string) {
  return cssRules(css).filter(rule => rule.selector === selector);
}

describe('sidebar submenu styles', () => {
  it('rotates the chevron only while the section is expanded', () => {
    const expanded = rulesFor('.nav-item[aria-expanded="true"] .nav-chevron');
    expect(expanded.some(rule => rule.body.includes('rotate(90deg)'))).toBe(true);
    expect(css).not.toContain('.nav-item.selected .nav-chevron');
  });

  it('draws a guide rail for the submenu', () => {
    const rail = rulesFor('.nav-sub::before');
    expect(rail.some(rule => rule.body.includes('left:') && rule.body.includes('width:2px'))).toBe(true);
  });

  it('marks the active submenu entry with a dot', () => {
    const dot = rulesFor('.nav-sub button::before');
    expect(dot.some(rule => rule.body.includes('border-radius:50%'))).toBe(true);
    const active = rulesFor('.nav-sub button.selected::before');
    expect(active.some(rule => rule.body.includes('background:var(--green)'))).toBe(true);
  });

  it('animates the reveal and disables motion when reduced motion is requested', () => {
    expect(rulesFor('.nav-sub').some(rule => rule.body.includes('animation'))).toBe(true);
    const reduced = cssRules(css).filter(rule => rule.media.includes('prefers-reduced-motion'));
    expect(reduced.some(rule => rule.selector === '.nav-sub' && rule.body.includes('animation:none'))).toBe(true);
  });
});
