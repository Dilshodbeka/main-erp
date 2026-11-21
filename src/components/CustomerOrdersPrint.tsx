import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import type { OrderProfitRow } from '../history';
import type { Customer } from '../types';
import { date, money, statuses } from '../ui';

// Mijoz buyurtmalari ro‘yxati — A4 qog‘ozga (foyda ustunisiz: varaq mijozga beriladi).
export function CustomerOrdersPrint({ customer, orders, close }: { customer: Customer; orders: OrderProfitRow[]; close: () => void }) {
  return createPortal(<div className="modal-backdrop print-overlay">
      <div className="dialog wide print-dialog" role="dialog" aria-label="Mijoz buyurtmalari">
        <header className="no-print">
          <div><h2>Mijoz buyurtmalari</h2><p>A4 formatida chop etish uchun brauzer oynasi ochiladi.</p></div>
          <div className="button-group">
            <button className="secondary" onClick={() => close()}>Yopish</button>
            <button className="primary" onClick={() => window.print()}><Printer size={16} />Chop etish</button>
          </div>
        </header>
        <div className="print-root"><article className="print-page">
          <header className="print-head">
            <div><h1>MIJOZ BUYURTMALARI</h1></div>
            <div className="print-head-right"><b>{customer.name}</b><span>Sana: {date(new Date().toISOString().slice(0, 10))}</span></div>
          </header>
          <div className="print-meta">
            <div><small>Mijoz</small><b>{customer.name}</b></div>
            <div><small>Telefon / manzil</small><b>{[customer.phone, customer.address].filter(Boolean).join(' · ') || '—'}</b></div>
          </div>
          <section className="print-section">
            <table className="print-table">
              <thead><tr><th>№</th><th>Buyurtma</th><th>Sana</th><th>Holat</th><th className="right">Summa</th><th className="right">To‘langan</th><th className="right">Qarz</th></tr></thead>
              <tbody>{orders.map((row, index) => <tr key={row.order.id}>
                <td>{index + 1}</td><td><b>{row.order.number}</b> · {row.order.title}</td><td>{date(row.date.slice(0, 10))}</td><td>{statuses[row.order.status]}</td>
                <td className="right">{money(row.revenue)}</td><td className="right">{row.paid > 0 ? money(row.paid) : '—'}</td><td className="right">{row.debt > 0 ? money(row.debt) : '—'}</td>
              </tr>)}</tbody>
              <tfoot><tr><td colSpan={4}><b>{`Jami · ${orders.length} ta buyurtma`}</b></td>
                <td className="right"><b>{money(orders.reduce((total, row) => total + row.revenue, 0))}</b></td>
                <td className="right"><b>{money(orders.reduce((total, row) => total + row.paid, 0))}</b></td>
                <td className="right"><b>{money(orders.reduce((total, row) => total + row.debt, 0))}</b></td></tr></tfoot>
            </table>
          </section>
          <div className="print-signs"><span>Topshirdi: ____________________</span><span>Qabul qildi: ____________________</span></div>
        </article></div>
      </div>
    </div>, document.body);
}
