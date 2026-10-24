import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { useApi } from '../../lib/useApi.js';
import { formatMoney, formatMonth } from '../../lib/format.js';
import { PageHeader } from '../../components/data.jsx';
import { Alert, Button, Card, EmptyState, Spinner } from '../../components/ui.jsx';
import { PayslipDetailModal, usePayslipDownload } from './PayrollRunPage.jsx';

/** Employee self-service: own finalized payslips with PDF download (brief #17). */
export default function PayslipsPage() {
  const { data, loading, error, reload } = useApi('/payslips');
  const { download, busyId } = usePayslipDownload();
  const [selected, setSelected] = useState(null);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="My payslips" description="Payslips appear here once Admin finalizes the month." />

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Spinner /> Loading payslips...
        </div>
      ) : error ? (
        <Alert type="error">
          {error}{' '}
          <button className="font-medium underline" onClick={reload}>
            Try again
          </button>
        </Alert>
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={FileText} title="No payslips yet">
            No payslips yet - they appear after payroll is finalized.
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {data.map((p) => (
            <li key={p.id}>
              <Card className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setSelected(p)}>
                    <span className="rounded-lg bg-brand-50 p-2.5 text-brand-700">
                      <FileText className="size-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block font-semibold text-slate-900 hover:text-brand-700">{formatMonth(p.month)}</span>
                      <span className="block text-xs text-slate-500">
                        {p.workingDays} working days{p.absentDays ? ` · ${p.absentDays} absent` : ''}
                        {p.unpaidLeaveDays ? ` · ${p.unpaidLeaveDays} unpaid leave` : ''}
                      </span>
                    </span>
                  </button>
                  <dl className="grid grid-cols-4 gap-3 text-sm sm:gap-6">
                    <div>
                      <dt className="text-xs text-slate-500">Gross</dt>
                      <dd className="font-medium text-slate-800">{formatMoney(p.gross, '')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Deductions</dt>
                      <dd className="font-medium text-slate-800">{formatMoney(p.deductions, '')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Tax</dt>
                      <dd className="font-medium text-slate-800">{formatMoney(p.tax, '')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Net (PKR)</dt>
                      <dd className="font-semibold text-brand-800">{formatMoney(p.net, '')}</dd>
                    </div>
                  </dl>
                  <Button variant="secondary" onClick={() => download(p)} loading={busyId === p.id}>
                    <Download className="size-4" /> PDF
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {selected && <PayslipDetailModal payslip={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
