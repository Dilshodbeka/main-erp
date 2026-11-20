// Interface language. The source text of the whole UI is Uzbek; other languages are applied on top
// of the rendered page from a dictionary keyed by the Uzbek text (gettext style). Anything missing
// from the dictionary simply stays Uzbek, so a new screen never breaks — it is just untranslated.
export type Lang = 'uz' | 'ru';
export const LANGS: { id: Lang; label: string }[] = [{ id: 'uz', label: 'O‘zbekcha' }, { id: 'ru', label: 'Русский' }];
const STORAGE_KEY = 'aliya.lang';

export function readLang(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): Lang {
  try { return storage?.getItem(STORAGE_KEY) === 'ru' ? 'ru' : 'uz'; } catch { return 'uz'; }
}

export function saveLang(lang: Lang, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(STORAGE_KEY, lang); } catch { /* private mode: the choice lasts for this page only */ }
}

export type Dictionary = Record<string, string>;
const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim();
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Pattern { anchor: string; regex: RegExp; target: string; weight: number }

/**
 * Builds a function that translates one piece of visible text, or returns null when it has no
 * translation. Keys with {0}, {1}… are templates: the placeholders match any text and are carried
 * into the translation (and translated themselves when they are dictionary entries, e.g. a status).
 */
export function createTranslator(dictionary: Dictionary): (text: string) => string | null {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [source, target] of Object.entries(dictionary)) {
    const key = squeeze(source);
    if (!key || !target) continue;
    if (!/\{\d+\}/.test(key)) { exact.set(key, target); continue; }
    const parts = key.split(/\{\d+\}/);
    const literal = parts.join('');
    if (squeeze(literal).length < 2) continue; // "{0}" alone would swallow everything
    const order = [...key.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
    const regex = new RegExp(`^${parts.map(escapeRegex).join('(.+?)')}$`, 's');
    const remapped = target.replace(/\{(\d+)\}/g, (_, index) => `\u0000${order.indexOf(Number(index))}\u0000`);
    patterns.push({ anchor: parts.reduce((a, b) => (b.length > a.length ? b : a), ''), regex, target: remapped, weight: literal.length });
  }
  patterns.sort((a, b) => b.weight - a.weight);

  const translate = (text: string, depth = 0): string | null => {
    const key = squeeze(text);
    if (!key) return null;
    const direct = exact.get(key);
    if (direct !== undefined) return direct;
    if (depth > 1) return null;
    for (const pattern of patterns) {
      if (!key.includes(pattern.anchor)) continue;
      const match = pattern.regex.exec(key);
      if (!match) continue;
      return pattern.target.replace(/\u0000(\d+)\u0000/g, (_, index) => {
        const captured = match[Number(index) + 1] ?? '';
        return translate(captured, depth + 1) ?? captured;
      });
    }
    // "Savdo va CRM · Buyurtmalar": parts joined with a middle dot are translated one by one.
    if (depth === 0 && key.includes(' · ')) {
      const parts = key.split(' · ');
      const done = parts.map(part => translate(part, 1));
      if (done.some(part => part !== null)) return parts.map((part, index) => done[index] ?? part).join(' · ');
    }
    return null;
  };
  // Surrounding spaces belong to the layout (inline gaps) — keep them exactly.
  return text => {
    const translated = translate(text);
    if (translated === null) return null;
    const lead = /^\s*/.exec(text)![0];
    const trail = /\s*$/.exec(text)![0];
    return `${lead}${translated}${trail}`;
  };
}

const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

function skipped(node: Node | null): boolean {
  for (let element = node instanceof Element ? node : node?.parentElement ?? null; element; element = element.parentElement) {
    if (SKIP.has(element.tagName) || element.hasAttribute('data-no-translate') || (element as HTMLElement).isContentEditable) return true;
  }
  return false;
}

/** Translates the page and keeps translating whatever React renders afterwards. Returns a stop function. */
export function translateDocument(root: HTMLElement, translate: (text: string) => string | null): () => void {
  const textNode = (node: Text) => {
    if (skipped(node)) return;
    const next = translate(node.data);
    if (next !== null && next !== node.data) node.data = next;
  };
  const attributes = (element: Element) => {
    if (skipped(element)) return;
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const next = translate(value);
      if (next !== null && next !== value) element.setAttribute(name, next);
    }
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { textNode(node as Text); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    attributes(element);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      if (current.nodeType === Node.TEXT_NODE) textNode(current as Text); else attributes(current as Element);
    }
  };
  walk(root);
  const title = translate(document.title);
  if (title) document.title = title;
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') textNode(record.target as Text);
      else if (record.type === 'attributes') attributes(record.target as Element);
      else record.addedNodes.forEach(walk);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  return () => observer.disconnect();
}

let active: ((text: string) => string | null) | null = null;
export function setActiveTranslator(translate: ((text: string) => string | null) | null): void { active = translate; }

/** For text the page translator cannot reach: the clipboard, chat messages, downloaded files. */
export function tr(text: string): string {
  return active?.(text) ?? text;
}
