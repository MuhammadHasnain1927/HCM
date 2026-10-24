import { useEffect, useMemo, useState } from 'react';
import { Clock, ExternalLink, LocateFixed, MapPin } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../components/toast.jsx';
import { Alert, Button, Card, Input, Select, Spinner } from '../../components/ui.jsx';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const toForm = (s) => ({
  companyName: s.companyName,
  timezone: s.timezone,
  officeStart: s.officeStart,
  officeEnd: s.officeEnd,
  graceMinutes: String(s.graceMinutes),
  halfDayHours: String(s.halfDayHours),
  weekendDays: s.weekendDays,
  lat: s.office.lat ?? '',
  lng: s.office.lng ?? '',
  radiusMeters: String(s.office.radiusMeters),
  latePenaltyEnabled: Boolean(s.latePenaltyEnabled),
  faceCheckInRequired: s.faceCheckInRequired !== false,
});

function Section({ icon: Icon, title, description, children }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-lg bg-brand-50 p-2 text-brand-700">
          <Icon className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

export default function CompanySettingsTab({ canEdit }) {
  const toast = useToast();
  const { updateCompany } = useAuth();
  const { data, loading, error, reload } = useApi('/settings');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['Asia/Karachi', 'UTC'];
    }
  }, []);

  useEffect(() => {
    if (data) setForm(toForm(data));
  }, [data]);

  if (loading && !form) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
        <Spinner /> Loading settings...
      </div>
    );
  }
  if (error && !form) {
    return (
      <Alert type="error">
        {error}{' '}
        <button className="font-medium underline" onClick={reload}>
          Try again
        </button>
      </Alert>
    );
  }
  if (!form) return null;

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const toggleDay = (day) =>
    setForm((f) => ({
      ...f,
      weekendDays: f.weekendDays.includes(day) ? f.weekendDays.filter((d) => d !== day) : [...f.weekendDays, day],
    }));

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Location is not available in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }));
        setErrors((er) => ({ ...er, office: undefined }));
        setLocating(false);
        toast.success(`Location captured (accuracy about ${Math.round(pos.coords.accuracy)} m).`);
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === 1 ? 'Location permission was denied.' : 'Could not get your location.');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = async (e) => {
    e.preventDefault();
    const er = {};
    const num = (v) => (v === '' || v === null ? null : Number(v));
    const lat = num(form.lat);
    const lng = num(form.lng);
    if (form.companyName.trim().length < 2) er.companyName = 'Company name is required';
    if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) er.lat = 'Between -90 and 90';
    if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) er.lng = 'Between -180 and 180';
    if ((lat === null) !== (lng === null)) er.lat = 'Enter both latitude and longitude, or neither';
    setErrors(er);
    if (Object.keys(er).length) return;

    setSaving(true);
    try {
      const { data: saved } = await api.put('/settings', {
        companyName: form.companyName.trim(),
        timezone: form.timezone,
        officeStart: form.officeStart,
        officeEnd: form.officeEnd,
        graceMinutes: Number(form.graceMinutes),
        halfDayHours: Number(form.halfDayHours),
        weekendDays: form.weekendDays,
        office: { lat, lng, radiusMeters: Number(form.radiusMeters) },
        latePenaltyEnabled: form.latePenaltyEnabled,
        faceCheckInRequired: form.faceCheckInRequired,
      });
      setForm(toForm(saved));
      toast.success('Company settings saved.');
      updateCompany({ name: saved.companyName, timezone: saved.timezone });
    } catch (err) {
      const fe = fieldErrors(err);
      // Server reports nested fields as "office.radiusMeters"; map them to inputs.
      setErrors({
        ...fe,
        radiusMeters: fe['office.radiusMeters'],
        lat: fe['office.lat'] ?? fe.office,
        lng: fe['office.lng'],
      });
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const hasLocation = form.lat !== '' && form.lng !== '';
  const disabled = !canEdit || saving;

  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      <Section icon={Clock} title="Company and working hours" description="Used to decide present, late, half day and absent.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Company name" value={form.companyName} onChange={set('companyName')} error={errors.companyName} disabled={disabled} />
          <Select label="Timezone" value={form.timezone} onChange={set('timezone')} error={errors.timezone} disabled={disabled}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
          <Input label="Office start" type="time" value={form.officeStart} onChange={set('officeStart')} error={errors.officeStart} disabled={disabled} />
          <Input label="Office end" type="time" value={form.officeEnd} onChange={set('officeEnd')} error={errors.officeEnd} disabled={disabled} />
          <Input
            label="Grace period (minutes)"
            type="number"
            min="0"
            max="120"
            value={form.graceMinutes}
            onChange={set('graceMinutes')}
            error={errors.graceMinutes}
            hint={`Check-in after ${lateAfter(form.officeStart, form.graceMinutes)} counts as late.`}
            disabled={disabled}
          />
          <Input
            label="Half day if worked less than (hours)"
            type="number"
            min="1"
            max="12"
            step="0.5"
            value={form.halfDayHours}
            onChange={set('halfDayHours')}
            error={errors.halfDayHours}
            disabled={disabled}
          />
        </div>
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-medium text-slate-700">Weekend days</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => {
              const on = form.weekendDays.includes(d.value);
              return (
                <button
                  type="button"
                  key={d.value}
                  onClick={() => toggleDay(d.value)}
                  disabled={disabled}
                  aria-pressed={on}
                  className={`min-w-14 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${
                    on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {errors.weekendDays && <p className="mt-1.5 text-sm text-red-600">{errors.weekendDays}</p>}
        </fieldset>
        <label className="mt-5 flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
          <input
            type="checkbox"
            checked={form.latePenaltyEnabled}
            onChange={(e) => setForm((f) => ({ ...f, latePenaltyEnabled: e.target.checked }))}
            disabled={disabled}
            className="mt-0.5 size-4 rounded border-slate-300 accent-brand-700"
          />
          <span>
            <span className="font-medium text-slate-900">Late penalty</span>
            <span className="block text-slate-500">Every 3 late days deduct half a day of pay in payroll. Off by default.</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
          <input
            type="checkbox"
            checked={form.faceCheckInRequired}
            onChange={(e) => setForm((f) => ({ ...f, faceCheckInRequired: e.target.checked }))}
            disabled={disabled}
            className="mt-0.5 size-4 rounded border-slate-300 accent-brand-700"
          />
          <span>
            <span className="font-medium text-slate-900">Face ID for attendance</span>
            <span className="block text-slate-500">
              Check-in and check-out need a live camera photo with a blink, matched by AI to the employee's enrolled face, so nobody can mark attendance for someone else. The office radius below also applies when set. On by default.
            </span>
          </span>
        </label>
      </Section>

      <Section
        icon={MapPin}
        title="Office location"
        description="Camera check-ins are accepted only within this distance of the office."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Latitude" inputMode="decimal" placeholder="e.g. 24.860700" value={form.lat} onChange={set('lat')} error={errors.lat} disabled={disabled} />
          <Input label="Longitude" inputMode="decimal" placeholder="e.g. 67.001100" value={form.lng} onChange={set('lng')} error={errors.lng} disabled={disabled} />
          <Input
            label="Radius (meters)"
            type="number"
            min="10"
            max="5000"
            value={form.radiusMeters}
            onChange={set('radiusMeters')}
            error={errors.radiusMeters}
            disabled={disabled}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canEdit && (
            <Button type="button" variant="secondary" onClick={useMyLocation} loading={locating} disabled={saving}>
              <LocateFixed className="size-4" /> Use my current location
            </Button>
          )}
          {hasLocation && (
            <a
              href={`https://www.google.com/maps?q=${encodeURIComponent(`${form.lat},${form.lng}`)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
            >
              View on map <ExternalLink className="size-3.5" />
            </a>
          )}
          {!hasLocation && <span className="text-sm text-slate-500">No office location set yet.</span>}
        </div>
      </Section>

      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setForm(toForm(data))} disabled={saving}>
            Discard changes
          </Button>
          <Button type="submit" loading={saving}>
            Save settings
          </Button>
        </div>
      )}
    </form>
  );
}

function lateAfter(start, grace) {
  if (!/^\d{2}:\d{2}$/.test(start || '')) return '...';
  const [h, m] = start.split(':').map(Number);
  const total = h * 60 + m + (Number(grace) || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
