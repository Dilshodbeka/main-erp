import { LANGS, readLang, saveLang, type Lang } from '../translate';

/** Interface language: Uzbek or Russian. The choice is kept in the browser; the page reloads to apply it everywhere. */
export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const current = readLang();
  const choose = (lang: Lang) => {
    if (lang === current) return;
    saveLang(lang);
    window.location.reload();
  };
  return (
    <div className={compact ? 'lang-switch compact' : 'lang-switch'} role="group" aria-label="Til / Язык" data-no-translate>
      {LANGS.map(lang => (
        <button type="button" key={lang.id} className={lang.id === current ? 'active' : ''} aria-pressed={lang.id === current} onClick={() => choose(lang.id)}>
          {compact ? lang.id.toUpperCase() : lang.label}
        </button>
      ))}
    </div>
  );
}
