import type { FormEvent } from 'react';
import { Building2, LogOut, ShieldCheck } from 'lucide-react';

export interface CompanyOnboardingProps {
  busy: boolean;
  error: string;
  onSubmit: (name: string) => void;
  onSignOut: () => void;
}

export function CompanyOnboarding({ busy, error, onSubmit, onSignOut }: CompanyOnboardingProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit(String(form.get('name') || ''));
  };
  return (
    <div className="login-shell onboarding-shell">
      <div className="login-story"><div className="brand big"><span>A</span> ALIYA <small>ERP</small></div><h1>Korxonangiz uchun<br />alohida ish maydoni.</h1><p>Buyurtmalar, seh, ombor va pul.<br />Har bir korxona ma’lumotlari ajratilgan.</p><div className="story-stages">HISOB <span>·</span> KORXONA <span>·</span> JAMOA</div></div>
      <section className="login-card">
        <Building2 size={28} />
        <h2>Korxonangizni yarating</h2>
        <p>Hisobingiz hali korxonaga bog‘lanmagan. Nomni kiriting — tizim ish maydonini yaratadi va sizni egasi qiladi.</p>
        <form onSubmit={submit}>
          <label className="field"><span>Korxona nomi</span><input name="name" required minLength={2} maxLength={160} autoFocus placeholder="Masalan, Aliya Mebel" /></label>
          <button className="primary full" disabled={busy}>{busy ? 'Yaratilmoqda…' : 'Korxonani yaratish'}</button>
        </form>
        {error && <div className="warning">{error}</div>}
        <button type="button" className="secondary full" disabled={busy} onClick={onSignOut}><LogOut size={15} />Boshqa hisob bilan kirish</button>
        <small><ShieldCheck size={13} /> Amal faqat bir marta bajariladi. Keyingi kirishlarda ish maydoni avtomatik ochiladi.</small>
      </section>
    </div>
  );
}
