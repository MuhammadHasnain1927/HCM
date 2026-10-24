import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { saveText } from '../../lib/download.js';
import Modal from '../../components/Modal.jsx';
import { Alert, Button } from '../../components/ui.jsx';
import { DataTable } from '../../components/data.jsx';

const MAX_BYTES = 850 * 1024;

const TEMPLATE = [
  'code,name,email,phone,gender,department,designation,joinDate,basicSalary,status,address',
  'EMP-1001,Ayesha Khan,ayesha.khan@example.com,0300-1234567,female,Engineering,Software Engineer,2026-01-15,120000,active,"House 12, Block 5, Karachi"',
].join('\r\n');

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const downloadTemplate = () => saveText(`${TEMPLATE}\r\n`, 'employees-import-template.csv');

/**
 * CSV import with a dry run first (brief M3): the server validates every row
 * and reports row + field + reason; nothing is saved until "Import".
 */
export default function ImportCsvModal({ onClose, onImported }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [csv, setCsv] = useState('');
  const [step, setStep] = useState('pick'); // pick | checked | done
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (e) => {
    const f = e.target.files?.[0];
    // Reset so choosing the same (fixed) file again still triggers a change.
    e.target.value = '';
    setError('');
    setReport(null);
    setStep('pick');
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      setError('Choose a .csv file.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('The file is too large (max about 850 KB, 500 rows).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFile(f);
      setCsv(String(reader.result ?? ''));
    };
    reader.onerror = () => setError('Could not read the file.');
    reader.readAsText(f);
  };

  const run = async (dryRun) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/employees/import', { csv }, { params: { dryRun }, timeout: 120000 });
      setReport(data);
      if (!dryRun && data.imported > 0) {
        setStep('done');
        onImported?.(data);
      } else {
        setStep('checked');
      }
    } catch (err) {
      const details = err.response?.data?.error?.details;
      setError(errorMessage(err));
      if (Array.isArray(details) && details.length) {
        setReport({ totalRows: 0, validRows: 0, errorCount: details.length, errors: details, imported: 0, dryRun: true });
        setStep('checked');
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadCredentials = () => {
    const lines = ['code,name,email,temporaryPassword', ...report.credentials.map((c) => [c.code, c.name, c.email, c.temporaryPassword ?? ''].map(csvCell).join(','))];
    saveText(`${lines.join('\r\n')}\r\n`, `employee-logins-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const errorColumns = [
    { key: 'row', header: 'Row', className: 'w-16' },
    { key: 'field', header: 'Field', className: 'w-36 font-medium text-slate-900' },
    { key: 'reason', header: 'Problem' },
  ];
  const credColumns = [
    { key: 'code', header: 'Code', className: 'whitespace-nowrap' },
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'temporaryPassword', header: 'Temporary password', render: (c) => <code className="font-mono text-slate-900">{c.temporaryPassword ?? 'Linked to HR login'}</code> },
  ];

  const canImport = step === 'checked' && report && report.errorCount === 0 && report.validRows > 0;

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      size="lg"
      title="Import employees from CSV"
      description="Check the file first. Nothing is saved until you import, and every row must be valid."
      footer={
        step === 'done' ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {canImport ? (
              <Button onClick={() => run(false)} loading={busy}>
                Import {report.validRows} employee{report.validRows === 1 ? '' : 's'}
              </Button>
            ) : (
              <Button onClick={() => run(true)} loading={busy} disabled={!csv}>
                Check file
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-4">
        {step !== 'done' && (
          <>
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-300 p-4 sm:flex-row sm:items-center">
              <FileUp className="size-6 shrink-0 text-brand-700" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium text-slate-900">{file ? file.name : 'No file chosen'}</p>
                <p className="text-xs text-slate-500">
                  Required columns: name, email, department, joinDate (YYYY-MM-DD), basicSalary. Optional: code, phone, gender, designation, status, address.
                </p>
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={pick} className="sr-only" id="employee-csv" />
              <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                Choose file
              </Button>
            </div>
            <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
              <Download className="size-4" /> Download template
            </button>
          </>
        )}

        <Alert type="error">{error}</Alert>

        {step === 'checked' && report && (
          <>
            {report.errorCount === 0 ? (
              <Alert type="success">
                All {report.validRows} row{report.validRows === 1 ? '' : 's'} look good. Import to create the employees and their logins.
              </Alert>
            ) : (
              <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  {report.totalRows ? `${report.validRows} of ${report.totalRows} rows are valid. ` : ''}
                  Fix the {report.errorCount} problem{report.errorCount === 1 ? '' : 's'} below and choose the file again. Rows are numbered as in the file (row 1 is the header).
                </p>
              </div>
            )}
            {report.errors?.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                <DataTable columns={errorColumns} rows={report.errors} rowKey={(r) => `${r.row}-${r.field}-${r.reason}`} />
              </div>
            )}
          </>
        )}

        {step === 'done' && report && (
          <>
            <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                Imported {report.imported} employee{report.imported === 1 ? '' : 's'}. Each one must change the temporary password on first sign-in.
              </p>
            </div>
            {report.stoppedAt && (
              <Alert type="error">
                The import stopped at {report.stoppedAt.email}: {report.stoppedAt.reason}. The rows below were created; fix the file and import the remaining rows.
              </Alert>
            )}
            <Alert type="info">These passwords are shown only once. Download them now and share them securely.</Alert>
            <Button variant="secondary" onClick={downloadCredentials}>
              <Download className="size-4" /> Download credentials CSV
            </Button>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              <DataTable columns={credColumns} rows={report.credentials ?? []} rowKey={(c) => c.email} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
