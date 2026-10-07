/** Reference categorical order, validated for colour vision deficiency on adjacent pairs. */
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const HUB_PALETTE = CATEGORICAL;

export function hubColour(index: number): string {
  return HUB_PALETTE[index % HUB_PALETTE.length] ?? '#2563eb';
}

export const DC_COLOUR = '#111827';
export const CLOSED_COLOUR = '#9ca3af';
