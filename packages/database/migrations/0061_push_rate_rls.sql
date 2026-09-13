ALTER TABLE "push_rate_windows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "push_rate_read" ON "push_rate_windows" AS PERMISSIVE FOR SELECT TO public USING ("push_rate_windows"."project_id"=NULLIF(current_setting('rove.push_rate_project',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "push_rate_insert" ON "push_rate_windows" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("push_rate_windows"."project_id"=NULLIF(current_setting('rove.push_rate_project',true),'')::uuid);--> statement-breakpoint
CREATE POLICY "push_rate_update" ON "push_rate_windows" AS PERMISSIVE FOR UPDATE TO public USING ("push_rate_windows"."project_id"=NULLIF(current_setting('rove.push_rate_project',true),'')::uuid) WITH CHECK ("push_rate_windows"."project_id"=NULLIF(current_setting('rove.push_rate_project',true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "push_rate_windows" FORCE ROW LEVEL SECURITY;
