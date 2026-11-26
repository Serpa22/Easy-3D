import { requireUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Páginas para imprimir: sin barra lateral, solo la hoja y una barra que no se imprime. */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <main className="min-h-dvh px-3 py-4 sm:px-6 sm:py-8 print:p-0">{children}</main>;
}
