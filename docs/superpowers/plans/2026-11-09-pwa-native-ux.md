# PWA + Native-Feel UX — план реализации (Часть 1)

> **Для agentic-исполнителей:** REQUIRED SUB-SKILL: используйте superpowers:executing-plans (inline, БЕЗ субагентов — владелец запретил субагентов). Шаги используют checkbox (`- [ ]`). Каждый шаг завершается проверкой (не commit — рабочая папка НЕ Git-репозиторий).

**Цель:** сделать Aliya ERP устанавливаемым PWA с нативным ощущением: manifest + иконки + установка, офлайн, вибрация, скелетоны, свайпы, микроанимации. Без изменения доменной логики.

**Архитектура:** аддитивный слой — новые модули `src/haptics.ts`, `src/swipe.ts`, `src/Skeleton.tsx`, `src/pwa.ts`, `public/manifest.json` + иконки; точечные вставки в `index.html`, `src/App.tsx`, `src/styles.css`.

**Тех-стек:** React 19 + TypeScript strict, Vite 6, Vitest 3 (node-окружение, без jsdom).

**Спецификация:** `docs/superpowers/specs/2026-11-09-pwa-native-ux-design.md` — план аргументирует от неё; спецификация выше плана.

## Global Constraints

- Не Git-репозиторий: никаких commit/веток; шаг завершается проверкой.
- Без субагентов: реализация inline, TDD (RED → GREEN).
- Тесты: Vitest в node-окружении (`npx vitest run <file> -t "<pattern>"`).
- UI на узбекской латинице, суммы UZS. Точные строки ниже — копировать дословно.
- Деплой (`npm run deploy`) — только по отдельному разрешению владельца; в этом плане НЕ выполняется.
- `prefers-reduced-motion: reduce` отключает анимации (shimmer, пружина, вибрация).
- Вибрация — только Android (`navigator.vibrate`), на iPhone/ПК — no-op.
- CSS-регрессии через существующий парсер `src/mobileStyle.ts` (паттерн как в `src/orderEditorStyle.test.ts`).

---

## Rulings (решения по неоднозначностям)

- **R1. «Arxiv» в свайпе заказа** = открытие существующей модалки подтверждения `cancelOrder` (`show('cancelOrder', o.id)`), а не мгновенная отмена. Свайп не выполняет разрушающих действий сразу.
- **R2. «Tahrirlash» в свайпе кассы** = у кассы нет модалки редактирования; единственное безопасное действие строки — стorno. Свайп кассы открывает существующую модалку `reverse` («Storno»). Отклонение от буквы спеки, дух сохранён (безопасное действие через существующий поток).
- **R3. Скелетоны** применяются там, где реально есть состояние загрузки. Приложение — единый снапшот (не per-list fetch): загрузка бывает только при начальном `snapshot()` (state === null) и фоновом `load()`. Скелетон ставится в login-shell вместо текста «Tizim yuklanmoqda». Списки рендерятся синхронно из локального state — искусственные скелетоны на списках не нужны.

---

## File Structure

| Файл | Ответственность |
|------|-----------------|
| `public/manifest.json` (create) | Web App Manifest |
| `public/icons/icon-192.png`, `public/icons/icon-512.png` (create) | иконки установки |
| `src/haptics.ts` (create) | паттерны вибрации + безопасный вызов |
| `src/swipe.ts` (create) | чистая функция порога + компонент Swipeable |
| `src/Skeleton.tsx` (create) | компонент скелетона |
| `src/pwa.ts` (create) | логика баннера установки и тоста обновления |
| `src/haptics.test.ts` (create) | тесты вибрации |
| `src/swipe.test.ts` (create) | тесты порога свайпа |
| `src/pwa.test.ts` (create) | тесты логики баннера |
| `src/pwaStyle.test.ts` (create) | CSS-регрессии (skeleton, swipe, reduced-motion) |
| `index.html` (modify) | ссылка на manifest, apple-меты, иконка |
| `src/App.tsx` (modify) | haptic в apply(), баннер установки, Swipeable/Skeleton вставки |
| `src/styles.css` (modify) | shimmer, микроанимации, свайп-кнопки, баннер, reduced-motion |

