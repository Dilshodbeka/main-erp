import { useEffect, useState } from 'react';
import { BookOpen, Check, ChevronRight, HelpCircle, MessageSquare, X } from 'lucide-react';
import { nextStep, type GuideAction, type PageGuide } from '../guide';
import { manualTopics, type ManualTopic } from '../manual';
import { supportAlerts } from '../support';
import { Dialog } from '../ui';
import { SupportPanel, type SupportProps } from './Support';

export function GuideHint({ guide, onAction, onOpen }: {
  guide: PageGuide; onAction: (action: GuideAction) => void; onOpen: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(false); }, [guide.page]);
  const next = nextStep(guide);
  if (!next || hidden) return null;
  const action = next.action;
  return <div className="guide-hint">
    <HelpCircle size={17} />
    <div className="guide-hint-text"><b>Yordamchi</b><span>Keyingi qadam — {next.title}. {next.detail}</span></div>
    <div className="guide-hint-actions">
      {action && <button className="secondary small" onClick={() => onAction(action)}>{action.label}</button>}
      <button className="text-button" onClick={onOpen}>Barcha qadamlar<ChevronRight size={14} /></button>
      <button className="icon-button" aria-label="Maslahatni yopish" onClick={() => setHidden(true)}><X size={14} /></button>
    </div>
  </div>;
}

export function GuideFab({ remaining, alert = false, onClick }: { remaining: number; alert?: boolean; onClick: () => void }) {
  return <button className="guide-fab" onClick={onClick} aria-label="Yordamchi: keyingi qadam va qo‘llanma">
    <HelpCircle size={20} /><span>Yordamchi</span>{remaining > 0 && <b>{remaining}</b>}
    {alert && <i className="guide-dot" aria-hidden="true" />}
  </button>;
}

export function ManualPanel({ topics = manualTopics }: { topics?: ManualTopic[] }) {
  return <div className="manual-panel">
    <div className="guide-progress">{topics.length} mavzu · ekranlardagi haqiqiy tugmalar bo‘yicha</div>
    {topics.map((topic, index) => <article className="manual-topic" key={topic.id}>
      <header>
        <span className="manual-number">{index + 1}</span>
        <div><h3>{topic.title}</h3><p>{topic.summary}</p></div>
      </header>
      {topic.sections.map(section => <section className="manual-section" key={section.title}>
        <b>{section.title}</b>
        <p>{section.body}</p>
        <ol>{section.steps.map(step => <li key={step}>{step}</li>)}</ol>
        {section.note && <div className="info-note">{section.note}</div>}
      </section>)}
    </article>)}
  </div>;
}

export function GuidePanel({ guide, onAction, close, support }: {
  guide: PageGuide; onAction: (action: GuideAction) => void; close: () => void; support?: SupportProps;
}) {
  const [tab, setTab] = useState<'steps' | 'manual' | 'support'>('steps');
  const pending = guide.steps.filter(step => !step.done).length;
  const firstPending = guide.steps.findIndex(step => !step.done);
  const alerts = support ? supportAlerts(support.tickets, support.actor, support.seen) : 0;
  return <Dialog
    title={`Yordamchi · ${guide.title}`}
    subtitle={tab === 'steps' ? guide.purpose : tab === 'manual' ? 'Bo‘yash, mijoz fasadlari va LKM normalari bo‘yicha amaliy qo‘llanma.' : 'Tez savollar va murojaatlar'}
    close={close} wide>
    <div className="guide-tabs" role="tablist" aria-label="Yordamchi bo‘limlari">
      <button role="tab" aria-selected={tab === 'steps'} onClick={() => setTab('steps')}><Check size={15} />Qadamlar</button>
      <button role="tab" aria-selected={tab === 'manual'} onClick={() => setTab('manual')}><BookOpen size={15} />Qo‘llanma</button>
      {support && <button role="tab" aria-selected={tab === 'support'} onClick={() => setTab('support')}>
        <MessageSquare size={15} />Murojaat{alerts > 0 && <span className="guide-tab-badge">{alerts}</span>}
      </button>}
    </div>
    {tab === 'support' && support
      ? <SupportPanel support={support} />
      : tab === 'steps'
        ? <div className="guide-panel">
          <div className="guide-progress">{pending ? `${pending} qadam qoldi` : 'Hamma qadam bajarilgan'} · {guide.steps.length - pending}/{guide.steps.length} tayyor</div>
          <ol className="guide-steps">{guide.steps.map((step, index) => {
            const action = step.action;
            const isNext = index === firstPending;
            return <li key={step.id} className={`guide-step ${step.done ? 'done' : isNext ? 'next' : ''}`}>
              <span className="guide-marker">{step.done ? <Check size={15} /> : index + 1}</span>
              <div className="guide-step-body">
                <b>{step.title}</b>
                <small>{step.detail}</small>
                {!step.done && step.blocked && <small className="guide-blocked">Avval yuqoridagi qadamlar bajarilishi kerak</small>}
                {!step.done && action && <button className="secondary small" disabled={step.blocked} onClick={() => onAction(action)}>{action.label}</button>}
              </div>
            </li>;
          })}</ol>
          <div className="info-note">{guide.outcome}</div>
          <p className="subtle-note">Qadamlar hisobdagi ma’lumotga qarab avtomatik belgilanadi: yangi yozuv qo‘shilsa, ro‘yxat yangilanadi.</p>
        </div>
        : <ManualPanel />}
  </Dialog>;
}
