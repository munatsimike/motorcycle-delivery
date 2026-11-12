package com.riders.rider.feature.delivery.domain

const val NAVIGATION_ZOOM = 17.5f
const val OFF_ROUTE_METRES = 45.0
const val OFF_ROUTE_LOOSE_METRES = 80.0
const val OFF_ROUTE_ACCURACY_METRES = 40f
const val RELIABLE_BEARING_MIN_SPEED_MPS = 1.5f
const val RELIABLE_BEARING_MAX_ACCURACY = 45f

data class RouteManeuver(
    val text: String,
    val type: String,
    val street: String?,
    val metres: Double,
    val seconds: Double,
    val fromIndex: Int,
    val toIndex: Int,
    val point: GeoPoint,
)

data class GuidanceCue(
    val stepIndex: Int,
    val instruction: String,
    val type: String,
    val street: String?,
    val metresToManeuver: Double,
    val remainingMetres: Double,
    val remainingSeconds: Double?,
)

data class PathProjection(
    val segmentIndex: Int,
    val alongMetres: Double,
    val distanceMetres: Double,
)

/**
 * A bearing is usable only while the motorcycle is moving and the reported
 * accuracy is tight enough to avoid spinning the marker on a noisy fix.
 */
fun reliableBearing(
    speedMetresPerSecond: Float?,
    bearingDegrees: Float?,
    bearingAccuracyDegrees: Float?,
): Float? {
    val bearing = bearingDegrees ?: return null
    val speed = speedMetresPerSecond ?: return null
    if (!bearing.isFinite() || !speed.isFinite() || speed < RELIABLE_BEARING_MIN_SPEED_MPS) {
        return null
    }
    val accuracy = bearingAccuracyDegrees
    if (accuracy != null && (!accuracy.isFinite() || accuracy > RELIABLE_BEARING_MAX_ACCURACY)) {
        return null
    }
    return ((bearing % 360f) + 360f) % 360f
}

fun projectOntoPath(point: GeoPoint, path: List<GeoPoint>): PathProjection? {
    if (path.size < 2) {
        return null
    }
    var bestDistance = Double.POSITIVE_INFINITY
    var bestAlong = 0.0
    var bestSegment = 0
    var travelled = 0.0
    for (index in 0 until path.lastIndex) {
        val start = path[index]
        val end = path[index + 1]
        val segment = metresBetween(start, end)
        val fraction = if (segment < 0.5) 0.0 else projectionFraction(start, end, point).coerceIn(0.0, 1.0)
        val along = travelled + segment * fraction
        val distance = metresBetween(point, interpolate(start, end, fraction))
        if (distance < bestDistance) {
            bestDistance = distance
            bestAlong = along
            bestSegment = index
        }
        travelled += segment
    }
    return PathProjection(bestSegment, bestAlong, bestDistance)
}

/**
 * A rider who is still on the road is not off route, however far they have
 * travelled along it. A poor fix must be much farther away before it counts.
 */
fun isOffRoute(rider: GeoPoint, path: List<GeoPoint>, accuracyMetres: Float?): Boolean {
    val projection = projectOntoPath(rider, path) ?: return false
    val limit = if (accuracyMetres == null || accuracyMetres > OFF_ROUTE_ACCURACY_METRES) {
        OFF_ROUTE_LOOSE_METRES
    } else {
        OFF_ROUTE_METRES
    }
    return projection.distanceMetres > limit
}

/**
 * The first route is requested immediately. A replacement waits for the rider
 * to leave the corridor and for [ROUTE_REFRESH_INTERVAL_MS]. Moving along the
 * route does not request another one.
 */
fun shouldReplaceGuidance(
    hasRoute: Boolean,
    offRoute: Boolean,
    nowMillis: Long,
    lastRequestAtMillis: Long?,
): Boolean {
    if (lastRequestAtMillis != null && nowMillis - lastRequestAtMillis < ROUTE_REFRESH_INTERVAL_MS) {
        return false
    }
    if (!hasRoute) {
        return true
    }
    return offRoute
}

