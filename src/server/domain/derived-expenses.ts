/**
 * Gastos que nacen de otros registros: envíos, mantenimientos, facturas de luz
 * y compra de máquinas. Cada función deja el libro contable coherente con el
 * registro de origen (crear, actualizar o eliminar el gasto según corresponda).
 */
import "server-only";
import type { DbOrTx } from "@/server/db";
import type { EnergyBill, Machine, MaintenanceLog, Shipment } from "@/server/db/schema";
import { carrierLabel } from "@/lib/carriers";
import { formatDateShort } from "@/lib/format";
import { removeLedgerEntry, syncLedgerEntry } from "./ledger";

/** Coste de un envío → gasto «Envíos» (fecha de envío; si no hay, la indicada). */
export async function syncShipmentExpense(
  tx: DbOrTx,
  shipment: Shipment,
  opts: { fallbackDate: string; orderNumber?: string | null },
): Promise<void> {
  const target = opts.orderNumber ? `pedido ${opts.orderNumber}` : (shipment.recipientName ?? shipment.destination ?? "");
  await syncLedgerEntry(tx, {
    companyId: shipment.companyId,
    sourceType: "shipment",
    sourceId: shipment.id,
    type: "expense",
    category: "shipping",
    amountCents: shipment.costCents,
    date: shipment.shippedAt ?? opts.fallbackDate,
    description: `Envío ${carrierLabel(shipment.carrier)}${target ? ` · ${target}` : ""}`,
    counterparty: carrierLabel(shipment.carrier),
  });
}

export async function removeShipmentExpense(tx: DbOrTx, shipment: Pick<Shipment, "id" | "companyId">): Promise<void> {
  await removeLedgerEntry(tx, { companyId: shipment.companyId, sourceType: "shipment", sourceId: shipment.id });
}

/** Coste de un mantenimiento → gasto «Mantenimiento» asociado a la máquina. */
export async function syncMaintenanceExpense(tx: DbOrTx, log: MaintenanceLog, machineName: string): Promise<void> {
  await syncLedgerEntry(tx, {
    companyId: log.companyId,
    sourceType: "maintenance",
    sourceId: log.id,
    type: "expense",
    category: "maintenance",
    amountCents: log.costCents,
    date: log.date,
    description: `${machineName}: ${log.title}`,
    machineId: log.machineId,
  });
}

export async function removeMaintenanceExpense(tx: DbOrTx, log: Pick<MaintenanceLog, "id" | "companyId">): Promise<void> {
  await removeLedgerEntry(tx, { companyId: log.companyId, sourceType: "maintenance", sourceId: log.id });
}

/** Factura de luz → gasto «Electricidad» (fecha: fin del periodo facturado). */
export async function syncEnergyBillExpense(tx: DbOrTx, bill: EnergyBill): Promise<void> {
  await syncLedgerEntry(tx, {
    companyId: bill.companyId,
    sourceType: "energy",
    sourceId: bill.id,
    type: "expense",
    category: "electricity",
    amountCents: bill.amountCents,
    date: bill.periodEnd,
    description: `Factura de luz ${formatDateShort(bill.periodStart)} – ${formatDateShort(bill.periodEnd)}`,
    counterparty: bill.provider,
  });
}

export async function removeEnergyBillExpense(tx: DbOrTx, bill: Pick<EnergyBill, "id" | "companyId">): Promise<void> {
  await removeLedgerEntry(tx, { companyId: bill.companyId, sourceType: "energy", sourceId: bill.id });
}

/**
 * Compra de una máquina → gasto «Maquinaria». Solo si `register` es true y la
 * máquina tiene precio y fecha de compra; en otro caso se elimina el gasto.
 */
export async function syncMachinePurchaseExpense(tx: DbOrTx, machine: Machine, register: boolean): Promise<void> {
  const amountCents = register && machine.purchaseDate ? (machine.purchasePriceCents ?? 0) : 0;
  await syncLedgerEntry(tx, {
    companyId: machine.companyId,
    sourceType: "machine",
    sourceId: machine.id,
    type: "expense",
    category: "machinery",
    amountCents,
    date: machine.purchaseDate ?? "1970-01-01",
    description: `Compra de ${machine.name}`,
    counterparty: machine.brand,
    machineId: machine.id,
  });
}
