import { Fragment } from 'react';
import { Printer } from 'lucide-react';
import { date, money, num } from '../ui';
import type { CashReceiptModel, InvoiceModel, RouteSheetModel } from '../documents';

export type PrintModel = { type: 'route'; data: RouteSheetModel } | { type: 'invoice'; data: InvoiceModel } | { type: 'cash'; data: CashReceiptModel };

export function PrintDocument({ model, close }: { model: PrintModel; close: () => void }) {
  const title = model.type === 'route' ? 'Marshrut varaqasi' : model.type === 'invoice' ? 'Hisob-faktura' : 'Kassa orderi';
  return <div className="modal-backdrop print-overlay">
    <div className="dialog wide print-dialog" role="dialog" aria-label={title}>
      <header className="no-print">
        <div><h2>{title}</h2><p>A4 formatida chop etish uchun brauzer oynasi ochiladi.</p></div>
        <div className="button-group">
          <button className="secondary" onClick={close}>Yopish</button>
          <button className="primary" onClick={() => window.print()}><Printer size={16} />Chop etish</button>
        </div>
      </header>
      <div className="print-root">{model.type === 'route' ? <RouteSheet data={model.data} /> : model.type === 'invoice' ? <Invoice data={model.data} /> : <CashReceipt data={model.data} />}</div>
    </div>
  </div>;
}

function RouteSheet({ data }: { data: RouteSheetModel }) {
  return <article className="print-page route-sheet">
    <header className="print-head">
      <div><small>ALIYA ERP · ISHLAB CHIQARISH</small><h1>MARSHRUT VARAQASI</h1></div>
      <div className="print-order-banner"><b>{data.number}</b><span>{data.customerName}</span></div>
    </header>
    <div className="print-meta">
      <div><small>Buyurtma</small><b>{data.title}</b></div>
      <div><small>Mijoz</small><b>{data.customerName}</b></div>
      <div><small>Muddat</small><b>{date(data.dueDate)}</b></div>
      <div><small>Onlayn chizma</small><b>{data.drawingUrl ?? '—'}</b></div>
    </div>
    <section className="print-section">
      <h2>Material almashtirishlari</h2>
      {data.substitutions.length ? <table className="print-table">
        <thead><tr><th>Uya</th><th>Haqiqiy material</th></tr></thead>
        <tbody>{data.substitutions.map(row => <tr key={row.slot}><td>{row.slot}</td><td>{row.itemName}</td></tr>)}</tbody>
      </table> : <p className="print-note">Almashtirishlar yo‘q — retsept bo‘yicha ishlanadi.</p>}
    </section>
    <section className="print-section">
      <h2>Operatsiyalar</h2>
      <table className="print-table">
        <thead><tr><th>№</th><th>Operatsiya</th><th className="right">Miqdor</th><th>Birlik</th><th>Ijrochi</th><th className="right">Norma, daq.</th><th>Belgilar</th></tr></thead>
        <tbody>{(() => { const seen = new Set<string>(); return data.operations.map((row, index) => {
          const header = row.position && !seen.has(row.position) ? <tr className="print-group" key={`p:${row.position}`}><td colSpan={7}>{row.position}</td></tr> : null;
          seen.add(row.position);
          return <Fragment key={`o:${index}`}>{header}<tr>
            <td>{index + 1}</td><td>{row.name}</td><td className="right">{num(row.qty)}</td><td>{row.unit}</td>
            <td>{row.workerName}</td><td className="right">{row.standardMinutes || '—'}</td><td className="print-marks" />
          </tr></Fragment>;
        }); })()}</tbody>
      </table>
    </section>
    <footer className="print-signatures">
      <div><span>Sex ustasi</span><i /></div>
      <div><span>Topshirildi</span><i /></div>
      <div><span>Qabul qilindi</span><i /></div>
    </footer>
  </article>;
}

