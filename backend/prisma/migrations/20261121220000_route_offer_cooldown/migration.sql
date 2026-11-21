-- Deliberately independent of delivery deletion; expired rows are pruned on next request.
CREATE TABLE route_offer_cooldowns (
  delivery_id uuid NOT NULL, customer_id uuid NOT NULL,
  pickup_lat double precision NOT NULL, pickup_lng double precision NOT NULL,
  dropoff_lat double precision NOT NULL, dropoff_lng double precision NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (delivery_id, expires_at)
);
CREATE INDEX route_offer_cooldowns_customer_expiry ON route_offer_cooldowns(customer_id, expires_at);
CREATE FUNCTION route_cooldown_distance(a double precision,b double precision,c double precision,d double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT 12742000 * asin(sqrt(least(1.0, greatest(0.0,
 sin(radians(c-a)/2)^2 + cos(radians(a))*cos(radians(c))*sin(radians(d-b)/2)^2))))
$$;
CREATE FUNCTION route_cooldown_until(cid uuid, plat double precision, plng double precision, dlat double precision, dlng double precision)
RETURNS timestamptz LANGUAGE plpgsql AS $$
DECLARE deadline timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(cid::text, 81271));
 DELETE FROM route_offer_cooldowns WHERE customer_id=cid AND expires_at <= clock_timestamp();
 SELECT max(expires_at) INTO deadline FROM route_offer_cooldowns
 WHERE customer_id=cid AND expires_at > clock_timestamp()
 AND route_cooldown_distance(pickup_lat,pickup_lng,plat,plng)<=100
 AND route_cooldown_distance(dropoff_lat,dropoff_lng,dlat,dlng)<=100;
 SELECT greatest(deadline, max(offer_response_expires_at + interval '5 minutes')) INTO deadline FROM deliveries
 WHERE customer_id=cid AND status='CREATED' AND offer_response_expires_at <= clock_timestamp() AND offer_response_expires_at + interval '5 minutes' > clock_timestamp()
 AND route_cooldown_distance(pickup_latitude::double precision,pickup_longitude::double precision,plat,plng)<=100
 AND route_cooldown_distance(dropoff_latitude::double precision,dropoff_longitude::double precision,dlat,dlng)<=100;
 RETURN deadline;
END $$;
INSERT INTO route_offer_cooldowns
SELECT id,customer_id,pickup_latitude,pickup_longitude,dropoff_latitude,dropoff_longitude,offer_response_expires_at + interval '5 minutes'
FROM deliveries WHERE status='NO_RIDER_FOUND' AND offer_response_expires_at + interval '5 minutes' > clock_timestamp()
AND pickup_latitude IS NOT NULL AND pickup_longitude IS NOT NULL AND dropoff_latitude IS NOT NULL AND dropoff_longitude IS NOT NULL;
CREATE FUNCTION route_cooldown_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF OLD.status='CREATED' OR NEW.status<>'CREATED' THEN RETURN NEW; END IF;
 END IF;
 IF NEW.status='CREATED' AND NEW.service_class IS NOT NULL THEN
  deadline := route_cooldown_until(NEW.customer_id,NEW.pickup_latitude::double precision,NEW.pickup_longitude::double precision,NEW.dropoff_latitude::double precision,NEW.dropoff_longitude::double precision);
  IF deadline IS NOT NULL THEN RAISE EXCEPTION 'ROUTE_COOLDOWN_UNTIL %', to_char(deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER route_offer_cooldown_guard BEFORE INSERT OR UPDATE OF status ON deliveries FOR EACH ROW EXECUTE FUNCTION route_cooldown_delivery_guard();

CREATE TRIGGER route_offer_cooldown_delete BEFORE DELETE ON deliveries FOR EACH ROW EXECUTE FUNCTION route_cooldown_delivery_guard();

