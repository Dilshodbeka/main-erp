import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, CircleAlert, Copy, Download, ExternalLink, FileText, Image as ImageIcon, Link2, MessageCircle, Paperclip, Send, Unlink, X } from 'lucide-react';
import {
  ChatError,
  DEMO_FILE_LIMIT,
  chatCreateLink,
  chatErrorText,
  chatFileUrl,
  chatLinkManual,
  chatMarkRead,
  chatMessages,
  chatSendFile,
  chatSendText,
  chatUnlink,
  demoSimulateIncoming,
  type ChatLinkInfo,
  type ChatMessage,
} from '../chat';
import { MAX_TELEGRAM_FILE_BYTES, OUTBOUND_ACCEPT, sanitizeFileName, validateOutboundFile } from '../../supabase/functions/_shared/telegram';
import { mode } from '../repository';
import { formatMoney } from '../i18n';
import { debtReminderMessage } from '../serviceNotify';
import type { Customer } from '../types';

export function ChatBadge({ count, className = '' }: { count: number; className?: string }) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return <span className={`chat-count ${className}`} aria-label={`${count} o‘qilmagan xabar`}>{count > 99 ? '99+' : count}</span>;
}

interface TelegramChatProps {
  customer: Customer;
  companyId: string;
  chatId: string | null;
  debt: number;
  refreshKey: number;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (message: string, error?: boolean) => void;
}

const describe = (error: unknown): string =>
  chatErrorText(error instanceof ChatError ? error.code : error instanceof Error ? error.message : 'network');

const fileSize = (size: number | null): string => {
  if (!size || size <= 0) return 'Hajm noma’lum';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const dayKey = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const dayLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
};

