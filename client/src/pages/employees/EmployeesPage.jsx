import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, FileUp, Search, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useApi } from '../../lib/useApi.js';
import { downloadFile, blobErrorMessage } from '../../lib/download.js';
import { EMPLOYEE_STATUS, formatDay, formatMoney } from '../../lib/format.js';
import { useToast } from '../../components/toast.jsx';
import { Badge, DataTable, PageHeader } from '../../components/data.jsx';
import { Button, Card, EmptyState } from '../../components/ui.jsx';
import EmployeeFormModal from './EmployeeFormModal.jsx';
import CredentialsModal from './CredentialsModal.jsx';
import ImportCsvModal from './ImportCsvModal.jsx';

const selectCls =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100';

/** Employee directory (brief #07): Admin views, HR manages, register and CSV import/export (#06, #08). */
export default function EmployeesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user.role === 'hr';

  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({ search: '', departmentId: '', status: 'current', sort: 'name' });
  const [page, setPage] = useState(1);
  const [registering, setRegistering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [created, setCreated] = useState(null);
  const [exporting, setExporting] = useState(false);

  const departments = useApi('/org/departments', { params: { includeArchived: true } });
  const params = {
    page,
    limit: 20,
    sort: filters.sort,
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
  const { data, loading, error, reload } = useApi('/employees', { params });

  // Debounce typing so the server is not asked on every key.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const setFilter = (field) => (e) => {
    setFilters((f) => ({ ...f, [field]: e.target.value }));
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { page: _p, limit: _l, ...exportParams } = params;
      await downloadFile('/employees/export', 'employees.csv', { params: exportParams });
    } catch (err) {
      toast.error(await blobErrorMessage(err, 'Export failed. Please try again.'));
    } finally {
      setExporting(false);
    }
  };

  const filtered = Boolean(filters.search || filters.departmentId || (filters.status && filters.status !== 'current'));

  const columns = [
    {
      key: 'name',
      header: 'Employee',
      render: (e) => (
        <Link to={`/employees/${e.id}`} className="group block min-w-0">
          <span className="block truncate font-medium text-slate-900 group-hover:text-brand-700 group-hover:underline">{e.name}</span>
          <span className="block truncate text-xs text-slate-500">
            {e.code} · {e.email}
          </span>
        </Link>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      render: (e) => (
        <div className="min-w-0">
          <p className="truncate text-slate-800">{e.departmentName ?? '-'}</p>
          {e.designationTitle && <p className="truncate text-xs text-slate-500">{e.designationTitle}</p>}
        </div>
      ),
    },
    { key: 'joinDate', header: 'Joined', className: 'whitespace-nowrap', render: (e) => formatDay(e.joinDate, { weekday: false }) },
    {
      key: 'gross',
      header: 'Gross salary',
      className: 'whitespace-nowrap text-right',
      render: (e) => (e.salary?.basic ? formatMoney(e.salary.gross) : <span className="text-slate-400">Not set</span>),
    },
    {
      key: 'status',
      header: 'Status',
      render: (e) => <Badge color={EMPLOYEE_STATUS[e.status]?.color}>{EMPLOYEE_STATUS[e.status]?.label ?? e.status}</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Employees"
        description={canManage ? 'Register employees, keep their details current and import or export the directory.' : 'Company directory. HR manages employee records.'}
        actions={
          canManage && (
            <>
              <Button variant="secondary" onClick={exportCsv} loading={exporting}>
                <Download className="size-4" /> Export CSV
              </Button>
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <FileUp className="size-4" /> Import CSV
              </Button>
              <Button onClick={() => setRegistering(true)}>
                <UserPlus className="size-4" /> Register employee
              </Button>
            </>
          )
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, code, email or phone"
              aria-label="Search employees"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
            <select value={filters.departmentId} onChange={setFilter('departmentId')} aria-label="Filter by department" className={selectCls}>
              <option value="">All departments</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.isActive ? '' : ' (archived)'}
                </option>
              ))}
            </select>
            <select value={filters.status} onChange={setFilter('status')} aria-label="Filter by status" className={selectCls}>
              <option value="current">Current (active + probation)</option>
              <option value="active">Active</option>
              <option value="probation">Probation</option>
              <option value="exited">Exited</option>
              <option value="">All statuses</option>
            </select>
            <select value={filters.sort} onChange={setFilter('sort')} aria-label="Sort by" className={selectCls}>
              <option value="name">Sort: name</option>
              <option value="code">Sort: code</option>
              <option value="joinDate">Sort: newest joiners</option>
              <option value="newest">Sort: recently added</option>
            </select>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={data?.items}
          loading={loading}
          error={error}
          onRetry={reload}
          empty={
            <EmptyState
              icon={Users}
              title={filtered ? 'No matching employees' : 'No employees yet'}
              action={
                !filtered && canManage ? (
                  <Button onClick={() => setRegistering(true)}>
                    <UserPlus className="size-4" /> Register the first employee
                  </Button>
                ) : undefined
              }
            >
              {filtered ? 'Try a different search or filter.' : canManage ? 'Register employees one by one or import a CSV file.' : 'HR has not registered any employees yet.'}
            </EmptyState>
          }
        />

        {data && data.total > 0 && (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {data.total} employee{data.total === 1 ? '' : 's'}
              {data.pages > 1 ? ` · page ${data.page} of ${data.pages}` : ''}
            </span>
            {data.pages > 1 && (
              <div className="flex gap-2">
                <Button variant="secondary" className="px-3 py-1.5" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" className="px-3 py-1.5" disabled={page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {registering && (
        <EmployeeFormModal
          onClose={() => setRegistering(false)}
          onSaved={(result) => {
            setRegistering(false);
            setCreated(result);
            toast.success(`${result.employee.name} registered.`);
            reload();
          }}
        />
      )}
      {created && <CredentialsModal result={created} onClose={() => setCreated(null)} />}
      {importing && (
        <ImportCsvModal
          onClose={() => setImporting(false)}
          onImported={(res) => {
            toast.success(`Imported ${res.imported} employee${res.imported === 1 ? '' : 's'}.`);
            reload();
          }}
        />
      )}
    </div>
  );
}
