const nf = (dp: number) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function fmtNum(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return nf(dp).format(n);
}

export function fmtEur(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return `€${nf(dp).format(n)}`;
}

/** Compact euro: €1.25m, €840k. */
export function fmtEurShort(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `€${nf(2).format(n / 1e6)}m`;
  if (abs >= 1e3) return `€${nf(0).format(n / 1e3)}k`;
  return `€${nf(0).format(n)}`;
}

export function fmtPct(share: number | null | undefined, dp = 0): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return '–';
  return `${nf(dp).format(share * 100)}%`;
}

export function fmtMetric(n: number | null | undefined, unit: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  if (unit.startsWith('€/year')) return fmtEur(n);
  if (unit.startsWith('€/unit')) return fmtEur(n, 3);
  if (unit === 'FTE') return `${fmtNum(n, 1)} FTE`;
  if (unit === 'points') return `${fmtNum(n, 1)} points`;
  return `${fmtNum(n, Math.abs(n) < 10 ? 2 : 0)} ${unit}`.trim();
}
