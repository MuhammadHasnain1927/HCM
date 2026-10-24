import { describe, expect, it } from 'vitest';
import { checkInStatus, finalStatus } from '../src/services/attendance.service.js';
import { rates } from '../src/services/daystatus.service.js';
import {
  addDays,
  dayOfWeek,
  localDate,
  localMinutes,
  monthRange,
  workingDaysBetween,
  zonedDateTime,
} from '../src/utils/time.js';

const settings = { officeStart: '09:00', graceMinutes: 15, halfDayHours: 5 };

describe('attendance rules (brief, Section 3, M4)', () => {
  it('is late only after 09:15', () => {
    expect(checkInStatus(9 * 60, settings)).toEqual({ status: 'present', lateMinutes: 0 });
    expect(checkInStatus(9 * 60 + 15, settings)).toEqual({ status: 'present', lateMinutes: 0 });
    expect(checkInStatus(9 * 60 + 16, settings)).toEqual({ status: 'late', lateMinutes: 16 });
  });

  it('is a half day under 5 hours, whatever the check-in status', () => {
    expect(finalStatus('present', 299, settings)).toBe('half_day');
    expect(finalStatus('late', 299, settings)).toBe('half_day');
    expect(finalStatus('late', 300, settings)).toBe('late');
    expect(finalStatus('present', 480, settings)).toBe('present');
  });
});

describe('company timezone handling', () => {
  it('reads local date and time in Asia/Karachi (UTC+5), not the server zone', () => {
    const instant = new Date('2026-03-02T23:30:00Z'); // 04:30 next day in Karachi
    expect(localDate(instant, 'Asia/Karachi')).toBe('2026-03-03');
    expect(localMinutes(instant, 'Asia/Karachi')).toBe(4 * 60 + 30);
  });

  it('builds an instant from a local date and time', () => {
    expect(zonedDateTime('2026-03-02', '09:05', 'Asia/Karachi').toISOString()).toBe('2026-03-02T04:05:00.000Z');
    expect(zonedDateTime('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });

  it('counts working days without weekends and holidays', () => {
    const cal = { weekendDays: [6, 0], holidays: new Set(['2026-03-11']) };
    // Mon 9 Mar .. Sun 15 Mar: 5 weekdays minus 1 holiday.
    expect(workingDaysBetween('2026-03-09', '2026-03-15', cal)).toEqual(['2026-03-09', '2026-03-10', '2026-03-12', '2026-03-13']);
    expect(dayOfWeek('2026-03-09')).toBe(1);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
});

describe('attendance metrics (brief, Section 7)', () => {
  it('uses the brief formulas', () => {
    const r = rates({ present: 6, late: 2, half_day: 2, missing_checkout: 1, absent: 1, on_leave: 2, expected: 14 });
    // (6 + 2 + 1 + 0.5*2) / (14 - 2) = 10 / 12
    expect(r.attendanceRate).toBe(83.3);
    expect(r.latePercent).toBe(25); // 2 / (6 + 2)
    expect(r.absenteeism).toBe(7.1); // 1 / 14
  });

  it('returns null instead of dividing by zero', () => {
    expect(rates({ present: 0, late: 0, half_day: 0, missing_checkout: 0, absent: 0, on_leave: 0, expected: 0 })).toEqual({
      attendanceRate: null,
      latePercent: null,
      absenteeism: null,
    });
  });
});
