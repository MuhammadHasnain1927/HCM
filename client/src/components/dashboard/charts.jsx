import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDay } from '../../lib/format.js';

// Charts follow the data-viz method: thin marks, rounded bar ends, recessive
// grid and axes, hover tooltips, colors from CSS roles (light/dark aware),
// categorical hues in a fixed order, and a legend whenever there are 2+ series.

const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const axis = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: false };

function TooltipBox({ active, payload, label, labelFormatter, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <p className="mb-1 font-medium text-slate-900">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey ?? p.name} className="flex items-center gap-2 text-slate-600">
          <span className="size-2 rounded-full" style={{ background: p.color ?? p.payload?.fill }} aria-hidden />
          {p.name}: <span className="font-medium text-slate-900">{valueFormatter ? valueFormatter(p.value, p) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function EmptyChart({ children = 'No data for these filters yet.', height = 220 }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500" style={{ height }}>
      {children}
    </div>
  );
}

/** Attendance rate per working day (a single series: no legend box, the title names it). */
export function TrendLine({ data, dataKey = 'attendanceRate', name = 'Attendance rate', unit = '%', height = 220 }) {
  const points = (data ?? []).filter((d) => d[dataKey] !== null && d[dataKey] !== undefined);
  if (!points.length) return <EmptyChart height={height} />;
  return (
    <div style={{ height }} role="img" aria-label={`${name} by day`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => formatDay(d, { weekday: false, year: false })} {...axis} minTickGap={24} />
          <YAxis domain={[0, 100]} unit={unit} {...axis} width={44} />
          <Tooltip
            content={<TooltipBox labelFormatter={(d) => formatDay(d)} valueFormatter={(v) => `${v}${unit}`} />}
            cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }}
          />
          <Line type="monotone" dataKey={dataKey} name={name} stroke="var(--chart-single)" strokeWidth={2} dot={points.length < 25 ? { r: 3, strokeWidth: 0, fill: 'var(--chart-single)' } : false} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for one measure across categories (departments, leave types). */
export function HBars({ data, labelKey, valueKey, name, valueFormatter = (v) => v, height }) {
  const rows = (data ?? []).filter((d) => d[valueKey] !== null && d[valueKey] !== undefined);
  if (!rows.length) return <EmptyChart height={height ?? 160} />;
  const h = height ?? Math.max(120, rows.length * 34 + 24);
  return (
    <div style={{ height: h }} role="img" aria-label={`${name} by ${labelKey}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }} barCategoryGap={8}>
          <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" {...axis} tickFormatter={(v) => valueFormatter(v)} hide />
          <YAxis type="category" dataKey={labelKey} {...axis} width={110} tick={{ fill: 'var(--chart-axis)', fontSize: 12 }} />
          <Tooltip content={<TooltipBox valueFormatter={(v) => valueFormatter(v)} />} cursor={{ fill: 'var(--chart-grid)', opacity: 0.4 }} />
          <Bar
            dataKey={valueKey}
            name={name}
            fill="var(--chart-single)"
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            label={{ position: 'right', fill: 'var(--chart-axis)', fontSize: 11, formatter: (v) => valueFormatter(v) }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Parts of a whole (gender split, leave by type) with a legend and values. */
export function Donut({ data, nameKey = 'name', valueKey = 'value', height = 200 }) {
  const rows = (data ?? []).filter((d) => d[valueKey] > 0);
  if (!rows.length) return <EmptyChart height={height} />;
  const total = rows.reduce((s, r) => s + r[valueKey], 0);
  const top = rows.slice(0, 4);
  const other = rows.slice(4).reduce((s, r) => s + r[valueKey], 0);
  const slices = other ? [...top, { [nameKey]: 'Other', [valueKey]: other }] : top;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div style={{ height, width: height }} className="shrink-0" role="img" aria-label="Breakdown chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey={valueKey} nameKey={nameKey} innerRadius="58%" outerRadius="90%" paddingAngle={2} stroke="var(--chart-surface)" strokeWidth={2}>
              {slices.map((s, i) => (
                <Cell key={s[nameKey]} fill={i < SERIES.length ? SERIES[i] : 'var(--chart-axis)'} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox valueFormatter={(v) => `${v} (${Math.round((v / total) * 100)}%)`} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {slices.map((s, i) => (
          <li key={s[nameKey]} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 capitalize text-slate-600">
              <span className="size-2.5 rounded-sm" style={{ background: i < SERIES.length ? SERIES[i] : 'var(--chart-axis)' }} aria-hidden />
              {s[nameKey]}
            </span>
            <span className="font-medium tabular-nums text-slate-900">
              {s[valueKey]} <span className="text-xs font-normal text-slate-400">({Math.round((s[valueKey] / total) * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical bars for ordered buckets (tenure). */
export function VBars({ data, labelKey = 'name', valueKey = 'value', name, height = 200 }) {
  if (!(data ?? []).some((d) => d[valueKey] > 0)) return <EmptyChart height={height} />;
  return (
    <div style={{ height }} role="img" aria-label={name}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey={labelKey} {...axis} interval={0} />
          <YAxis allowDecimals={false} {...axis} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: 'var(--chart-grid)', opacity: 0.4 }} />
          <Bar dataKey={valueKey} name={name} fill="var(--chart-single)" radius={[4, 4, 0, 0]} maxBarSize={40} label={{ position: 'top', fill: 'var(--chart-axis)', fontSize: 11 }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
