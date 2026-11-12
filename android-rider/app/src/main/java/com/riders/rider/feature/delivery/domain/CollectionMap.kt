package com.riders.rider.feature.delivery.domain

data class GeoPoint(val latitude: Double, val longitude: Double)

const val ROUTE_REFRESH_METRES = 50.0
const val ROUTE_REFRESH_INTERVAL_MS = 20_000L
const val PICKUP_ARRIVAL_METRES = 100.0
const val DROPOFF_ARRIVAL_METRES = 100.0

/** Two markers closer than this share one street-level camera instead of a bounds fit. */
const val SAME_PLACE_METRES = 40.0

/** Zoom used when the rider and pickup are effectively the same place. */
const val STREET_LEVEL_ZOOM = 17f

/** Inside this distance the camera leaves the whole route and shows the pickup street. */
const val NEAR_PLACE_METRES = 700.0

/** Closest frame. Wide enough for the pickup block and the place names around it. */
const val NEAR_PLACE_SPAN_METRES = 320.0

/**
 * Shortest ground a delivery camera may show. A short pickup or drop-off is
 * expanded to this span so the fit does not zoom into the street.
 */
const val MIN_FRAME_SPAN_METRES = 1_500.0

/** Street-level zoom used when the rider is at the pickup. */
const val NEAR_PLACE_ZOOM = 17f

/** Widest zoom that still shows nearby places while the rider is approaching. */
const val APPROACH_PLACE_ZOOM = 15.5f

private const val METRES_PER_LATITUDE = 111_320.0

fun parseGeoPoint(latitude: String?, longitude: String?): GeoPoint? {
    val lat = latitude?.trim()?.toDoubleOrNull() ?: return null
    val lng = longitude?.trim()?.toDoubleOrNull() ?: return null
    if (!lat.isFinite() || !lng.isFinite() || lat !in -90.0..90.0 || lng !in -180.0..180.0) {
        return null
    }
    return GeoPoint(lat, lng)
}

fun riderReachedPickup(rider: GeoPoint, pickup: GeoPoint, radiusMetres: Double = PICKUP_ARRIVAL_METRES): Boolean {
    return metresBetween(rider, pickup) <= radiusMetres
}

fun riderReachedDropoff(rider: GeoPoint, dropoff: GeoPoint, radiusMetres: Double = DROPOFF_ARRIVAL_METRES): Boolean {
    return metresBetween(rider, dropoff) <= radiusMetres
}

/** A missing, stale, or unusable fix is not arrival. */
fun dropoffArrivalReading(rider: GeoPoint?, dropoff: GeoPoint?, fixUsable: Boolean): Boolean {
    if (!fixUsable || rider == null || dropoff == null) {
        return false
    }
    return riderReachedDropoff(rider, dropoff)
}

/** Arrival stays confirmed for the delivery after the rider leaves the radius or the fix drops. */
fun retainDropoffArrival(confirmed: Boolean, reading: Boolean): Boolean = confirmed || reading

enum class CollectedPrimaryAction {
    NavigateToDropoff,
    MarkAsDelivered,
}

/**
 * One primary action. A confirmed arrival replaces navigation.
 * Without a destination point, or without location permission, the geofence cannot run,
 * so the existing confirmation action stays available.
 */
fun collectedPrimaryAction(
    arrived: Boolean,
    dropoffKnown: Boolean,
    locationGranted: Boolean,
): CollectedPrimaryAction {
    if (arrived || !dropoffKnown || !locationGranted) {
        return CollectedPrimaryAction.MarkAsDelivered
    }
    return CollectedPrimaryAction.NavigateToDropoff
}

/** True when the camera should show the pickup and the places around it, not the whole route. */
fun framesNearbyPlace(rider: GeoPoint?, pickup: GeoPoint?): Boolean {
    if (pickup == null) {
        return false
    }
    if (rider == null) {
        return true
    }
    return metresBetween(rider, pickup) <= NEAR_PLACE_METRES
}

/**
 * Zoom for a rider who is near the pickup. A rider at the door stays at street level.
 * A rider still a few blocks out zooms out just enough to keep both of them in frame.
 */
fun nearPlaceZoom(distanceMetres: Double?): Float {
    val span = if (distanceMetres == null) {
        NEAR_PLACE_SPAN_METRES
    } else {
        (distanceMetres * 2.4).coerceAtLeast(NEAR_PLACE_SPAN_METRES)
    }
    val zoom = NEAR_PLACE_ZOOM - (Math.log(span / NEAR_PLACE_SPAN_METRES) / Math.log(2.0)).toFloat()
    return zoom.coerceIn(APPROACH_PLACE_ZOOM, NEAR_PLACE_ZOOM)
}

