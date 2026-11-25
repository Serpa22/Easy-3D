"use client";

import { useState, useTransition, type ReactNode } from "react";
import { CheckCircle2, Plug, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Checkbox, DateInput, Field, FormActions, Input, MoneyInput, NumberInput, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { CONNECTION_SPECS, type ConnectionConfig } from "@/lib/connections";
import { CONNECTION_TYPES, CONNECTION_TYPE_LABELS, MACHINE_STATUSES, MACHINE_STATUS_LABELS, TECHNOLOGIES, TECHNOLOGY_LABELS, type ConnectionType } from "@/lib/domain";
import { centsToInput, numberToInput } from "@/lib/format";
import { saveMachineAction, testConnectionAction } from "@/server/actions/machines";

export interface MachineFormValues {
  id?: string;
  name?: string;
  brand?: string | null;
  model?: string | null;
  technology?: string;
  serialNumber?: string | null;
  location?: string | null;
  status?: string;
  notes?: string | null;
  powerPrintW?: number;
  powerIdleW?: number;
  purchasePriceCents?: number | null;
  purchaseDate?: string | null;
  lifespanHours?: number;
  loadedMaterialId?: string | null;
  connectionType?: ConnectionType;
  bridgeId?: string | null;
  /** Configuración ya enmascarada (sin secretos). */
  connection?: ConnectionConfig;
  registerPurchase?: boolean;
}

export interface MachineFormProps {
  slug: string;
  values?: MachineFormValues;
  materials: Array<{ id: string; name: string }>;
  bridges: Array<{ id: string; name: string }>;
  onDone?: () => void;
  onCancel?: () => void;
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full text-sm font-semibold text-fg">{title}</legend>
      {description ? <p className="-mt-2 text-[0.8125rem] text-fg-3">{description}</p> : null}
      {children}
    </fieldset>
  );
}

