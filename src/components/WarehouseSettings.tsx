import { Plus } from 'lucide-react';
import { Empty, Section } from '../ui';
import type { Command, State } from '../types';

export function WarehouseSettings({ state, busy, run }: {
  state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
}) {
  const activeCount = state.warehouses.filter(row => row.active).length;
  return <Section title="Omborlar" hint="Buyurtma, xarid va inventarizatsiya omborga bog‘lanadi. Kamida bitta faol ombor qolishi kerak.">
    <div className="warehouse-settings">
      {state.warehouses.map(row => <form key={row.id} onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const name = String(data.get('name') || '').trim();
        const active = data.get('active') === 'on';
        if (!name || (name === row.name && active === row.active)) return;
        void run({ type: 'warehouse.update', warehouseId: row.id, name, active });
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
        void run({ type: 'warehouse.create', name }).then(ok => { if (ok) form.reset(); });
      }}>
        <input name="name" maxLength={80} placeholder="Yangi ombor nomi" aria-label="Yangi ombor nomi" required />
        <button className="primary small" disabled={busy}><Plus size={14} />Ombor qo‘shish</button>
      </form>
    </div>
    {!state.warehouses.length && <Empty text="Kamida bitta ombor kerak" />}
  </Section>;
}
