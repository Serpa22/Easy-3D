CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"activity" text,
	"description" text,
	"monogram" text,
	"vat_rate_pct" double precision DEFAULT 21 NOT NULL,
	"order_prefix" text DEFAULT 'P' NOT NULL,
	"order_seq" integer DEFAULT 0 NOT NULL,
	"electricity_mode" text DEFAULT 'fixed' NOT NULL,
	"kwh_price" double precision DEFAULT 0.16 NOT NULL,
	"kwh_price_peak" double precision DEFAULT 0.22 NOT NULL,
	"kwh_price_flat" double precision DEFAULT 0.15 NOT NULL,
	"kwh_price_valley" double precision DEFAULT 0.1 NOT NULL,
	"labor_rate_cents" integer DEFAULT 1500 NOT NULL,
	"target_margin_pct" double precision DEFAULT 60 NOT NULL,
	"failure_rate_pct" double precision DEFAULT 5 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"tax_id" text,
	"address_line" text,
	"postal_code" text,
	"city" text,
	"province" text,
	"country" text DEFAULT 'España',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "energy_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"kwh" double precision DEFAULT 0 NOT NULL,
	"amount_cents" integer NOT NULL,
	"provider" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"print_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_live" (
	"machine_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"state" text DEFAULT 'offline' NOT NULL,
	"telemetry" jsonb,
	"current_job_id" uuid,
	"updated_at" timestamp with time zone,
	"state_since" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"model" text,
	"technology" text DEFAULT 'fdm' NOT NULL,
	"serial_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"location" text,
	"notes" text,
	"power_print_w" double precision DEFAULT 120 NOT NULL,
	"power_idle_w" double precision DEFAULT 8 NOT NULL,
	"purchase_price_cents" integer,
	"purchase_date" date,
	"lifespan_hours" integer DEFAULT 5000 NOT NULL,
	"total_print_seconds" integer DEFAULT 0 NOT NULL,
	"connection_type" text DEFAULT 'none' NOT NULL,
	"connection_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bridge_id" uuid,
	"loaded_material_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" text DEFAULT 'preventive' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"next_due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"type" text NOT NULL,
	"qty" double precision NOT NULL,
	"total_cost_cents" integer,
	"print_job_id" uuid,
	"date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'filament' NOT NULL,
	"material_type" text,
	"brand" text,
	"color_name" text,
	"color_hex" text,
	"unit" text DEFAULT 'g' NOT NULL,
	"stock_qty" double precision DEFAULT 0 NOT NULL,
	"pack_size" double precision DEFAULT 1000 NOT NULL,
	"pack_cost_cents" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" double precision DEFAULT 0 NOT NULL,
	"supplier" text,
	"location" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid,
	"customer_name" text NOT NULL,
	"channel" text DEFAULT 'direct' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"payment_method" text,
	"order_date" date NOT NULL,
	"due_date" date,
	"paid_at" date,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"shipping_charged_cents" integer DEFAULT 0 NOT NULL,
	"fees_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"vat_rate_pct" double precision DEFAULT 21 NOT NULL,
	"ship_name" text,
	"ship_address_line" text,
	"ship_postal_code" text,
	"ship_city" text,
	"ship_province" text,
	"ship_country" text,
	"stock_deducted" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"machine_id" uuid,
	"product_id" uuid,
	"order_id" uuid,
	"material_id" uuid,
	"name" text NOT NULL,
	"file_name" text,
	"status" text DEFAULT 'printing' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"estimated_sec" integer,
	"progress" double precision DEFAULT 0 NOT NULL,
	"material_used" double precision DEFAULT 0 NOT NULL,
	"pieces_produced" integer DEFAULT 0 NOT NULL,
	"pieces_failed" integer DEFAULT 0 NOT NULL,
	"energy_kwh" double precision DEFAULT 0 NOT NULL,
	"energy_cost_cents" integer DEFAULT 0 NOT NULL,
	"material_cost_cents" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"thumbnail_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"category" text,
	"description" text,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"material_id" uuid,
	"material_qty" double precision DEFAULT 0 NOT NULL,
	"print_minutes" double precision DEFAULT 0 NOT NULL,
	"labor_minutes" double precision DEFAULT 0 NOT NULL,
	"packaging_cost_cents" integer DEFAULT 0 NOT NULL,
	"other_cost_cents" integer DEFAULT 0 NOT NULL,
	"machine_id" uuid,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"vat_rate_pct" double precision DEFAULT 21 NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"last_generated_date" date,
	"counterparty" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid,
	"carrier" text NOT NULL,
	"service" text,
	"tracking_number" text,
	"tracking_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"weight_g" integer,
	"recipient_name" text,
	"destination" text,
	"shipped_at" date,
	"estimated_delivery" date,
	"delivered_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"vat_rate_pct" double precision DEFAULT 21 NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"counterparty" text,
	"payment_method" text,
	"notes" text,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"source_key" text DEFAULT '' NOT NULL,
	"machine_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_bills" ADD CONSTRAINT "energy_bills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_events" ADD CONSTRAINT "machine_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_events" ADD CONSTRAINT "machine_events_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_live" ADD CONSTRAINT "machine_live_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_live" ADD CONSTRAINT "machine_live_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_bridge_id_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."bridges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_company_idx" ON "customers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "energy_bills_company_idx" ON "energy_bills" USING btree ("company_id","period_end");--> statement-breakpoint
CREATE INDEX "machine_events_machine_idx" ON "machine_events" USING btree ("machine_id","created_at");--> statement-breakpoint
CREATE INDEX "machine_events_company_idx" ON "machine_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "machines_company_idx" ON "machines" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "maintenance_machine_idx" ON "maintenance_logs" USING btree ("machine_id","date");--> statement-breakpoint
CREATE INDEX "material_movements_material_idx" ON "material_movements" USING btree ("material_id","date");--> statement-breakpoint
CREATE INDEX "material_movements_company_idx" ON "material_movements" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "materials_company_idx" ON "materials" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_company_date_idx" ON "orders" USING btree ("company_id","order_date");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_company_number_idx" ON "orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "print_jobs_company_idx" ON "print_jobs" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE INDEX "print_jobs_machine_idx" ON "print_jobs" USING btree ("machine_id","started_at");--> statement-breakpoint
CREATE INDEX "products_company_idx" ON "products" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "recurring_company_idx" ON "recurring_expenses" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shipments_company_idx" ON "shipments" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "transactions_company_date_idx" ON "transactions" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "transactions_company_type_idx" ON "transactions" USING btree ("company_id","type","date");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_source_idx" ON "transactions" USING btree ("source_type","source_id","source_key") WHERE "transactions"."source_type" <> 'manual';