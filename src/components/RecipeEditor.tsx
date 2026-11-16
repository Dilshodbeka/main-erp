import { useState } from 'react';
import { BookOpen, Plus, X } from 'lucide-react';
import { groupItems } from '../order-editor';
import { Dialog, Empty, Field, Section, num } from '../ui';
import type { Command, Recipe, RecipeComponentInput, RecipeVersion, State } from '../types';
import { MaterialPicker } from './MaterialPicker';

interface DraftComponent {
  key: string; slot: string; itemId: string; allowedItemIds: string[]; qtyPerUnit: number;
}

interface Draft {
  id: string | null; name: string; outputItemId: string; components: DraftComponent[];
}

const uid = () => crypto.randomUUID();

const emptyComponent = (): DraftComponent => ({ key: uid(), slot: '', itemId: '', allowedItemIds: [], qtyPerUnit: 1 });

function draftFrom(version: RecipeVersion): DraftComponent[] {
  return version.components.map(component => ({
    key: uid(), slot: component.slot, itemId: component.itemId ?? '',
    allowedItemIds: [...component.allowedItemIds], qtyPerUnit: component.qtyPerUnit,
  }));
}

function parseComponents(draft: Draft): RecipeComponentInput[] {
  if (!draft.components.length) throw new Error('Retseptga kamida bitta komponent qo‘shing');
  const seen = new Set<string>();
  return draft.components.map(component => {
    const slot = component.slot.trim();
    if (!slot) throw new Error('Har bir komponentda uya bo‘lishi kerak');
    if (seen.has(slot.toLowerCase())) throw new Error(`«${slot}» uyasi ikki marta ko‘rsatilgan`);
    seen.add(slot.toLowerCase());
    if (!(component.qtyPerUnit > 0)) throw new Error(`«${slot}» uyasi normasi noldan katta bo‘lishi kerak`);
    if (!component.itemId && !component.allowedItemIds.length) throw new Error(`«${slot}» uyasi uchun material yoki almashtirishni tanlang`);
    return {
      slot, itemId: component.itemId || null, allowedItemIds: [...component.allowedItemIds],
      qtyPerUnit: component.qtyPerUnit,
    };
  });
}

