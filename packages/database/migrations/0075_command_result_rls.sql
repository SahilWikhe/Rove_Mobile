ALTER TABLE "commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "command_result_read" ON "commands" AS PERMISSIVE FOR SELECT TO public USING ("commands"."actor_id"=NULLIF(current_setting('rove.command_actor',true),'')::uuid AND "commands"."key"=current_setting('rove.command_key',true) AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="commands"."actor_id" AND u.disabled=false));--> statement-breakpoint
CREATE POLICY "command_result_insert" ON "commands" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("commands"."actor_id"=NULLIF(current_setting('rove.command_actor',true),'')::uuid AND "commands"."key"=current_setting('rove.command_key',true) AND EXISTS(SELECT 1 FROM public.users u WHERE u.id="commands"."actor_id" AND u.disabled=false) AND "commands"."fingerprint"=NULLIF(current_setting('rove.command_fingerprint',true),''));
--> statement-breakpoint
ALTER TABLE "commands" FORCE ROW LEVEL SECURITY;
