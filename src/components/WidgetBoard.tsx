import type { ReactNode } from 'react';
import { ArrowUpRight, Banknote, MessageCircle, Package, ShoppingCart, Truck } from 'lucide-react';
import { cashBalance, payrollDebt, reservedQty, stockQty, supplierDebt } from '../domain';
import { customerBalance } from '../receivables';
import { Badge, date, money, num, statuses } from '../ui';
import { ChatBadge } from './TelegramChat';
import type { ChatOverview } from '../chat';
import type { Order, State, Status } from '../types';

interface WidgetBoardProps {
  state: State;
  chat: ChatOverview;
  onStage: (status: Status) => void;
  onGo: (page: string) => void;
  onOrder: (id: string) => void;
  onChat: (customerId: string) => void;
}

const stages: Status[] = ['draft', 'production', 'ready', 'shipped', 'delivered'];

export function WidgetBoard({ state, chat, onStage, onGo, onOrder, onChat }: WidgetBoardProps) {
  const midnight = new Date().setHours(0, 0, 0, 0);
  const overdue = (order: Order) => order.status !== 'delivered' && order.status !== 'cancelled'
    && new Date(`${order.dueDate}T00:00:00`).getTime() < midnight;

  const orders = state.orders.filter(order => order.kind !== 'series');
  const active = orders
    .filter(order => ['production', 'ready', 'shipped'].includes(order.status))
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
    .slice(0, 4);
  const readyOrders = orders.filter(order => order.status === 'ready').length;
  const low = state.items.filter(item => !item.customerId && stockQty(state, item.id) - reservedQty(state, item.id) < item.minQty);
  const stockValue = state.items.filter(item => !item.customerId).reduce((sum, item) => sum + stockQty(state, item.id) * item.cost, 0);
  const receivable = state.customers.reduce((sum, customer) => sum + customerBalance(state, customer.id).debt, 0);
  const payrollTotal = state.employees.reduce((sum, employee) => sum + payrollDebt(state, employee.id), 0);
  const supplierTotal = state.suppliers.reduce((sum, supplier) => sum + Math.max(0, supplierDebt(state, supplier.id)), 0);
  const unread = Object.entries(chat.unread)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .flatMap(([customerId, count]) => {
      const customer = state.customers.find(entry => entry.id === customerId);
      return customer ? [{ customer, count }] : [];
    });

  const amount = (value: number) => money(value).replace(/\s*so‘m$/u, '');
  const customerName = (order: Order) => state.customers.find(customer => customer.id === order.customerId)?.name || 'Mijoz';

  return <div className="widget-board">
    <Widget className="wide" title="Ishlab chiqarish" hint="Har bir buyurtma bosqichlar bo‘ylab" action={<WidgetLink onClick={() => onGo('production')}>Sehni ochish</WidgetLink>}>
      <div className="pipeline widget-pipeline">
        {stages.map((stage, index) => <button key={stage} onClick={() => onStage(stage)}>
          <span className={`step-number stage-${stage}`}>{String(index + 1).padStart(2, '0')}</span>
          <strong>{orders.filter(order => order.status === stage).length}</strong>
          <small>{statuses[stage]}</small>
        </button>)}
      </div>
      <ul className="widget-list">
        {active.map(order => <li key={order.id}>
          <button className="widget-row" onClick={() => onOrder(order.id)}>
            <span className="grow">
              <b>{order.number} · {order.title}</b>
              <small className={overdue(order) ? 'debt' : ''}>{customerName(order)} · muddat {date(order.dueDate)}</small>
            </span>
            <Badge status={order.status} />
          </button>
        </li>)}
      </ul>
      {!active.length && <p className="widget-empty">Faol buyurtmalar yo‘q. CRMdan ishga tushiring.</p>}
    </Widget>

    <Widget title="Nazoratda" hint="Keyingi qadamni o‘tkazib yubormang">
      <div className="attention">
        <button onClick={() => onGo('logistics')}><span className="attention-icon amber"><Truck size={20} /></span><div><b>Yuborishga tayyor</b><small>{readyOrders ? `${readyOrders} buyurtma yetkazishni kutmoqda` : 'Tayyor buyurtmalar yo‘q'}</small></div><ArrowUpRight size={15} /></button>
        <button onClick={() => onGo('warehouse')}><span className="attention-icon coral"><Package size={20} /></span><div><b>Materiallarni to‘ldirish</b><small>{low.length ? `${low.length} pozitsiya minimaldan past` : 'Kritik qoldiqlar yo‘q'}</small></div><ArrowUpRight size={15} /></button>
        <button onClick={() => onGo('people')}><span className="attention-icon green"><Banknote size={20} /></span><div><b>Ish haqi hisob-kitoblari</b><small>{money(payrollTotal)} to‘lash uchun</small></div><ArrowUpRight size={15} /></button>
        <button onClick={() => onGo('purchases')}><span className="attention-icon blue"><ShoppingCart size={20} /></span><div><b>Yetkazib beruvchilar</b><small>{money(supplierTotal)} qarz</small></div><ArrowUpRight size={15} /></button>
      </div>
    </Widget>

    <Widget title="Moliya" hint="Kassa, bank va qarzdorlik · UZS" action={<WidgetLink onClick={() => onGo('cash')}>Kassa</WidgetLink>}>
      <div className="widget-stat-row">
        <Stat label="Naqd pul" value={amount(cashBalance(state, 'cash'))} />
        <Stat label="Bank / karta" value={amount(cashBalance(state, 'bank'))} />
        <Stat label="Mijozlar qarzi" value={amount(receivable)} />
        <Stat label="Majburiyatlar" value={amount(supplierTotal + payrollTotal)} tone="debt" />
      </div>
      <p className="widget-footnote">O‘tkazmalar foyda yaratmaydi; qarz faqat bog‘langan to‘lovlar bilan yopiladi.</p>
    </Widget>

    <Widget title="Ombor" hint="Zaxira va tanqislik · UZS" action={<WidgetLink onClick={() => onGo('warehouse')}>Ombor</WidgetLink>}>
      <div className="widget-stat-row">
        <Stat label="Pozitsiyalar" value={state.items.length} />
        <Stat label="Zaxira qiymati" value={amount(stockValue)} />
      </div>
      <ul className="widget-list">
        {low.slice(0, 3).map(item => {
          const available = stockQty(state, item.id) - reservedQty(state, item.id);
          return <li key={item.id}>
            <button className="widget-row" onClick={() => onGo('warehouse')}>
              <Package size={16} />
              <span className="grow"><b>{item.name}</b><small>Bo‘sh {num(available)} {item.unit} · minimum {num(item.minQty)}</small></span>
              <span className="widget-tag">tanqis</span>
            </button>
          </li>;
        })}
      </ul>
      {!low.length && <p className="widget-empty">Barcha qoldiqlar me’yorida.</p>}
    </Widget>

    <Widget title="Mijozlar va chat" hint="Telegram yozishmalari" action={<WidgetLink onClick={() => onGo('orders')}>CRM</WidgetLink>}>
      <div className="widget-stat-row">
        <Stat label="Mijozlar" value={state.customers.length} />
        <Stat label="Bog‘langan chat" value={Object.keys(chat.linked).length} />
      </div>
      <span className="widget-subtitle">O‘qilmagan xabarlar</span>
      <ul className="widget-list">
        {unread.map(({ customer, count }) => <li key={customer.id}>
          <button className="widget-row" onClick={() => onChat(customer.id)}>
            <span className="avatar pale">{customer.name.slice(0, 1)}</span>
            <span className="grow"><b>{customer.name}</b><small>Telegram chat ochish</small></span>
            <ChatBadge count={count} />
            <MessageCircle size={15} />
          </button>
        </li>)}
      </ul>
      {!unread.length && <p className="widget-empty">O‘qilmagan xabarlar yo‘q.</p>}
    </Widget>
  </div>;
}

function Widget({ title, hint, action, className = '', children }: { title: string; hint?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`widget ${className}`}>
    <header className="widget-head">
      <div className="widget-title"><h2>{title}</h2>{hint && <small>{hint}</small>}</div>
      {action}
    </header>
    <div className="widget-body">{children}</div>
  </section>;
}

function WidgetLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button className="widget-link" onClick={onClick}>{children}<ArrowUpRight size={13} /></button>;
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'debt' }) {
  return <div className="widget-stat"><small>{label}</small><b className={tone === 'debt' ? 'debt' : ''}>{value}</b></div>;
}
