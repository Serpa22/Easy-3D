import { Paper } from "@/components/documents/document-paper";
import type { BuiltContract } from "@/lib/contract-templates";

/** Contrato montado (`buildContract`) en una hoja A4 imprimible. */
export function ContractPaper({ contract }: { contract: BuiltContract }) {
  return (
    <Paper className="text-[0.875rem] leading-relaxed">
      <h2 className="text-center text-lg font-semibold uppercase tracking-wide text-fg">{contract.title}</h2>
      {contract.signatures ? <p className="mt-2 text-center text-fg-2">{contract.dateLine}</p> : null}
      <div className="mt-6 flex flex-col gap-5">
        {contract.sections.map((s, i) => (
          <section key={i} className="flex flex-col gap-2">
            {s.heading ? <h3 className={s.paragraphs.length === 0 || /^(Reunidos|Exponen|Cláusulas)$/.test(s.heading) ? "mt-2 text-center text-[0.8125rem] font-semibold uppercase tracking-wider text-fg" : "font-semibold text-fg"}>{s.heading}</h3> : null}
            {s.paragraphs.map((p, j) => (
              <p key={j} className="text-justify text-fg">
                {p.lead ? <span className="mr-1.5 font-medium">{p.lead}</span> : null}
                {p.text}
              </p>
            ))}
          </section>
        ))}
      </div>
      {contract.signatures ? (
        <div className="avoid-break mt-12 grid gap-8 sm:grid-cols-2">
          {contract.signatures.map((s) => (
            <div key={s.role} className="flex flex-col">
              <div className="h-24" />
              <p className="border-t border-line-strong pt-2 font-medium">{s.role}</p>
              <p className="text-fg-2">{s.name}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-8 text-fg-2">{contract.dateLine}</p>
      )}
    </Paper>
  );
}
