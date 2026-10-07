import { useEffect, useState } from 'react';

/** True while the document uses the dark theme. */
export function useIsDark(): boolean {
  const read = () => document.documentElement.dataset.theme === 'dark';
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/** Sequential blue ramp, light to dark. */
const BLUE_RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab'];
const BLUE_RAMP_DARK = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4'];

/** Background and text colour for a 1 to 10 score. Higher scores get the stronger step. */
export function scoreColours(score: number, dark: boolean): { bg: string; fg: string } {
  const i = Math.min(9, Math.max(0, Math.round(score) - 1));
  if (dark) return { bg: BLUE_RAMP_DARK[i] ?? '#2a78d6', fg: i >= 6 ? '#0b1220' : '#ffffff' };
  return { bg: BLUE_RAMP[i] ?? '#2a78d6', fg: i >= 6 ? '#ffffff' : '#0b1220' };
}
