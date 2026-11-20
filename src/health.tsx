import { CircleAlert, Clock, Package, TrendingUp, Wallet, Truck } from 'lucide-react';
import { actualCost, estimatedCost, reservedQty, stockQty } from './domain';
import { orderBalance } from './receivables';
import { shipmentQty } from './sales';
import type { Order, State } from './types';
import { date, dateTime, Empty, Metric, money, num, Section } from './ui';

const DAY = 86_400_000;
const MARGIN_THRESHOLD = 10;
const STOCK_MULTIPLIER = 3;
const monetary = (value: number) => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
const greaterThan = (value: number, limit: number) => value - limit > Number.EPSILON * Math.max(Math.abs(value), Math.abs(limit)) * 8;
const AGE_BANDS = [
  { key: '0-30', label: '0–30 kun' },
  { key: '31-60', label: '31–60 kun' },
  { key: '61-90', label: '61–90 kun' },
  { key: '91+', label: '91+ kun' },
  { key: 'unknown', label: 'Sana noma’lum' },
] as const;

function timestamp(value: string): number {
  return value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).getTime() : NaN;
}

// Local calendar days avoid UTC date shifts and 23/25-hour daylight-saving days.
function calendarDay(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY;
}

function ageDays(value: string, today: number): number | null {
  const time = timestamp(value);
  return Number.isFinite(time) ? Math.max(0, today - calendarDay(new Date(time))) : null;
}

function ageBand(age: number | null): typeof AGE_BANDS[number]['key'] {
  if (age === null) return 'unknown';
  if (age <= 30) return '0-30';
  if (age <= 60) return '31-60';
  if (age <= 90) return '61-90';
  return '91+';
}

function nextAction(state: State, order: Order): string {
  if (order.status === 'draft') return 'Hisob-kitob va materiallar mavjudligini tekshiring, ishga tushirishni kelishib oling.';
  if (order.status === 'ready') return 'To‘lov va tayyor buyurtmani yuborishni kelishib oling.';
  if (order.status === 'shipped') return 'Yetkazib berishni aniqlang va qabul qilinishini tasdiqlang.';
  if (order.materials.some(line => line.issuedQty < line.qty)) return 'To‘liqligini tekshiring va zaxiradagi materiallarni bering.';
  if (state.reports.some(report => report.orderId === order.id && report.status === 'submitted')) {
    return 'Ish bo‘yicha qabulni kutayotgan hisobotlarni tekshiring.';
  }
  const task = order.route.find(line => line.completed < line.planned);
  return task ? `Ish qoldig‘ini aniqlang: ${task.name}.` : 'Ishlarning tugallanganini va yuborishga tayyorligini tekshiring.';
}

