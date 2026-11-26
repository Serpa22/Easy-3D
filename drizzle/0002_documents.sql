CREATE TABLE "document_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" double precision DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_sequences_company_id_kind_year_pk" PRIMARY KEY("company_id","kind","year")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"seq" integer NOT NULL,
	"number" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"order_id" uuid,
	"customer_id" uuid,
	"rectifies_id" uuid,
	"rectification_reason" text,
	"issuer" jsonb NOT NULL,
	"customer" jsonb NOT NULL,
	"prices_include_vat" boolean DEFAULT false NOT NULL,
	"show_prices" boolean DEFAULT true NOT NULL,
	"vat_rate_pct" double precision DEFAULT 21 NOT NULL,
	"irpf_rate_pct" double precision DEFAULT 0 NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"base_cents" integer DEFAULT 0 NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"irpf_cents" integer DEFAULT 0 NOT NULL,
	"amount_due_cents" integer DEFAULT 0 NOT NULL,
	"payment_method" text,
	"notes" text,
	"terms" text,
	"footer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fiscal_address_line" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fiscal_postal_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fiscal_city" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fiscal_province" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fiscal_country" text DEFAULT 'España';--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "irpf_rate_pct" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "invoice_prefix" text DEFAULT 'F' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "rectifying_prefix" text DEFAULT 'R' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "quote_prefix" text DEFAULT 'PRE' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "delivery_prefix" text DEFAULT 'ALB' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "quote_validity_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "payment_terms_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "quote_terms" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "document_footer" text;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_rectifies_id_documents_id_fk" FOREIGN KEY ("rectifies_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_items_document_idx" ON "document_items" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "documents_company_kind_idx" ON "documents" USING btree ("company_id","kind","issue_date");--> statement-breakpoint
CREATE INDEX "documents_order_idx" ON "documents" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number_idx" ON "documents" USING btree ("company_id","kind","year","seq");