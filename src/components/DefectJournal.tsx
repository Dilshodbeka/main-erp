import { useState } from 'react';
import { CircleAlert, Package, Users } from 'lucide-react';
import { Empty, Metric, Section, dateTime, money, num } from '../ui';
import { defectReasonLabel } from '../i18n';
import { defectJournalRows, defectMonths, defectTotals } from '../defect-view';
import { unitLabel } from '../work-view';
import type { State } from '../types';

const monthLabel = (key: string): string =>
  new Date(`${key}-02T00:00:00`).toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' });

export function DefectJournal({ state }: { state: State }) {
  const months = defectMonths(state);
  const [month, setMonth] = useState(months[0] ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const rows = defectJournalRows(state, month, employeeId);
  const totals = defectTotals(rows);
  const workers = state.employees.filter(employee => state.defects.some(row => row.employeeId === employee.id));
  return <Section
    title="Brak tarixi"
    hint="O‘zgarmas jurnal: miqdor, sabab va materialning normadagi bahosi. Bu summa hech kimning ish haqidan ushlanmaydi."
    action={<div className="section-tools">
      <select aria-label="Brak oyi filtri" value={month} onChange={event => setMonth(event.target.value)}>
        <option value="">Barcha oylar</option>
        {months.map(entry => <option key={entry} value={entry}>{monthLabel(entry)}</option>)}
      </select>
      <select aria-label="Brak xodimi filtri" value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
        <option value="">Barcha xodimlar</option>
        {workers.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
      </select>
    </div>}
  >
    <div className="metrics three">
      <Metric label="Brak (m²)" value={`${num(totals.squareMeters)} m²`} detail="Faqat metr kvadratdagi bosqichlar" icon={CircleAlert} accent />
      <Metric label="Material qiymati" value={money(totals.materialCost)} detail="Norma bo‘yicha yo‘qotilgan material" icon={Package} />
      <Metric label="Eng ko‘p brak" value={totals.top?.name ?? '—'} detail={totals.top ? `${num(totals.top.qty)} m²` : 'Bu davrda brak yo‘q'} icon={Users} />
    </div>
    {rows.length
      ? <div className="table-scroll cardable"><table>
          <thead><tr><th>Sana</th><th>Buyurtma</th><th>Operatsiya</th><th>Xodim</th><th className="right">Miqdor</th><th>Sabab</th><th>Sarflangan material</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td data-label="Sana">{dateTime(row.createdAt)}</td>
            <td data-label="Buyurtma"><b>{row.orderNumber}</b><small>{row.orderTitle}</small></td>
            <td data-label="Operatsiya">{row.operationName}</td>
            <td data-label="Xodim">{row.employeeName}</td>
            <td data-label="Miqdor" className="right"><b>{num(row.qty)} {unitLabel(row.unit)}</b></td>
            <td data-label="Sabab">{defectReasonLabel(row.reason)}{row.note && <small>{row.note}</small>}</td>
            <td data-label="Sarflangan material">{row.materials.length
              ? <>{row.materials.map(material => <small key={material.itemId}>{material.name} · {num(material.qty)}</small>)}<b>{money(row.materialCost)}</b></>
              : <span className="muted">—</span>}</td>
          </tr>)}</tbody>
        </table></div>
      : <Empty text="Bu davrda brak qayd etilmagan" />}
  </Section>;
}
