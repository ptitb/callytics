function partsInZone(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return parts;
}

/** dd-mm-yyyy HH:mm:ss in the given time zone, the same format the Callytics UI uses. */
export function formatDateTime(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/** yyyy-mm-dd-HHmm in the given time zone, used in attachment file names. */
export function formatFileStamp(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
}

/** 18 -> "18 s", 65 -> "1 min 05 s". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes} min ${seconds} s`;
}
