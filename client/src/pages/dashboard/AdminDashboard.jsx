import { useState } from 'react';
import { Link } from 'react-router';
import { Banknote, Percent, TrendingDown, Users, Wallet } from 'lucide-react';
import { useApi } from '../../lib/useApi.js';
import { formatMoney, formatMonth, timeAgo, todayIso } from '../../lib/format.js';
import { Alert, Spinner } from '../../components/ui.jsx';
import { Tabs } from '../../components/data.jsx';
import { AiSummaryCard, AnnouncementsWidget, FilterBar, KpiCard, SectionCard } from '../../components/dashboard/widgets.jsx';
import { Donut, HBars, VBars } from '../../components/dashboard/charts.jsx';
import HrDashboard from './HrDashboard.jsx';

const compactMoney = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v));

export default function AdminDashboard({ header }) {
  const [tab, setTab] = useState('company');
  const tabs = [
    { value: 'company', label: 'Company' },
    { value: 'people', label: 'Attendance & leave' },
  ];
  return (
    <>
      {header}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'company' ? <CompanyView /> : <HrDashboard scope="hr" />}
    </>
  );
}

function CompanyView() {
  const today = todayIso();
  const [filters, setFilters] = useState({ from: `${today.slice(0, 4)}-01-01`, to: today });
  const { data, loading, error, reload } = useApi('/analytics/admin', { params: filters });

  return (
    <>
      <FilterBar value={filters} onChange={setFilters} />
      {error && (
        <Alert type="error" className="mb-4">
          {error}{' '}
          <button className="font-medium underline" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      {loading && !data && (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Spinner /> Loading dashboard...
        </div>
      )}
      {data && (
        <div className={`space-y-5 ${loading ? 'opacity-60 transition' : ''}`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard label="Headcount" value={data.kpis.headcount} icon={Users} hint="Active + probation" to="/employees" />
            <KpiCard label="Attrition YTD" value={`${data.kpis.attritionYtd}%`} icon={TrendingDown} hint={`${data.kpis.exitsYtd} exit${data.kpis.exitsYtd === 1 ? '' : 's'} ÷ average headcount`} />
            <KpiCard
              label="Payroll cost"
              value={data.kpis.payrollCost ? formatMoney(data.kpis.payrollCost.gross) : '-'}
              icon={Wallet}
              hint={data.kpis.payrollCost ? `${formatMonth(data.kpis.payrollCost.month)} · ${data.kpis.payrollCost.status}` : 'No payroll run yet'}
              to="/payroll"
            />
            <KpiCard label="Average salary" value={data.kpis.averageSalary ? formatMoney(data.kpis.averageSalary) : '-'} icon={Banknote} hint="Mean gross per month" />
            <KpiCard label="Attendance rate" value={data.kpis.attendanceRate === null ? '-' : `${data.kpis.attendanceRate}%`} icon={Percent} hint="For the selected period" />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <SectionCard title="Headcount by department">
              <HBars data={data.headcountByDepartment} labelKey="department" valueKey="count" name="Employees" />
            </SectionCard>
            <SectionCard title="Payroll cost by department" description={data.kpis.payrollCost ? `Gross, ${formatMonth(data.kpis.payrollCost.month)}` : 'Appears after the first payroll run'}>
              <HBars data={data.payrollCostByDepartment} labelKey="department" valueKey="gross" name="Gross" valueFormatter={compactMoney} />
            </SectionCard>
            <AiSummaryCard scope="admin" filters={filters} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <SectionCard title="Average salary by department" description="Mean gross per month">
              <HBars data={data.averageSalaryByDepartment} labelKey="name" valueKey="averageGross" name="Average gross" valueFormatter={compactMoney} />
            </SectionCard>
            <SectionCard title="Gender">
              <Donut data={data.gender} />
            </SectionCard>
            <SectionCard title="Tenure">
              <VBars data={data.tenure} name="Employees" />
            </SectionCard>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <SectionCard title="Average salary by designation" className="lg:col-span-1">
              <HBars data={data.averageSalaryByDesignation.slice(0, 8)} labelKey="name" valueKey="averageGross" name="Average gross" valueFormatter={compactMoney} />
            </SectionCard>
            <SectionCard
              title="Recent activity"
              description="From the audit log"
              action={
                <Link to="/audit-log" className="text-xs font-medium text-brand-700 hover:underline">
                  Audit log
                </Link>
              }
            >
              {data.auditFeed.length === 0 ? (
                <p className="text-sm text-slate-500">No activity yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.auditFeed.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">{a.action.replace(/[._]/g, ' ')}</span>
                        <span className="block truncate text-xs text-slate-500">{a.actorName}</span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <AnnouncementsWidget />
          </div>
        </div>
      )}
    </>
  );
}
