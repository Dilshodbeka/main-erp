import { money, num, Section } from '../ui';
import type { MachineReport, PeriodReport, ShopReport, StockBalanceReport } from '../reports';

export function FinanceReports({ report, shops, stock, machines }: { report: PeriodReport; shops: ShopReport[]; stock: StockBalanceReport; machines: MachineReport }) {
  return <>
    <div className="dashboard-grid">
      <Section title="Davr bo‘yicha do‘konlar" hint="Har bir do‘kon bo‘yicha tushum, tannarx va hisob-kitoblar">
        {shops.length ? <div className="table-scroll cardable"><table><thead><tr><th>Do‘kon</th><th className="right">Yuborishlar</th><th className="right">Tushum</th><th className="right">Tannarx</th><th className="right">Foyda</th><th className="right">To‘langan</th><th className="right">Qarz</th><th className="right">Avans</th></tr></thead><tbody>{shops.map(shop => <tr key={shop.shopId}><td data-label="Do‘kon"><b>{shop.name}</b><small>{num(shop.deliveredQty)} dona yetkazilgan</small></td><td data-label="Yuborishlar" className="right">{shop.shipments}</td><td data-label="Tushum" className="right">{money(shop.revenue)}</td><td data-label="Tannarx" className="right">{money(shop.cost)}</td><td data-label="Foyda" className={`right ${shop.grossProfit < 0 ? 'debt' : 'positive'}`}>{money(shop.grossProfit)}</td><td data-label="To‘langan" className="right">{money(shop.paid)}</td><td data-label="Qarz" className={`right ${shop.debt > 0 ? 'debt' : ''}`}>{money(shop.debt)}</td><td data-label="Avans" className="right">{money(shop.advance)}</td></tr>)}</tbody></table></div> : <p className="subtle-note">Hozircha do‘konlar yo‘q. CRMda «Do‘kon» turidagi mijoz yarating.</p>}
      </Section>
      <Section title="Pul, qarzlar va hisob-kitoblar" hint="Pul harakati tushumdan alohida">
        <div className="settings-facts">
          <span>Pul kirimi<b>{money(report.cashIn)}</b></span>
          <span>Pul chiqimi<b>{money(report.cashOut)}</b></span>
          <span>Kassa saldosi<b>{money(report.netCash)}</b></span>
          <span>Mijozlar va do‘konlar qarzi<b>{money(report.debt)}</b></span>
          <span>Mijozlar avanslari<b>{money(report.advances)}</b></span>
          <span>Qabulga hisoblangan<b>{money(report.payrollPending)}</b></span>
          <span>Qabul qilingan va to‘langan<b>{money(report.payrollAccepted)} · {money(report.payrollPaid)}</b></span>
        </div>
      </Section>
    </div>
    <div className="dashboard-grid">
      <Section title="Davr bo‘yicha ombor" hint="Boshlang‘ich qoldiq + kirim − chiqim = yakuniy">
        <div className="table-scroll cardable"><table><thead><tr><th>Pozitsiya</th><th className="right">Boshlanish</th><th className="right">Kirim</th><th className="right">Chiqim</th><th className="right">Yakun</th><th className="right">Qiymat</th></tr></thead><tbody>{stock.rows.map(row => <tr key={row.itemId}><td data-label="Pozitsiya"><b>{row.name}</b><small>{row.unit} · ishlab chiqarilgan {num(row.manufactured)}</small></td><td data-label="Boshlanish" className="right">{num(row.opening)}</td><td data-label="Kirim" className="right positive">{num(row.inbound)}</td><td data-label="Chiqim" className="right">{num(row.outbound)}</td><td data-label="Yakun" className="right"><b>{num(row.closing)}</b></td><td data-label="Qiymat" className="right">{money(row.closingValue)}</td></tr>)}</tbody></table></div>
        <div className="settings-facts"><span>Boshlang‘ich qiymat<b>{money(stock.openingValue)}</b></span><span>Yakuniy qiymat<b>{money(stock.closingValue)}</b></span><span>Seriyalarda ishlab chiqarilgan<b>{num(stock.manufactured)} dona</b></span></div>
      </Section>
      <Section title="Dastgohlar: reja va fakt" hint="Fakt — bosqich narxi bilan qabul qilingan operatsiyalar">
        <div className="table-scroll cardable"><table><thead><tr><th>Dastgoh</th><th className="right">Soat, reja</th><th className="right">Maqsad</th><th className="right">Fakt</th><th className="right">Yo‘qotish</th></tr></thead><tbody>{machines.rows.map(row => <tr key={row.machineId}><td data-label="Dastgoh"><b>{row.name}</b><small>{money(row.hourlyRevenueTarget)} / soat</small></td><td data-label="Soat, reja" className="right">{num(row.plannedHours)}</td><td data-label="Maqsad" className="right">{money(row.targetRevenue)}</td><td data-label="Fakt" className="right">{money(row.actualRevenue)}</td><td data-label="Yo‘qotish" className={`right ${row.lostRevenue ? 'debt' : ''}`}>{row.lostRevenue === null ? '—' : money(row.lostRevenue)}</td></tr>)}</tbody></table></div>
        <div className="settings-facts"><span>Dastgohlar bo‘yicha maqsad<b>{money(machines.targetRevenue)}</b></span><span>Haqiqiy ishlab chiqarish<b>{money(machines.actualRevenue)}</b></span><span>Maqsadga nisbatan yo‘qotish<b>{money(machines.lostRevenue)}</b></span></div>
      </Section>
    </div>
  </>;
}