---

### Task 1: Manifest и иконки

**Файлы:**
- Create: `public/manifest.json`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png`
- Modify: `index.html`
- Test: `src/pwa.test.ts` (manifest-структура)

**Интерфейсы:**
- Produces: `public/manifest.json` с полями `name`, `short_name`, `display: "standalone"`, `icons` (192/512), `theme_color: "#172e2a"`.

- [ ] **Шаг 1: RED — тест структуры manifest**

Создать `src/pwa.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function manifest() {
  const raw = readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('manifest.json', () => {
  it('объявляет standalone-установку с именем и иконками', () => {
    const m = manifest();
    expect(m.name).toBe('Aliya');
    expect(m.short_name).toBe('Aliya');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#172e2a');
    const icons = m.icons as Array<{ src: string; sizes: string }>;
    expect(icons.map(i => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });
});
```

- [ ] **Шаг 2: Запустить тест — проверить, что падает**

Run: `npx vitest run src/pwa.test.ts`
Expected: FAIL — `ENOENT` (файл `public/manifest.json` не существует).

- [ ] **Шаг 3: Создать manifest.json**

```json
{
  "name": "Aliya",
  "short_name": "Aliya",
  "description": "Mebel ishlab chiqarishni boshqarish",
  "lang": "uz",
  "dir": "ltr",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "theme_color": "#172e2a",
  "background_color": "#fdfefb",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]
}
```

- [ ] **Шаг 4: Сгенерировать иконки**

Через ImageGen создать две PNG-иконки: тёмно-зелёный (#172e2a) скруглённый квадрат, белая буква «A» по центру (как бренд-марка приложения). Сохранить как `public/icons/icon-192.png` (192×192) и `public/icons/icon-512.png` (512×512).

- [ ] **Шаг 5: Подключить manifest и apple-меты в index.html**

В `<head>` после `<meta name="theme-color" ...>` добавить:

```html
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

- [ ] **Шаг 6: Проверить GREEN**

Run: `npx vitest run src/pwa.test.ts`
Expected: PASS.

- [ ] **Шаг 7: Проверка сборки**

Run: `npx tsc -b --pretty false && npm run build`
Expected: exit 0; в `dist/` появились `manifest.json`, `icons/icon-192.png`, `icons/icon-512.png`.

---

### Task 2: Вибрация — src/haptics.ts

**Файлы:**
- Create: `src/haptics.ts`
- Test: `src/haptics.test.ts`

**Интерфейсы:**
- Produces: `haptic(kind, vibrate?)`, `hapticPattern(kind)`, `type HapticKind = 'tap' | 'success' | 'warning'`.

- [ ] **Шаг 1: RED — тест паттернов и no-op**

```ts
import { describe, expect, it } from 'vitest';
import { haptic, hapticPattern } from './haptics';

describe('haptics', () => {
  it('возвращает паттерны для каждого вида', () => {
    expect(hapticPattern('tap')).toEqual([15]);
    expect(hapticPattern('success')).toEqual([20, 30, 20]);
    expect(hapticPattern('warning')).toEqual([40, 40, 40]);
  });

  it('вызывает vibrate с паттерном, когда он доступен', () => {
    const calls: number[][] = [];
    haptic('success', pattern => { calls.push(pattern); return true; });
    expect(calls).toEqual([[20, 30, 20]]);
  });

  it('тихо пропускает, когда vibrate отсутствует', () => {
    expect(() => haptic('tap', undefined)).not.toThrow();
  });
});
```

- [ ] **Шаг 2: Запустить — проверить FAIL**

Run: `npx vitest run src/haptics.test.ts`
Expected: FAIL — module not found.

- [ ] **Шаг 3: Реализовать src/haptics.ts**

```ts
export type HapticKind = 'tap' | 'success' | 'warning';

const PATTERNS: Record<HapticKind, number[]> = {
  tap: [15],
  success: [20, 30, 20],
  warning: [40, 40, 40],
};

export function hapticPattern(kind: HapticKind): number[] {
  return PATTERNS[kind];
}

export function haptic(
  kind: HapticKind,
  vibrate: ((pattern: number[]) => boolean) | undefined =
    typeof navigator !== 'undefined' ? navigator.vibrate?.bind(navigator) : undefined,
): void {
  if (!vibrate) return;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  try { vibrate(PATTERNS[kind]); } catch { /* noop */ }
}
```

- [ ] **Шаг 4: Проверить GREEN**

Run: `npx vitest run src/haptics.test.ts`
Expected: PASS (3 теста).

---

### Task 3: Подключить вибрацию в apply()

**Файлы:**
- Modify: `src/App.tsx` (import haptic; вызовы в `apply`)

- [ ] **Шаг 1: Импорт**

Добавить в блок импортов `src/App.tsx` (после строки `import { customerLedger } from './receivables';`):

```ts
import { haptic } from './haptics';
```

- [ ] **Шаг 2: Вызовы в apply()**

В функции `apply` (App.tsx, ~строка 245) изменить тело:

```ts
  const apply = async (command: Command): Promise<State | null> => {
    if (!state || busyRef.current) return null;
    busyRef.current = true; setBusy(true);
    haptic('tap');
    try {
      const result = await execute(state, command, actor);
      setState(result.state);
      if (mode === 'cloud') setActor(result.actor);
      setSync(syncStatus());
      setNotice({ message: result.queued ? 'Oflayn navbatga saqlandi. Balanslar server tasdiqlagandan keyin o‘zgaradi.' : 'Amal saqlandi. Hisob yangilandi.', error: false });
      haptic('success');
      return result.state;
    } catch (e) {
      const message = errorText(e);
      setNotice({ message, error: true });
      haptic('warning');
      if (mode === 'demo') setState(readDemo()); else await load();
      return null;
    } finally { busyRef.current = false; setBusy(false); }
  };
```

- [ ] **Шаг 3: Проверка типов и регрессий**

Run: `npx tsc -b --pretty false && npm test`
Expected: exit 0; существующие тесты зелёные.

---

### Task 4: Скелетон — src/Skeleton.tsx + shimmer CSS

**Файлы:**
- Create: `src/Skeleton.tsx`
- Modify: `src/styles.css` (shimmer + reduced-motion)
- Modify: `src/App.tsx` (в login-shell вместо текста «Tizim yuklanmoqda»)
- Test: `src/pwaStyle.test.ts` (CSS-регрессии)

**Интерфейсы:**
- Produces: `Skeleton({ rows })` (React-компонент), `skeletonRows(count): null[]` (чистая).

- [ ] **Шаг 1: RED — CSS-регрессия скелетона**

Создать `src/pwaStyle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cssRules } from './mobileStyle';

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

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
    expect(css).toContain('prefers-reduced-motion');
    const reduced = cssRules(css).find(r => r.selector.includes('prefers-reduced-motion'));
    expect(reduced?.body).toContain('animation');
  });
});
```

- [ ] **Шаг 2: Запустить — проверить FAIL**

Run: `npx vitest run src/pwaStyle.test.ts`
Expected: FAIL — `@keyframes shimmer` не найден.

- [ ] **Шаг 3: Реализовать src/Skeleton.tsx**

```tsx
import type { ReactNode } from 'react';

export function skeletonRows(count: number): null[] {
  return Array.from({ length: count }, () => null);
}

export function Skeleton({ rows = 4, className = '' }: { rows?: number; className?: string }): ReactNode {
  return (
    <div className={`skeleton ${className}`} aria-hidden="true">
      {skeletonRows(rows).map((_, i) => <div className="skeleton-row" key={i} />)}
    </div>
  );
}
```

- [ ] **Шаг 4: Добавить shimmer CSS в src/styles.css**

В конец файла:

```css
.skeleton{display:flex;flex-direction:column;gap:10px;padding:14px 0}
.skeleton-row{height:14px;border-radius:7px;background:linear-gradient(90deg,#e8ede4 25%,#f4f7f0 37%,#e8ede4 63%);background-size:400% 100%;animation:shimmer 1.4s ease infinite}
@keyframes shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}
@media (prefers-reduced-motion: reduce){
  .skeleton-row{animation:none}
}
```

- [ ] **Шаг 5: Вставить Skeleton в login-shell (App.tsx)**

В `src/App.tsx`, в login-shell заменить текстовый заголовок «Tizim yuklanmoqda» на скелетон. Найти строку:

```tsx
<h2>{mode === 'cloud' ? 'Korxonaga kirish' : state ? 'Tizimda kim ishlaydi?' : 'Tizim yuklanmoqda'}</h2>
```

заменить на:

```tsx
<h2>{mode === 'cloud' ? 'Korxonaga kirish' : state ? 'Tizimda kim ishlaydi?' : 'Yuklanmoqda'}</h2>
```

и сразу под `<h2>…</h2>` (только когда `!state && mode === 'demo'`) добавить:

```tsx
{!state && mode === 'demo' && <Skeleton rows={3} />}
```

Добавить импорт: `import { Skeleton } from './Skeleton';` в блок импортов App.tsx.

- [ ] **Шаг 6: Проверить GREEN + типы**

Run: `npx vitest run src/pwaStyle.test.ts && npx tsc -b --pretty false`
Expected: PASS; tsc exit 0.

---

### Task 5: Свайп — src/swipe.ts

**Файлы:**
- Create: `src/swipe.ts`
- Test: `src/swipe.test.ts`

**Интерфейсы:**
- Produces: `swipeDecision(deltaX, threshold?)`, `type SwipeAction`, `Swipeable({ actions, children })` (React-компонент, touch-only).

- [ ] **Шаг 1: RED — тест порога**

```ts
import { describe, expect, it } from 'vitest';
import { swipeDecision } from './swipe';

describe('swipe', () => {
  it('раскрывает действия при свайпе влево дальше порога', () => {
    expect(swipeDecision(-61)).toBe('reveal');
    expect(swipeDecision(-120, 80)).toBe('reveal');
  });

  it('не раскрывает ниже порога и при свайпе вправо', () => {
    expect(swipeDecision(-59)).toBe('none');
    expect(swipeDecision(40)).toBe('none');
    expect(swipeDecision(-60)).toBe('reveal');
  });
});
```

- [ ] **Шаг 2: Запустить — проверить FAIL**

Run: `npx vitest run src/swipe.test.ts`
Expected: FAIL — module not found.

- [ ] **Шаг 3: Реализовать src/swipe.ts**

```tsx
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';

export function swipeDecision(deltaX: number, threshold = 60): 'none' | 'reveal' {
  return deltaX <= -threshold ? 'reveal' : 'none';
}

export interface SwipeAction { label: string; onSelect: () => void; }

export function Swipeable({ actions, children }: { actions: SwipeAction[]; children: ReactNode }): ReactNode {
  const [offset, setOffset] = useState(0);
  const start = useRef<number | null>(null);
  const onDown = (e: PointerEvent<HTMLDivElement>) => { if (e.pointerType !== 'touch') return; start.current = e.clientX; };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    const delta = Math.min(0, e.clientX - start.current);
    setOffset(swipeDecision(delta) === 'reveal' ? -96 : delta);
  };
  const onUp = () => { start.current = null; setOffset(swipeDecision(offset) === 'reveal' ? -96 : 0); };
  return (
    <div className="swipeable" style={{ transform: `translateX(${offset}px)`, transition: 'transform .18s ease' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="swipe-actions" aria-hidden={offset === 0}>
        {actions.map(a => <button key={a.label} type="button" className="swipe-action" onClick={a.onSelect}>{a.label}</button>)}
      </div>
      <div className="swipe-content">{children}</div>
    </div>
  );
}
```

- [ ] **Шаг 4: Проверить GREEN**

Run: `npx vitest run src/swipe.test.ts`
Expected: PASS (3 теста).

- [ ] **Шаг 5: CSS для свайпа в src/styles.css**

В конец файла:

```css
.swipeable{position:relative;overflow:hidden;touch-action:pan-y}
.swipe-actions{position:absolute;top:0;right:0;height:100%;display:flex;align-items:stretch}
.swipe-actions>button.swipe-action{min-width:88px;border:none;color:#fff;font-weight:700;font-size:13px;padding:0 14px}
.swipe-actions>button.swipe-action:first-child{background:var(--green)}
.swipe-actions>button.swipe-action:last-child{background:#b3543f}
.swipe-content{position:relative;background:inherit}
```

---

### Task 6: Свайп в карточках заказов (kanban)

**Файлы:**
- Modify: `src/App.tsx` (обернуть `.kanban-card` в `Swipeable`)

**Интерфейсы:**
- Consumes: `Swipeable`, `SwipeAction` из `src/swipe.ts`; `show` из App.
- Действия: «Tahrirlash» → `show('orderEdit', o.id)`; «Arxiv» → `show('cancelOrder', o.id)` (только admin, не cancelled).

- [ ] **Шаг 1: Импорт**

В App.tsx добавить: `import { Swipeable } from './swipe';`

- [ ] **Шаг 2: Обернуть карточку**

В kanban-рендере (App.tsx, `orderView === 'board'`, `.kanban-cards` map) заменить `<article className="kanban-card" ...>…</article>` на:

```tsx
<Swipeable key={o.id} actions={[
  { label: 'Tahrirlash', onSelect: () => show('orderEdit', o.id) },
  ...(admin && o.status !== 'cancelled' ? [{ label: 'Arxiv', onSelect: () => show('cancelOrder', o.id) }] : []),
]}>
  <article className="kanban-card" tabIndex={0} onClick={() => setSelectedOrder(o.id)} onKeyDown={e => { if (e.key === 'Enter') setSelectedOrder(o.id); }}>
    …тело карточки без изменений…
  </article>
</Swipeable>
```

(перенести `key={o.id}` с article на Swipeable).

- [ ] **Шаг 3: Проверка**

Run: `npx tsc -b --pretty false && npm test`
Expected: exit 0.

---

### Task 7: Свайп в строках журнала кассы

**Файлы:**
- Modify: `src/App.tsx` (обернуть `<tr>` журнала кассы в `Swipeable`)

**Действия:** «Storno» → `show('reverse', c.id)` (только когда `!reversed && !c.reversalOf`).

- [ ] **Шаг 1: Обернуть строку**

В рендере журнала кассы (App.tsx, `panel === 'kassa'`, `cashRows.map`) заменить `<tr key={c.id}>…</tr>` на:

```tsx
{(() => {
  const reversed = state.cash.some(x => x.reversalOf === c.id);
  return (
    <Swipeable key={c.id} actions={reversed || c.reversalOf ? [] : [{ label: 'Storno', onSelect: () => show('reverse', c.id) }]}>
      <tr>…тело строки без изменений…</tr>
    </Swipeable>
  );
})()}
```

- [ ] **Шаг 2: Проверка**

Run: `npx tsc -b --pretty false && npm test`
Expected: exit 0.

Примечание: `.table-scroll table` использует `<tbody>`; `Swipeable` (div) между `<tbody>` и `<tr>` невалиден HTML. Обернуть `<tr>` внутри `<td>` недопустимо. Решение: рендерить Swipeable как `<tr>`-совместимый — НЕТ. Корректный путь: применить свайп к кассе через карточный вид на мобильном. Если `cardable` уже превращает таблицу в карточки на мобильном, свайп прикрепляется к карточке. **Исполнитель**: проверить, как `.cardable` рендерится на мобильном (см. `src/mobileCards.ts`), и прикрепить Swipeable к карточному контейнеру строки, а не к `<tr>`. Если карточного вида нет — свайп кассы перенести в `Task 6`-паттерн на `.cash-amount`-строках невозможно; тогда применить свайп к кассе как к списку `.debt-list`/карточкам в той же секции. **При неоднозначности — реализовать свайп только для заказов (Task 6), кассу оставить без свайпа и записать ruling в отчёт.**

---

### Task 8: Баннер установки и тост обновления — src/pwa.ts

**Файлы:**
- Create: `src/pwa.ts`
- Modify: `src/App.tsx` (состояние install-события, баннер в `banners`)
- Modify: `src/styles.css` (стили баннера)
- Test: `src/pwa.test.ts` (дополнить)

**Интерфейсы:**
- Produces: `shouldShowInstallBanner(state)`, `isStandalone()`, `isIos()`, `type BeforeInstallPrompt`.

- [ ] **Шаг 1: RED — логика баннера**

Дописать в `src/pwa.test.ts`:

```ts
import { isIos, isStandalone, shouldShowInstallBanner } from './pwa';

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
```

- [ ] **Шаг 2: Запустить — проверить FAIL**

Run: `npx vitest run src/pwa.test.ts`
Expected: FAIL — `./pwa` not found (manifest-тесты при этом проходят).

- [ ] **Шаг 3: Реализовать src/pwa.ts**

```ts
export interface BeforeInstallPrompt { prompt: () => Promise<void>; }

export interface InstallBannerInput { standalone: boolean; dismissed: boolean; available: boolean; }

export function shouldShowInstallBanner(input: InstallBannerInput): boolean {
  return input.available && !input.standalone && !input.dismissed;
}

export function isStandalone(match = (q: string) => window.matchMedia?.(q).matches): boolean {
  return match('(display-mode: standalone)');
}

export function isIos(userAgent: string): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}
```

- [ ] **Шаг 4: Интеграция в App.tsx**

Добавить состояние и эффект (после `const [chatRefresh, setChatRefresh] = useState(0);`):

```ts
const [installPrompt, setInstallPrompt] = useState<BeforeInstallPrompt | null>(null);
const [installDismissed, setInstallDismissed] = useState(false);
useEffect(() => {
  const onPrompt = (event: Event) => {
    event.preventDefault();
    const prompt = event as Event & BeforeInstallPrompt;
    setInstallPrompt(prompt);
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  return () => window.removeEventListener('beforeinstallprompt', onPrompt);
}, []);
```

Импортировать `import { shouldShowInstallBanner, isStandalone, isIos, type BeforeInstallPrompt } from './pwa';`.

В `banners` (App.tsx, ~строка 463) добавить баннер:

```tsx
{(() => {
  const standalone = isStandalone();
  const ios = isIos(navigator.userAgent);
  const available = !!installPrompt || ios;
  if (!shouldShowInstallBanner({ standalone, dismissed: installDismissed, available })) return null;
  return <div className="demo-banner install-banner">
    <span><Download size={15} />{ios ? 'Safari: Ulashish → «Bosh ekranga qo‘shish» orqali o‘rnating.' : 'Ilovani bosh ekranga o‘rnating.'}</span>
    {installPrompt
      ? <button onClick={() => { void installPrompt.prompt(); setInstallPrompt(null); }}>O‘rnatish</button>
      : <button onClick={() => setInstallDismissed(true)}>Yopish</button>}
  </div>;
})()}
```

- [ ] **Шаг 5: CSS баннера**

```css
.install-banner{justify-content:space-between}
.install-banner button{white-space:nowrap}
```

- [ ] **Шаг 6: Проверить GREEN + типы**

Run: `npx vitest run src/pwa.test.ts && npx tsc -b --pretty false`
Expected: PASS; tsc exit 0.

---

### Task 9: Микроанимации и reduced-motion

**Файлы:**
- Modify: `src/styles.css`

- [ ] **Шаг 1: Добавить микроанимации**

В конец `src/styles.css`:

```css
.kanban-card,.mini-cards article,.employee-card,.delivery-grid article{transition:transform .12s ease,box-shadow .12s ease}
.kanban-card:active,.mini-cards article:active,.employee-card:active{transform:scale(.985)}
.mobile-nav-item{transition:color .12s ease,background-color .12s ease}
.mobile-nav-item:active{transform:scale(.94)}
button.primary:active,button.secondary:active{transform:translateY(1px)}
@media (prefers-reduced-motion: reduce){
  .kanban-card,.mini-cards article,.employee-card,.delivery-grid article,
  .mobile-nav-item,button.primary,button.secondary{transition:none;transform:none}
}
```

- [ ] **Шаг 2: CSS-регрессия (дополнить pwaStyle.test.ts)**

```ts
it('добавляет микроанимации и глушит их при reduced-motion', () => {
  expect(css).toContain('.kanban-card:active');
  expect(css).toContain('.mobile-nav-item:active');
  const reduced = cssRules(css).find(r => r.selector.includes('prefers-reduced-motion'));
  expect(reduced?.body).toContain('transform:none');
});
```

- [ ] **Шаг 3: Проверить**

Run: `npx vitest run src/pwaStyle.test.ts`
Expected: PASS.

---

### Task 10: Полная проверка

- [ ] **Шаг 1: Тесты**

Run: `npm test`
Expected: все тесты зелёные (включая новые `haptics`, `swipe`, `pwa`, `pwaStyle`).

- [ ] **Шаг 2: Типы и сборка**

Run: `npx tsc -b --pretty false && npm run build`
Expected: exit 0; в `dist/` присутствуют `sw.js`, `manifest.json`, `icons/`.

- [ ] **Шаг 3: Браузер (preview)**

Run: `npm run preview` (порт 4173). Проверить в браузере:
- 1280/759/390/320 — карточки и таблицы не ломаются, нижняя навигация на месте;
- `manifest.json` отдаётся (DevTools → Application → Manifest);
- свайп влево на карточке заказа (touch-эмуляция) раскрывает «Tahrirlash»/«Arxiv»;
- баннер установки появляется в Chrome (или iOS-подсказка на iPhone);
- офлайн-перезагрузка (Application → Service Workers → Offline) открывает приложение.

- [ ] **Шаг 4: Отчёт владельцу**

Описать результат на узбекской латинице: что добавлено, что проверено, скриншот/поведение. **Деплой НЕ выполнять** — запросить отдельное разрешение.

---

## Self-Review

1. **Покрытие спеки:** manifest+иконки+установка (T1, T8), офлайн (существующий SW, проверка в T10), вибрация (T2, T3), скелетоны (T4), свайпы (T5, T6, T7), микроанимации (T9), reduced-motion (T4, T9). Push — вне области (спека). ✓
2. **Плейсхолдеры:** нет TBD/TODO. ✓
3. **Типы/имена:** `haptic(kind, vibrate?)`, `swipeDecision`, `Swipeable`, `Skeleton`, `shouldShowInstallBanner`, `isStandalone`, `isIos` согласованы между задачами. `show('orderEdit'|'cancelOrder'|'reverse')` — существующие модалки App.tsx (проверены grep). ✓
4. **Неоднозначность Task 7:** явно описана с fallback-ruling; при столкновении — касса без свайпа, зафиксировать в отчёте. ✓
