# Driver document upload and review

Reviewed September 12, 2026 against source `31f7e42`. The native Documents screen and backend intake, storage, scanning and staff review boundaries are implemented. This guide does not assert a newly run AWS integration test or production activation.

## Implemented flow

The driver reserves an owned document, obtains its scoped upload operation, uploads the selected file and completes verification. Supported kinds are driver's license, vehicle registration and vehicle insurance. JPEG, PNG and PDF are limited to 10 MiB; checks include declared type, file signature and SHA-256. File checks are not malware scanning or proof that the document is valid.

Objects remain private and quarantined. Server modules implement S3 upload/inbox/quarantine/download and GuardDuty scan-result handling. Storage paths do not use user filenames. Scanning and authorized human review are separate stages; an uploaded file does not automatically approve a driver. The UI distinguishes verification pending, awaiting review, replacement required, delayed, approved and expired/rejected evidence.

Staff document download/review and eligibility endpoints enforce their server authorization/MFA boundary. Vehicle approval, current document approval and payout readiness are independent eligibility requirements. The staff dashboard is maintained outside this repository.

## Sources and configuration

- Driver screen: `apps/driver/src/app/documents.tsx`; picker under `apps/driver/src/documents`.
- API routes: `apps/api/src/app.ts`; shared schemas: `packages/contracts`.
- Services: `packages/server/src/driver-documents.ts`, `document-intake.ts`, `document-scanning.ts`, `document-review.ts` and `driver-eligibility.ts`.
- Storage/scanner adapters: `packages/server/src/s3-document-*.ts` and `guardduty-document-scanner.ts`.
- Infrastructure template: `infra/aws/driver-documents.template.json`; environment names and validators: `apps/api/.env.example` and runtime composition.

Keep migration-owner and AWS secrets off mobile clients. A template or successful lint does not establish a deployed bucket, correct IAM, active scanner or complete event delivery. Use the explicit `pnpm documents:staging:smoke` entrypoint only with the intended staging configuration and its documented arguments; do not run against production or real documents as a documentation check.

The storage smoke accepts explicit arguments:

```sh
pnpm documents:staging:smoke --bucket <staging-bucket> --region <region> --owner <account-id> --confirm-synthetic-write --verify-uploader-permissions
```

This is a write-capable staging check using the selected AWS identity. It retains synthetic inbox/quarantine objects for inspection and does not prove malware scanning or human approval. Verify the target and permissions first; do not execute it as part of a docs-only validation.

## Evidence and remaining work

Source tests cover ownership, intake, storage, scanning, review and eligibility. CI lints the infrastructure without cloud credentials. Full native upload/retry, real scan-event completion, staff review/download, expiry and operational recovery must be demonstrated for the configured environment before launch. Define retention/deletion, access monitoring and support handling separately. Do not infer those outcomes from a successful upload alone.