export function TelegramChat({ customer, companyId, chatId, debt, refreshKey, onClose, onChanged, onNotice }: TelegramChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<ChatLinkInfo | null>(null);
  const [linkError, setLinkError] = useState('');
  const [copied, setCopied] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState('');
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const changed = useRef(onChanged);
  const noticeRef = useRef(onNotice);
  changed.current = onChanged;
  noticeRef.current = onNotice;

  const notice = (message: string, error = false) => noticeRef.current(message, error);

  const load = useCallback(async () => {
    try {
      const list = await chatMessages(customer.id);
      setMessages(list);
      setProblem('');
      if (list.some(message => !message.isRead)) {
        await chatMarkRead(customer.id);
        changed.current();
      }
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setLoading(false);
    }
  }, [customer.id]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const days = useMemo(() => {
    const groups: { key: string; label: string; items: ChatMessage[] }[] = [];
    for (const message of messages) {
      const key = dayKey(message.createdAt);
      const last = groups.at(-1);
      if (!last || last.key !== key) {
        groups.push({ key, label: dayLabel(message.createdAt), items: [message] });
      } else last.items.push(message);
    }
    return groups;
  }, [messages]);

  const send = async () => {
    const value = text.trim();
    if (!value || !chatId || sending) return;
    setSending(true);
    try {
      await chatSendText(customer.id, value);
      setText('');
      await load();
      changed.current();
    } catch (error) {
      notice(describe(error), true);
    } finally {
      setSending(false);
    }
  };

  const remindDebt = async () => {
    if (!chatId || sending || debt <= 0) return;
    if (!window.confirm(`Qarz eslatmasini yuborish: ${formatMoney(debt)}?`)) return;
    setSending(true);
    try {
      await chatSendText(customer.id, debtReminderMessage(customer, debt));
      await load();
      changed.current();
      notice('Qarz eslatmasi yuborildi.');
    } catch (error) {
      notice(describe(error), true);
    } finally {
      setSending(false);
    }
  };

  const attach = async (file: File) => {
    if (!chatId || sending) return;
    setSending(true);
    try {
      const limit = mode === 'demo' ? DEMO_FILE_LIMIT : MAX_TELEGRAM_FILE_BYTES;
      if (file.size > limit) throw new ChatError(mode === 'demo' ? 'demo_file_too_large' : 'file_too_large');
      const allowed = validateOutboundFile({ name: file.name, size: file.size });
      if (!allowed.ok) throw new ChatError(allowed.code);
      await chatSendFile(companyId, customer.id, file, text.trim());
      setText('');
      await load();
      changed.current();
    } catch (error) {
      notice(describe(error), true);
    } finally {
      setSending(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const openFile = async (message: ChatMessage, download: boolean) => {
    try {
      const known = fileUrls[message.id];
      const url = known ?? (await chatFileUrl(message));
      if (!url) { notice('Fayl havolasi topilmadi.', true); return; }
      if (!known) setFileUrls(previous => ({ ...previous, [message.id]: url }));
      if (download) {
        const linkElement = document.createElement('a');
        linkElement.href = url;
        linkElement.download = sanitizeFileName(message.fileName || 'fayl');
        linkElement.rel = 'noopener';
        linkElement.click();
        return;
      }
      if (message.fileType === 'photo') return;
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      notice(describe(error), true);
    }
  };

  const createLink = async () => {
    setLinkError('');
    try {
      setLink(await chatCreateLink(companyId, customer.id));
      changed.current();
    } catch (error) {
      setLinkError(describe(error));
    }
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notice('Havolani nusxalab bo‘lmadi. Matnni qo‘lda belgilang.', true);
    }
  };

  const linkManually = async () => {
    if (!manual.trim()) return;
    setLinkError('');
    try {
      await chatLinkManual(customer.id, manual.trim());
      setManual('');
      setManualOpen(false);
      changed.current();
    } catch (error) {
      setLinkError(describe(error));
    }
  };

  const unlink = async () => {
    setLinkError('');
    try {
      await chatUnlink(customer.id);
      setLink(null);
      changed.current();
    } catch (error) {
      notice(describe(error), true);
    }
  };

  const demoStart = async () => {
    setLinkError('');
    try {
      await chatLinkManual(customer.id, `7001${String(Date.now()).slice(-7)}`);
      setLink(null);
      changed.current();
    } catch (error) {
      setLinkError(describe(error));
    }
  };

  const simulateIncoming = async () => {
    try {
      await demoSimulateIncoming(customer.id);
    } catch (error) {
      notice(describe(error), true);
    }
  };

  const fileCard = (message: ChatMessage) => (
    <div className="chat-file">
      <span className="chat-file-icon">{message.fileType === 'photo' ? <ImageIcon size={17} /> : <FileText size={17} />}</span>
      <div>
        <b>{message.fileName || 'Fayl'}</b>
        <small>{fileSize(message.fileSize)}</small>
      </div>
      <div className="chat-file-actions">
        <button type="button" className="icon-button" aria-label={`${message.fileName || 'Fayl'}ni ochish`} onClick={() => void openFile(message, false)}><ExternalLink size={15} /></button>
        <button type="button" className="icon-button" aria-label={`${message.fileName || 'Fayl'}ni yuklab olish`} onClick={() => void openFile(message, true)}><Download size={15} /></button>
      </div>
      {message.fileType === 'photo' && fileUrls[message.id] && <img className="chat-preview" src={fileUrls[message.id]} alt={message.fileName || 'Rasm'} loading="lazy" />}
    </div>
  );

  return <div className="drawer-overlay chat-overlay">
    <button className="drawer-shade" aria-label="Chatni yopish" onClick={onClose} />
    <aside className="chat-drawer" role="dialog" aria-modal="true" aria-label={`${customer.name} bilan Telegram chat`}>
      <header>
        <div className="chat-ident">
          <div className="avatar pale">{customer.name.slice(0, 1)}</div>
          <div>
            <span className="eyebrow">TELEGRAM CHAT</span>
            <h2>{customer.name}</h2>
            {chatId
              ? <p className="chat-state linked"><i />Bog‘langan · chat ID {chatId}</p>
              : <p className="chat-state"><i />Hali bog‘lanmagan</p>}
          </div>
        </div>
        <div className="chat-head-actions">
          {mode === 'demo' && chatId && <button type="button" className="secondary small" onClick={() => void simulateIncoming()}><MessageCircle size={14} />Kiruvchi (demo)</button>}
          {customer.kind === 'service' && chatId && <button type="button" className="secondary small" disabled={sending || debt <= 0} title={debt > 0 ? `Qarz: ${formatMoney(debt)}` : 'Qarz yo‘q'} onClick={() => void remindDebt()}><Bell size={14} />Qarz eslatmasi</button>}
          {chatId && <button type="button" className="secondary small" onClick={() => void unlink()}><Unlink size={14} />Uzish</button>}
          <button type="button" className="icon-button" aria-label="Chatni yopish" onClick={onClose}><X size={20} /></button>
        </div>
      </header>

      {problem && <div className="chat-problem"><CircleAlert size={18} /><span>{problem}</span></div>}

      {!chatId && <section className="chat-link-panel">
        <h3>Telegram’ni ulash</h3>
        <p>Mijoz botga o‘zi o‘tishi uchun bir martalik havola yarating. Havola 24 soat amal qiladi. Mijoz «Start» bosgach chat avtomatik bog‘lanadi.</p>
        {link
          ? <div className="chat-link-result">
            <code>{link.url}</code>
            <div className="button-group">
              <button type="button" className="secondary small" onClick={() => void copyLink()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Nusxalandi' : 'Nusxalash'}</button>
              {mode === 'demo' && <button type="button" className="primary small" onClick={() => void demoStart()}><MessageCircle size={14} />Mijoz «Start» bosdi (demo)</button>}
            </div>
            <small>Amal qiladi: {new Date(link.expiresAt).toLocaleString('uz-UZ')}</small>
          </div>
          : <button type="button" className="primary small" onClick={() => void createLink()}><Link2 size={14} />Havola yaratish</button>}
        <button type="button" className="text-button" onClick={() => setManualOpen(value => !value)}>Chat ID orqali bog‘lash<Link2 size={13} /></button>
        {manualOpen && <div className="chat-manual">
          <input aria-label="Telegram chat ID" value={manual} onChange={event => setManual(event.target.value)} placeholder="Masalan, 700100001" inputMode="numeric" />
          <button type="button" className="secondary small" onClick={() => void linkManually()} disabled={!manual.trim()}>Bog‘lash</button>
        </div>}
        <small>Chat ID — mijozning Telegram raqami emas. Uni faqat mijoz botga yozgandan keyin bilib olish mumkin.</small>
        {linkError && <div className="warning">{linkError}</div>}
      </section>}

      <div className="chat-body">
        {loading && <p className="chat-note">Yuklanmoqda…</p>}
        {!loading && !messages.length && <p className="chat-note">Hozircha xabarlar yo‘q.{chatId ? ' Birinchi xabarni pastdan yozing.' : ''}</p>}
        {days.map(day => <div className="chat-group" key={day.key}>
          <div className="chat-day"><span>{day.label}</span></div>
          {day.items.map(message => <article className={`chat-bubble ${message.sender}`} key={message.id}>
            {message.text && <p>{message.text}</p>}
            {message.fileType && message.fileType !== 'text' && message.fileType !== 'voice' && fileCard(message)}
            {message.fileType === 'voice' && <div className="chat-file"><span className="chat-file-icon"><MessageCircle size={17} /></span><div><b>Ovozli xabar</b><small>{fileSize(message.fileSize)}</small></div><div className="chat-file-actions"><button type="button" className="icon-button" aria-label="Ovozli xabarni ochish" onClick={() => void openFile(message, false)}><ExternalLink size={15} /></button></div></div>}
            <small className="chat-meta">{new Date(message.createdAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</small>
          </article>)}
        </div>)}
        <div ref={endRef} />
      </div>

      {chatId && <footer className="chat-composer">
        <input ref={fileInput} type="file" accept={OUTBOUND_ACCEPT} hidden onChange={event => { const file = event.target.files?.[0]; if (file) void attach(file); }} />
        <button type="button" className="icon-button" aria-label="Fayl yoki chizma biriktirish" disabled={sending} onClick={() => fileInput.current?.click()}><Paperclip size={19} /></button>
        <textarea
          aria-label="Xabar matni"
          value={text}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }}
          placeholder="Xabar yozing… (Enter — yuborish, Shift+Enter — yangi qator)"
          maxLength={4096}
          rows={1}
        />
        <button type="button" className="primary" aria-label="Xabarni yuborish" disabled={sending || !text.trim()} onClick={() => void send()}><Send size={17} /></button>
        <small className="chat-hint">Fayllar: PDF, rasm, DWG/DXF, ofis hujjatlari, arxivlar · {mode === 'demo' ? 'demo rejimida 1 MB gacha' : '20 MB gacha'}</small>
      </footer>}
    </aside>
  </div>;
}
