-- Permit retrying the same expired delivery without bypassing the cooldown on new deliveries.
CREATE OR REPLACE FUNCTION route_cooldown_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deadline timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status IN ('CREATED','NO_RIDER_FOUND') AND OLD.offer_response_expires_at <= clock_timestamp() AND OLD.offer_response_expires_at + interval '5 minutes' > clock_timestamp() AND OLD.pickup_latitude IS NOT NULL AND OLD.pickup_longitude IS NOT NULL AND OLD.dropoff_latitude IS NOT NULL AND OLD.dropoff_longitude IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(OLD.customer_id::text,81271));
   INSERT INTO route_offer_cooldowns VALUES (OLD.id,OLD.customer_id,OLD.pickup_latitude,OLD.pickup_longitude,OLD.dropoff_latitude,OLD.dropoff_longitude,OLD.offer_response_expires_at + interval '5 minutes') ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='CREATED' AND NEW.status IN ('NO_RIDER_FOUND','CANCELLED') AND NEW.offer_response_expires_at <= clock_timestamp()
  AND NEW.pickup_latitude IS NOT NULL AND NEW.pickup_longitude IS NOT NULL AND NEW.dropoff_latitude IS NOT NULL AND NEW.dropoff_longitude IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.customer_id::text,81271));
   INSERT INTO route_offer_cooldowns VALUES (NEW.id,NEW.customer_id,NEW.pickup_latitude,NEW.pickup_longitude,NEW.dropoff_latitude,NEW.dropoff_longitude,NEW.offer_response_expires_at + interval '5 minutes') ON CONFLICT DO NOTHING;
  END IF;
  IF OLD.status='CREATED' OR NEW.status<>'CREATED' OR OLD.status='NO_RIDER_FOUND' THEN RETURN NEW; END IF;
 END IF;
 IF NEW.status='CREATED' AND NEW.service_class IS NOT NULL THEN
  deadline := route_cooldown_until(NEW.customer_id,NEW.pickup_latitude::double precision,NEW.pickup_longitude::double precision,NEW.dropoff_latitude::double precision,NEW.dropoff_longitude::double precision);
  IF deadline IS NOT NULL THEN RAISE EXCEPTION 'ROUTE_COOLDOWN_UNTIL %', to_char(deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); END IF;
 END IF;
 RETURN NEW;
END $$;
