package com.riders.rider.feature.delivery.domain

import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LOCATION_MAX_FIX_AGE_MS
import kotlin.math.max
import kotlin.math.abs

/** Route requests ignore a fix wider than the loose off-route band. */
const val ROUTE_FIX_MAX_ACCURACY_METRES = 80f

/** Foreground map display only; does not change location upload cadence. */
const val MAP_LOCATION_INTERVAL_MS = 2_000L
const val MAP_OFF_ROUTE_REFRESH_MS = 8_000L
private const val HEADING_SAMPLE_MAX_AGE_MS = 30_000L
private const val HEADING_MIN_DISPLACEMENT_METRES = 12.0
private const val HEADING_MAX_FIX_ACCURACY_METRES = 35f

/**
 * Latest fresh fix that is accurate enough to judge the corridor.
 * The filtered motorcycle point is never a route origin.
 */
fun routeCalculationFix(fix: GpsFix?, ageMillis: Long?): GpsFix? {
    if (fix == null || ageMillis == null || ageMillis !in 0..LOCATION_MAX_FIX_AGE_MS) {
        return null
    }
    val accuracy = fix.accuracyMetres
    if (accuracy != null && (!accuracy.isFinite() || accuracy <= 0f || accuracy > ROUTE_FIX_MAX_ACCURACY_METRES)) {
        return null
    }
    return fix
}

/**
 * A confirmed deviation can refresh before the ordinary 20s/50m interval.
 * Routine progress keeps that interval. Record the attempt when the response
 * arrives, including an empty or rejected line, so retries stay on this cooldown.
 */
fun shouldRefreshLiveMapRoute(
    lastOrigin: GeoPoint?,
    origin: GeoPoint,
    lastRequestAtMillis: Long?,
    nowMillis: Long,
    path: List<GeoPoint>,
    accuracyMetres: Float?,
): Boolean {
    val accurateEnough = accuracyMetres == null ||
        (accuracyMetres.isFinite() && accuracyMetres > 0f && accuracyMetres <= 80f)
    val offRoute = accurateEnough && isOffRoute(origin, path, accuracyMetres)
    if (offRoute && (lastRequestAtMillis == null ||
            nowMillis - lastRequestAtMillis >= MAP_OFF_ROUTE_REFRESH_MS)) {
        return true
    }
    return shouldRequestPickupRoute(lastOrigin, origin, lastRequestAtMillis, nowMillis)
}

/**
 * Prefer the provider's reliable travel bearing. If that is missing (e.g. at
 * walking speed), infer direction only from sufficiently separated accurate
 * fixes. Keep the previous heading when stopped or receiving noisy fixes.
 * This is per map session, not a sensor or another location subscription.
 */
class TravelHeadingTracker {
    private data class Sample(val point: GeoPoint, val time: Long, val accuracy: Float)
    private var anchor: Sample? = null
    private var lastTime: Long? = null
    private var held: Float? = null
    private var frozen = false

    private fun acceptHeading(reading: Float) {
        val previous = held
        if (previous == null || abs(shortestBearingDelta(previous, reading)) >= 8f) held = reading
    }

    fun reset() {
        anchor = null
        lastTime = null
        held = null
        frozen = false
    }

    fun update(
        point: GeoPoint,
        timeMillis: Long,
        accuracyMetres: Float?,
        speedMetresPerSecond: Float?,
        bearingDegrees: Float?,
        bearingAccuracyDegrees: Float?,
        arrived: Boolean = false,
    ): Float? {
        if (frozen) return held
        // Process the fix that confirms arrival, then hold its last reliable heading.
        frozen = arrived
        if (lastTime?.let { timeMillis <= it } == true ||
            !point.latitude.isFinite() || !point.longitude.isFinite()) return held
        lastTime = timeMillis
        val sample = accuracyMetres?.takeIf {
            it.isFinite() && it > 0f && it <= HEADING_MAX_FIX_ACCURACY_METRES
        }?.let { Sample(point, timeMillis, it) }
        val reported = reliableBearing(speedMetresPerSecond, bearingDegrees, bearingAccuracyDegrees)
        if (reported != null) {
            acceptHeading(reported)
            anchor = sample
            return held
        }
        if (sample == null) {
            anchor = null
            return held
        }
        val previous = anchor
        val elapsed = previous?.let { timeMillis - it.time }
        if (previous == null || elapsed == null || elapsed > HEADING_SAMPLE_MAX_AGE_MS ||
            speedMetresPerSecond?.let { it.isFinite() && it < 0.4f } == true) {
            anchor = sample
            return held
        }
        val distance = metresBetween(previous.point, point)
        val minimum = max(HEADING_MIN_DISPLACEMENT_METRES,
            1.5 * max(previous.accuracy, sample.accuracy))
        if (distance < minimum) return held
        anchor = sample
        if (elapsed <= 0L || distance / (elapsed / 1000.0) > 65.0) return held
        geographicBearing(previous.point, point)?.let(::acceptHeading)
        return held
    }
}


