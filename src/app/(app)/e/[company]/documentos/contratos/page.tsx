import { redirect } from "next/navigation";

/** Las plantillas se eligen desde Documentos. */
export default async function ContractsIndex({ params }: { params: Promise<{ company: string }> }) {
  redirect(`/e/${(await params).company}/documentos#plantillas`);
}
