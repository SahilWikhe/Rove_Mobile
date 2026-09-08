CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_positive_count" CHECK ("rate_limit_buckets"."count" > 0),
	CONSTRAINT "rate_limit_digest_key" CHECK ("rate_limit_buckets"."key" ~ '^[a-f0-9]{64}$')
);
