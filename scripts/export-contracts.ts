/**
 * Vuelca las plantillas de contrato con sus huecos «[…]» en JSON, para generar
 * los Word de `public/plantillas/`:
 *
 *   npx tsx scripts/export-contracts.ts > contratos.json
 *   python3 scripts/build-contract-docx.py contratos.json public/plantillas
 */
import { CONTRACT_TEMPLATES, PARTY_PLACEHOLDERS, buildContract } from "../src/lib/contract-templates";

const out = CONTRACT_TEMPLATES.map((t) => {
  const values: Record<string, string> = { ...PARTY_PLACEHOLDERS };
  for (const f of t.fields) values[`campo.${f.key}`] = f.placeholder;
  return { slug: t.slug, ...buildContract(t, values) };
});
process.stdout.write(JSON.stringify(out, null, 2));
