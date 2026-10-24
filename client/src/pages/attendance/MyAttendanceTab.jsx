import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FilePenLine } from 'lucide-react';
import { useApi } from '../../lib/useApi.js';
import { DAY_STATUS, REQUEST_STATUS, currentMonth, formatDay, formatMinutes, formatMonth, formatPercent } from '../../lib/format.js';
import CheckInWidget from '../../components/attendance/CheckInWidget.jsx';
import { Badge, DataTable } from '../../components/data.jsx';
import { Alert, Button, Card, EmptyState, Spinner } from '../../components/ui.jsx';
import AttendanceMonthGrid from './AttendanceMonthGrid.jsx';
import CorrectionRequestModal from './CorrectionRequestModal.jsx';

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const SOURCE_LABEL = { web: 'Web', camera: 'Camera', correction: 'Correction' };

function Stat({ label, value, tone = 'text-slate-900' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

/** HR and Employee: own check-in, month calendar and correction requests. */
export default function MyAttendanceTab() {
  const [month, setMonth] = useState(currentMonth());
  const calendar = useApi('/attendance/calendar', { params: { month } });
  const corrections = useApi('/attendance/corrections');
  const [selected, setSelected] = useState(null);
  const [correction, setCorrection] = useState(null); // null | { date, checkIn, checkOut }

  const data = calendar.data;
  const noRecord = calendar.error && /employee record/i.test(calendar.error);
  const shownDays = useMemo(
    () => (data?.days ?? []).filter((d) => !['upcoming', 'not_employed'].includes(d.status)).slice().reverse(),
    [data],
  );
  const selectedDay = data?.days.find((d) => d.date === selected) ?? null;

  const openCorrection = (day) =>
    setCorrection({
      date: day?.date,
      checkIn: day?.record?.checkInTime ?? '',
      checkOut: day?.record?.checkOutTime ?? '',
    });

  const dayColumns = [
    { key: 'date', header: 'Date', className: 'whitespace-nowrap', render: (d) => formatDay(d.date, { year: false }) },
    {
      key: 'status',
      header: 'Status',
      render: (d) => {
        const meta = DAY_STATUS[d.status];
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {meta?.label && <Badge color={meta.color}>{meta.label}</Badge>}
            {(d.leaveType || d.holidayName) && <span className="text-xs text-slate-500">{d.leaveType ?? d.holidayName}</span>}
          </div>
        );
      },
    },
    { key: 'in', header: 'In', render: (d) => d.record?.checkInTime ?? '-' },
    { key: 'out', header: 'Out', render: (d) => d.record?.checkOutTime ?? (d.inProgress ? 'Working' : '-') },
    { key: 'worked', header: 'Worked', className: 'whitespace-nowrap', render: (d) => formatMinutes(d.record?.workedMinutes) },
    { key: 'late', header: 'Late', render: (d) => (d.record?.lateMinutes ? `${d.record.lateMinutes} min` : '-') },
    { key: 'source', header: 'Source', render: (d) => (d.record ? SOURCE_LABEL[d.record.source] ?? d.record.source : '-') },
    {
      key: 'fix',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (d) =>
        ['absent', 'missing_checkout', 'late', 'half_day', 'present'].includes(d.status) ? (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openCorrection(d)}>
            Correct
          </Button>
        ) : null,
    },
  ];

  const correctionColumns = [
    { key: 'date', header: 'Day', className: 'whitespace-nowrap', render: (c) => formatDay(c.date) },
    { key: 'times', header: 'Requested', render: (c) => `${c.checkIn}${c.checkOut ? ` - ${c.checkOut}` : ''}` },
    { key: 'reason', header: 'Reason', render: (c) => <span className="line-clamp-2 max-w-xs">{c.reason}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <div>
          <Badge color={REQUEST_STATUS[c.status]?.color}>{REQUEST_STATUS[c.status]?.label ?? c.status}</Badge>
          {c.reviewComment && <p className="mt-1 text-xs text-slate-500">"{c.reviewComment}"</p>}
        </div>
      ),
    },
  ];

  if (noRecord) {
    return (
      <Card>
        <EmptyState title="No employee record yet">Ask HR to register you as an employee so you can check in and see your attendance.</EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-5">
        <CheckInWidget
          className="lg:col-span-2"
          onChange={() => {
            calendar.reload();
          }}
        />

        <Card className="p-4 sm:p-5 lg:col-span-3">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" className="px-2 py-1.5" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <h2 className="min-w-36 text-center text-base font-semibold text-slate-900" aria-live="polite">
                {formatMonth(month)}
              </h2>
              <Button
                variant="ghost"
                className="px-2 py-1.5"
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                disabled={month >= currentMonth()}
                aria-label="Next month"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <Button variant="secondary" className="px-3 py-1.5" onClick={() => openCorrection(selectedDay)}>
              <FilePenLine className="size-4" /> Request correction
            </Button>
          </div>

          {calendar.loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Spinner /> Loading calendar...
            </div>
          ) : calendar.error ? (
            <Alert type="error">
              {calendar.error}{' '}
              <button className="font-medium underline" onClick={calendar.reload}>
                Try again
              </button>
            </Alert>
          ) : data ? (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Attendance rate" value={formatPercent(data.rates?.attendanceRate)} tone="text-brand-800" />
                <Stat label="Present" value={(data.counts?.present ?? 0) + (data.counts?.late ?? 0)} />
                <Stat label="Late arrivals" value={data.counts?.lateArrivals ?? data.counts?.late ?? 0} tone="text-amber-700" />
                <Stat label="Absent" value={data.counts?.absent ?? 0} tone="text-red-600" />
              </div>
              <AttendanceMonthGrid days={data.days} selected={selected} onSelect={(d) => setSelected(d.date)} />
              {selectedDay && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  <span className="font-medium">{formatDay(selectedDay.date)}:</span> {DAY_STATUS[selectedDay.status]?.label || 'No status'}
                  {selectedDay.record && ` · In ${selectedDay.record.checkInTime}${selectedDay.record.checkOutTime ? ` · Out ${selectedDay.record.checkOutTime}` : ''}`}
                  {selectedDay.leaveType && ` · ${selectedDay.leaveType}`}
                  {selectedDay.holidayName && ` · ${selectedDay.holidayName}`}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">Worked this month: {data.workedHours ?? 0} h</p>
            </>
          ) : null}
        </Card>
      </div>

      <Card>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">Day by day</h2>
        </div>
        <DataTable
          columns={dayColumns}
          rows={shownDays}
          rowKey={(d) => d.date}
          loading={calendar.loading}
          error={calendar.error}
          onRetry={calendar.reload}
          empty={<EmptyState title="No days to show yet">Your attendance for this month will appear here.</EmptyState>}
        />
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">My correction requests</h2>
        </div>
        <DataTable
          columns={correctionColumns}
          rows={corrections.data}
          loading={corrections.loading}
          error={corrections.error}
          onRetry={corrections.reload}
          empty={<EmptyState title="No correction requests">If you forgot to check in or out, request a correction and HR will review it.</EmptyState>}
        />
      </Card>

      {correction && (
        <CorrectionRequestModal
          initialDate={correction.date}
          initialCheckIn={correction.checkIn}
          initialCheckOut={correction.checkOut}
          onClose={() => setCorrection(null)}
          onSaved={() => {
            setCorrection(null);
            corrections.reload();
          }}
        />
      )}
    </div>
  );
}
