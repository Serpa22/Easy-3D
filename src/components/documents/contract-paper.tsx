import { Paper, PaperHeader, SignatureBoxes, type PaperBrand } from "@/components/documents/document-paper";
import { cn } from "@/lib/cn";
import type { BuiltContract } from "@/lib/contract-templates";

/** «Primera. Objeto» → ordinal (en acento) y título. */
function splitClause(heading: string): { ordinal: string | null; title: string } {
  const i = heading.indexOf(". ");
  return i > 0 ? { ordinal: heading.slice(0, i), title: heading.slice(i + 2) } : { ordinal: null, title: heading };
}

/**
 * Contrato montado (`buildContract`) en una hoja A4 imprimible, con la marca de
 * la sub-empresa. `standalone`: el título es el `h1` de la página (impresión).
 */
export function ContractPaper({ contract, brand, standalone }: { contract: BuiltContract; brand: PaperBrand; standalone?: boolean }) {
  const Title = standalone ? "h1" : "h2";
  const Section = standalone ? "h2" : "h3";
  const Clause = standalone ? "h3" : "h4";
  const last = contract.sections.at(-1);
  const closing = contract.signatures && last && !last.heading ? last : null;
  const body = closing ? contract.sections.slice(0, -1) : contract.sections;
  return (
    <Paper accent={brand.accent} contract>
      <PaperHeader brand={brand} />
      <Title className={cn("doc-titular doc-contrato__titulo", !contract.signatures && "doc-contrato__titulo--filete")}>{contract.title}</Title>
      {contract.signatures ? <p className="doc-contrato__fecha">{contract.dateLine}</p> : null}

      <div className="doc-legal">
        {body.map((s, i) => {
          const clause = s.heading ? splitClause(s.heading) : null;
          return (
            <section key={i}>
              {!s.heading || !clause ? null : s.paragraphs.length === 0 || /^(Reunidos|Exponen|Cláusulas)$/.test(s.heading) ? (
                <Section className="doc-rotulo doc-seccion">{s.heading}</Section>
              ) : (
                <Clause className="doc-clausula">
                  {clause.ordinal ? (
                    <>
                      <span>{clause.ordinal}</span>
                      {" · "}
                    </>
                  ) : null}
                  {clause.title}
                </Clause>
              )}
              {s.paragraphs.map((p, j) => (
                <p key={j}>
                  {p.lead ? <b>{p.lead} </b> : null}
                  {p.text}
                </p>
              ))}
            </section>
          );
        })}
      </div>

      {contract.signatures ? (
        // El párrafo de cierre no se separa de las firmas: nunca queda una página solo con ellas.
        <div className="avoid-break">
          {closing ? (
            <div className="doc-legal doc-legal--cierre">
              {closing.paragraphs.map((p, j) => (
                <p key={j}>{p.text}</p>
              ))}
            </div>
          ) : null}
          {/* Sin nombre conocido (hueco «________»): basta el filete del hueco, con su nota. */}
          <SignatureBoxes boxes={contract.signatures.map((s) => (/^[_\s]*$/.test(s.name) ? { label: s.role, note: "Nombre y firma" } : { label: s.role, name: s.name }))} />
        </div>
      ) : (
        <p className="doc-contrato__fecha doc-contrato__fecha--final">{contract.dateLine}</p>
      )}
    </Paper>
  );
}
