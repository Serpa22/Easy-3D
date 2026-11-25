import { DateInput, Field, Input, MoneyInput, NumberInput, Select, Textarea } from "@/components/ui/form";
import { CATEGORY_LABELS, categoriesFor, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type TransactionType } from "@/lib/domain";
import { centsToInput, numberToInput } from "@/lib/format";
import type { Transaction } from "@/server/db/schema";

/** Campos del formulario de un ingreso o gasto (alta y edición). */
export function TransactionFields({
  type,
  transaction,
  today,
  defaultVat,
}: {
  type: TransactionType;
  transaction?: Transaction;
  today: string;
  defaultVat: number;
}) {
  return (
    <>
      {transaction ? <input type="hidden" name="id" value={transaction.id} /> : null}
      <input type="hidden" name="type" value={type} />
      <Field label="Concepto" name="description" required>
        <Input defaultValue={transaction?.description} maxLength={200} placeholder={type === "income" ? "Venta en feria" : "Boquillas de recambio"} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Importe (IVA incluido)" name="amount" required>
          <MoneyInput defaultValue={centsToInput(transaction?.amountCents)} />
        </Field>
        <Field label="Fecha" name="date" required>
          <DateInput defaultValue={transaction?.date ?? today} max="2100-12-31" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Categoría" name="category" required>
          <Select defaultValue={transaction?.category ?? categoriesFor(type)[0]}>
            {categoriesFor(type).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="IVA" name="vatRatePct">
          <NumberInput unit="%" defaultValue={numberToInput(transaction?.vatRatePct ?? defaultVat)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label={type === "income" ? "Cliente" : "Proveedor"} name="counterparty">
          <Input defaultValue={transaction?.counterparty ?? ""} maxLength={120} />
        </Field>
        <Field label="Método de pago" name="paymentMethod">
          <Select defaultValue={transaction?.paymentMethod ?? ""}>
            <option value="">Sin indicar</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notas" name="notes">
        <Textarea defaultValue={transaction?.notes ?? ""} rows={2} maxLength={2000} />
      </Field>
    </>
  );
}
