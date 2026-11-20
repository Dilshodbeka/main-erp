import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dateLocale } from '../i18n';
import { CircleAlert, Download, FileText, MessageCircle, Mic, Paperclip, Send, Square, Trash2 } from 'lucide-react';
import { ChatError, chatErrorText } from '../chat';
import {
  orderAuthorLabel,
  orderChatDelete,
  orderChatDemoIncoming,
  orderChatFileUrl,
  orderChatMarkRead,
  orderChatMessages,
  orderChatSend,
  orderChatSendFile,
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
  /** The sender's part in this order (stage names), shown next to the name. */
  authorTitle?: string;
}

const describe = (error: unknown): string =>
  chatErrorText(error instanceof ChatError ? error.code : error instanceof Error ? error.message : 'network');

const time = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
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

const sizeText = (bytes: number): string => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A photo, voice note, video or document of a message. The private link is requested when the message is shown. */
function Attachment({ message }: { message: OrderChatMessage }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const path = message.file?.path ?? '';
  useEffect(() => {
    let active = true;
    if (path) void orderChatFileUrl(path).then(link => { if (active) setUrl(link); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [path]);
  if (!message.file) return null;
  if (failed) return <p className="chat-note">Faylni ochib bo‘lmadi.</p>;
  if (!url) return <p className="chat-note">Yuklanmoqda…</p>;
  if (message.kind === 'image') return <a href={url} target="_blank" rel="noreferrer" className="chat-photo"><img src={url} alt={message.file.name} loading="lazy" /></a>;
  if (message.kind === 'voice') return <audio className="chat-audio" controls preload="metadata" src={url} />;
  if (message.kind === 'video') return <video className="chat-video" controls preload="metadata" playsInline src={url} />;
  return <a className="chat-file" href={url} target="_blank" rel="noreferrer" download={message.file.name}><FileText size={18} /><span><b>{message.file.name}</b><small>{sizeText(message.file.size)}</small></span><Download size={16} /></a>;
}

export function OrderChat({ actor, orderId, customerId, customerName, refreshKey, onChanged, authorTitle = '' }: OrderChatProps) {
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
      await orderChatSend(actor, orderId, value, customerId, authorTitle);
      setText('');
      await load();
      changed.current();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setSending(false);
    }
  };

  const sendFile = async (file: Blob, name: string, voice = false) => {
    setSending(true);
    try {
      await orderChatSendFile(actor, orderId, file, name, voice, authorTitle);
      await load();
      changed.current();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setSending(false);
    }
  };

  /** One button: the first press starts the microphone, the second sends the voice note. */
  const toggleVoice = async () => {
    if (recording) { recorder.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream);
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        setRecording(false);
        const type = media.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        if (blob.size) void sendFile(blob, `ovoz-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'}`, true);
      };
      recorder.current = media;
      media.start();
      setRecording(true);
    } catch {
      setProblem(chatErrorText('mic_denied'));
    }
  };
  useEffect(() => () => { if (recorder.current?.state === 'recording') recorder.current.stop(); }, []);

  const removeChat = async () => {
    if (!window.confirm('Chat barcha xabar va fayllari bilan o‘chirilsinmi? Buni qaytarib bo‘lmaydi.')) return;
    try { await orderChatDelete(orderId); await load(); changed.current(); } catch (error) { setProblem(describe(error)); }
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
      <div className="order-chat-tools">
        {mode === 'demo' && <button type="button" className="secondary small" onClick={() => void simulate()}><MessageCircle size={14} />Kiruvchi (demo)</button>}
        {actorRole === 'admin' && messages.length > 0 && <button type="button" className="icon-button" aria-label="Chatni o‘chirish" title="Chatni o‘chirish" onClick={() => void removeChat()}><Trash2 size={16} /></button>}
      </div>
    </header>

    {problem && <div className="order-chat-problem"><CircleAlert size={16} /><span>{problem}</span></div>}

    <div className="order-chat-body">
      {loading && <p className="chat-note">Yuklanmoqda…</p>}
      {!loading && !messages.length && <p className="chat-note">Hozircha xabar yo‘q. Buyurtma bo‘yicha savollarni shu yerda yozing.</p>}
      {days.map(day => <div className="chat-group" key={day.key}>
        <div className="chat-day"><span>{day.label}</span></div>
        {day.items.map(message => message.authorKind === 'system'
          ? <article className="chat-system" key={message.id}><p>{message.text}</p><small className="chat-meta">{time(message.createdAt)}</small></article>
          : <article className={`chat-bubble ${message.authorKind === 'client' ? 'client' : 'operator'}`} key={message.id}>
            {message.file ? <Attachment message={message} /> : <p>{message.text}</p>}
            <small className="chat-meta">{message.authorTitle || orderAuthorLabel(message.authorKind)} · {message.authorName} · {time(message.createdAt)}</small>
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
      {mode !== 'demo' && <>
        <input ref={fileInput} type="file" hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.zip,.rar,.txt" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void sendFile(file, file.name); }} />
        <button type="button" className="secondary chat-tool" aria-label="Fayl, rasm yoki video biriktirish" title="Fayl, rasm yoki video biriktirish" disabled={sending || recording} onClick={() => fileInput.current?.click()}><Paperclip size={17} /></button>
        <button type="button" className={recording ? 'secondary chat-tool recording' : 'secondary chat-tool'} aria-label={recording ? 'Yozishni to‘xtatish va yuborish' : 'Ovozli xabar yozish'} title={recording ? 'Yozishni to‘xtatish va yuborish' : 'Ovozli xabar yozish'} disabled={sending && !recording} onClick={() => void toggleVoice()}>{recording ? <Square size={15} /> : <Mic size={17} />}</button>
      </>}
      <button type="button" className="primary" aria-label="Xabarni yuborish" disabled={sending || !text.trim()} onClick={() => void send()}><Send size={17} /></button>
    </footer>
    <small className="order-chat-hint">{recording ? 'Yozilmoqda… Yuborish uchun tugmani yana bosing.' : actorRole === 'admin' && customerId
      ? 'Matn mijozga ham boradi — agar uning Telegrami ulangan bo‘lsa. Fayl, ovoz va videoni faqat buyurtma ishtirokchilari ko‘radi.'
      : 'Xabar buyurtma ishtirokchilariga ko‘rinadi.'}</small>
  </section>;
}
