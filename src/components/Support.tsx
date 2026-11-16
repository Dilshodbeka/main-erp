import { useState } from 'react';
import { ArrowLeft, MessageSquare, Send } from 'lucide-react';
import type { Actor, Command, SupportTicket, TicketContext, TicketStatus } from '../types';
import { Empty, dateTime } from '../ui';
import { searchFaq } from '../support-faq';
import {
  buildTicketContext, hasUnread, lastMessage, needsReply, sortedTickets, visibleTickets, type SeenMap,
} from '../support';

export interface SupportProps {
  tickets: SupportTicket[];
  actor: Actor;
  build: string;
  page: string;
  revision: number;
  sync: 'online' | 'offline';
  pending: number;
  errors: string[];
  seen: SeenMap;
  onSeen: (ticketId: string, messageId: string) => void;
  run: (command: Command) => Promise<boolean>;
}

type TicketFilter = 'open' | 'closed' | 'all';
const statusLabel: Record<TicketStatus, string> = { open: 'Ochiq', closed: 'Yopilgan' };

export function SupportQuestions() {
  const [query, setQuery] = useState('');
  const rows = searchFaq(query);
  return <section className="support-faq">
    <header><h3>Tez savollar</h3><p>Javobni qidiring yoki ro‘yxatdan tanlang.</p></header>
    <input className="support-search" value={query} placeholder="Savol qidirish…" aria-label="Savol qidirish" onChange={event => setQuery(event.target.value)} />
    {rows.length
      ? rows.map(item => <details key={item.id}><summary>{item.question}</summary><p>{item.answer}</p></details>)
      : <p className="support-faq-empty">Savol topilmadi.</p>}
  </section>;
}

function ContextCard({ context }: { context: TicketContext }) {
  return <dl>
    <dt>Bo‘lim</dt><dd>{context.page}</dd>
    <dt>Reviziya</dt><dd>{context.revision}</dd>
    <dt>Aloqa</dt><dd>{context.sync === 'online' ? 'Onlayn' : 'Oflayn'}</dd>
    <dt>Navbat</dt><dd>{context.pending}</dd>
    <dt>Yig‘ilma</dt><dd>{context.build}</dd>
    <dt>Xatolar</dt><dd>{context.errors.length ? context.errors.join(' · ') : 'Yo‘q'}</dd>
  </dl>;
}

function MessageRow({ message, own }: { message: SupportTicket['messages'][number]; own: boolean }) {
  return <article className={`support-message ${own ? 'own' : ''}`}>
    <header><b>{message.authorName}</b><time>{dateTime(message.at)}</time></header>
    <p>{message.text}</p>
    {message.context && <details className="support-context"><summary>Diagnostika</summary><ContextCard context={message.context} /></details>}
  </article>;
}

