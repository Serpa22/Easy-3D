import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { numberToInput } from "@/lib/format";
import type { PrintJob } from "@/server/db/schema";

export interface PrintOptions {
  machines: Array<{ id: string; name: string; manual: boolean; loadedMaterialId: string | null }>;
  materials: Array<{ id: string; name: string; unit: string }>;
  products: Array<{ id: string; name: string }>;
  orders: Array<{ id: string; number: string; customerName: string }>;
}

function Links({ options, job, materialId }: { options: PrintOptions; job?: PrintJob; materialId?: string | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Material" name="materialId" hint={job ? undefined : "Vacío = el cargado en la máquina."}>
        <Select defaultValue={job?.materialId ?? materialId ?? ""}>
          <option value="">{job ? "Sin material" : "El de la máquina"}</option>
          {options.materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Producto" name="productId">
        <Select defaultValue={job?.productId ?? ""}>
          <option value="">Sin producto</option>
          {options.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Pedido" name="orderId">
        <Select defaultValue={job?.orderId ?? ""}>
          <option value="">Sin pedido</option>
          {options.orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.number} · {o.customerName}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

function MachineSelect({ options, machineId }: { options: PrintOptions; machineId?: string }) {
  // Primero las máquinas manuales: las conectadas apuntan sus impresiones solas.
  const sorted = [...options.machines].sort((a, b) => Number(b.manual) - Number(a.manual));
  return (
    <Field label="Máquina" name="machineId" required>
      <Select defaultValue={machineId ?? sorted[0]?.id ?? ""}>
        {sorted.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.manual ? "" : " (conectada)"}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function Outcome({ job, unit }: { job?: PrintJob; unit: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Resultado" name="status">
          <Select defaultValue={job?.endedAt ? job.status : "completed"}>
            <option value="completed">Completada</option>
            <option value="failed">Fallida</option>
            <option value="cancelled">Cancelada</option>
          </Select>
        </Field>
        <Field label="Material usado" name="materialUsed" hint="Se descuenta del stock del material.">
          <NumberInput unit={unit} defaultValue={job && job.materialUsed > 0 ? numberToInput(job.materialUsed) : ""} />
        </Field>
        <Field label="Piezas buenas" name="piecesProduced" hint="Se suman al stock del producto.">
          <NumberInput unit="ud" defaultValue={job && job.piecesProduced > 0 ? String(job.piecesProduced) : ""} />
        </Field>
        <Field label="Piezas fallidas" name="piecesFailed">
          <NumberInput unit="ud" defaultValue={job && job.piecesFailed > 0 ? String(job.piecesFailed) : ""} />
        </Field>
      </div>
      <Field label="Motivo del fallo" name="errorMessage" hint="Solo si falló.">
        <Input defaultValue={job?.errorMessage ?? ""} placeholder="Atasco de filamento, pieza despegada…" maxLength={300} />
      </Field>
      <Field label="Notas" name="notes">
        <Textarea defaultValue={job?.notes ?? ""} rows={2} maxLength={2000} />
      </Field>
    </>
  );
}

/** «Empieza ahora»: la máquina aparecerá imprimiendo en la sala de máquinas. */
export function StartFields({ options, machineId }: { options: PrintOptions; machineId?: string }) {
  return (
    <>
      <MachineSelect options={options} machineId={machineId} />
      <Field label="Qué se imprime" name="name" required>
        <Input placeholder="Set Cherry 61 teclas · bandeja 2" maxLength={200} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Duración prevista" name="estimatedHours" hint="Para estimar el progreso.">
          <NumberInput unit="h" />
        </Field>
        <Field label={<span className="sr-only sm:not-sr-only sm:invisible">Minutos</span>} name="estimatedMinutes">
          <NumberInput unit="min" aria-label="Minutos previstos" />
        </Field>
      </div>
      <Links options={options} />
      <Field label="Notas" name="notes">
        <Textarea rows={2} maxLength={2000} />
      </Field>
    </>
  );
}

/** «Ya terminó»: se apunta con inicio y fin. */
export function LogFields({ options, now, machineId }: { options: PrintOptions; now: string; machineId?: string }) {
  return (
    <>
      <MachineSelect options={options} machineId={machineId} />
      <Field label="Qué se imprimió" name="name" required>
        <Input maxLength={200} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Inicio" name="startedAt" required>
          <Input type="datetime-local" max={now} className="font-mono tabular" />
        </Field>
        <Field label="Fin" name="endedAt" required>
          <Input type="datetime-local" defaultValue={now} max={now} className="font-mono tabular" />
        </Field>
      </div>
      <Links options={options} />
      <Outcome unit="g / ml" />
    </>
  );
}

export function FinishFields({ job, unit, now }: { job: PrintJob; unit: string; now: string }) {
  return (
    <>
      <input type="hidden" name="jobId" value={job.id} />
      <Field label="Hora de fin" name="endedAt">
        <Input type="datetime-local" defaultValue={now} max={now} className="font-mono tabular" />
      </Field>
      <Outcome job={job} unit={unit} />
    </>
  );
}

export function EditFields({ job, unit, options }: { job: PrintJob; unit: string; options: PrintOptions }) {
  return (
    <>
      <input type="hidden" name="jobId" value={job.id} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nombre" name="name" required className="sm:col-span-2">
          <Input defaultValue={job.name} maxLength={200} />
        </Field>
        <Field label="Duración" name="durationMinutes" required>
          <NumberInput unit="min" defaultValue={String(Math.round(job.durationSec / 60))} />
        </Field>
      </div>
      <Links options={options} job={job} />
      <Outcome job={job} unit={unit} />
    </>
  );
}
