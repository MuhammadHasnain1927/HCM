import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Tabs } from '../../components/data.jsx';
import MyAttendanceTab from './MyAttendanceTab.jsx';
import DailyBoardTab from './DailyBoardTab.jsx';
import CorrectionsTab from './CorrectionsTab.jsx';

/**
 * Attendance (brief M4): own check-in and calendar for HR and Employees,
 * daily board and corrections for Admin and HR.
 */
export default function AttendancePage() {
  const { user } = useAuth();
  const role = user.role;

  const tabs = useMemo(() => {
    const list = [];
    if (role !== 'admin') list.push({ value: 'mine', label: 'My attendance' });
    if (role === 'admin' || role === 'hr') {
      list.push({ value: 'board', label: 'Daily board' });
      list.push({ value: 'corrections', label: 'Corrections' });
    }
    return list;
  }, [role]);

  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const defaultTab = role === 'admin' ? 'board' : 'mine';
  const [tab, setTab] = useState(tabs.some((t) => t.value === requested) ? requested : defaultTab);

  const changeTab = (value) => {
    setTab(value);
    setParams({ tab: value }, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Attendance"
        description={
          role === 'employee'
            ? 'Check in and out, see your month, and ask HR to fix a day.'
            : role === 'hr'
              ? 'Your own attendance, the daily board for everyone, and correction requests.'
              : 'Daily attendance for everyone and correction requests.'
        }
      />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={changeTab} />}
      {tab === 'mine' && role !== 'admin' && <MyAttendanceTab />}
      {tab === 'board' && role !== 'employee' && <DailyBoardTab />}
      {tab === 'corrections' && role !== 'employee' && <CorrectionsTab canDecide={role === 'hr'} />}
    </div>
  );
}