export function SupportList({ tickets, actor, filter, seen, onFilter, onOpen, onCreate }: {
  tickets: SupportTicket[];
  actor: Actor;
  filter: TicketFilter;
  seen: SeenMap;
  onFilter: (value: TicketFilter) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const rows = sortedTickets(tickets).filter(ticket => filter === 'all' || ticket.status === filter);
  const filters: TicketFilter[] = actor.role === 'admin' ? ['open', 'closed', 'all'] : ['all', 'open', 'closed'];
  const filterLabel: Record<TicketFilter, string> = { open: 'Ochiq', closed: 'Yopilgan', all: 'Hammasi' };
  return <section className="support-list">
    <div className="support-list-head">
      <h3>{actor.role === 'admin' ? 'Barcha murojaatlar' : 'Murojaatlar'}</h3>
      {actor.role === 'worker' && <button className="primary small" onClick={onCreate}><MessageSquare size={15} />Yangi murojaat</button>}
    </div>
    <div className="support-filters">
      {filters.map(value => <button key={value} className={`support-chip ${filter === value ? 'active' : ''}`}
        aria-pressed={filter === value} onClick={() => onFilter(value)}>{filterLabel[value]}</button>)}
    </div>
    {rows.length === 0
      ? <Empty text={actor.role === 'worker'
        ? 'Hozircha murojaatlar yo‘q. Muammo bo‘lsa, «Yangi murojaat» orqali yozing.'
        : 'Hozircha murojaatlar yo‘q.'} />
      : rows.map(ticket => {
        const last = lastMessage(ticket);
        const unread = hasUnread(ticket, actor, seen);
        const answer = actor.role === 'admin' ? needsReply(ticket) : unread;
        return <button key={ticket.id} className="support-row" data-id={ticket.id} onClick={() => onOpen(ticket.id)}>
          <b>{actor.role === 'admin' ? ticket.authorName : ticket.messages[0].text.slice(0, 60)}
            <span className={`support-status ${ticket.status}`}>{statusLabel[ticket.status]}</span>
            {answer && <span className="support-unread">Yangi javob</span>}
          </b>
          <time>{dateTime(ticket.updatedAt)}</time>
          <small>{last?.text ?? ''}</small>
        </button>;
      })}
  </section>;
}

export function SupportThread({ ticket, actor, onBack, run }: {
  ticket: SupportTicket;
  actor: Actor;
  onBack: () => void;
  run: (command: Command) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const done = await run({ type: 'ticket.reply', ticketId: ticket.id, text });
    setBusy(false);
    if (done) setText('');
  };
  const close = async () => {
    if (busy) return;
    setBusy(true);
    await run({ type: 'ticket.close', ticketId: ticket.id });
    setBusy(false);
  };
  return <section className="support-thread">
    <div className="support-thread-head">
      <button className="text-button" onClick={onBack}><ArrowLeft size={15} />Ortga</button>
      <div className="support-thread-actions">
        <span className={`support-status ${ticket.status}`}>{statusLabel[ticket.status]}</span>
        {actor.role === 'admin' && ticket.status === 'open' && <button className="secondary small" disabled={busy} onClick={close}>Yopish</button>}
      </div>
    </div>
    {ticket.status === 'closed' && ticket.closedAt && <p className="support-closed-note">Yopilgan: {ticket.closedByName} · {dateTime(ticket.closedAt)}</p>}
    <div className="support-messages">
      {ticket.messages.map(message => <MessageRow key={message.id} message={message} own={message.authorId === actor.id} />)}
    </div>
    {ticket.status === 'closed' && <p className="support-closed-note">Murojaat yopilgan. Javob yozsangiz, u qayta ochiladi.</p>}
    <div className="support-compose">
      <textarea value={text} maxLength={2000} placeholder="Javob yozing…" aria-label="Javob yozing"
        onChange={event => setText(event.target.value)} />
      <div className="support-actions">
        <button className="primary" disabled={busy || !text.trim()} onClick={submit}><Send size={15} />Yuborish</button>
      </div>
    </div>
  </section>;
}

export function SupportNew({ support, onCancel, onCreated }: {
  support: SupportProps;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const context = buildTicketContext({
    page: support.page, revision: support.revision, online: support.sync === 'online',
    pending: support.pending, build: support.build, errors: support.errors,
  });
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const done = await support.run({ type: 'ticket.create', text, context });
    setBusy(false);
    if (done) { setText(''); onCreated(); }
  };
  return <section className="support-compose">
    <h3>Yangi murojaat</h3>
    <textarea value={text} maxLength={2000} placeholder="Muammoni yozing" aria-label="Muammoni yozing"
      onChange={event => setText(event.target.value)} />
    <details className="support-context support-context-compose"><summary>Avtomatik ma’lumot</summary><ContextCard context={context} /></details>
    <div className="support-actions">
      <button className="primary" disabled={busy || !text.trim()} onClick={submit}><Send size={15} />Yuborish</button>
      <button className="secondary" disabled={busy} onClick={onCancel}>Bekor qilish</button>
    </div>
  </section>;
}

export function SupportPanel({ support }: { support: SupportProps }) {
  const [view, setView] = useState<'list' | 'new' | 'thread'>('list');
  const [ticketId, setTicketId] = useState('');
  // the worker alert also counts answers on tickets the owner already closed
  const [filter, setFilter] = useState<TicketFilter>(support.actor.role === 'admin' ? 'open' : 'all');
  const tickets = visibleTickets(support.tickets, support.actor);
  const open = (id: string) => {
    const ticket = tickets.find(row => row.id === id);
    const last = ticket ? lastMessage(ticket) : null;
    if (support.actor.role === 'worker' && ticket && last?.authorRole === 'admin') support.onSeen(ticket.id, last.id);
    setTicketId(id);
    setView('thread');
  };
  const ticket = tickets.find(row => row.id === ticketId);
  return <div className="support-panel">
    <SupportQuestions />
    {support.actor.role === 'display'
      ? <p className="info-note">Bu ekranda murojaat yuborish o‘chirilgan.</p>
      : view === 'new'
        ? <SupportNew support={support} onCancel={() => setView('list')} onCreated={() => setView('list')} />
        : view === 'thread' && ticket
          ? <SupportThread ticket={ticket} actor={support.actor} onBack={() => setView('list')} run={support.run} />
          : <SupportList tickets={tickets} actor={support.actor} filter={filter} seen={support.seen}
            onFilter={setFilter} onOpen={open} onCreate={() => setView('new')} />}
  </div>;
}
