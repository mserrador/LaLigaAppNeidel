import { DateTime } from 'luxon';

export const SCHEDULING_ZONE = 'Europe/Madrid';

export const madridLocalToUtcIso = (value) => {
  if (!value) return null;
  const parsed = DateTime.fromISO(value, { zone: SCHEDULING_ZONE });
  return parsed.isValid ? parsed.toUTC().toISO() : null;
};

export const utcIsoToMadridLocal = (value) => {
  if (!value) return '';
  const parsed = DateTime.fromISO(value, { setZone: true }).setZone(SCHEDULING_ZONE);
  return parsed.isValid ? parsed.toFormat("yyyy-MM-dd'T'HH:mm") : '';
};

export const formatMadridDateTime = (value, fallback = 'Sin fecha') => {
  if (!value) return fallback;
  const parsed = DateTime.fromISO(value, { setZone: true }).setZone(SCHEDULING_ZONE);
  return parsed.isValid ? parsed.toFormat('dd/MM/yyyy HH:mm:ss') : fallback;
};

export const getCountdown = (value, now = DateTime.utc()) => {
  const target = DateTime.fromISO(value || '', { setZone: true });
  const current = DateTime.isDateTime(now) ? now : DateTime.fromISO(String(now), { setZone: true });
  if (!target.isValid || !current.isValid) return { expired: true, totalSeconds: 0, text: 'Fecha no válida' };

  const totalSeconds = Math.max(0, Math.floor(target.diff(current, 'seconds').seconds));
  if (totalSeconds === 0) return { expired: true, totalSeconds: 0, text: 'Llegó la hora' };

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  if (!days) parts.push(`${seconds}s`);
  return { expired: false, totalSeconds, text: parts.join(' ') };
};

export const subtractOffsetFromIso = (value, amount, unit = 'minutes') => {
  const parsed = DateTime.fromISO(value || '', { setZone: true });
  const quantity = Number(amount);
  if (!parsed.isValid || !Number.isFinite(quantity) || quantity < 0) return null;
  const seconds = unit === 'seconds' ? quantity : quantity * 60;
  return parsed.minus({ seconds }).toUTC().toISO();
};
