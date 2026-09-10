CREATE TABLE driver_document_scans (
  document_id uuid PRIMARY KEY REFERENCES driver_documents(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','clean','infected','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  locked_until timestamptz,
  scanned_key text,
  scanned_version text,
  scanned_sha256 text,
  completed_at timestamptz,
  CHECK ((lease_token IS NULL) = (locked_until IS NULL)),
  CHECK (
    (state IN ('pending','failed') AND scanned_key IS NULL AND scanned_version IS NULL AND scanned_sha256 IS NULL AND completed_at IS NULL)
    OR (state IN ('clean','infected') AND scanned_key IS NOT NULL AND scanned_version IS NOT NULL AND scanned_sha256 IS NOT NULL AND scanned_sha256 ~ '^[a-f0-9]{64}$' AND completed_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX driver_document_scans_due ON driver_document_scans(available_at) WHERE state='pending';
--> statement-breakpoint
INSERT INTO driver_document_scans(document_id) SELECT id FROM driver_documents WHERE state='quarantined';
