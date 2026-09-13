ALTER TABLE "audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_append" ON "audit" AS PERMISSIVE FOR INSERT TO public WITH CHECK (jsonb_build_object('id',"audit"."id",'actor',"audit"."actor_id",'action',"audit"."action",'aggregate',"audit"."aggregate_id",'metadata',"audit"."metadata") = NULLIF(current_setting('rove.audit_append',true),'')::jsonb);
--> statement-breakpoint
ALTER TABLE "audit" FORCE ROW LEVEL SECURITY;
