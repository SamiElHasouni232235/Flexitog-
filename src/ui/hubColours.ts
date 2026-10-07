const HUB_PALETTE = ['#2563eb', '#d97706', '#059669', '#7c3aed', '#dc2626', '#0891b2', '#be185d', '#65a30d', '#ca8a04'];

export function hubColour(index: number): string {
  return HUB_PALETTE[index % HUB_PALETTE.length] ?? '#2563eb';
}

export const DC_COLOUR = '#111827';
export const CLOSED_COLOUR = '#9ca3af';
