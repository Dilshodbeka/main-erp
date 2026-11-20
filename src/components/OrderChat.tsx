import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, MessageCircle, Send } from 'lucide-react';
import { ChatError, chatErrorText } from '../chat';
import {
  orderAuthorLabel,
  orderChatDemoIncoming,
  orderChatMarkRead,
  orderChatMessages,
  orderChatSend,
  type OrderChatMessage,
} from '../order-chat';
import { mode } from '../repository';
import type { Actor } from '../types';

interface OrderChatProps {
  actor: Actor;
  orderId: string;
  customerId: string | null;
  customerName: string | null;
  refreshKey: number;
  onChanged: () => void;
}

const describe = (error: unknown): string =>
  chatErrorText(error instanceof ChatError ? error.code : error instanceof Error ? error.message : 'network');

const time = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
};

const dayKey = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const dayLabel = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
};

export function OrderChat({ actor, orderId, customerId, customerName, refreshKey, onChanged }: OrderChatProps) {
  const [messages, setMessages] = useState<OrderChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef('');
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const { id: actorId, name: actorName, role: actorRole, companyId } = actor;

  const load = useCallback(async () => {
    try {
      const list = await orderChatMessages(orderId);
      setMessages(list);
      setProblem('');
      const newest = list.filter(message => message.authorProfileId !== actorId).at(-1);
      if (newest && newest.createdAt > markedRef.current) {
        markedRef.current = newest.createdAt;
        await orderChatMarkRead({ id: actorId, name: actorName, role: actorRole, companyId }, orderId);
        changed.current();
      }
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setLoading(false);
    }
  }, [orderId, actorId, actorName, actorRole, companyId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const days = useMemo(() => {
    const groups: { key: string; label: string; items: OrderChatMessage[] }[] = [];
    for (const message of messages) {
      const key = dayKey(message.createdAt);
      const last = groups.at(-1);
      if (!last || last.key !== key) groups.push({ key, label: dayLabel(message.createdAt), items: [message] });
      else last.items.push(message);
    }
    return groups;
  }, [messages]);

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await orderChatSend(actor, orderId, value, customerId);
      setText('');
      await load();
      changed.current();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setSending(false);
    }
  };

  const simulate = async () => {
    try {
      await orderChatDemoIncoming(orderId);
      await load();
    } catch (error) {
      setProblem(describe(error));
    }
  };

  return <section className="order-chat" aria-label="Buyurtma chati">
    <header className="order-chat-head">
      <div>
        <span className="eyebrow">BUYURTMA CHATI</span>
        <h3>Menejer · Ispolateli · Klient</h3>
        <small>{customerName ? `Klient: ${customerName} · Telegram orqali` : 'Klient Telegram orqali yozadi'}</small>
      </div>
      {mode === 'demo' && <button type="button" className="secondary small" onClick={() => void simulate()}><MessageCircle size={14} />Kiruvchi (demo)</button>}
    </header>

    {problem && <div className="order-chat-problem"><CircleAlert size={16} /><span>{problem}</span></div>}

    <div className="order-chat-body">
      {loading && <p className="chat-note">Yuklanmoqda…</p>}
      {!loading && !messages.length && <p className="chat-note">Hozircha xabar yo‘q. Buyurtma bo‘yicha savollarni shu yerda yozing.</p>}
      {days.map(day => <div className="chat-group" key={day.key}>
        <div className="chat-day"><span>{day.label}</span></div>
        {day.items.map(message => <article className={`chat-bubble ${message.authorKind === 'client' ? 'client' : 'operator'}`} key={message.id}>
          <p>{message.text}</p>
          <small className="chat-meta">{orderAuthorLabel(message.authorKind)} · {message.authorName} · {time(message.createdAt)}</small>
        </article>)}
      </div>)}
      <div ref={endRef} />
    </div>

    <footer className="order-chat-composer">
      <textarea
        aria-label="Xabar matni"
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }}
        placeholder="Xabar yozing… (Enter — yuborish)"
        maxLength={4096}
        rows={1}
        disabled={sending}
      />
      <button type="button" className="primary" aria-label="Xabarni yuborish" disabled={sending || !text.trim()} onClick={() => void send()}><Send size={17} /></button>
    </footer>
    <small className="order-chat-hint">{actorRole === 'admin' && customerId
      ? 'Xabaringiz mijozga Telegram orqali boradi va shu yerda saqlanadi.'
      : 'Xabar buyurtma ishtirokchilariga ko‘rinadi.'}</small>
  </section>;
}