data class CollectionCameraFrame(
    val center: GeoPoint,
    val streetLevel: Boolean,
    val points: List<GeoPoint>,
)

/**
 * Frames the road line together with the rider and pickup. A bend that leaves the
 * straight line between the markers is included. A cluster inside [SAME_PLACE_METRES]
 * stays at street level so padding does not zoom the camera out across the city.
 */
fun collectionCameraFrame(
    rider: GeoPoint?,
    pickup: GeoPoint?,
    route: List<GeoPoint> = emptyList(),
): CollectionCameraFrame? {
    val points = ArrayList<GeoPoint>(route.size + 2)
    if (rider != null) {
        points.add(rider)
    }
    if (pickup != null) {
        points.add(pickup)
    }
    for (point in route) {
        if (point.latitude.isFinite() && point.longitude.isFinite()) {
            points.add(point)
        }
    }
    if (points.isEmpty()) {
        return null
    }
    var minLatitude = points[0].latitude
    var maxLatitude = minLatitude
    var minLongitude = points[0].longitude
    var maxLongitude = minLongitude
    for (point in points) {
        if (point.latitude < minLatitude) minLatitude = point.latitude
        if (point.latitude > maxLatitude) maxLatitude = point.latitude
        if (point.longitude < minLongitude) minLongitude = point.longitude
        if (point.longitude > maxLongitude) maxLongitude = point.longitude
    }
    val center = GeoPoint((minLatitude + maxLatitude) / 2.0, (minLongitude + maxLongitude) / 2.0)
    val span = metresBetween(GeoPoint(minLatitude, minLongitude), GeoPoint(maxLatitude, maxLongitude))
    return CollectionCameraFrame(center, span <= SAME_PLACE_METRES, points)
}

/**
 * Keeps every marker and route point, and grows a short frame to [minSpanMetres]
 * on both axes around the same center. A route that is already wider is unchanged.
 */
fun withMinimumCameraSpan(
    points: List<GeoPoint>,
    minSpanMetres: Double = MIN_FRAME_SPAN_METRES,
): List<GeoPoint> {
    if (points.isEmpty() || minSpanMetres <= 0.0 || !minSpanMetres.isFinite()) {
        return points
    }
    var minLatitude = points[0].latitude
    var maxLatitude = minLatitude
    var minLongitude = points[0].longitude
    var maxLongitude = minLongitude
    for (point in points) {
        if (point.latitude < minLatitude) minLatitude = point.latitude
        if (point.latitude > maxLatitude) maxLatitude = point.latitude
        if (point.longitude < minLongitude) minLongitude = point.longitude
        if (point.longitude > maxLongitude) maxLongitude = point.longitude
    }
    val midLatitude = (minLatitude + maxLatitude) / 2.0
    val midLongitude = (minLongitude + maxLongitude) / 2.0
    val latitudeSpan = (maxLatitude - minLatitude) * METRES_PER_LATITUDE
    val longitudeScale = METRES_PER_LATITUDE * Math.cos(Math.toRadians(midLatitude)).coerceAtLeast(0.2)
    val longitudeSpan = (maxLongitude - minLongitude) * longitudeScale
    if (latitudeSpan >= minSpanMetres && longitudeSpan >= minSpanMetres) {
        return points
    }
    val halfLatitude = maxOf(latitudeSpan, minSpanMetres) / 2.0 / METRES_PER_LATITUDE
    val halfLongitude = maxOf(longitudeSpan, minSpanMetres) / 2.0 / longitudeScale
    return points + listOf(
        GeoPoint(midLatitude - halfLatitude, midLongitude - halfLongitude),
        GeoPoint(midLatitude + halfLatitude, midLongitude + halfLongitude),
    )
}

/** Marker inset in pixels. A map that has not been laid out has no padding yet. */
fun collectionMarkerPaddingPx(clearanceDp: Float, density: Float): Int {
    if (clearanceDp <= 0f || !clearanceDp.isFinite() || density <= 0f || !density.isFinite()) {
        return 0
    }
    return (clearanceDp * density).toInt()
}

/**
 * Road distance and travel time from the routing service. Missing or invalid
 * values stay hidden rather than being estimated from a straight line.
 */
fun approachSummary(metres: Double?, seconds: Int?): String? {
    if (metres == null || seconds == null || !metres.isFinite() || metres <= 0.0 || seconds < 0) {
        return null
    }
    val distance = if (metres < 1_000.0) {
        "${metres.toInt()} m"
    } else {
        val kilometres = metres / 1_000.0
        if (kilometres >= 10.0) "${kilometres.toInt()} km" else String.format(java.util.Locale.US, "%.1f km", kilometres)
    }
    val time = if (seconds < 60) "< 1 min" else "${(seconds + 30) / 60} min"
    return "$distance · $time"
}

