import { useState } from 'react';
import { Check } from 'lucide-react';
import { saveCompanyPhone } from '../company-profile';
import { errorText } from '../ui';

export function CompanyProfileSettings({ name, phone, onSaved, onNotice }: {
  name: string;
  phone: string;
  onSaved: (phone: string) => void;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [value, setValue] = useState(phone);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const saved = await saveCompanyPhone(value);
      setValue(saved);
      onSaved(saved);
      onNotice('Aloqa telefoni saqlandi.');
    } catch (error) {
      onNotice(errorText(error), true);
    } finally {
      setBusy(false);
    }
  };

  return <div className="company-profile-setting">
    <p className="subtle-note">Mijozga boradigan hujjatlarda chiqadi: <b>{name || 'korxona nomi topilmadi'}</b></p>
    <div className="company-profile-row">
      <label className="inline-field"><span>Aloqa telefoni</span>
        <input name="companyPhone" type="tel" maxLength={40} value={value} placeholder="+998 90 123 45 67" onChange={event => setValue(event.target.value)} />
      </label>
      <button type="button" className="secondary" disabled={busy || value.trim() === phone} onClick={() => void save()}><Check size={16} />Saqlash</button>
    </div>
    <p className="subtle-note">Bo‘sh qoldirilsa hujjatda faqat korxona nomi ko‘rinadi.</p>
  </div>;
}