/** Display-only deadband. Never substitutes coordinates in the shared GPS feed. */
class MapPositionTracker {
    private var held: GeoPoint? = null
    private var heldAccuracy = 0f
    private var lastTime: Long? = null
    private var frozen = false

    fun reset() {
        held = null
        heldAccuracy = 0f
        lastTime = null
        frozen = false
    }

    fun update(
        point: GeoPoint,
        timeMillis: Long,
        accuracyMetres: Float?,
        speedMetresPerSecond: Float?,
        arrived: Boolean,
    ): GeoPoint? {
        if (frozen) return held
        if (!point.latitude.isFinite() || !point.longitude.isFinite() ||
            point.latitude !in -90.0..90.0 || point.longitude !in -180.0..180.0) return held
        if (lastTime?.let { timeMillis < it } == true) return held
        lastTime = timeMillis
        val accuracy = accuracyMetres?.takeIf { it.isFinite() && it > 0f }
        val previous = held
        // Arrival is the existing per-leg latch. Hold the last real arrival fix,
        // never snap the uploaded position to the destination.
        if (arrived) {
            if (previous == null || metresBetween(previous, point) >= 12.0) held = point
            frozen = true
            return held
        }
        if (previous != null) {
            if (accuracy != null && accuracy > 35f) return previous
            val speed = speedMetresPerSecond?.takeIf { it.isFinite() && it >= 0f }
            val uncertainty = max(heldAccuracy, accuracy ?: 0f).toDouble().coerceAtMost(35.0)
            val minimum = when {
                speed != null && speed >= 1.5f -> max(5.0, uncertainty * 0.75)
                speed != null && speed >= 0.4f -> max(8.0, uncertainty)
                speed != null -> max(25.0, uncertainty * 2.0)
                else -> max(15.0, uncertainty * 1.5)
            }
            if (metresBetween(previous, point) < minimum && !(heldAccuracy > 35f && accuracy != null && accuracy <= 35f)) {
                return previous
            }
        }
        held = point
        heldAccuracy = accuracy ?: 0f
        return held
    }
}


/** A leg outlives the navigation destination's ViewModel, not the signed-in session. */
data class LiveMapLegKey(val assignmentId: String, val dropoff: Boolean, val stop: GeoPoint)

class LiveMapLegState(private val stop: GeoPoint) {
    private val headings = TravelHeadingTracker()
    private val positions = MapPositionTracker()
    private var reliable: Float? = null
    private var roadFallback = false
    var point: GeoPoint? = null
        private set
    var heading: Float? = null
        private set
    var arrived = false
        private set

    fun update(point: GeoPoint, time: Long, accuracy: Float?, speed: Float?,
               bearing: Float?, bearingAccuracy: Float?, atStop: Boolean, road: List<GeoPoint>,
               legOrigin: GeoPoint? = null) {
        if (arrived) return
        reliable = headings.update(point, time, accuracy, speed, bearing, bearingAccuracy, atStop)
        this.point = positions.update(point, time, accuracy, speed, atStop)
        if (atStop) {
            // Actual motion always wins, even if a detour puts the pickup ahead.
            // For an already-arrived delivery without a measured heading, use
            // the overall leg direction, not the tiny (possibly reversed) GPS
            // offset to the stop or a route's old departure direction.
            heading = reliable
                ?: legOrigin?.let { geographicBearing(it, stop) }
                ?: heading
                ?: routeDepartureBearing(road)
                ?: 0f
            arrived = true
        } else {
            chooseHeading(road)
        }
    }

    fun chooseHeading(road: List<GeoPoint>) {
        if (arrived) return
        val travel = reliable
        if (travel != null) {
            heading = travel
        } else {
            val routeBearing = if (!roadFallback) routeDepartureBearing(road) else null
            if (routeBearing != null) {
                heading = routeBearing
                roadFallback = true
            } else if (heading == null) {
                heading = cameraHeading(null, emptyList(), point, stop)
            }
        }
    }
}

/** Bounded memory only. Changing owner clears all previous leg states. */
class LiveMapLegCache(private val capacity: Int = 32) {
    private var owner: String? = null
    private val legs = LinkedHashMap<LiveMapLegKey, LiveMapLegState>(16, 0.75f, true)

    @Synchronized fun get(owner: String, key: LiveMapLegKey): LiveMapLegState {
        if (this.owner != owner) {
            legs.clear()
            this.owner = owner
        }
        return legs.getOrPut(key) { LiveMapLegState(key.stop) }.also {
            while (legs.size > capacity.coerceAtLeast(1)) legs.remove(legs.keys.first())
        }
    }

    @Synchronized fun clear() {
        legs.clear()
        owner = null
    }
}
