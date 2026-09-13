ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "request_limit_read" ON "rate_limit_buckets" AS PERMISSIVE FOR SELECT TO public USING ("rate_limit_buckets"."key"=current_setting('rove.rate_key',true));--> statement-breakpoint
CREATE POLICY "request_limit_insert" ON "rate_limit_buckets" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("rate_limit_buckets"."key"=current_setting('rove.rate_key',true));--> statement-breakpoint
CREATE POLICY "request_limit_update" ON "rate_limit_buckets" AS PERMISSIVE FOR UPDATE TO public USING ("rate_limit_buckets"."key"=current_setting('rove.rate_key',true)) WITH CHECK ("rate_limit_buckets"."key"=current_setting('rove.rate_key',true));--> statement-breakpoint
CREATE POLICY "request_limit_prune_read" ON "rate_limit_buckets" AS PERMISSIVE FOR SELECT TO public USING (current_setting('rove.rate_prune',true)='true' AND "rate_limit_buckets"."expires_at"<statement_timestamp()-interval '1 day');--> statement-breakpoint
CREATE POLICY "request_limit_prune_lock" ON "rate_limit_buckets" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('rove.rate_prune',true)='true' AND "rate_limit_buckets"."expires_at"<statement_timestamp()-interval '1 day') WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "request_limit_prune_delete" ON "rate_limit_buckets" AS PERMISSIVE FOR DELETE TO public USING (current_setting('rove.rate_prune',true)='true' AND "rate_limit_buckets"."expires_at"<statement_timestamp()-interval '1 day');
--> statement-breakpoint
ALTER TABLE "rate_limit_buckets" FORCE ROW LEVEL SECURITY;
