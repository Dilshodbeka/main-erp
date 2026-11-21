import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { disablePush, enablePush, pushStatus, PushError, type PushStatus } from '../push';

/** "Notifications on this device" switch in the side menu: for the owner and for every worker. */
export function PushToggle({ supabase, onNotice }: { supabase: SupabaseClient; onNotice: (message: string, error?: boolean) => void }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushStatus().then(setStatus).catch(() => setStatus('unsupported')); }, []);
  if (!status || status === 'unsupported') return null;
  if (status === 'ios-install') return <p className="push-hint"><Bell size={15} />Bildirishnomalar uchun ilovani «Bosh ekranga» o‘rnating.</p>;
  if (status === 'blocked') return <p className="push-hint"><BellOff size={15} />Bildirishnomalar brauzerda bloklangan. Manzil satridagi qulf belgisini bosing → «Uvedomleniya / Bildirishnomalar» → «Ruxsat berish», so‘ng sahifani yangilang.</p>;
  const toggle = async () => {
    setBusy(true);
    try {
      if (status === 'on') { await disablePush(supabase); onNotice('Bu qurilmada bildirishnomalar o‘chirildi.'); }
      else { await enablePush(supabase); onNotice('Bildirishnomalar yoqildi: yangiliklar shu qurilmaga keladi.'); }
    } catch (error) {
      onNotice(error instanceof PushError ? error.message : 'Bildirishnomalarni sozlab bo‘lmadi.', true);
    } finally {
      setStatus(await pushStatus().catch(() => 'unsupported' as const));
      setBusy(false);
    }
  };
  return (
    <button type="button" className={status === 'on' ? 'push-toggle on' : 'push-toggle'} disabled={busy} aria-pressed={status === 'on'} onClick={() => void toggle()}>
      {status === 'on' ? <Bell size={16} /> : <BellOff size={16} />}
      <span>{status === 'on' ? 'Bildirishnomalar yoqilgan' : 'Bildirishnomalarni yoqish'}</span>
    </button>
  );
}
