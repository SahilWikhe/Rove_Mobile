-- Invalidate only the assigned rider's location view after the GPS transaction commits.
-- Coordinates and ride IDs never enter notification payloads.
CREATE FUNCTION rove_notify_driver_location() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient uuid;
BEGIN
  IF NEW.location IS NOT DISTINCT FROM OLD.location AND
     NEW.location_sampled_at IS NOT DISTINCT FROM OLD.location_sampled_at AND
     NEW.online IS NOT DISTINCT FROM OLD.online THEN RETURN NULL; END IF;
  FOR recipient IN SELECT DISTINCT r.rider_id FROM rides r
    JOIN users u ON u.id=r.rider_id AND NOT u.disabled
    WHERE r.driver_id=NEW.id AND r.state IN ('matched','en_route','arrived','in_progress','interrupted')
  LOOP
    PERFORM pg_notify('rove_driver_location_changed', json_build_object('users', ARRAY[recipient])::text);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER driver_location_notify AFTER UPDATE OF location,location_sampled_at,online ON drivers
FOR EACH ROW EXECUTE FUNCTION rove_notify_driver_location();
