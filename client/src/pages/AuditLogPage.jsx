import { useEffect, useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { useApi } from '../lib/useApi.js';
import { formatDateTime } from '../lib/format.js';
import Modal from '../components/Modal.jsx';
import { Badge, DataTable, PageHeader } from '../components/data.jsx';
import { Button, Card, EmptyState } from '../components/ui.jsx';
import { ROLE_LABELS } from '../config/navigation.js';

const ACTION_FILTERS = [
  { value: '', label: 'All actions' },
  { value: 'setup.', label: 'Setup' },
  { value: 'settings.', label: 'Settings' },
  { value: 'user.', label: 'User accounts' },
  { value: 'employee.', label: 'Employees' },
  { value: 'attendance.', label: 'Attendance' },
  { value: 'leave.', label: 'Leave' },
  { value: 'payroll.', label: 'Payroll' },
  { value: 'payslip.', label: 'Payslips' },
  { value: 'department.', label: 'Departments' },
  { value: 'holiday.', label: 'Holidays' },
  { value: 'announcement.', label: 'Announcements' },
];

const actionColor = (a) =>
  /delete|reject|deactivate|exit/.test(a) ? 'red' : /finalize|approve|create|activate/.test(a) ? 'green' : /update|reset|correct|role/.test(a) ? 'amber' : 'gray';

/** Changed fields between two snapshots, for the detail view. */
function diff(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const skip = new Set(['_id', 'createdAt', 'updatedAt', '__v']);
  return [...keys]
    .filter((k) => !skip.has(k) && JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .map((k) => ({ field: k, before: before?.[k], after: after?.[k] }));
}

const show = (v) => (v === undefined ? '—' : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

/** Audit log (brief #25): Admin only, read-only, with filters and paging. */
export default function AuditLogPage() {
  const [action, setAction] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const { data, loading, error, reload } = useApi('/audit-logs', { params: { page, limit: 25, ...(action ? { action } : {}), ...(search ? { search } : {}) } });

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const columns = [
    { key: 'createdAt', header: 'When', className: 'whitespace-nowrap', render: (a) => formatDateTime(a.createdAt) },
    { key: 'action', header: 'Action', render: (a) => <Badge color={actionColor(a.action)}>{a.action}</Badge> },
    { key: 'entity', header: 'Record', render: (a) => <span className="text-slate-600">{a.entity}</span> },
    {
      key: 'actor',
      header: 'By',
      render: (a) => (
        <span>
          <span className="font-medium text-slate-900">{a.actorName}</span>
          <span className="block text-xs text-slate-500">{ROLE_LABELS[a.actorRole] ?? a.actorRole}</span>
        </span>
      ),
    },
    {
      key: 'view',
      header: <span className="sr-only">Details</span>,
      className: 'text-right',
      render: (a) => (
        <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => setSelected(a)}>
          Details
        </Button>
      ),
    },
  ];

  const changes = selected ? diff(selected.before, selected.after) : [];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Audit log" description="Every important action, with who did it and what changed. Entries cannot be edited or deleted." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by person, action or record"
              aria-label="Search audit log"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by action"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {ACTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <DataTable columns={columns} rows={data?.items} loading={loading} error={error} onRetry={reload} empty={<EmptyState icon={ClipboardList} title="No matching entries" />} />
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              Page {data.page} of {data.pages} · {data.total} entries
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" className="px-3 py-1.5" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" className="px-3 py-1.5" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {selected && (
        <Modal open onClose={() => setSelected(null)} title={selected.action} description={`${selected.actorName} · ${formatDateTime(selected.createdAt)}`} size="lg" footer={<Button onClick={() => setSelected(null)}>Close</Button>}>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Record</dt>
              <dd className="font-medium text-slate-900">{selected.entity}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Record id</dt>
              <dd className="truncate font-mono text-xs text-slate-700">{selected.entityId ?? '—'}</dd>
            </div>
          </dl>
          {changes.length === 0 ? (
            <p className="text-sm text-slate-500">No field-level changes recorded for this action.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-medium">Field</th>
                    <th className="py-2 pr-3 font-medium">Before</th>
                    <th className="py-2 font-medium">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {changes.map((c) => (
                    <tr key={c.field}>
                      <td className="py-2 pr-3 font-medium text-slate-700">{c.field}</td>
                      <td className="max-w-[12rem] break-words py-2 pr-3 text-red-700">{show(c.before)}</td>
                      <td className="max-w-[12rem] break-words py-2 text-emerald-700">{show(c.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
