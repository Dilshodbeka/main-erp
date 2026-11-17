import { useState } from 'react';
import { ChevronDown, ChevronRight, Package, Pencil } from 'lucide-react';
import { reservedQty, shippedQty, stockQty } from '../domain';
import { matchesQuery, sortRows, type SortOption, type SortState } from '../listview';
import { Empty, Section, date, money, num } from '../ui';
import { categoryLabel, inWarehouseGroup, inWarehouseLeaf, warehouseGroups } from '../warehouse';
import type { State } from '../types';
import { SortSelect } from './SortSelect';

type WarehouseTab = 'materials' | 'blanks' | 'finished';
type StockSortKey = 'name' | 'stock' | 'available' | 'value';

const tabs: [WarehouseTab, string][] = [
  ['materials', 'Materiallar bazasi'],
  ['blanks', 'Zagotovkalar'],
  ['finished', 'Tayyor mahsulot'],
];

export function WarehouseCatalog({ state, warehouseId, search, onEdit, onCount }: {
  state: State; warehouseId: string; search: string; onEdit: (itemId: string) => void; onCount: (itemId: string) => void;
}) {
  const [tab, setTab] = useState<WarehouseTab>('materials');
  const [group, setGroup] = useState<string | null>(null);
  const [leaf, setLeaf] = useState<string | null>(null);
  const [uncategorized, setUncategorized] = useState(false);
  const [open, setOpen] = useState<string[]>(warehouseGroups.map(row => row.code));
  const [stockFilter, setStockFilter] = useState('all');
  const [stockSort, setStockSort] = useState<SortState<StockSortKey> | null>({ field: 'name', direction: 'asc' });
  const customerName = (id: string) => state.customers.find(row => row.id === id)?.name ?? 'Mijoz';
  const scoped = state.items.filter(item => tab === 'materials'
    ? item.kind === 'material'
    : tab === 'blanks' ? item.kind === 'blank' : item.kind === 'finished');
  const searched = scoped.filter(item => matchesQuery([item.name, categoryLabel(item.category), item.customerId ? customerName(item.customerId) : null], search));
  const sortOptions: SortOption<State['items'][number], StockSortKey>[] = [
    { value: 'name', label: 'Nomi', get: item => item.name },
    { value: 'stock', label: 'Omborda', get: item => stockQty(state, item.id, warehouseId) },
    { value: 'available', label: 'Bo‘sh miqdor', get: item => stockQty(state, item.id, warehouseId) - reservedQty(state, item.id, warehouseId) },
    { value: 'value', label: 'Qiymat', get: item => item.customerId ? null : stockQty(state, item.id, warehouseId) * (tab === 'finished' ? item.salePrice : item.cost) },
  ];
  const visible = sortRows(searched.filter(item => {
    if (uncategorized) return item.category === null;
    if (!inWarehouseGroup(item.category, group) || !inWarehouseLeaf(item.category, leaf)) return false;
    const free = stockQty(state, item.id, warehouseId) - reservedQty(state, item.id, warehouseId);
    return stockFilter === 'all' || (stockFilter === 'out' ? free <= 0 : stockFilter === 'low' ? free > 0 && free < item.minQty : free >= item.minQty);
  }), sortOptions, stockSort);
  const count = (groupCode: string | null, leafCode: string | null = null) =>
    searched.filter(item => inWarehouseGroup(item.category, groupCode) && inWarehouseLeaf(item.category, leafCode)).length;
  const uncategorizedCount = searched.filter(item => item.category === null).length;
  const selectTab = (next: WarehouseTab) => { setTab(next); setGroup(null); setLeaf(null); setUncategorized(false); };
  const selectGroup = (code: string | null) => { setGroup(code); setLeaf(null); setUncategorized(false); };
  const selectLeaf = (groupCode: string, leafCode: string) => { setGroup(groupCode); setLeaf(leafCode); setUncategorized(false); };
  const toggle = (code: string) => setOpen(current => current.includes(code) ? current.filter(row => row !== code) : [...current, code]);
  const readyOrders = state.orders.filter(order => order.kind !== 'series' && ['ready', 'shipped', 'delivered'].includes(order.status));
  const valueHead = tab === 'finished' ? 'Sotuv narxi' : 'Tannarx / dona';
  const hint = tab === 'materials'
    ? '01–07 tasniflagich: list, kromka, pogon, mahkamlagich, furnitura va sarf materiallari. Kategoriya nomenklatura kartasida o‘zgartiriladi.'
    : tab === 'blanks'
      ? 'Kesish, kromkalash va bo‘yashdan keyingi qismlar. Zagotovka seriya yoki buyurtma ichida paydo bo‘ladi.'
      : 'Qadoqlangan tayyor mebel. Sotuv narxi katalogda, tannarx ishlab chiqarishdan yig‘iladi.';

  return <>
    <Section title="Ombor tuzilmasi" hint={hint} action={<div className="section-tools"><div className="segmented tight warehouse-tabs">{tabs.map(([key, label]) => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => selectTab(key)}>{label}</button>)}</div><select aria-label="Zaxira filtri" value={stockFilter} onChange={event => setStockFilter(event.target.value)}><option value="all">Barcha qoldiqlar</option><option value="low">Minimaldan past</option><option value="out">Tugagan</option><option value="ok">Yetarli</option></select><SortSelect value={stockSort} onChange={setStockSort} options={sortOptions} /></div>}>
      <div className={tab === 'materials' ? 'warehouse-layout' : ''}>
        {tab === 'materials' && <aside className="warehouse-tree" aria-label="Materiallar tasniflagichi">
          <button className={`tree-root ${!group && !uncategorized ? 'active' : ''}`} onClick={() => selectGroup(null)}>
            <Package size={15} /><span>Barcha materiallar</span><b>{searched.length}</b>
          </button>
          {warehouseGroups.map(row => <div className="tree-group" key={row.code}>
            <div className={`tree-row ${group === row.code && !leaf && !uncategorized ? 'active' : ''}`}>
              <button className="tree-toggle" aria-label={`${row.name} guruhini ${open.includes(row.code) ? 'yig‘ish' : 'ochish'}`} aria-expanded={open.includes(row.code)} onClick={() => toggle(row.code)}>{open.includes(row.code) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
              <button className="tree-select" onClick={() => selectGroup(row.code)}><span className="tree-code">{row.code}</span><span>{row.name}</span><b>{count(row.code)}</b></button>
            </div>
            {open.includes(row.code) && <div className="tree-leaves">{row.children.map(child => <button key={child.code} className={`tree-leaf ${leaf === child.code ? 'active' : ''}`} onClick={() => selectLeaf(row.code, child.code)}><span className="tree-code">{child.code}</span><span>{child.name}</span><b>{count(row.code, child.code)}</b></button>)}</div>}
          </div>)}
          {uncategorizedCount > 0 && <button className={`tree-root extra ${uncategorized ? 'active' : ''}`} onClick={() => { setGroup(null); setLeaf(null); setUncategorized(true); }}>Tasniflanmagan<b>{uncategorizedCount}</b></button>}
        </aside>}
        <div className="warehouse-panel">
          <div className="table-scroll cardable"><table><thead><tr><th>Pozitsiya</th><th className="right">Omborda</th><th className="right">Band</th><th className="right">Bo‘sh</th><th className="right">{valueHead}</th><th /></tr></thead><tbody>{visible.map(item => {
            const qty = stockQty(state, item.id, warehouseId);
            const reserved = reservedQty(state, item.id, warehouseId);
            return <tr key={item.id}>
              <td data-label="Pozitsiya"><div className="item-cell">{item.photo
                ? <img className="item-thumb" src={item.photo} alt="" loading="lazy" />
                : <span className="item-thumb placeholder"><Package size={15} /></span>}<div><b>{item.name}</b><small>{categoryLabel(item.category)} · {item.customerId ? `Mijoz materiali: ${customerName(item.customerId)}` : `${num(item.minQty)} ${item.unit} minimum`}</small></div></div></td>
              <td data-label="Omborda" className="right">{num(qty)} {item.unit}</td>
              <td data-label="Band" className="right muted">{num(reserved)}</td>
              <td data-label="Bo‘sh" className={`right ${qty - reserved < item.minQty ? 'debt' : ''}`}><b>{num(qty - reserved)}</b></td>
              <td data-label={valueHead} className="right">{tab === 'finished'
                ? item.customerId ? 'Baholanmaydi' : <><b>{money(item.salePrice)}</b><small>tannarx {money(item.cost)}</small></>
                : item.customerId ? 'Baholanmaydi' : <><b>{money(item.cost)}</b><small>/ {item.unit}</small></>}</td>
              <td data-label="Amallar"><div className="table-actions"><button className="icon-button" aria-label={`${item.name} tahrirlash`} title="Tahrirlash" onClick={() => onEdit(item.id)}><Pencil size={16} /></button><button className="secondary small" onClick={() => onCount(item.id)}>Solishtirish</button></div></td>
            </tr>;
          })}</tbody></table></div>
          {!visible.length && <Empty text={tab === 'materials' ? 'Bu tasnifda material yo‘q. Pozitsiya qo‘shing yoki kategoriyani tahrirlang.' : tab === 'blanks' ? 'Zagotovkalar kesish va ishlovdan keyin paydo bo‘ladi.' : 'Tayyor mahsulot seriya chiqarilgandan keyin paydo bo‘ladi.'} />}
          <p className="panel-footnote">Tannarx faqat xarid, retsept va inventarizatsiya orqali o‘zgaradi. Tahrirlash nomi, birligi, minimal zaxirasi, sotuv narxi va tasniflagichni yangilaydi.</p>
        </div>
      </div>
    </Section>
    {tab === 'finished' && <Section title="Buyurtmalar bo‘yicha tayyor mahsulot" hint="Sotuvga tayyor, hali to‘liq yuborilmagan buyurtmalar"><div className="mini-cards">{readyOrders.map(order => <article key={order.id}><div className="attention-icon green"><Package size={20} /></div><div><b>{order.number} · {order.title}</b><small>Tayyor {num(order.qty)} · yuborilgan {num(shippedQty(state, order.id))} · muddat {date(order.dueDate)}</small></div><strong>{num(order.qty - shippedQty(state, order.id))} dona</strong></article>)}</div>{!readyOrders.length && <Empty text="Mahsulotlar barcha bosqichlar qabul qilingandan keyin paydo bo‘ladi" />}</Section>}
  </>;
}
