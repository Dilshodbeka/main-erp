import { Plus } from 'lucide-react';
import { Empty, Section } from '../ui';
import type { Command, State } from '../types';

export function WorkshopSettings({ state, busy, run }: {
  state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
}) {
  const activeCount = state.workshops.filter(row => row.active).length;
  return <Section title="Sexlar" hint="Dastgoh va operatsiyalar sexga bog‘lanadi. Kamida bitta faol sex qolishi kerak; sexni o‘chirish tarixni o‘zgartirmaydi.">
    <div className="warehouse-settings">
      {state.workshops.map(row => <form key={row.id} onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const name = String(data.get('name') || '').trim();
        const active = data.get('active') === 'on';
        if (!name || (name === row.name && active === row.active)) return;
        void run({ type: 'workshop.update', workshopId: row.id, name, active });
      }}>
        <input name="name" defaultValue={row.name} maxLength={80} aria-label={`${row.name} nomi`} required />
        <label className="warehouse-active"><input type="checkbox" name="active" defaultChecked={row.active} disabled={row.active && activeCount <= 1} />Faol</label>
        <button className="secondary small" disabled={busy}>Saqlash</button>
      </form>)}
      <form className="warehouse-create" onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const name = String(new FormData(form).get('name') || '').trim();
        if (!name) return;
        void run({ type: 'workshop.create', name }).then(ok => { if (ok) form.reset(); });
      }}>
        <input name="name" maxLength={80} placeholder="Yangi sex nomi" aria-label="Yangi sex nomi" required />
        <button className="primary small" disabled={busy}><Plus size={14} />Sex qo‘shish</button>
      </form>
    </div>
    {!state.workshops.length && <Empty text="Kamida bitta sex kerak" />}
  </Section>;
}
