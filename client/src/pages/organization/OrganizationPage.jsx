import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Tabs } from '../../components/data.jsx';
import { Alert } from '../../components/ui.jsx';
import CompanySettingsTab from './CompanySettingsTab.jsx';
import DepartmentsTab from './DepartmentsTab.jsx';
import DesignationsTab from './DesignationsTab.jsx';
import LeaveTypesTab from './LeaveTypesTab.jsx';
import HolidaysTab from './HolidaysTab.jsx';

const TABS = [
  { value: 'company', label: 'Company' },
  { value: 'departments', label: 'Departments' },
  { value: 'designations', label: 'Designations' },
  { value: 'leave-types', label: 'Leave types' },
  { value: 'holidays', label: 'Holidays' },
];

export default function OrganizationPage() {
  const { user } = useAuth();
  const canEdit = user.role === 'admin';
  const [params, setParams] = useSearchParams();
  const initial = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'company';
  const [tab, setTab] = useState(initial);

  const changeTab = (value) => {
    setTab(value);
    setParams({ tab: value }, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Organization"
        description="Company rules, structure and calendar. Rule changes apply to new records only."
      />
      {!canEdit && (
        <Alert type="info" className="mb-5">
          You can view the organization setup. Only an Admin can change it.
        </Alert>
      )}
      <Tabs tabs={TABS} value={tab} onChange={changeTab} />
      {tab === 'company' && <CompanySettingsTab canEdit={canEdit} />}
      {tab === 'departments' && <DepartmentsTab canEdit={canEdit} />}
      {tab === 'designations' && <DesignationsTab canEdit={canEdit} />}
      {tab === 'leave-types' && <LeaveTypesTab canEdit={canEdit} />}
      {tab === 'holidays' && <HolidaysTab canEdit={canEdit} />}
    </div>
  );
}
