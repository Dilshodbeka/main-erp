export interface CssRule {
  selector: string;
  body: string;
  media: string;
}

/** Uppercase lockups and footers may sit one step below the reading floor. */
export const MICRO_LABELS = ['.brand small', '.nav-group', '.app-footer'];

const CONTROLS = ['button', '.primary', '.secondary', '.icon-button', '.text-button', '.row-link', '.nav-item', '.mobile-nav-item', '.panel-bar button'];

export function cssRules(source: string, media = ''): CssRule[] {
  const rules: CssRule[] = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open < 0) break;
    const head = source.slice(index, open).trim();
    let depth = 1;
    let end = open + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}') depth -= 1;
      end += 1;
    }
    const body = source.slice(open + 1, end - 1);
    if (head.startsWith('@media')) rules.push(...cssRules(body, head));
    else if (!head.startsWith('@')) rules.push({ selector: head, body, media });
    index = end;
  }
  return rules;
}

function mediaMatchesPhone(media: string): boolean {
  if (!media) return true;
  if (media.includes('print')) return false;
  const maxWidth = /max-width:\s*(\d+)px/.exec(media)?.[1];
  if (maxWidth) return Number(maxWidth) >= 700;
  const minWidth = /min-width:\s*(\d+)px/.exec(media)?.[1];
  if (minWidth) return Number(minWidth) <= 700;
  return true;
}

/** Rules a phone actually renders: the base sheet plus every block wide enough to still match. */
export function phoneRules(source: string): CssRule[] {
  return cssRules(source).filter(rule => mediaMatchesPhone(rule.media));
}

export function pixelValues(body: string, property: string): number[] {
  return [...body.matchAll(new RegExp(`${property}:\\s*(\\d+(?:\\.\\d+)?)px`, 'g'))].map(match => Number(match[1]));
}

function lastPixel(body: string, property: string): number | undefined {
  const sizes = pixelValues(body, property);
  return sizes.length ? sizes[sizes.length - 1] : undefined;
}

function selectorTokens(selector: string): string[] {
  return selector.split(',').map(token => token.trim()).filter(Boolean);
}

/** Value each selector ends up with on a phone, later rules winning the way the cascade does. */
function effectivePhoneValues(source: string, property: string): Map<string, number> {
  const byToken = new Map<string, number>();
  for (const rule of phoneRules(source)) {
    const px = lastPixel(rule.body, property);
    if (px === undefined) continue;
    for (const token of selectorTokens(rule.selector)) byToken.set(token, px);
  }
  return byToken;
}

/** Font size a phone ends up with for each selector, later rules winning like the cascade does. */
export function effectivePhoneFontSizes(source: string): Array<{ selector: string; px: number }> {
  return [...effectivePhoneValues(source, 'font-size')]
    .filter(([selector]) => !selector.includes('.print-'))
    .map(([selector, px]) => ({ selector, px }));
}

/** Selectors whose phone text is under `belowPx`, in the order a reader meets them. */
export function tinyTextSelectors(source: string, belowPx: number): string[] {
  return effectivePhoneFontSizes(source)
    .filter(entry => entry.px < belowPx)
    .map(entry => `${entry.selector}: ${entry.px}px`);
}

/** Labels a phone reader has to make out: nothing under `floorPx`, micro labels nothing under 10px. */
export function readabilityIssues(source: string, floorPx = 11): string[] {
  const minimumFor = (selector: string) => (MICRO_LABELS.some(label => selector.includes(label)) ? 10 : floorPx);
  return effectivePhoneFontSizes(source)
    .filter(entry => entry.px < minimumFor(entry.selector))
    .map(entry => `${entry.selector}: ${entry.px}px`);
}

function isInputRule(selector: string): boolean {
  return selector.split(',').some(part => /(^|[\s.>])(input|select|textarea)/.test(part.trim()));
}

function isControlRule(selector: string): boolean {
  return CONTROLS.some(control => selector.includes(control));
}

export function phoneStyleIssues(css: string, html: string): string[] {
  const issues: string[] = [];
  const viewport = /<meta[^>]*name="viewport"[^>]*>/i.exec(html)?.[0] ?? '';
  if (!viewport.includes('viewport-fit=cover')) issues.push('viewport meta lacks viewport-fit=cover, so safe-area insets stay 0');
  if (!css.includes('text-size-adjust:100%')) issues.push('missing text-size-adjust:100%, iOS resizes text on its own');

  const fontSizes = effectivePhoneFontSizes(css);
  for (const field of fontSizes) {
    if (isInputRule(field.selector) && field.px < 16) {
      issues.push(`${field.selector}: ${field.px}px — iOS zooms the page when a field is under 16px`);
    }
  }
  if (!fontSizes.some(field => isInputRule(field.selector) && field.px >= 16)) {
    issues.push('no phone rule sets fields to 16px');
  }

  const nav = phoneRules(css).filter(rule => rule.selector.includes('.mobile-nav'));
  if (!nav.some(rule => rule.body.includes('safe-area-inset-bottom'))) issues.push('.mobile-nav ignores safe-area-inset-bottom');
  return issues;
}

export function mobileTapTargetIssues(source: string, minimumPx = 44): string[] {
  const heights = effectivePhoneValues(source, 'min-height');
  const issues = [...heights]
    .filter(([token, px]) => isControlRule(token) && px < minimumPx)
    .map(([token, px]) => `${token}: min-height ${px}px`);
  if ((heights.get('button') ?? 0) < minimumPx) issues.push('no phone rule gives every button a 44px minimum height');
  return issues;
}
