import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDiagnostics } from './diagnostics';
import { setDateLocale } from './i18n';
import { createTranslator, readLang, translateDocument } from './translate';
import './styles.css';
import './native.css';

installDiagnostics(window, localStorage);

/** Russian is applied on top of the Uzbek interface; the dictionary is loaded only when it is needed. */
async function applyLanguage(): Promise<void> {
  const lang = readLang();
  document.documentElement.lang = lang;
  if (lang !== 'ru') return;
  try {
    const dictionary = (await import('./locales/ru.json')).default as Record<string, string>;
    const translate = createTranslator(dictionary);
    setDateLocale('ru-RU');
    translateDocument(document.body, translate);
    for (const name of ['confirm', 'alert'] as const) {
      const native = window[name].bind(window) as (message?: string) => unknown;
      (window as unknown as Record<string, unknown>)[name] = (message?: string) => native(message === undefined ? message : translate(String(message)) ?? message);
    }
  } catch (error) {
    console.error('Tarjima yuklanmadi:', error); // the interface simply stays Uzbek
  }
}

void applyLanguage().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
});
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(error => {
      console.error('Oflayn yuklash mavjud emas:', error);
    });
  });
}