/** Moves the map target south so the pickup sits in the open map above a bottom sheet. */
fun placeCameraTarget(pickup: GeoPoint, zoom: Float, liftPixels: Float): GeoPoint {
    if (liftPixels <= 0f || !zoom.isFinite()) {
        return pickup
    }
    val degreesPerPixel = 360.0 / (256.0 * Math.pow(2.0, zoom.toDouble()))
    return GeoPoint(pickup.latitude - liftPixels * degreesPerPixel, pickup.longitude)
}

fun metresBetween(from: GeoPoint, to: GeoPoint): Double {
    val latitude = (to.latitude - from.latitude) * METRES_PER_LATITUDE
    val longitude = (to.longitude - from.longitude) * METRES_PER_LATITUDE * Math.cos(Math.toRadians(from.latitude))
    return Math.hypot(latitude, longitude)
}

/**
 * The first request is immediate. Later requests wait for both a meaningful
 * move and a quiet interval so a moving rider does not refetch on every fix.
 */
fun shouldRequestPickupRoute(
    lastOrigin: GeoPoint?,
    nextOrigin: GeoPoint,
    lastRequestAtMillis: Long?,
    nowMillis: Long,
): Boolean {
    if (lastRequestAtMillis != null && nowMillis - lastRequestAtMillis < ROUTE_REFRESH_INTERVAL_MS) {
        return false
    }
    if (lastOrigin == null) {
        return true
    }
    return metresBetween(lastOrigin, nextOrigin) >= ROUTE_REFRESH_METRES
}

fun decodeEncodedPolyline(encoded: String): List<GeoPoint> {
    val points = ArrayList<GeoPoint>()
    var index = 0
    var latitude = 0
    var longitude = 0
    while (index < encoded.length) {
        val latitudeDelta = decodeSigned(encoded, index) ?: return emptyList()
        index = latitudeDelta.next
        latitude += latitudeDelta.value
        val longitudeDelta = decodeSigned(encoded, index) ?: return emptyList()
        index = longitudeDelta.next
        longitude += longitudeDelta.value
        points.add(GeoPoint(latitude / 1e5, longitude / 1e5))
    }
    return roadLine(points)
}

fun decodeRouteLine(points: List<GeoPoint>): List<GeoPoint> = roadLine(points)

fun roadLine(points: List<GeoPoint>): List<GeoPoint> {
    val usable = points.filter { it.latitude.isFinite() && it.longitude.isFinite() }
    return if (usable.size > 1) usable else emptyList()
}

/** Road geometry has intermediate points. The two stop coordinates alone are not a driving route. */
fun drivingRouteLine(points: List<GeoPoint>): List<GeoPoint> {
    val usable = points.filter { it.latitude.isFinite() && it.longitude.isFinite() }
    return if (usable.size > 2) usable else emptyList()
}

/** A snapped road may start a short distance from the GPS fix. Farther than this, it is not the rider's route. */
const val LIVE_ROUTE_ORIGIN_METRES = 150.0

/** Drop-off roads can end on the nearest driveable point rather than the exact pin. */
const val LIVE_ROUTE_DESTINATION_METRES = 250.0

/**
 * True only for a road with intermediate points that starts at the rider and ends at the drop-off.
 * A pickup-to-drop-off line, or the two stop coordinates alone, is not the rider's live route.
 */
fun isRiderDropoffRoad(line: List<GeoPoint>, rider: GeoPoint, dropoff: GeoPoint): Boolean {
    if (line.size <= 2) {
        return false
    }
    return metresBetween(line.first(), rider) <= LIVE_ROUTE_ORIGIN_METRES &&
        metresBetween(line.last(), dropoff) <= LIVE_ROUTE_DESTINATION_METRES
}

fun deliveryRouteKey(pickup: GeoPoint, dropoff: GeoPoint): String {
    return listOf(pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude)
        .joinToString("|") { String.format(java.util.Locale.US, "%.5f", it) }
}

private data class Decoded(val value: Int, val next: Int)

private fun decodeSigned(encoded: String, start: Int): Decoded? {
    var index = start
    var shift = 0
    var result = 0
    while (index < encoded.length && shift <= 30) {
        val chunk = encoded[index].code - 63
        index += 1
        if (chunk < 0) {
            return null
        }
        result = result or ((chunk and 0x1f) shl shift)
        shift += 5
        if (chunk < 0x20) {
            val value = if (result and 1 == 1) (result shr 1).inv() else result shr 1
            return Decoded(value, index)
        }
    }
    return null
}