/** Formulario de máquina: datos, consumo, amortización y conexión en directo. */
export function MachineForm({ slug, values = {}, materials, bridges, onDone, onCancel }: MachineFormProps) {
  const [type, setType] = useState<ConnectionType>(values.connectionType ?? "none");
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, startTest] = useTransition();
  const spec = CONNECTION_SPECS[type];
  const sameType = type === (values.connectionType ?? "none");

  return (
    <ActionForm action={saveMachineAction.bind(null, slug)} onSuccess={onDone} className="gap-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <Group title="Datos de la máquina">
        <Field label="Nombre" name="name" required>
          <Input defaultValue={values.name} placeholder="Bambu Lab P1S · 1" maxLength={80} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marca" name="brand">
            <Input defaultValue={values.brand ?? ""} placeholder="Bambu Lab" maxLength={60} />
          </Field>
          <Field label="Modelo" name="model">
            <Input defaultValue={values.model ?? ""} placeholder="P1S" maxLength={60} />
          </Field>
          <Field label="Tecnología" name="technology">
            <Select defaultValue={values.technology ?? "fdm"}>
              {TECHNOLOGIES.map((t) => (
                <option key={t} value={t}>
                  {TECHNOLOGY_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado" name="status">
            <Select defaultValue={values.status ?? "active"}>
              {MACHINE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {MACHINE_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Número de serie" name="serialNumber">
            <Input defaultValue={values.serialNumber ?? ""} maxLength={80} />
          </Field>
          <Field label="Ubicación" name="location">
            <Input defaultValue={values.location ?? ""} placeholder="Taller · estantería A" maxLength={80} />
          </Field>
        </div>
        <Field label="Material cargado" name="loadedMaterialId" hint="Se descuenta de tu stock cuando termina una impresión.">
          <Select defaultValue={values.loadedMaterialId ?? ""}>
            <option value="">Sin material asignado</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </Group>

      <Group title="Consumo y amortización" description="Sirven para calcular el coste de luz de cada impresión y el coste por hora de máquina.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Potencia imprimiendo" name="powerPrintW">
            <NumberInput unit="W" defaultValue={numberToInput(values.powerPrintW ?? 120)} />
          </Field>
          <Field label="Potencia en reposo" name="powerIdleW">
            <NumberInput unit="W" defaultValue={numberToInput(values.powerIdleW ?? 8)} />
          </Field>
          <Field label="Vida útil" name="lifespanHours" required>
            <NumberInput unit="h" defaultValue={String(values.lifespanHours ?? 5000)} />
          </Field>
          <Field label="Precio de compra" name="purchasePrice">
            <MoneyInput defaultValue={centsToInput(values.purchasePriceCents)} />
          </Field>
          <Field label="Fecha de compra" name="purchaseDate" className="sm:col-span-2">
            <DateInput defaultValue={values.purchaseDate ?? ""} />
          </Field>
        </div>
        <Checkbox name="registerPurchase" defaultChecked={values.registerPurchase} label="Registrar la compra como gasto en Finanzas" hint="Necesita precio y fecha de compra." />
      </Group>

      <Group title="Conexión en directo" description="Conecta la impresora para ver su estado, la pieza que imprime y sus eventos en tiempo real.">
        <Field label="Tipo de conexión" name="connectionType">
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as ConnectionType);
              setTest(null);
            }}
          >
            {CONNECTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {CONNECTION_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-[0.8125rem] text-fg-2">{spec.summary}</p>
        {spec.steps.length > 0 ? (
          <ol className="list-inside list-decimal space-y-1 rounded-md border border-line bg-bg px-4 py-3 text-[0.8125rem] text-fg-2">
            {spec.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        ) : null}
        {spec.fields.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {spec.fields.map((field) => {
              const saved = sameType && values.connection?.[`__has_${field.key}`] === true;
              const current = sameType ? values.connection?.[field.key] : undefined;
              return (
                <Field
                  key={`${type}-${field.key}`}
                  label={field.label}
                  name={`conn_${field.key}`}
                  required={field.required && !saved}
                  hint={field.secret && saved ? "Guardada. Déjalo vacío para conservarla." : field.help}
                >
                  <Input
                    type={field.type === "password" ? "password" : "text"}
                    inputMode={field.type === "number" ? "decimal" : undefined}
                    autoComplete="off"
                    placeholder={field.secret && saved ? "••••••••" : field.placeholder}
                    defaultValue={field.secret ? "" : current !== undefined ? String(current) : field.defaultValue !== undefined ? String(field.defaultValue) : ""}
                  />
                </Field>
              );
            })}
          </div>
        ) : null}
        {type !== "none" && type !== "simulator" && bridges.length > 0 ? (
          <Field label="Quién se conecta a la máquina" name="bridgeId" hint="Usa un bridge si la app está en la nube y no alcanza la red del taller.">
            <Select defaultValue={values.bridgeId ?? ""}>
              <option value="">Este servidor</option>
              {bridges.map((b) => (
                <option key={b.id} value={b.id}>
                  Bridge «{b.name}»
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {type !== "none" ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              icon={<Plug />}
              loading={testing}
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (!form) return;
                const data = new FormData(form);
                setTest(null);
                startTest(async () => {
                  const res = await testConnectionAction(slug, data);
                  if (res.ok && res.data) setTest({ ok: res.data.ok, message: res.data.message });
                  else if (!res.ok) setTest({ ok: false, message: res.error ?? "No se pudo probar la conexión." });
                });
              }}
            >
              Probar conexión
            </Button>
            {test ? (
              <p role="status" className={`flex items-start gap-2 text-sm ${test.ok ? "text-ok" : "text-danger"}`}>
                {test.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                <span className="text-fg">{test.message}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </Group>

      <Field label="Notas" name="notes">
        <Textarea defaultValue={values.notes ?? ""} rows={2} maxLength={2000} />
      </Field>

      <FormActions>
        {onCancel ? <Button onClick={onCancel}>Cancelar</Button> : null}
        <SubmitButton>{values.id ? "Guardar cambios" : "Añadir máquina"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}

/** Botón «Añadir máquina» con el formulario en un diálogo. */
export function NewMachineButton({ slug, materials, bridges, variant = "primary", label = "Añadir máquina" }: Omit<MachineFormProps, "values" | "onDone" | "onCancel"> & { variant?: "primary" | "secondary"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Añadir máquina" size="lg">
        <MachineForm slug={slug} materials={materials} bridges={bridges} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
