import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { INDUSTRIES, addGroup, addLeaf, groupsOf, parseClassifier, presetGroups, type CompanySettings, type Industry } from '../classifier';
import type { WarehouseGroup } from '../warehouse';
import type { State } from '../types';
import { Field, Section } from '../ui';

// Ombor tasniflagichi: sohaga mos tayyor to‘plam yoki o‘z guruh va bo‘limlaringiz.
export function ClassifierEditor({ state, settings, busy, save }: {
  state: State; settings: CompanySettings; busy: boolean; save: (next: CompanySettings) => Promise<boolean>;
}) {
  const [industry, setIndustry] = useState<Industry>(settings.industry);
  const [groups, setGroups] = useState<WarehouseGroup[]>(() => groupsOf(settings));
  const [dirty, setDirty] = useState(false);
  const used = new Set(state.items.map(item => item.category).filter(Boolean));
  const change = (next: WarehouseGroup[]) => { setGroups(next); setDirty(true); };
  const rename = (groupCode: string, leafCode: string | null, name: string) => change(groups.map(group => group.code !== groupCode ? group
    : leafCode === null ? { ...group, name } : { ...group, children: group.children.map(leaf => leaf.code === leafCode ? { ...leaf, name } : leaf) }));
  const removeLeaf = (groupCode: string, leafCode: string) => change(groups.map(group => group.code === groupCode ? { ...group, children: group.children.filter(leaf => leaf.code !== leafCode) } : group));
  const pickIndustry = (next: Industry) => {
    if (dirty && !window.confirm('Tayyor to‘plam joriy o‘zgarishlar o‘rniga qo‘yiladi. Davom etasizmi?')) return;
    setIndustry(next); setGroups(presetGroups(next)); setDirty(true);
  };
  const valid = parseClassifier(groups);
  const complete = valid !== null && valid.length === groups.length && valid.every((group, index) => group.children.length === groups[index].children.length);
  return <Section title="Ombor tasniflagichi" hint="Sohangizga mos to‘plamni tanlang, keyin guruh va bo‘limlar nomini o‘zingizga moslang. Pozitsiyalarda kod saqlanadi, nomni o‘zgartirish xavfsiz."
    action={<div className="section-tools"><button className="primary small" disabled={busy || !dirty || !complete} onClick={() => { if (valid) void save({ industry, classifier: valid }).then(done => { if (done) setDirty(false); }); }}>Saqlash</button></div>}>
    <div className="classifier-top">
      <Field label="Soha (tayyor to‘plam)"><select value={industry} onChange={event => pickIndustry(event.target.value as Industry)}>{INDUSTRIES.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
      {!complete && <p className="warning">Har bir guruh va bo‘limga nom yozing.</p>}
    </div>
    <div className="classifier-grid">{groups.map(group => <div className="classifier-group" key={group.code}>
      <label><span>{group.code}</span><input aria-label={`Guruh ${group.code}`} maxLength={60} value={group.name} placeholder="Guruh nomi" onChange={event => rename(group.code, null, event.target.value)} /></label>
      {group.children.map(leaf => <label className="leaf" key={leaf.code}><span>{leaf.code}</span>
        <input aria-label={`Bo‘lim ${leaf.code}`} maxLength={60} value={leaf.name} placeholder="Bo‘lim nomi" onChange={event => rename(group.code, leaf.code, event.target.value)} />
        <button type="button" className="icon-button" aria-label={`Bo‘limni olib tashlash ${leaf.code}`} title={used.has(leaf.code) ? 'Bu bo‘limda pozitsiyalar bor' : 'Olib tashlash'} disabled={used.has(leaf.code)} onClick={() => removeLeaf(group.code, leaf.code)}><X size={14} /></button></label>)}
      <button type="button" className="text-button" onClick={() => change(addLeaf(groups, group.code))}><Plus size={13} />Bo‘lim</button>
    </div>)}
      <button type="button" className="secondary small classifier-add" onClick={() => change(addGroup(groups))}><Plus size={14} />Guruh</button>
    </div>
  </Section>;
}
