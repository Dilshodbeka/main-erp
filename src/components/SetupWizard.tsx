import { useState } from 'react';
import { Check } from 'lucide-react';
import { setupSteps, type SetupStepId } from '../setup';
import { Dialog } from '../ui';
import type { State } from '../types';

export function SetupWizard({ state, busy, online, close, runDemo, manual }: {
  state: State;
  busy: boolean;
  online: boolean;
  close: () => void;
  runDemo: (step: SetupStepId) => Promise<boolean>;
  manual: (step: SetupStepId) => void;
}) {
  const [running, setRunning] = useState<SetupStepId | null>(null);
  const locked = busy || running !== null;
  const ready = setupSteps.filter(step => step.done(state)).length;
  return <Dialog title="Boshlang‘ich sozlash" subtitle="To‘rt qadamda ishlash uchun minimal ma’lumot. Har qadamni qo‘lda kiriting yoki demodan oling." close={() => { if (!locked) close(); }}>
    <div className="form-body">
      <div className="setup-progress">
        <div><b>{ready} / {setupSteps.length} qadam tayyor</b><small>{ready === setupSteps.length ? 'Asosiy sozlash tugallandi.' : 'Tartib muhim emas — xohlagan qadamdan boshlang.'}</small></div>
        <div className="setup-bar" role="progressbar" aria-valuemin={0} aria-valuemax={setupSteps.length} aria-valuenow={ready}><i style={{ width: `${ready / setupSteps.length * 100}%` }} /></div>
      </div>
      {!online && <div className="warning">Oflayn rejimda demo yuklanmaydi. Avval internetga ulaning yoki ma’lumotni qo‘lda kiriting.</div>}
      <div className="setup-list">
        {setupSteps.map((step, index) => {
          const done = step.done(state);
          return <article className={`setup-step ${done ? 'done' : ''}`} key={step.id}>
            <span className="setup-number">{done ? <Check size={16} /> : index + 1}</span>
            <div className="setup-copy"><b>{step.title}</b><p>{step.description}</p></div>
            {done
              ? <span className="badge delivered">Tayyor</span>
              : <div className="setup-actions">
                  <button className="secondary small" type="button" disabled={locked} onClick={() => manual(step.id)}>Qo‘lda kiritish</button>
                  <button className="primary small" type="button" disabled={locked || !online} onClick={() => {
                    setRunning(step.id);
                    void runDemo(step.id).finally(() => setRunning(null));
                  }}>{running === step.id ? 'Yuklanmoqda…' : 'Demodan olish'}</button>
                </div>}
          </article>;
        })}
      </div>
      <p className="subtle-note">Demo faqat yetishmayotgan yozuvlarni qo‘shadi: mavjud ma’lumotlar o‘zgarmaydi, buyurtma esa sexga ishga tushirilmaydi.</p>
    </div>
    <footer className="form-footer"><button className="secondary" type="button" disabled={running !== null} onClick={close}>Yopish</button></footer>
  </Dialog>;
}
