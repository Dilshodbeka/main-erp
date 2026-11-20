// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createTranslator, readLang, saveLang, translateDocument } from './translate';

const translate = createTranslator({
  'Buyurtmalar': 'Заказы',
  'Ishlab chiqarishda': 'В производстве',
  '{0} ta pozitsiya saqlandi.': 'Сохранено позиций: {0}.',
  'Holat: {0}': 'Статус: {0}',
  '{0} dan {1} gacha': 'с {0} по {1}',
  '{1} — {0} kun qoldi': '{0} дн. осталось — {1}',
  '{0}': 'never',
  'Mijoz, telefon yoki buyurtma…': 'Клиент, телефон или заказ…',
});

describe('translator', () => {
  it('translates exact text and keeps the surrounding spaces', () => {
    expect(translate('Buyurtmalar')).toBe('Заказы');
    expect(translate('  Buyurtmalar\n')).toBe('  Заказы\n');
    expect(translate('Noma’lum matn')).toBeNull();
    expect(translate('   ')).toBeNull();
  });
  it('fills templates and translates what the placeholders captured', () => {
    expect(translate('3 ta pozitsiya saqlandi.')).toBe('Сохранено позиций: 3.');
    expect(translate('Holat: Ishlab chiqarishda')).toBe('Статус: В производстве');
    expect(translate('Holat: ORD-0003')).toBe('Статус: ORD-0003');
    expect(translate('M11 20 dan M11 27 gacha')).toBe('с M11 20 по M11 27');
  });
  it('respects placeholder numbers when the translation reorders them', () => {
    expect(translate('Sinov — 5 kun qoldi')).toBe('5 дн. осталось — Sinov');
  });
  it('a bare placeholder is never a template', () => {
    expect(translate('Farrux og‘a')).toBeNull();
  });
});

describe('language choice', () => {
  it('defaults to Uzbek and remembers Russian', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    expect(readLang(storage)).toBe('uz');
    saveLang('ru', storage);
    expect(readLang(storage)).toBe('ru');
    expect(readLang({ getItem: () => { throw new Error('blocked'); } })).toBe('uz');
  });
});

describe('page translation', () => {
  it('translates existing and later content, attributes included, and leaves user input alone', async () => {
    document.body.innerHTML = '<main><h1>Buyurtmalar</h1><input placeholder="Mijoz, telefon yoki buyurtma…" value="Buyurtmalar"><textarea>Buyurtmalar</textarea><p data-no-translate>Buyurtmalar</p></main>';
    const stop = translateDocument(document.body, translate);
    expect(document.querySelector('h1')!.textContent).toBe('Заказы');
    expect(document.querySelector('input')!.getAttribute('placeholder')).toBe('Клиент, телефон или заказ…');
    expect(document.querySelector('input')!.value).toBe('Buyurtmalar');
    expect(document.querySelector('textarea')!.textContent).toBe('Buyurtmalar');
    expect(document.querySelector('p')!.textContent).toBe('Buyurtmalar');

    const added = document.createElement('span');
    added.textContent = '2 ta pozitsiya saqlandi.';
    document.querySelector('main')!.append(added);
    document.querySelector('h1')!.firstChild!.nodeValue = 'Ishlab chiqarishda';
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(added.textContent).toBe('Сохранено позиций: 2.');
    expect(document.querySelector('h1')!.textContent).toBe('В производстве');
    stop();
  });
});

describe('russian dictionary', () => {
  it('is built from the translation batches (run `npm run build:i18n` after editing them)', async () => {
    const built = (await import('../scripts/i18n/build.mjs?check' as string)).default as Record<string, string>;
    const shipped = (await import('./locales/ru.json')).default as Record<string, string>;
    expect(shipped).toEqual(built);
  });

  it('translates real interface texts, their parts and templates', async () => {
    const translate = createTranslator((await import('./locales/ru.json')).default as Record<string, string>);
    expect(translate('Buyurtma qabul qilish')).toBe('Принять заказ');
    expect(translate('Savdo va CRM · Buyurtmalar')).toBe('Продажи и CRM · Заказы');
    expect(translate('1,500,000 so‘m')).toBe('1,500,000 сум');
    expect(translate('noyabr · 2026')).toBe('ноябрь · 2026');
    expect(translate('Sinov muddati: 1 kun qoldi.')).toBe('Пробный период: осталось 1 дн.');
    expect(translate('ORD-0007')).toBeNull();
  });
});
