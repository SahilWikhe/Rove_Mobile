CREATE TABLE "driver_transfer_movements" (
	"source" text NOT NULL,
	"balance_id" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	CONSTRAINT "driver_transfer_movements_journalId_unique" UNIQUE("journal_id")
);
--> statement-breakpoint
ALTER TABLE "driver_transfer_movements" ADD CONSTRAINT "driver_transfer_movements_operation_id_driver_transfer_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."driver_transfer_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_transfer_movements" ADD CONSTRAINT "driver_transfer_movements_journal_id_ledger_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_transfer_movement_source" ON "driver_transfer_movements" USING btree ("source","balance_id");--> statement-breakpoint
CREATE INDEX "driver_transfer_movement_operation" ON "driver_transfer_movements" USING btree ("operation_id");--> statement-breakpoint
CREATE FUNCTION rove_preserve_transfer_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Transfer movement bindings are immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transfer_movement_immutable BEFORE UPDATE OR DELETE ON driver_transfer_movements
FOR EACH ROW EXECUTE FUNCTION rove_preserve_transfer_movement();
