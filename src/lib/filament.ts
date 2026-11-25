/** Conversión de longitud de filamento a peso. */

/** Densidades típicas en g/cm³. */
export const FILAMENT_DENSITY: Record<string, number> = {
  PLA: 1.24,
  "PLA+": 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  PA: 1.14,
  NYLON: 1.14,
  PC: 1.2,
  PVA: 1.23,
  HIPS: 1.04,
};

export function densityFor(materialType: string | null | undefined): number {
  if (!materialType) return FILAMENT_DENSITY.PLA;
  const key = materialType.trim().toUpperCase();
  if (FILAMENT_DENSITY[key]) return FILAMENT_DENSITY[key];
  const match = Object.keys(FILAMENT_DENSITY).find((k) => key.startsWith(k));
  return match ? FILAMENT_DENSITY[match] : FILAMENT_DENSITY.PLA;
}

/** Milímetros de filamento → gramos (1,75 mm de diámetro por defecto). */
export function filamentMmToGrams(lengthMm: number, materialType?: string | null, diameterMm = 1.75): number {
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) return 0;
  const radiusCm = diameterMm / 20;
  const volumeCm3 = Math.PI * radiusCm * radiusCm * (lengthMm / 10);
  return volumeCm3 * densityFor(materialType);
}