function Invoice({ data }: { data: InvoiceModel }) {
  return <article className="print-page">
    <header className="print-head">
      <div><h1>HISOB-FAKTURA</h1></div>
      <div className="print-head-right"><b>{data.number}</b><span>Sana: {date(data.date)}</span></div>
    </header>
    <div className="print-parties single">
      <div><small>Xaridor</small><b>{data.customer}</b><span>{data.address || 'Manzil ko‘rsatilmagan'}</span></div>
    </div>
    {!!data.positions.length && <section className="print-section">
      <h2>Buyurtma pozitsiyalari</h2>
      <table className="print-table">
        <thead><tr><th>№</th><th>Pozitsiya</th><th>Turi</th><th className="right">Miqdor</th><th className="right">Bitta dona narxi</th><th className="right">Summa</th></tr></thead>
        <tbody>{data.positions.map((position, index) => <tr key={`${position.title}:${index}`}>
          <td>{index + 1}</td><td>{position.title}</td><td>{position.kind === 'service' ? 'Xizmat' : 'Mahsulot'}</td>
          <td className="right">{num(position.qty)}</td><td className="right">{money(position.unitPrice)}</td><td className="right">{money(position.total)}</td>
        </tr>)}</tbody>
      </table>
    </section>}
    {!!data.lines.length && <section className="print-section">
      <h2>Tovarlar</h2>
      <table className="print-table print-lines">
        <thead><tr><th>№</th><th>Nomi</th><th className="right">Miqdor</th><th>Birlik</th><th className="right">Narx</th><th className="right">Summa</th></tr></thead>
        <tbody>{data.lines.map((row, index) => <tr key={`${row.description}:${index}`}>
          <td>{index + 1}</td><td>{row.description}</td><td className="right">{num(row.qty)}</td>
          <td>{row.unit}</td><td className="right">{money(row.price)}</td><td className="right">{money(row.total)}</td>
        </tr>)}</tbody>
      </table>
    </section>}
    {(data.costs.length > 0 || data.cost.total > 0) && <section className="print-section">
      <h2>Tannarx (ichki hisob)</h2>
      <table className="print-table">
        <thead><tr><th>Pozitsiya</th><th className="right">Material</th><th className="right">Bosqich tannarxi</th><th className="right">Tannarx</th><th className="right">Marja</th></tr></thead>
        <tbody>
          {data.costs.map((row, index) => <tr key={`${row.position}:${index}`}>
            <td>{row.position}</td><td className="right">{money(row.material)}</td><td className="right">{money(row.labor)}</td>
            <td className="right">{money(row.total)}</td><td className="right">{money(row.margin)}</td>
          </tr>)}
          {data.cost.overhead > 0 && <tr>
            <td>Boshqa xarajatlar</td><td className="right">—</td><td className="right">—</td>
            <td className="right">{money(data.cost.overhead)}</td><td className="right">—</td>
          </tr>}
          <tr className="print-group">
            <td>Jami tannarx</td><td className="right">{money(data.cost.material)}</td><td className="right">{money(data.cost.labor)}</td>
            <td className="right">{money(data.cost.total)}</td><td className="right">{money(data.cost.margin)}</td>
          </tr>
        </tbody>
      </table>
      <p className="print-note">Tannarx mijoz summasiga qo‘shilmaydi — bu ichki hisob.</p>
    </section>}
    <div className="print-totals">
      {Math.abs(data.markup) >= 0.005 && <span>Pozitsiyalar<b>{money(data.subtotal)}</b></span>}
      {data.markup > 0 && <span>Natsenka<b>{money(data.markup)}</b></span>}
      {data.markup < 0 && <span>Chegirma<b>{money(Math.abs(data.markup))}</b></span>}
      <span>Jami<b>{money(data.total)}</b></span>
      <span>To‘langan<b>{money(data.paid)}</b></span>
      <span className="print-debt">Qarz<b>{money(data.debt)}</b></span>
      {data.vat !== null && <span>QQS<b>{money(data.vat)}</b></span>}
    </div>
  </article>;
}

function CashReceipt({ data }: { data: CashReceiptModel }) {
  const incoming = data.kind === 'in';
  return <article className="print-page cash-order">
    <header className="print-head">
      <div><small>ALIYA ERP · MOLIYA</small><h1>{incoming ? 'KASSA KIRIM ORDERI' : 'KASSA CHIQIM ORDERI'}</h1></div>
      <div className="print-head-right"><b>{data.number}</b><span>Sana: {date(data.date)}</span></div>
    </header>
    <div className="print-meta">
      <div><small>{incoming ? 'Kimdan qabul qilindi' : 'Kimga berildi'}</small><b>{data.party}</b></div>
      <div><small>Asos</small><b>{data.basis}</b></div>
      <div><small>Hisob</small><b>{data.account}</b></div>
      <div><small>Summa</small><b>{money(data.amount)}</b></div>
    </div>
    {data.note && <p className="print-note">{data.note}</p>}
    {data.reversed && <p className="print-note">Storno yozuvi — asl hujjatni bekor qiladi.</p>}
    <footer className="print-signatures">
      <div><span>Bosh buxgalter</span><i /></div>
      <div><span>Kassir</span><i /></div>
      <div><span>{incoming ? 'Pulni topshirdi' : 'Pulni oldi'}</span><i /></div>
    </footer>
  </article>;
}
