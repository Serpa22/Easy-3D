/**
 * Arranque del servidor: inicia la conexión con las impresoras (modo embebido)
 * cuando la app corre como proceso de larga duración.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startEmbeddedPrinters } = await import("@/server/printers/embedded");
  startEmbeddedPrinters();
}
