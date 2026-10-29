const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isReadDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const timestamp = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day;
}

// Only the daily, salted visitor hash is allowed to leave the gateway.
export function checkedReadEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid read event');
  const keys = Object.keys(event).sort();
  if (keys.join(',') !== 'country,day,id,visitor') throw new Error('Unexpected read event fields');
  const { id, day, visitor, country } = event;
  if (!UUID.test(id ?? '') || !/^[a-f0-9]{24}$/.test(visitor ?? '') || !/^[A-Z]{2}$/.test(country ?? '')) throw new Error('Invalid read event');
  if (!isReadDay(day)) throw new Error('Invalid read event day');
  return { id, day, visitor, country };
}