export function healthMetrics(state: State, now = new Date()) {
  const nowTime = now.getTime();
  const today = calendarDay(now);
  const todayLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const openOrders = state.orders.filter(order => order.status !== 'delivered' && order.status !== 'cancelled');
  const delayedRows = openOrders.flatMap(order => {
    const due = timestamp(order.dueDate);
    const delayDays = today - calendarDay(new Date(due));
    return Number.isFinite(delayDays) && delayDays > 0
      ? [{ order, delayDays, amount: order.price, action: nextAction(state, order) }] : [];
  }).sort((a, b) => b.delayDays - a.delayDays || b.amount - a.amount);

  const receivableRows = state.orders.filter(order => order.status === 'delivered').flatMap(order => {
    const ledger = orderBalance(state, order.id);
    const debt = ledger?.outstanding ?? 0;
    const age = ageDays(order.createdAt, today);
    return debt > 0 ? [{
      order, paid: ledger?.paid ?? 0, debt, ageDays: age, ageBand: ageBand(age),
      customerName: state.customers.find(customer => customer.id === order.customerId)?.name ?? 'Buyurtmachi topilmadi',
    }] : [];
  }).sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1) || b.debt - a.debt);
  const ageBands = AGE_BANDS.map(band => {
    const rows = receivableRows.filter(row => row.ageBand === band.key);
    return { ...band, count: rows.length, amount: monetary(rows.reduce((sum, row) => sum + row.debt, 0)) };
  });

  const marginRows = state.orders.filter(order => order.status !== 'cancelled').map(order => {
    const plannedCost = estimatedCost(state, order);
    const plannedProfit = monetary(order.price - plannedCost);
    return {
      order, plannedCost, plannedProfit, actualCost: actualCost(state, order),
      plannedMarginPercent: order.price > 0 ? plannedProfit / order.price * 100 : null,
    };
  });
  const lowMarginRows = marginRows.filter(row => row.plannedMarginPercent !== null && greaterThan(MARGIN_THRESHOLD, row.plannedMarginPercent))
    .sort((a, b) => a.plannedMarginPercent! - b.plannedMarginPercent!);

  const ownItems = state.items.filter(item => item.customerId === null);
  const ownItemIds = new Set(ownItems.map(item => item.id));
  const inventoryRows = ownItems.map(item => {
    const stock = stockQty(state, item.id);
    const reserved = reservedQty(state, item.id);
    const free = Math.max(0, stock - reserved);
    const thresholdQty = item.minQty * STOCK_MULTIPLIER;
    const aboveThresholdQty = item.minQty > 0 && greaterThan(free, thresholdQty) ? free - thresholdQty : 0;
    return {
      item, stock, reserved, free, thresholdQty, aboveThresholdQty,
      stockValue: monetary(stock * item.cost), freeValue: monetary(free * item.cost),
      aboveThresholdValue: monetary(aboveThresholdQty * item.cost),
    };
  });
  const reviewRows = inventoryRows.filter(row => row.aboveThresholdQty > 0)
    .sort((a, b) => b.aboveThresholdValue - a.aboveThresholdValue);
  const stockValue = monetary(inventoryRows.reduce((sum, row) => sum + row.stockValue, 0));
  // Only recorded issues to orders, at issue-time cost. Counts/purchases are not consumption.
  const issuedOwnMaterialCost30Days = monetary(state.movements.reduce((sum, movement) => {
    const time = timestamp(movement.createdAt);
    return movement.direction === 'out' && movement.source === 'order' && ownItemIds.has(movement.itemId)
      && time >= nowTime - 30 * DAY && time <= nowTime
      ? sum + monetary(movement.qty * movement.unitCost) : sum;
  }, 0));

  const fulfillmentRows = state.orders.filter(order => order.status === 'delivered').flatMap(order => {
    const shipments = state.shipments.filter(shipment => shipment.orderId === order.id && shipment.status !== 'cancelled');
    const deliveredQty = shipments.filter(shipment => shipment.status === 'delivered').reduce((sum, shipment) => sum + shipmentQty(shipment), 0);
    const tolerance = Number.EPSILON * Math.max(1, order.qty) * 8;
    if (!shipments.length || deliveredQty + tolerance < order.qty
      || shipments.some(shipment => shipment.status !== 'delivered' || !shipment.deliveredAt)) return [];
    const times = shipments.map(shipment => timestamp(shipment.deliveredAt!));
    const created = timestamp(order.createdAt);
    if (!Number.isFinite(created) || times.some(time => !Number.isFinite(time))) return [];
    const delivered = Math.max(...times);
    if (delivered < created || delivered > nowTime) return [];
    return [{ order, deliveredAt: new Date(delivered).toISOString(), days: (delivered - created) / DAY }];
  });

  return {
    today: todayLabel,
    delayed: { rows: delayedRows, count: delayedRows.length, amount: monetary(delayedRows.reduce((sum, row) => sum + row.amount, 0)) },
    receivables: { rows: receivableRows, count: receivableRows.length, amount: monetary(receivableRows.reduce((sum, row) => sum + row.debt, 0)), ageBands },
    margins: marginRows,
    lowMargin: { rows: lowMarginRows, count: lowMarginRows.length, amount: monetary(lowMarginRows.reduce((sum, row) => sum + row.order.price, 0)), thresholdPercent: MARGIN_THRESHOLD },
    inventory: {
      rows: inventoryRows, count: inventoryRows.length, stockValue,
      freeValue: monetary(inventoryRows.reduce((sum, row) => sum + row.freeValue, 0)),
      reviewRows, reviewCount: reviewRows.length,
      reviewFreeValue: monetary(reviewRows.reduce((sum, row) => sum + row.freeValue, 0)),
      aboveThresholdValue: monetary(reviewRows.reduce((sum, row) => sum + row.aboveThresholdValue, 0)),
      thresholdMultiplier: STOCK_MULTIPLIER, issuedOwnMaterialCost30Days,
      stockCoverDays: issuedOwnMaterialCost30Days > 0 ? stockValue / issuedOwnMaterialCost30Days * 30 : null,
    },
    fulfillment: {
      rows: fulfillmentRows, count: fulfillmentRows.length,
      averageDays: fulfillmentRows.length ? fulfillmentRows.reduce((sum, row) => sum + row.days, 0) / fulfillmentRows.length : null,
    },
  };
}

