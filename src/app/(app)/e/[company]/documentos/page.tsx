import type { Metadata } from "next";
import Link from "next/link";
import { Eye, FileSignature, FileText, Printer, Receipt } from "lucide-react";
import { DocumentKindBadge, DocumentStatusBadge, NewDocumentMenu } from "@/components/documents/shared";
import { ActionsMenu, type ActionsMenuItem } from "@/components/ui/actions";
import { Alert, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, StatGrid } from "@/components/ui/display";
import { SearchInput } from "@/components/ui/form";
import { FilterBar, Pagination, TabsNav, hrefWith, param, type SearchParams } from "@/components/ui/nav";
import { DataTable } from "@/components/ui/table";
import { todayISO } from "@/lib/dates";
import { DOCUMENT_KIND_SLUGS, kindFromSlug, missingIssuerFields } from "@/lib/documents";
import { DOCUMENT_KINDS, DOCUMENT_KIND_PLURAL } from "@/lib/domain";
import { formatDateShort, formatMoney } from "@/lib/format";
import { CONTRACT_TEMPLATES } from "@/lib/contract-templates";
import { requireCompany } from "@/server/context";
import { issuerFromCompany } from "@/server/domain/documents-service";
import { getDocumentKpis, listDocuments } from "@/server/queries/documents";

export const metadata: Metadata = { title: "Documentos" };

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ company: string }>; searchParams: Promise<SearchParams> }) {
  const { company, db, org } = await requireCompany((await params).company);
  const sp = await searchParams;
  const slug = company.slug;
  const basePath = `/e/${slug}/documentos`;
  const kind = kindFromSlug(param(sp, "tipo")) ?? undefined;
  const q = param(sp, "q");
  const year = todayISO(org.timeZone).slice(0, 4);

  const [list, kpis] = await Promise.all([
    listDocuments(db, company.id, { kind, q, page: Number(param(sp, "pag")) || 1 }),
    getDocumentKpis(db, company.id, { from: `${year}-01-01`, to: `${year}-12-31` }),
  ]);
  const missing = missingIssuerFields(issuerFromCompany(company));
  const newMenu = <NewDocumentMenu basePath={basePath} />;

  return (
    <>
      <PageHeader
        title="Documentos"
        description="Facturas, rectificativas, presupuestos y albaranes con numeración correlativa, listos para imprimir o guardar en PDF. No generan movimientos: el ingreso se apunta al cobrar el pedido."
        actions={newMenu}
      />

      {missing.length > 0 ? (
        <Alert
          tone="warn"
          title={`Faltan datos fiscales de ${company.name}`}
          action={
            <Link href={`/e/${slug}/ajustes#datos-fiscales`} className="font-medium text-fg underline underline-offset-4 hover:text-fg-2">
              Completar
            </Link>
          }
        >
          Una factura completa debe llevar tu {missing.join(" y ")}. Rellénalos en Ajustes y saldrán en los documentos nuevos.
        </Alert>
      ) : null}

      <StatGrid cols={4}>
        <Stat label={`Facturado en ${year}`} value={formatMoney(kpis.invoicedCents)} icon={<Receipt />} hint={`${kpis.invoices} ${kpis.invoices === 1 ? "factura" : "facturas"}, rectificativas incluidas`} />
        <Stat label="Base imponible" value={formatMoney(kpis.baseCents)} hint={`Año ${year}`} />
        <Stat label="IVA repercutido" value={formatMoney(kpis.vatCents)} hint={`Año ${year}`} />
        <Stat label="Presupuestos pendientes" value={kpis.pendingQuotes} icon={<FileText />} hint={kpis.pendingQuotes > 0 ? formatMoney(kpis.pendingQuotesCents) : "Sin respuesta pendiente"} />
      </StatGrid>

      <TabsNav
        label="Tipo de documento"
        items={[
          { href: hrefWith(basePath, sp, { tipo: null, pag: null }), label: "Todos", count: list.counts.all, current: !kind },
          ...DOCUMENT_KINDS.map((k) => ({ href: hrefWith(basePath, sp, { tipo: DOCUMENT_KIND_SLUGS[k], pag: null }), label: DOCUMENT_KIND_PLURAL[k], count: list.counts[k], current: k === kind })),
        ]}
      />
      <FilterBar>
        <SearchInput placeholder="Buscar número o cliente…" />
      </FilterBar>

      <DataTable
        caption="Documentos"
        columns={[
          { key: "number", header: "Número" },
          { key: "kind", header: "Tipo", hideBelow: "md" },
          { key: "date", header: "Fecha", hideBelow: "sm" },
          { key: "customer", header: "Cliente" },
          { key: "status", header: "Estado", hideBelow: "lg" },
          { key: "total", header: "Total", numeric: true },
          { key: "actions", header: <span className="sr-only">Acciones</span>, align: "right", className: "w-12 px-1" },
        ]}
        rows={list.rows.map((d) => {
          const items: ActionsMenuItem[] = [
            { type: "link", label: "Ver documento", icon: <Eye />, href: `${basePath}/${d.id}` },
            { type: "link", label: "Imprimir o PDF", icon: <Printer />, href: `${basePath}/${d.id}/imprimir` },
          ];
          return {
            key: d.id,
            href: `${basePath}/${d.id}`,
            cells: [
              <span key="n" className="whitespace-nowrap font-mono tabular">{d.number}</span>,
              <DocumentKindBadge key="k" kind={d.kind} />,
              <span key="d" className="whitespace-nowrap text-fg-2">{formatDateShort(d.issueDate)}</span>,
              <span key="c" className="block max-w-48 truncate">{d.customer.name}</span>,
              <DocumentStatusBadge key="s" kind={d.kind} status={d.status} dueDate={d.dueDate} today={todayISO(org.timeZone)} />,
              d.kind === "delivery_note" && !d.showPrices ? <span key="t" className="text-fg-3">—</span> : formatMoney(d.amountDueCents),
              <ActionsMenu key="m" size="sm" label={`Acciones de ${d.number}`} items={items} />,
            ],
          };
        })}
        empty={
          q || list.counts.all > 0 ? (
            <EmptyState title="Sin resultados" description="Prueba con otra pestaña u otro texto de búsqueda." />
          ) : (
            <EmptyState
              icon={<Receipt />}
              title="Aún no has emitido documentos"
              description="Crea una factura, un presupuesto o un albarán desde aquí o desde la ficha de un pedido: los datos del cliente y las líneas se rellenan solos."
              action={newMenu}
            />
          )
        }
      />
      <Pagination page={list.page} pageCount={list.pageCount} total={list.total} basePath={basePath} searchParams={sp} />

      <Card id="plantillas" className="scroll-mt-20">
        <CardHeader title="Plantillas de contrato" description="Se rellenan con los datos fiscales de la sub-empresa y del cliente que elijas. También puedes descargarlas en Word para editarlas a mano." />
        <CardBody>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CONTRACT_TEMPLATES.map((t) => (
              <li key={t.slug}>
                <Link href={`${basePath}/contratos/${t.slug}`} className="flex h-full items-start gap-3 rounded-md border border-line p-4 transition-colors hover:bg-hover active:bg-active">
                  <FileSignature className="mt-0.5 size-4 shrink-0 text-fg-2" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">{t.title}</span>
                    <span className="mt-0.5 block text-[0.8125rem] text-fg-2">{t.summary}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}

