-- Payloads contain recipient IDs only. Postgres delivers NOTIFY only after commit.
CREATE FUNCTION rove_notify_messages() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE targets uuid[]; ride uuid; recipient uuid;
BEGIN
  IF TG_TABLE_NAME = 'rides' THEN
    targets := ARRAY[NEW.rider_id, NEW.driver_id];
    IF TG_OP = 'UPDATE' THEN targets := targets || ARRAY[OLD.rider_id, OLD.driver_id]; END IF;
  ELSIF TG_TABLE_NAME = 'users' THEN
    SELECT array_agg(id) INTO targets FROM (
      SELECT NEW.id AS id UNION
      SELECT r.rider_id FROM rides r WHERE r.driver_id=NEW.id UNION
      SELECT r.driver_id FROM rides r WHERE r.rider_id=NEW.id
    ) recipients;
  ELSE
    IF TG_TABLE_NAME = 'offers' THEN ride := NEW.ride_id;
    ELSE SELECT o.ride_id INTO ride FROM offers o WHERE o.id=NEW.offer_id; END IF;
    SELECT ARRAY[r.rider_id,r.driver_id] INTO targets FROM rides r WHERE r.id=ride;
  END IF;
  IF targets IS NOT NULL THEN
    FOR recipient IN SELECT DISTINCT id FROM unnest(targets) id WHERE id IS NOT NULL LOOP
      PERFORM pg_notify('rove_messages_changed', json_build_object('users', ARRAY[recipient])::text);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER message_insert_notify AFTER INSERT ON trip_messages
FOR EACH ROW EXECUTE FUNCTION rove_notify_messages();
--> statement-breakpoint
CREATE TRIGGER message_read_notify AFTER INSERT OR UPDATE ON trip_message_reads
FOR EACH ROW EXECUTE FUNCTION rove_notify_messages();
--> statement-breakpoint
CREATE TRIGGER message_report_notify AFTER INSERT ON trip_message_reports
FOR EACH ROW EXECUTE FUNCTION rove_notify_messages();
--> statement-breakpoint
CREATE TRIGGER message_ride_notify AFTER INSERT OR UPDATE OF state,driver_id ON rides
FOR EACH ROW EXECUTE FUNCTION rove_notify_messages();
--> statement-breakpoint
CREATE TRIGGER message_offer_notify AFTER INSERT OR UPDATE OF status ON offers
FOR EACH ROW EXECUTE FUNCTION rove_notify_messages();
--> statement-breakpoint
CREATE TRIGGER message_owner_notify AFTER UPDATE OF disabled,name ON users
FOR EACH ROW EXECUTE FUNCTION rove_notify_messages();
