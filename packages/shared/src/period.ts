export function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instantMs);

  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const wallClockAsUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return wallClockAsUtc - Math.floor(instantMs / 1000) * 1000;
}

export function zonedDayStartMs(instantMs: number, timeZone: string): number {
  if (!Number.isFinite(instantMs)) throw new Error('instantMs must be a finite number');
  const offset = timeZoneOffsetMs(instantMs, timeZone);
  const localMs = instantMs + offset;
  const localMidnight = Math.floor(localMs / 86_400_000) * 86_400_000;
  return localMidnight - offset;
}

export const APP_TIME_ZONE = 'Asia/Tokyo';
