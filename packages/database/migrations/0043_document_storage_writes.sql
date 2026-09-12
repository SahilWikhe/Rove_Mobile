CREATE TABLE "document_storage_writes" (
	"object_key" text PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"object_version" text,
	CONSTRAINT "document_storage_write_result" CHECK (("document_storage_writes"."settled_at" is null and "document_storage_writes"."object_version" is null) or ("document_storage_writes"."settled_at" is not null and "document_storage_writes"."settled_at">="document_storage_writes"."started_at" and "document_storage_writes"."object_version" is not null and length("document_storage_writes"."object_version") between 1 and 1024 and "document_storage_writes"."object_version"<>'null'))
);
--> statement-breakpoint
ALTER TABLE "document_storage_writes" ADD CONSTRAINT "document_storage_writes_document_id_driver_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."driver_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_storage_writes_pending" ON "document_storage_writes" USING btree ("document_id") WHERE "document_storage_writes"."settled_at" is null;--> statement-breakpoint
CREATE FUNCTION protect_document_storage_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Document write evidence is immutable'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.object_key,NEW.document_id,NEW.started_at) IS DISTINCT FROM (OLD.object_key,OLD.document_id,OLD.started_at)
      OR (OLD.settled_at IS NOT NULL AND (NEW.settled_at,NEW.object_version) IS DISTINCT FROM (OLD.settled_at,OLD.object_version))
    THEN RAISE EXCEPTION 'Document write evidence is immutable'; END IF;
  ELSE
    IF NEW.settled_at IS NOT NULL OR NEW.object_version IS NOT NULL THEN RAISE EXCEPTION 'New writes must be unsettled'; END IF;
    SELECT driver_id INTO owner_id FROM driver_documents WHERE id=NEW.document_id;
    PERFORM id FROM drivers WHERE id=owner_id FOR UPDATE;
    PERFORM id FROM users WHERE id=owner_id AND role='driver' AND NOT disabled FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Document writes require active driver'; END IF;
    PERFORM id FROM driver_documents WHERE id=NEW.document_id AND state='reserved' AND expires_at>clock_timestamp();
    IF NOT FOUND THEN RAISE EXCEPTION 'Document write reservation unavailable'; END IF;
    IF NEW.object_key !~ ('^driver-documents/quarantine/' || NEW.document_id::text || '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    THEN RAISE EXCEPTION 'Document write scope mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_storage_write_evidence BEFORE INSERT OR UPDATE OR DELETE ON document_storage_writes
FOR EACH ROW EXECUTE FUNCTION protect_document_storage_write();
