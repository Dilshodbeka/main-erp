import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installDiagnostics } from './diagnostics';
import './styles.css';
import './native.css';

installDiagnostics(window, localStorage);
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(error => {
      console.error('Oflayn yuklash mavjud emas:', error);
    });
  });
}
