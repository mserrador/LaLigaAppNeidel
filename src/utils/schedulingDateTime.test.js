import { DateTime } from 'luxon';
import {
  formatMadridDateTime,
  getCountdown,
  madridLocalToUtcIso,
  subtractOffsetFromIso,
  utcIsoToMadridLocal,
} from './schedulingDateTime';

describe('schedulingDateTime', () => {
  test('converts Madrid winter and summer local times to UTC', () => {
    expect(madridLocalToUtcIso('2026-01-15T18:30')).toBe('2026-01-15T17:30:00.000Z');
    expect(madridLocalToUtcIso('2026-07-15T18:30')).toBe('2026-07-15T16:30:00.000Z');
  });

  test('formats and restores values in Europe/Madrid', () => {
    expect(formatMadridDateTime('2026-07-15T16:30:00.000Z')).toBe('15/07/2026 18:30:00');
    expect(utcIsoToMadridLocal('2026-07-15T16:30:00.000Z')).toBe('2026-07-15T18:30');
  });

  test('builds a stable countdown and expiration state', () => {
    const now = DateTime.fromISO('2026-10-03T10:00:00Z');
    expect(getCountdown('2026-10-04T12:02:03Z', now)).toMatchObject({
      expired: false,
      totalSeconds: 93723,
      text: '1d 2h 2m',
    });
    expect(getCountdown('2026-10-03T09:00:00Z', now).expired).toBe(true);
  });

  test('subtracts expiration offsets in seconds or minutes', () => {
    expect(subtractOffsetFromIso('2026-10-03T12:00:00Z', 90, 'seconds')).toBe('2026-10-03T11:58:30.000Z');
    expect(subtractOffsetFromIso('2026-10-03T12:00:00Z', 5, 'minutes')).toBe('2026-10-03T11:55:00.000Z');
  });
});
