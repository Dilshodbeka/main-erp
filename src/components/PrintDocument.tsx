import { Fragment } from 'react';
import { Printer } from 'lucide-react';
import { date, money, num } from '../ui';
import type { CashReceiptModel, InvoiceModel, PurchaseReceiptModel, RouteSheetModel } from '../documents';

export type PrintModel = { type: 'route'; data: RouteSheetModel } | { type: 'invoice'; data: InvoiceModel } | { type: 'cash'; data: CashReceiptModel } | { type: 'receipt'; data: PurchaseReceiptModel };

export function PrintDocument({ model, close }: { model: PrintModel; close: () => void }) {
  const title = model.type === 'route' ? 'Marshrut varaqasi' : model.type === 'invoice' ? 'Hisob-faktura' : model.type === 'cash' ? 'Kassa orderi' : 'Qabul varaqasi';
  return <div className="modal-backdrop print-overlay">
    <div className="dialog wide print-dialog" role="dialog" aria-label={title}>
      <header className="no-print">
        <div><h2>{title}</h2><p>A4 formatida chop etish uchun brauzer oynasi ochiladi.</p></div>
        <div className="button-group">
          <button className="secondary" onClick={close}>Yopish</button>
          <button className="primary" onClick={() => window.print()}><Printer size={16} />Chop etish</button>
        </div>
      </header>
      <div className="print-root">{model.type === 'route' ? <RouteSheet data={model.data} /> : model.type === 'invoice' ? <Invoice data={model.data} /> : model.type === 'cash' ? <CashReceipt data={model.data} /> : <PurchaseReceipt data={model.data} />}</div>
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
    <div className={data.company.name ? 'print-parties' : 'print-parties single'}>
      {!!data.company.name && <div><small>Sotuvchi</small><b>{data.company.name}</b>{!!data.company.phone && <span>{data.company.phone}</span>}</div>}
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

function PurchaseReceipt({ data }: { data: PurchaseReceiptModel }) {
  return <article className="print-page purchase-receipt">
    <header className="print-head">
      <div><small>ALIYA ERP · SKLAD</small><h1>QABUL VARAQASI</h1></div>
      <div className="print-head-right"><b>{data.number}</b><span>Sana: {date(data.date)}</span></div>
    </header>
    <div className="print-meta">
      <div><small>Yetkazib beruvchi</small><b>{data.supplier}</b><span>{data.phone || 'Telefon ko‘rsatilmagan'}</span></div>
      <div><small>Ombor</small><b>{data.warehouse}</b></div>
      <div><small>Buyurtma</small><b>{data.orderNumber ?? '—'}</b></div>
    </div>
    <section className="print-section">
      <h2>Materiallar</h2>
      <table className="print-table">
        <thead><tr><th>№</th><th>Material</th><th>Birlik</th><th className="right">Buyurilgan</th><th className="right">Qabul qilingan</th><th className="right">Qolgan</th><th className="right">Narx</th><th className="right">Summa</th></tr></thead>
        <tbody>{data.lines.map((line, index) => <tr key={`${line.name}:${index}`}>
          <td>{index + 1}</td><td>{line.name}</td><td>{line.unit}</td>
          <td className="right">{num(line.qty)}</td><td className="right">{num(line.received)}</td><td className="right">{num(line.remaining)}</td>
          <td className="right">{money(line.price)}</td><td className="right">{money(line.total)}</td>
        </tr>)}</tbody>
      </table>
    </section>
    <div className="print-totals">
      <span>Qabul qilingan summa<b>{money(data.receivedTotal)}</b></span>
      <span>Xarid summasi<b>{money(data.total)}</b></span>
    </div>
    <footer className="print-signatures">
      <div><span>Yetkazib berdi</span><i /></div>
      <div><span>Omborda qabul qilindi</span><i /></div>
      <div><span>Hisobchi tekshirdi</span><i /></div>
    </footer>
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
    {data.reversed && <p className="print-note">Bekor yozuvi — asl hujjatni bekor qiladi.</p>}
    <footer className="print-signatures">
      <div><span>Bosh buxgalter</span><i /></div>
      <div><span>Kassir</span><i /></div>
      <div><span>{incoming ? 'Pulni topshirdi' : 'Pulni oldi'}</span><i /></div>
    </footer>
  </article>;
}
