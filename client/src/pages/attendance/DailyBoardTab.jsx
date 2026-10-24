import { useState } from 'react';
import { Link } from 'react-router';
import { Users } from 'lucide-react';
import { useApi } from '../../lib/useApi.js';
import { DAY_STATUS, formatDay, formatMinutes, todayIso } from '../../lib/format.js';
import { Badge, DataTable } from '../../components/data.jsx';
import { Card, EmptyState } from '../../components/ui.jsx';

const CHIPS = [
  ['present', 'Present'],
  ['late', 'Late'],
  ['half_day', 'Half day'],
  ['missing_checkout', 'Missing check-out'],
  ['on_leave', 'On leave'],
  ['not_checked_in', 'Not checked in'],
  ['absent', 'Absent'],
];

const SOURCE_LABEL = { web: 'Web', camera: 'Camera', correction: 'Correction' };

/** Admin and HR: everyone's status for one day (brief #10). */
export default function DailyBoardTab() {
  const [date, setDate] = useState(todayIso());
  const [departmentId, setDepartmentId] = useState('');
  const departments = useApi('/org/departments');
  const board = useApi('/attendance/board', { params: { ...(date ? { date } : {}), ...(departmentId ? { departmentId } : {}) } });
  const data = board.data;

  const columns = [
    {
      key: 'name',
      header: 'Employee',
      render: (r) => (
        <div className="min-w-0">
          <Link to={`/employees/${r.employeeId}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
            {r.name}
          </Link>
          <p className="text-xs text-slate-500">
            {r.code}
            {r.designationTitle ? ` · ${r.designationTitle}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'departmentName', header: 'Department', render: (r) => r.departmentName ?? '-' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const meta = DAY_STATUS[r.status];
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {meta?.label ? <Badge color={meta.color}>{r.inProgress ? `${meta.label} · working` : meta.label}</Badge> : '-'}
            {r.leaveType && <span className="text-xs text-slate-500">{r.leaveType}</span>}
          </div>
        );
      },
    },
    { key: 'in', header: 'In', render: (r) => r.record?.checkInTime ?? '-' },
    { key: 'out', header: 'Out', render: (r) => r.record?.checkOutTime ?? '-' },
    { key: 'worked', header: 'Worked', className: 'whitespace-nowrap', render: (r) => formatMinutes(r.record?.workedMinutes) },
    { key: 'source', header: 'Source', render: (r) => (r.record ? SOURCE_LABEL[r.record.source] ?? r.record.source : '-') },
  ];

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="board-date">
            Date
          </label>
          <input
            id="board-date"
            type="date"
            value={date}
            max={data?.today ?? undefined}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            aria-label="Filter by department"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="">All departments</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        {data && (
          <p className="text-sm text-slate-500">
            {formatDay(data.date)} · {data.total} employee{data.total === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {data && data.total > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3" aria-label="Summary">
          {CHIPS.filter(([key]) => data.summary?.[key]).map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm">
              <Badge color={DAY_STATUS[key].color}>{data.summary[key]}</Badge>
              <span className="text-slate-700">{label}</span>
            </span>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={data?.rows}
        rowKey={(r) => r.employeeId}
        loading={board.loading}
        error={board.error}
        onRetry={board.reload}
        empty={
          <EmptyState icon={Users} title="No employees for this day">
            Employees appear here once HR registers them (and only from their join date).
          </EmptyState>
        }
      />
    </Card>
  );
}
