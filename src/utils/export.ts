/** Data export helpers (CSV) and browser download plumbing. */

import type { TitrationPoint } from '../chemistry/titration';

/** RFC 4180 field escaping. */
export function csvEscape(value: string | number): string {
  const s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build the titration CSV: header `added_volume_ml,pH` followed by one row per point. */
export function titrationToCSV(points: readonly TitrationPoint[]): string {
  const lines = ['added_volume_ml,pH'];
  for (const p of points) {
    lines.push(`${csvEscape(Number(p.addedVolumeML.toFixed(6)))},${csvEscape(Number(p.pH.toFixed(6)))}`);
  }
  return lines.join('\r\n') + '\r\n';
}

/** Trigger a browser download of a Blob. Returns false when the DOM API is unavailable. */
export function downloadBlob(blob: Blob, filename: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export function downloadText(text: string, filename: string, mime = 'text/csv;charset=utf-8'): boolean {
  return downloadBlob(new Blob([text], { type: mime }), filename);
}

export function timestampForFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
