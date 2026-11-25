import { Field, Input, Textarea } from "@/components/ui/form";
import type { Customer } from "@/server/db/schema";

export function CustomerFields({ customer }: { customer?: Customer }) {
  return (
    <>
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}
      <Field label="Nombre" name="name" required>
        <Input defaultValue={customer?.name} maxLength={120} autoComplete="off" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Correo electrónico" name="email">
          <Input type="email" defaultValue={customer?.email ?? ""} maxLength={160} autoComplete="off" />
        </Field>
        <Field label="Teléfono" name="phone">
          <Input type="tel" defaultValue={customer?.phone ?? ""} maxLength={40} autoComplete="off" />
        </Field>
        <Field label="NIF / CIF" name="taxId">
          <Input defaultValue={customer?.taxId ?? ""} maxLength={30} />
        </Field>
        <Field label="País" name="country">
          <Input defaultValue={customer?.country ?? "España"} maxLength={80} />
        </Field>
      </div>
      <Field label="Dirección" name="addressLine">
        <Input defaultValue={customer?.addressLine ?? ""} maxLength={200} />
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="C. postal" name="postalCode">
          <Input defaultValue={customer?.postalCode ?? ""} maxLength={20} />
        </Field>
        <Field label="Ciudad" name="city">
          <Input defaultValue={customer?.city ?? ""} maxLength={80} />
        </Field>
        <Field label="Provincia" name="province">
          <Input defaultValue={customer?.province ?? ""} maxLength={80} />
        </Field>
      </div>
      <Field label="Notas" name="notes">
        <Textarea defaultValue={customer?.notes ?? ""} rows={2} maxLength={2000} />
      </Field>
    </>
  );
}
