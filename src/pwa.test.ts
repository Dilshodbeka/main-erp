import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isIos, isStandalone, shouldShowInstallBanner } from './pwa';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8')) as Record<string, unknown>;

describe('manifest.json', () => {
  it('объявляет standalone-установку с именем и иконками', () => {
    expect(manifest.name).toBe('Aliya');
    expect(manifest.short_name).toBe('Aliya');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#172e2a');
    const icons = manifest.icons as Array<{ src: string; sizes: string }>;
    expect(icons.map(i => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });
});

describe('install banner', () => {
  it('показывает баннер, когда установка доступна и не standalone', () => {
    expect(shouldShowInstallBanner({ standalone: false, dismissed: false, available: true })).toBe(true);
  });
  it('скрывает в standalone, после отклонения или без события', () => {
    expect(shouldShowInstallBanner({ standalone: true, dismissed: false, available: true })).toBe(false);
    expect(shouldShowInstallBanner({ standalone: false, dismissed: true, available: true })).toBe(false);
    expect(shouldShowInstallBanner({ standalone: false, dismissed: false, available: false })).toBe(false);
  });
  it('определяет standalone и iOS без window', () => {
    expect(isStandalone(() => false)).toBe(false);
    expect(isIos('')).toBe(false);
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
  });
});
