CREATE TABLE "saved_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rider_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"place_id" text NOT NULL,
	CONSTRAINT "saved_places_kind" CHECK ("saved_places"."kind" IN ('home', 'work')),
	CONSTRAINT "saved_places_id_length" CHECK (length("saved_places"."place_id") BETWEEN 1 AND 512)
);
--> statement-breakpoint
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_places_rider_kind" ON "saved_places" USING btree ("rider_id","kind");