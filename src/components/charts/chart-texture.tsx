/**
 * Trama diagonal de la serie 2 (codificación secundaria de identidad).
 *
 * Una única trama, a 45°, tinta sobre un paso más tenue del mismo gris: nunca
 * horizontal ni vertical, que se leerían como rejilla o como más barras.
 * Se referencia con `fill="url(#id)"`; va en el <defs> de cada SVG.
 */
export function ChartTexture({ id }: { id: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" className="chart-texture-base" />
      <line x1="1.25" y1="0" x2="1.25" y2="6" className="chart-texture-ink" strokeWidth="2.5" />
    </pattern>
  );
}