fun routeProgress(
    rider: GeoPoint,
    path: List<GeoPoint>,
    steps: List<RouteManeuver>,
    totalSeconds: Int?,
): GuidanceCue? {
    val projection = projectOntoPath(rider, path) ?: return null
    val total = pathLength(path)
    val along = projection.alongMetres.coerceIn(0.0, total)
    val remaining = (total - along).coerceAtLeast(0.0)
    if (steps.isEmpty()) {
        return GuidanceCue(
            stepIndex = -1,
            instruction = "",
            type = "",
            street = null,
            metresToManeuver = remaining,
            remainingMetres = remaining,
            remainingSeconds = scaledSeconds(totalSeconds, total, remaining),
        )
    }
    val stepIndex = steps.indexOfLast { it.fromIndex <= projection.segmentIndex }.let { index ->
        if (index < 0) 0 else index
    }
    val step = steps[stepIndex]
    val maneuverAt = metresUntilIndex(path, step.toIndex.coerceIn(0, path.lastIndex))
    val toManeuver = (maneuverAt - along).coerceAtLeast(0.0)
    return GuidanceCue(
        stepIndex = stepIndex,
        instruction = step.text,
        type = step.type,
        street = step.street,
        metresToManeuver = toManeuver,
        remainingMetres = remaining,
        remainingSeconds = scaledSeconds(totalSeconds, total, remaining)
            ?: remainingStepSeconds(steps, stepIndex, toManeuver, step),
    )
}

fun formatMetres(metres: Double): String {
    val value = metres.coerceAtLeast(0.0)
    if (value < 1000.0) {
        return "${(value + 0.5).toInt()} m"
    }
    val tenths = (value / 100.0 + 0.5).toInt()
    return "${tenths / 10}.${tenths % 10} km"
}

fun formatArrival(remainingSeconds: Double?, nowMillis: Long = System.currentTimeMillis()): String? {
    val seconds = remainingSeconds ?: return null
    if (!seconds.isFinite() || seconds < 0.0) {
        return null
    }
    val arrival = java.time.Instant.ofEpochMilli(nowMillis + (seconds * 1000.0).toLong())
    val time = arrival.atZone(java.time.ZoneId.systemDefault())
    return time.hour.toString().padStart(2, '0') + ":" + time.minute.toString().padStart(2, '0')
}

private fun scaledSeconds(totalSeconds: Int?, totalMetres: Double, remainingMetres: Double): Double? {
    if (totalSeconds == null || totalSeconds < 0 || totalMetres < 1.0) {
        return null
    }
    return totalSeconds * (remainingMetres / totalMetres)
}

private fun remainingStepSeconds(
    steps: List<RouteManeuver>,
    index: Int,
    metresToManeuver: Double,
    step: RouteManeuver,
): Double? {
    val later = steps.drop(index + 1).sumOf { it.seconds.coerceAtLeast(0.0) }
    val current = if (step.metres <= 1.0) {
        step.seconds.coerceAtLeast(0.0)
    } else {
        step.seconds.coerceAtLeast(0.0) * (metresToManeuver / step.metres).coerceIn(0.0, 1.0)
    }
    val total = current + later
    return total.takeIf { it.isFinite() }
}

private fun pathLength(path: List<GeoPoint>): Double = metresUntilIndex(path, path.lastIndex)

private fun metresUntilIndex(path: List<GeoPoint>, index: Int): Double {
    if (path.size < 2) {
        return 0.0
    }
    val end = index.coerceIn(0, path.lastIndex)
    var total = 0.0
    for (cursor in 0 until end) {
        total += metresBetween(path[cursor], path[cursor + 1])
    }
    return total
}

private fun projectionFraction(start: GeoPoint, end: GeoPoint, point: GeoPoint): Double {
    val scale = Math.cos(Math.toRadians(start.latitude))
    val east = (end.longitude - start.longitude) * scale
    val north = end.latitude - start.latitude
    val pointEast = (point.longitude - start.longitude) * scale
    val pointNorth = point.latitude - start.latitude
    val length = east * east + north * north
    if (length == 0.0) {
        return 0.0
    }
    return (east * pointEast + north * pointNorth) / length
}

private fun interpolate(start: GeoPoint, end: GeoPoint, fraction: Double): GeoPoint {
    return GeoPoint(
        latitude = start.latitude + (end.latitude - start.latitude) * fraction,
        longitude = start.longitude + (end.longitude - start.longitude) * fraction,
    )
}
