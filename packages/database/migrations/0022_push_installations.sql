CREATE TABLE "push_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mutation_id" uuid,
	"mutation_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_installation_platform" CHECK ("push_installations"."platform" in ('ios','android')),
	CONSTRAINT "push_installation_revision" CHECK ("push_installations"."revision">0)
);
--> statement-breakpoint
ALTER TABLE "push_installations" ADD CONSTRAINT "push_installations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_installation_identity" ON "push_installations" USING btree ("project_id","installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_installation_active_token" ON "push_installations" USING btree ("project_id","token") WHERE "push_installations"."enabled"=true;