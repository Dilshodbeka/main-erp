import { useEffect, useState } from 'react';
import { dateLocale } from '../i18n';
import { Link2, Unlink } from 'lucide-react';
import { supabase } from '../repository';
import { Section } from '../ui';

interface LinkCode { code: string; expiresAt: string }

async function call<T>(name: string): Promise<T> {
  const { data, error } = await supabase!.rpc(name);
  if (error) throw new Error(error.message);
  return data as T;
}

/** The owner links their own Telegram to the bot: reports on demand and watcher notifications. */
export function OwnerTelegramCard({ onNotice }: { onNotice: (message: string, error?: boolean) => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [link, setLink] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState(false);

  // Before the migration is applied the card simply stays hidden.
  const refresh = () => { void call<number>('erp_owner_chats_count').then(setCount).catch(() => setCount(null)); };
  useEffect(refresh, []);
  if (count === null) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (error) { onNotice(error instanceof Error ? error.message : String(error), true); }
    finally { setBusy(false); }
  };

  return <Section title="Telegram nazorat" hint="Botdan kassa, qarzlar va buyurtmalar hisobotini oling; nazoratchi qotib qolgan buyurtma va kechikishlar haqida o‘zi yozadi.">
    <div className="settings-facts">
      <span>Ulangan Telegram<b className={count > 0 ? 'positive' : ''}>{count > 0 ? `${count} ta` : 'ulanmagan'}</b></span>
    </div>
    {link && <p className="subtle-note">Korxona botiga shu xabarni yuboring: <b className="owner-link-code">/ulash {link.code}</b><br />Kod {new Date(link.expiresAt).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })} gacha amal qiladi. Yuborgach «Tekshirish»ni bosing.</p>}
    <div className="data-actions">
      <button className="secondary" disabled={busy} onClick={() => void run(async () => setLink(await call<LinkCode>('erp_owner_link_code')))}><Link2 size={16} />{link ? 'Yangi kod' : 'Ulash kodi olish'}</button>
      {link && <button className="secondary" disabled={busy} onClick={refresh}>Tekshirish</button>}
      {count > 0 && <button className="text-button danger-text" disabled={busy} onClick={() => void run(async () => { await call<number>('erp_owner_chats_clear'); setLink(null); refresh(); onNotice('Telegram uzildi.'); })}><Unlink size={15} />Uzish</button>}
    </div>
  </Section>;
}
