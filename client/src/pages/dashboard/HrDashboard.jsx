import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CalendarDays, Clock, Inbox, Percent, UserCheck, Users } from 'lucide-react';
import { useApi } from '../../lib/useApi.js';
import { todayIso } from '../../lib/format.js';
import { Alert, Spinner } from '../../components/ui.jsx';
import { Badge } from '../../components/data.jsx';
import { AiSummaryCard, AnnouncementsWidget, FilterBar, KpiCard, SectionCard } from '../../components/dashboard/widgets.jsx';
import { Donut, HBars, TrendLine } from '../../components/dashboard/charts.jsx';

const pct = (v) => (v === null || v === undefined ? '-' : `${v}%`);

/** HR dashboard (brief, Section 7). Admin can open it too for the people view. */
export default function HrDashboard({ scope = 'hr', header }) {
  const today = todayIso();
  const [filters, setFilters] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const { data, loading, error, reload } = useApi('/analytics/hr', { params: filters });

  return (
    <>
      {header}
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Headcount" value={data.kpis.headcount} icon={Users} to="/employees" />
            <KpiCard label="Present today" value={data.kpis.presentToday} icon={UserCheck} hint={`${data.kpis.notCheckedInToday} not checked in yet`} to="/attendance?tab=board" />
            <KpiCard label="On leave today" value={data.kpis.onLeaveToday} icon={CalendarDays} />
            <KpiCard label="Late today" value={data.kpis.lateToday} icon={Clock} tone={data.kpis.lateToday ? 'warn' : 'default'} />
            <KpiCard
              label="Pending approvals"
              value={data.kpis.pendingApprovals}
              icon={Inbox}
              tone={data.kpis.pendingApprovals ? 'warn' : 'default'}
              hint={`${data.kpis.pendingLeaves} leave · ${data.kpis.pendingCorrections} corrections`}
              to={scope === 'hr' ? '/leave?tab=approvals' : '/leave?tab=all'}
            />
            <KpiCard label="Attendance rate" value={pct(data.kpis.attendanceRate)} icon={Percent} hint={`Late ${pct(data.kpis.latePercent)} · absent ${pct(data.kpis.absenteeism)}`} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <SectionCard title="Attendance rate by day" description="(present + late + missing check-out + ½ half days) ÷ (expected days − on leave)" className="lg:col-span-2">
              <TrendLine data={data.attendanceTrend} />
            </SectionCard>
            <AiSummaryCard scope={scope} filters={filters} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <SectionCard title="Absenteeism by department" description="Absent days ÷ expected working days">
              <HBars data={data.absenteeismByDepartment} labelKey="department" valueKey="absenteeism" name="Absenteeism" valueFormatter={(v) => `${v}%`} />
            </SectionCard>
            <SectionCard title="Leave by type" description="Approved leave days in the period">
              <Donut data={data.leaveByType} nameKey="leaveType" valueKey="days" />
            </SectionCard>
            <SectionCard title="Top 5 late-comers" description="Check-ins after the grace period">
              {data.topLateComers.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Nobody was late in this period.</p>
              ) : (
                <ol className="space-y-2">
                  {data.topLateComers.map((p, i) => (
                    <li key={p.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-50 text-xs font-semibold text-amber-800">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">{p.name}</span>
                          <span className="block truncate text-xs text-slate-500">{p.department}</span>
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-700">
                        {p.lateDays} day{p.lateDays === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </SectionCard>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <SectionCard title="On leave today">
              {data.today.onLeaveList.length === 0 ? (
                <p className="text-sm text-slate-500">Nobody is on leave today.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.today.onLeaveList.map((p) => (
                    <li key={p.name} className="flex justify-between gap-2">
                      <span className="font-medium text-slate-900">{p.name}</span>
                      <span className="text-slate-500">{p.leaveType}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <Insights insights={data.insights} />
            <AnnouncementsWidget />
          </div>

          <SectionCard title="Leave utilization" description="Approved days this year ÷ (quota × employees)">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.leaveUtilization.map((u) => (
                <div key={u.code} className="rounded-lg border border-slate-100 p-3">
                  <p className="text-xs text-slate-500">{u.leaveType}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{u.utilization === null ? `${u.approvedDays} days` : `${u.utilization}%`}</p>
                  {u.utilization !== null && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, u.utilization)}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </>
  );
}

/** Bonus insights: absence anomaly flags and a simple attrition-risk score. */
function Insights({ insights }) {
  const { absenceAnomalies = [], attritionRisk = [] } = insights ?? {};
  return (
    <SectionCard title="Insights" description="Absence anomalies and attrition risk (needs 5+ working days of data)">
      {absenceAnomalies.length === 0 && attritionRisk.length === 0 && <p className="text-sm text-slate-500">Nothing unusual in this period.</p>}
      <ul className="space-y-2 text-sm">
        {absenceAnomalies.map((a) => (
          <li key={`a-${a.name}`} className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <span>
              <span className="font-medium text-slate-900">{a.name}</span> was absent {a.absentDays} days (team average {a.teamAverage}).
            </span>
          </li>
        ))}
        {attritionRisk.map((r) => (
          <li key={`r-${r.name}`} className="flex items-start justify-between gap-2">
            <span>
              <span className="font-medium text-slate-900">{r.name}</span>
              <span className="block text-xs text-slate-500">{r.reasons.join(', ') || 'Pattern of absence or lateness'}</span>
            </span>
            <Badge color={r.level === 'high' ? 'red' : 'amber'}>{r.level === 'high' ? 'High' : 'Medium'} risk · {r.score}</Badge>
          </li>
        ))}
      </ul>
      {(absenceAnomalies.length > 0 || attritionRisk.length > 0) && (
        <Link to="/employees" className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline">
          Open the employee directory
        </Link>
      )}
    </SectionCard>
  );
}