export function RecipeCatalog({ state, busy, run }: {
  state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const item = (id: string | null) => state.items.find(row => row.id === id);
  const outputs = state.items.filter(row => !row.customerId && row.kind !== 'material');
  const businessItems = state.items.filter(row => !row.customerId);

  const openNew = () => {
    const output = outputs[0];
    setError('');
    setDraft({ id: null, name: output?.name ?? '', outputItemId: output?.id ?? '', components: [emptyComponent()] });
  };

  const openVersion = (recipe: Recipe) => {
    const latest = recipe.versions[recipe.versions.length - 1];
    setError('');
    setDraft({ id: recipe.id, name: recipe.name, outputItemId: recipe.outputItemId, components: latest ? draftFrom(latest) : [emptyComponent()] });
  };

  const save = async () => {
    if (!draft) return;
    try {
      if (!draft.outputItemId) throw new Error('Zagotovka yoki tayyor mahsulotni tanlang');
      const components = parseComponents(draft);
      const command: Command = draft.id
        ? { type: 'recipe.version.create', recipeId: draft.id, components }
        : { type: 'recipe.create', outputItemId: draft.outputItemId, name: draft.name.trim() || item(draft.outputItemId)?.name || '', components };
      if (await run(command)) setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Retseptni tekshiring');
    }
  };

  return <>
    <Section
      title="Retseptlar va normalar"
      hint="Retsept versiyasi o‘zgarmas: yangi versiya chiqarilgan seriyalarni qayta yozmaydi."
      action={<button className="primary small" onClick={openNew} disabled={!outputs.length}><Plus size={15} />Retsept</button>}
    >
      <div className="recipe-list">
        {state.recipes.map(recipe => {
          const output = item(recipe.outputItemId);
          const latest = recipe.versions[recipe.versions.length - 1];
          return <article className="recipe-card" key={recipe.id}>
            <header>
              <div><b>{recipe.name}</b><small>{output?.name ?? 'Mahsulot o‘chirilgan'} · {recipe.versions.length} versiya</small></div>
              <span className={`badge ${recipe.active ? 'ready' : 'cancelled'}`}><i />{latest ? `v${latest.version}` : 'versiyasiz'}</span>
            </header>
            <div className="recipe-components">
              {latest?.components.map(component => {
                const chosen = item(component.itemId);
                const allowed = component.allowedItemIds.map(id => item(id)?.name).filter(Boolean);
                return <div key={component.id} className="recipe-component">
                  <span>{component.slot}</span>
                  <b>{num(component.qtyPerUnit)} × {chosen?.name ?? 'chiqarishda tanlanadi'}</b>
                  <small>{allowed.length ? `Almashtirishlar: ${allowed.join(', ')}` : 'Belgilangan material'}</small>
                </div>;
              })}
              {!latest?.components.length && <p className="subtle-note">Retseptda hozircha komponentlar yo‘q.</p>}
            </div>
            <footer>
              <button className="secondary small" onClick={() => openVersion(recipe)}><BookOpen size={14} />Yangi versiya</button>
              <small>Mahsulot: {output?.kind === 'blank' ? 'zagotovka' : 'tayyor mahsulot'}</small>
            </footer>
          </article>;
        })}
      </div>
      {!state.recipes.length && <Empty text={outputs.length ? 'Zagotovka yoki tayyor mahsulot uchun retsept yarating' : 'Avval omborga zagotovka yoki tayyor mahsulot qo‘shing'} />}
    </Section>

    {draft && <Dialog
      title={draft.id ? 'Retseptning yangi versiyasi' : 'Yangi retsept'}
      subtitle="Uya, birlik normasi va ruxsat etilgan almashtirishlar. Buyurtmachi retsept komponentlarini yetkazib bera olmaydi."
      close={() => { if (!busy) setDraft(null); }} wide
    >
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="form-body">
          <div className="form-grid">
            <Field label="Retsept nomi">
              <input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required maxLength={200} autoFocus />
            </Field>
            <Field label="Nima chiqaramiz">
              <select value={draft.outputItemId} disabled={!!draft.id} onChange={event => {
                const output = item(event.target.value);
                setDraft({ ...draft, outputItemId: event.target.value, name: draft.name.trim() ? draft.name : output?.name ?? '' });
              }} required>
                <option value="">Mahsulotni tanlang</option>
                {outputs.map(row => <option key={row.id} value={row.id}>{row.name} · {row.kind === 'blank' ? 'zagotovka' : 'tayyor mahsulot'}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-section-title">
            <div><h3>Komponentlar</h3><small>Bir birlik natijaga miqdor</small></div>
            <button type="button" className="secondary small" onClick={() => setDraft({ ...draft, components: [...draft.components, emptyComponent()] })}><Plus size={14} />Komponent</button>
          </div>
          {draft.components.map((component, index) => {
            const available = businessItems.filter(row => row.id !== draft.outputItemId);
            return <div className="component-editor" key={component.key}>
              <div className="component-head">
                <label className="inline-field"><span>Uya / detal</span><input value={component.slot} placeholder="Masalan, Fasad" required maxLength={120} onChange={event => setDraft({
                  ...draft, components: draft.components.map((row, i) => i === index ? { ...row, slot: event.target.value } : row),
                })} /></label>
                <label className="inline-field"><span>Birlik normasi</span><input type="number" min="0.001" step="0.001" required value={component.qtyPerUnit} onChange={event => setDraft({
                  ...draft, components: draft.components.map((row, i) => i === index ? { ...row, qtyPerUnit: Number(event.target.value) } : row),
                })} /></label>
                <button type="button" className="icon-button" aria-label={`Komponentni olib tashlash ${index + 1}`} disabled={draft.components.length === 1} onClick={() => setDraft({ ...draft, components: draft.components.filter((_, i) => i !== index) })}><X size={17} /></button>
              </div>
              <div className="inline-field"><span>Asosiy material</span><MaterialPicker label={`Asosiy material ${index + 1}`}
                value={component.itemId} groups={groupItems(available)} placeholder="Asosiy materialsiz" clearLabel="Asosiy materialsiz"
                describe={row => row.kind === 'blank' ? 'zagotovka' : row.kind === 'finished' ? 'tayyor' : row.unit}
                onChange={itemId => setDraft({
                  ...draft, components: draft.components.map((row, i) => i === index ? { ...row, itemId } : row),
                })} /></div>
              <div className="component-allowed">
                <small>Ruxsat etilgan almashtirishlar</small>
                <div className="employee-picker">{available.map(option => <label key={option.id}>
                  <input type="checkbox" checked={component.allowedItemIds.includes(option.id)} onChange={event => setDraft({
                    ...draft, components: draft.components.map((entry, i) => i === index
                      ? { ...entry, allowedItemIds: event.target.checked ? [...entry.allowedItemIds, option.id] : entry.allowedItemIds.filter(id => id !== option.id) }
                      : entry),
                  })} />
                  {option.name}
                </label>)}</div>
              </div>
            </div>;
          })}
          {error && <div className="warning">{error}</div>}
          <p className="subtle-note">Norma pul bilan hisobdan chiqarilmaydi. Qiymat materiallar seriyali ishlab chiqarishga berilganda paydo bo‘ladi.</p>
        </div>
        <footer className="form-footer">
          <button type="button" className="secondary" onClick={() => setDraft(null)} disabled={busy}>Bekor qilish</button>
          <button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : draft.id ? 'Versiya yaratish' : 'Retsept yaratish'}</button>
        </footer>
      </form>
    </Dialog>}
  </>;
}
