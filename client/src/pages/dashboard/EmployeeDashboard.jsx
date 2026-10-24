import { Link } from 'react-router';
import { Clock, FileText, MessageCircle, Percent, TimerReset } from 'lucide-react';
import { useApi } from '../../lib/useApi.js';
import { downloadFile } from '../../lib/download.js';
import { formatMoney, formatMonth } from '../../lib/format.js';
import { useToast } from '../../components/toast.jsx';
import { Alert, Button, Card, Spinner } from '../../components/ui.jsx';
import { AnnouncementsWidget, KpiCard, SectionCard } from '../../components/dashboard/widgets.jsx';
import CheckInWidget from '../../components/attendance/CheckInWidget.jsx';
import LeaveBalanceCards from '../../components/leave/LeaveBalanceCards.jsx';

/** Personal dashboard (brief, Section 7): check-in, hours vs 40, lates, leave, payslip. */
export default function EmployeeDashboard({ header }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/analytics/me');

  if (loading && !data) {
    return (
      <>
        {header}
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Spinner /> Loading your dashboard...
        </div>
      </>
    );
  }

  if (data && !data.hasEmployeeRecord) {
    return (
      <>
        {header}
        <Alert type="info">Your login is not linked to an employee record yet, so there is no attendance or leave to show. Ask HR to register you as an employee.</Alert>
        <div className="mt-5">
          <AnnouncementsWidget />
        </div>
      </>
    );
  }

  const hoursPct = data ? Math.min(100, Math.round((data.hoursThisWeek / data.weeklyTargetHours) * 100)) : 0;
  const askAssistant = () => window.dispatchEvent(new CustomEvent('assistant:open', { detail: { question: 'How many leaves do I have left this year?' } }));

  return (
    <>
      {header}
      {error && (
        <Alert type="error" className="mb-4">
          {error}{' '}
          <button className="font-medium underline" onClick={reload}>
            Try again
          </button>
        </Alert>
      )}
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CheckInWidget onChange={reload} />
          </div>
          <SectionCard title="Hours this week" description={`Target ${data?.weeklyTargetHours ?? 40} h`}>
            <p className="text-3xl font-semibold tabular-nums text-slate-900">
              {data?.hoursThisWeek ?? 0}
              <span className="text-base font-normal text-slate-500"> h</span>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={hoursPct} aria-valuemin={0} aria-valuemax={100} aria-label="Hours this week">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${hoursPct}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{hoursPct}% of the weekly target</p>
          </SectionCard>
        </div>

        {data && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Late this month" value={data.lateThisMonth} icon={Clock} tone={data.lateThisMonth ? 'warn' : 'default'} to="/attendance" />
            <KpiCard label="Absent this month" value={data.absentThisMonth} icon={TimerReset} to="/attendance" />
            <KpiCard label="Attendance this month" value={data.attendanceRateThisMonth === null ? '-' : `${data.attendanceRateThisMonth}%`} icon={Percent} />
            <KpiCard
              label="Last payslip"
              value={data.lastPayslip ? formatMoney(data.lastPayslip.net) : '-'}
              icon={FileText}
              hint={data.lastPayslip ? `Net pay, ${formatMonth(data.lastPayslip.month)}` : 'None yet'}
              to="/payslips"
            />
          </div>
        )}

        <SectionCard
          title="Leave balance"
          action={
            <Link to="/leave" className="text-xs font-medium text-brand-700 hover:underline">
              Apply for leave
            </Link>
          }
        >
          <LeaveBalanceCards compact />
        </SectionCard>

        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AnnouncementsWidget />
          </div>
          <Card className="flex flex-col justify-between gap-4 p-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Ask my assistant</h2>
              <p className="mt-1 text-sm text-slate-500">Ask about your leave, attendance, payslip or company rules. Answers come from your own records.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={askAssistant}>
                <MessageCircle className="size-4" /> Ask a question
              </Button>
              {data?.lastPayslip && (
                <Button
                  variant="secondary"
                  onClick={() => downloadFile(`/payslips/${data.lastPayslip.id}/pdf`, `payslip-${data.lastPayslip.month}.pdf`).catch(() => toast.error('Download failed.'))}
                >
                  <FileText className="size-4" /> Last payslip
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
