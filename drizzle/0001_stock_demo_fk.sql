ALTER TABLE "companies" ADD COLUMN "demo_key" text;--> statement-breakpoint
ALTER TABLE "machine_live" ADD COLUMN "last_job" jsonb;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "stock_deducted_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "charge_from" date;--> statement-breakpoint
-- Las empresas de ejemplo ya creadas se reconocían por su descripción: se marcan una sola vez.
UPDATE "companies" SET "demo_key" = "slug" WHERE "description" = 'Empresa de demostración.' AND "slug" IN ('teclas', 'figuras');--> statement-breakpoint
-- Pedidos ya enviados: se asume que descontaron del stock todas sus unidades.
UPDATE "order_items" SET "stock_deducted_qty" = "quantity" WHERE "product_id" IS NOT NULL AND "quantity" > 0 AND "order_id" IN (SELECT "id" FROM "orders" WHERE "stock_deducted" = true);--> statement-breakpoint
-- Máquinas que apuntaban a un material ya borrado (antes no había clave foránea).
UPDATE "machines" SET "loaded_material_id" = NULL WHERE "loaded_material_id" IS NOT NULL AND "loaded_material_id" NOT IN (SELECT "id" FROM "materials");--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_loaded_material_id_materials_id_fk" FOREIGN KEY ("loaded_material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;
