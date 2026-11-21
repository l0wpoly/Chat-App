export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatMinutesLeft(iso: string, nowMs = Date.now()): string {
  const createdMs = new Date(iso).getTime();
  const expiresMs = createdMs + 60 * 60 * 1000;
  const diffMin = Math.max(0, Math.ceil((expiresMs - nowMs) / 60000));
  if (diffMin <= 1) return '<1m left';
  return `${diffMin}m left`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = idx === 0 ? 0 : idx === 1 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[idx]}`;
}

export function formatAudioSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