export function HealthSection({ state }: { state: State }) {
  const metrics = healthMetrics(state);
  const { delayed, receivables, lowMargin, inventory, fulfillment } = metrics;
  return <>
    <Section title="Operatsion salomatlik" hint={`${date(metrics.today)} holatiga · haqiqiy yozuvlar, prognozsiz`}>
      <div className="metrics three">
        <Metric label="Muddati buzilgan buyurtmalar" value={delayed.count} detail={`${money(delayed.amount)} · buyurtmalarning to‘liq qiymati, zarar emas`} icon={Clock} />
        <Metric label="Qarzdagi pul" value={money(receivables.amount)} detail={`${receivables.count} yetkazilgan buyurtmada to‘lov qoldig‘i`} icon={Wallet} accent />
        <Metric label="Rejadagi marja < 10%" value={lowMargin.count} detail={`${money(lowMargin.amount)} · tekshirish uchun buyurtmalar qiymati`} icon={TrendingUp} />
      </div>
      <div className="metrics three">
        <Metric label="Tekshirish uchun zaxiralar" value={inventory.reviewCount} detail={`${money(inventory.aboveThresholdValue)} 3 × minimal me’yordan ortiq`} icon={Package} />
        <Metric label="O‘z zaxirasi bilan qoplash" value={inventory.stockCoverDays === null ? '—' : `${num(inventory.stockCoverDays)} kun`} detail={inventory.stockCoverDays === null ? 'Oxirgi 30 kunda buyurtmalarga chiqim yo‘q' : 'Zaxira qiymati va oxirgi 30 kun chiqimlari bo‘yicha'} icon={CircleAlert} />
        <Metric label="O‘rtacha bajarish sikli" value={fulfillment.averageDays === null ? '—' : `${num(fulfillment.averageDays)} kun`} detail={`${fulfillment.count} to‘liq yetkazilgan buyurtma sanalari bilan`} icon={Truck} />
      </div>
      <p className="subtle-note">Sikl: buyurtma yaratilgandan oxirgi yetkazib berishgacha, to‘liq sanalari bor barcha yakunlangan buyurtmalar bo‘yicha. Qoplash: o‘z zaxirasi qiymati / oxirgi 30 kunda buyurtmalarga chiqim qiymati × 30; bu talab prognozi emas.</p>
    </Section>

    <Section title="Buyurtmalarni tezlashtirish" hint="Muddat mahalliy bugungi sanadan oldin; yetkazilgan va bekor qilinganlar hisobga olinmaydi.">
      {delayed.count ? <div className="table-scroll cardable"><table><thead><tr><th>Buyurtma</th><th>Muddat</th><th>Kechikish</th><th>Buyurtma qiymati</th><th>Keyingi qadam</th></tr></thead><tbody>
        {delayed.rows.map(row => <tr key={row.order.id}><td data-label="Buyurtma"><strong>{row.order.number}</strong><small>{row.order.title}</small></td><td data-label="Muddat">{date(row.order.dueDate)}</td><td data-label="Kechikish"><span className="badge debt">{num(row.delayDays)} kun</span></td><td data-label="Buyurtma qiymati">{money(row.amount)}</td><td data-label="Keyingi qadam">{row.action}</td></tr>)}
      </tbody></table></div> : <Empty text="Muddati buzilgan buyurtmalar yo‘q" />}
    </Section>

    <Section title="Qarzdan pulni bo‘shatish" hint="Yetkazilgan buyurtmaning to‘liq narxi qoldig‘i minus bekor yozuvlarni hisobga olgan to‘lovlar.">
      <p className="subtle-note">Yosh buyurtma yaratilgan kundan hisoblanadi, to‘lov muddatidan emas. Ma’lumotlarda shartnomaviy to‘lov muddatlari yo‘q: bu to‘lov kechikishi emas. Amal: buyurtmachi bilan hisob-kitobni solishtiring va to‘lov sanasini kelishib oling.</p>
      {receivables.count ? <>
        <div className="table-scroll cardable"><table><thead><tr><th>Yaratilgandan beri</th><th>Buyurtmalar</th><th>To‘lov qoldig‘i</th></tr></thead><tbody>
          {receivables.ageBands.filter(band => band.key !== 'unknown' || band.count > 0).map(band => <tr key={band.key}><td data-label="Yaratilgandan beri">{band.label}</td><td data-label="Buyurtmalar">{band.count}</td><td data-label="To‘lov qoldig‘i" className={band.amount > 0 ? 'debt' : ''}>{money(band.amount)}</td></tr>)}
        </tbody></table></div>
        <div className="table-scroll cardable"><table><thead><tr><th>Buyurtma / buyurtmachi</th><th>Yaratilgan</th><th>Yaratilgandan beri</th><th>To‘langan</th><th>To‘lov qoldig‘i</th></tr></thead><tbody>
          {receivables.rows.map(row => <tr key={row.order.id}><td data-label="Buyurtma / buyurtmachi"><strong>{row.order.number}</strong><small>{row.customerName}</small></td><td data-label="Yaratilgan">{dateTime(row.order.createdAt)}</td><td data-label="Yaratilgandan beri">{row.ageDays === null ? '—' : `${num(row.ageDays)} kun`}</td><td data-label="To‘langan">{money(row.paid)}</td><td data-label="To‘lov qoldig‘i" className="debt">{money(row.debt)}</td></tr>)}
        </tbody></table></div>
      </> : <Empty text="Yetkazilgan buyurtmalar bo‘yicha qarz yo‘q" />}
    </Section>

    <Section title="Narx va xarajatlarni tekshirish" hint="Diqqat chegarasi: rejadagi marja buyurtmaning to‘liq narxidan qat’iy 10% dan past.">
      <p className="subtle-note">Reja materiallar, operatsiyalar va rejadagi ustama xarajatlarni o‘z ichiga oladi. Hisobga olingan to‘g‘ridan-to‘g‘ri xarajatlar — berilgan materiallar va qabul qilingan ishning bosqich tannarxi, rejadagi ustama xarajatlarsiz; bu to‘liq haqiqiy tannarx emas. Past rejadagi marja haqiqiy zararni isbotlamaydi. Nol narxda foiz hisoblanmaydi.</p>
      {lowMargin.count ? <div className="table-scroll cardable"><table><thead><tr><th>Buyurtma</th><th>To‘liq narx</th><th>Reja bo‘yicha xarajatlar</th><th>Hisobga olingan to‘g‘ridan-to‘g‘ri xarajatlar</th><th>Rejadagi marja</th><th>Amal</th></tr></thead><tbody>
        {lowMargin.rows.map(row => <tr key={row.order.id}><td data-label="Buyurtma"><strong>{row.order.number}</strong><small>{row.order.title}</small></td><td data-label="To‘liq narx">{money(row.order.price)}</td><td data-label="Reja bo‘yicha xarajatlar">{money(row.plannedCost)}</td><td data-label="Hisobga olingan to‘g‘ridan-to‘g‘ri xarajatlar">{money(row.actualCost)}</td><td data-label="Rejadagi marja"><span className={`badge ${row.plannedProfit < 0 ? 'debt' : 'positive'}`}>{num(row.plannedMarginPercent!)}%</span><small>{money(row.plannedProfit)} reja bo‘yicha</small></td><td data-label="Amal">{row.order.status === 'delivered' ? 'Sarf va me’yorlarni solishtiring; natijani keyingi hisob-kitoblarda hisobga oling.' : 'Sarf me’yorlari, narxlar va ustama xarajatlarni tekshiring; yangi xarajatlardan oldin narxni kelishib oling.'}</td></tr>)}
      </tbody></table></div> : <Empty text="Rejadagi marjasi 10% dan past buyurtmalar yo‘q" />}
    </Section>

    <Section title="Xaridlar va bo‘sh zaxirani tekshirish" hint={`O‘z zaxirasi: ${money(inventory.stockValue)} · bo‘sh: ${money(inventory.freeValue)}`}>
      <p className="subtle-note">Diqqat evristikasi: bo‘sh qoldiq (ombor − zaxira) 3 × minimal zaxiradan ortiq, faqat minimal &gt; 0 bo‘lganda. Bu mo‘ljal, isbotlangan ortiqcha emas. Buyurtmachi materiallari chiqarib tashlangan. Oxirgi 30 kunda o‘z materiallarining buyurtmalarga chiqimi: {money(inventory.issuedOwnMaterialCost30Days)}.</p>
      {inventory.reviewCount ? <div className="table-scroll cardable"><table><thead><tr><th>Material</th><th>Omborda / zaxira</th><th>Bo‘sh</th><th>3 × minimal me’yor</th><th>Me’yordan ortiq</th><th>Amal</th></tr></thead><tbody>
        {inventory.reviewRows.map(row => <tr key={row.item.id}><td data-label="Material"><strong>{row.item.name}</strong><small>{row.item.unit}</small></td><td data-label="Omborda / zaxira">{num(row.stock)} / {num(row.reserved)}</td><td data-label="Bo‘sh">{num(row.free)}<small>{money(row.freeValue)}</small></td><td data-label="3 × minimal me’yor">{num(row.thresholdQty)}</td><td data-label="Me’yordan ortiq">{num(row.aboveThresholdQty)}<small>{money(row.aboveThresholdValue)}</small></td><td data-label="Amal">Kelgusi buyurtmalar va xaridlarni solishtiring; yangi to‘ldirishgacha bo‘sh zaxirani ishlating.</td></tr>)}
      </tbody></table></div> : <Empty text="Me’yordan ortiq bo‘sh o‘z zaxirasi yo‘q" />}
    </Section>
  </>;
}
