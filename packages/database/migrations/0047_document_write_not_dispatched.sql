ALTER TABLE "document_storage_writes" DROP CONSTRAINT "document_storage_write_result";--> statement-breakpoint
DROP INDEX "document_storage_writes_pending";--> statement-breakpoint
ALTER TABLE "document_storage_writes" ADD COLUMN "not_dispatched_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "document_storage_writes_pending" ON "document_storage_writes" USING btree ("document_id") WHERE "document_storage_writes"."settled_at" is null and "document_storage_writes"."not_dispatched_at" is null;--> statement-breakpoint
ALTER TABLE "document_storage_writes" ADD CONSTRAINT "document_storage_write_result" CHECK (("document_storage_writes"."settled_at" is null and "document_storage_writes"."object_version" is null and ("document_storage_writes"."not_dispatched_at" is null or "document_storage_writes"."not_dispatched_at">="document_storage_writes"."started_at")) or ("document_storage_writes"."not_dispatched_at" is null and "document_storage_writes"."settled_at" is not null and "document_storage_writes"."settled_at">="document_storage_writes"."started_at" and "document_storage_writes"."object_version" is not null and length("document_storage_writes"."object_version") between 1 and 1024 and "document_storage_writes"."object_version"<>'null'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_document_storage_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Document write evidence is immutable'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.object_key,NEW.document_id,NEW.started_at) IS DISTINCT FROM (OLD.object_key,OLD.document_id,OLD.started_at)
      OR (OLD.not_dispatched_at IS NOT NULL AND (NEW.not_dispatched_at,NEW.settled_at,NEW.object_version) IS DISTINCT FROM (OLD.not_dispatched_at,OLD.settled_at,OLD.object_version))
      OR (OLD.settled_at IS NOT NULL AND (NEW.settled_at,NEW.object_version) IS DISTINCT FROM (OLD.settled_at,OLD.object_version))
    THEN RAISE EXCEPTION 'Document write evidence is immutable'; END IF;
  ELSE
    IF NEW.not_dispatched_at IS NOT NULL OR NEW.settled_at IS NOT NULL OR NEW.object_version IS NOT NULL THEN RAISE EXCEPTION 'New writes must be unsettled'; END IF;
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
