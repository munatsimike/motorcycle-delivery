package com.riders.rider

import com.riders.rider.feature.delivery.presentation.RIDER_MOTORCYCLE_MARKER_DP
import com.riders.rider.feature.delivery.presentation.RiderMapTheme
import com.riders.rider.feature.delivery.presentation.TAG_TIP_HEIGHT_DP
import com.riders.rider.feature.delivery.presentation.TAG_TIP_WIDTH_DP
import com.riders.rider.feature.delivery.presentation.TAG_VISIBLE_GAP_DP
import com.riders.rider.feature.delivery.presentation.tagSpaceBelowTipDp
import com.riders.rider.feature.delivery.domain.APPROACH_PLACE_ZOOM
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.NEAR_PLACE_ZOOM
import com.riders.rider.feature.delivery.domain.ROUTE_REFRESH_INTERVAL_MS
import com.riders.rider.feature.delivery.domain.STREET_LEVEL_ZOOM
import com.riders.rider.feature.delivery.domain.approachSummary
import com.riders.rider.feature.delivery.domain.haversineMetres
import com.riders.rider.feature.delivery.domain.pickupTagLabel
import com.riders.rider.feature.delivery.domain.MIN_FRAME_SPAN_METRES
import com.riders.rider.feature.delivery.domain.ROUTE_MIN_FRAME_SPAN_METRES
import com.riders.rider.feature.delivery.domain.collectionCameraFrame
import com.riders.rider.feature.delivery.domain.withMinimumCameraSpan
import com.riders.rider.feature.delivery.domain.REQUEST_PIN_CLEARANCE_DP
import com.riders.rider.feature.delivery.domain.REQUEST_RIDER_CLEARANCE_DP
import com.riders.rider.feature.delivery.domain.REQUEST_SIDE_PADDING_DP
import com.riders.rider.feature.delivery.domain.REQUEST_TAG_CLEARANCE_DP
import com.riders.rider.feature.delivery.domain.REQUEST_TOP_CHROME_DP
import com.riders.rider.feature.delivery.domain.collectionMarkerPaddingPx
import com.riders.rider.feature.delivery.domain.requestCameraInsets
import com.riders.rider.feature.delivery.domain.decodeEncodedPolyline
import com.riders.rider.feature.delivery.domain.decodeRouteLine
import com.riders.rider.feature.delivery.domain.deliveryRouteKey
import com.riders.rider.feature.delivery.domain.drivingRouteLine
import com.riders.rider.feature.delivery.domain.framesNearbyPlace
import com.riders.rider.feature.delivery.domain.isRiderDropoffRoad
import com.riders.rider.feature.delivery.domain.metresBetween
import com.riders.rider.feature.delivery.domain.nearPlaceZoom
import com.riders.rider.feature.delivery.domain.parseGeoPoint
import com.riders.rider.feature.delivery.domain.placeCameraTarget
import com.riders.rider.feature.availability.domain.LOCATION_MAX_ACCURACY_METERS
import com.riders.rider.feature.availability.domain.LOCATION_MAX_FIX_AGE_MS
import com.riders.rider.feature.availability.domain.isDispatchUsable
import com.riders.rider.feature.delivery.domain.CollectedPrimaryAction
import com.riders.rider.feature.delivery.domain.collectedPrimaryAction
import com.riders.rider.feature.delivery.domain.dropoffArrivalReading
import com.riders.rider.feature.delivery.domain.retainDropoffArrival
import com.riders.rider.feature.delivery.domain.riderReachedDropoff
import com.riders.rider.feature.delivery.domain.riderReachedPickup
import com.riders.rider.feature.delivery.domain.shouldRequestPickupRoute
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CollectionMapTest {
    private val pickup = GeoPoint(-17.8252, 31.0335)

    @Test
    fun keepsClassicLightAsTheDefaultMapTheme() {
        assertEquals(RiderMapTheme.ClassicLight, RiderMapTheme.fromKey(null))
        assertEquals(RiderMapTheme.ClassicLight, RiderMapTheme.fromKey("unknown"))
        assertEquals(RiderMapTheme.MinimalLight, RiderMapTheme.fromKey("minimal_light"))
        assertEquals(RiderMapTheme.ClassicLight, RiderMapTheme.fromKey("classic_light"))
    }

    @Test
    fun readsPickupCoordinatesAndRejectsMissingOnes() {
        assertEquals(pickup, parseGeoPoint("-17.8252000", "31.0335000"))
        assertNull(parseGeoPoint(null, "31.0335000"))
        assertNull(parseGeoPoint("street", "31.0335000"))
        assertNull(parseGeoPoint("91", "31"))
    }

    @Test
    fun acceptsOnlyARoadThatStartsAtTheRiderAndEndsAtTheDropoff() {
        val rider = GeoPoint(-17.8300, 31.0500)
        val dropoff = GeoPoint(-17.8200, 31.0400)
        val road = listOf(rider, GeoPoint(-17.8250, 31.0450), dropoff)
        assertTrue(isRiderDropoffRoad(road, rider, dropoff))
        assertFalse(isRiderDropoffRoad(listOf(rider, dropoff), rider, dropoff))
        val pickupRoad = listOf(pickup, GeoPoint(-17.8220, 31.0360), dropoff)
        assertFalse(isRiderDropoffRoad(pickupRoad, rider, dropoff))
    }

    @Test
    fun requestsTheFirstRouteThenWaitsForFiftyMetresAndAQuietInterval() {
        val now = 1_000_000L
        assertTrue(shouldRequestPickupRoute(null, pickup, null, now))
        val nearby = GeoPoint(pickup.latitude + 10 / 111_320.0, pickup.longitude)
        assertTrue(metresBetween(pickup, nearby) < 50)
        assertTrue(!shouldRequestPickupRoute(pickup, nearby, now, now + ROUTE_REFRESH_INTERVAL_MS))
        val moved = GeoPoint(pickup.latitude + 60 / 111_320.0, pickup.longitude)
        assertTrue(metresBetween(pickup, moved) >= 50)
        assertTrue(!shouldRequestPickupRoute(pickup, moved, now, now + 1_000))
        assertTrue(shouldRequestPickupRoute(pickup, moved, now, now + ROUTE_REFRESH_INTERVAL_MS))
    }

    @Test
    fun zoomsToThePickupStreetWhenTheRiderIsNearAndKeepsAFarRouteWide() {
        assertTrue(framesNearbyPlace(null, pickup))
        assertEquals(NEAR_PLACE_ZOOM, nearPlaceZoom(null))
        val close = GeoPoint(pickup.latitude + 40 / 111_320.0, pickup.longitude)
        assertTrue(framesNearbyPlace(close, pickup))
        assertEquals(NEAR_PLACE_ZOOM, nearPlaceZoom(metresBetween(close, pickup)))
        val approaching = GeoPoint(pickup.latitude + 500 / 111_320.0, pickup.longitude)
        val approachZoom = nearPlaceZoom(metresBetween(approaching, pickup))
        assertTrue(approachZoom < NEAR_PLACE_ZOOM)
        assertTrue(approachZoom >= APPROACH_PLACE_ZOOM)
        val far = GeoPoint(pickup.latitude + 2_000 / 111_320.0, pickup.longitude)
        assertTrue(!framesNearbyPlace(far, pickup))
        val lifted = placeCameraTarget(pickup, NEAR_PLACE_ZOOM, 120f)
        assertTrue(lifted.latitude < pickup.latitude)
        assertEquals(pickup.longitude, lifted.longitude, 0.000_000_1)
    }

    @Test
    fun fitsSeparatedMarkersAndKeepsASharedLocationAtStreetLevel() {
        val same = collectionCameraFrame(pickup, pickup)
        assertTrue(same!!.streetLevel)
        assertEquals(STREET_LEVEL_ZOOM, STREET_LEVEL_ZOOM)
        val beside = GeoPoint(pickup.latitude + 20 / 111_320.0, pickup.longitude)
        assertTrue(collectionCameraFrame(beside, pickup)!!.streetLevel)
        val hundred = GeoPoint(pickup.latitude + 100 / 111_320.0, pickup.longitude)
        val oneKilometre = GeoPoint(pickup.latitude + 1_000 / 111_320.0, pickup.longitude)
        val tenKilometres = GeoPoint(pickup.latitude + 10_000 / 111_320.0, pickup.longitude)
        assertFalse(collectionCameraFrame(hundred, pickup)!!.streetLevel)
        assertFalse(collectionCameraFrame(oneKilometre, pickup)!!.streetLevel)
        assertFalse(collectionCameraFrame(tenKilometres, pickup)!!.streetLevel)
        assertEquals(2, collectionCameraFrame(tenKilometres, pickup)!!.points.size)
        val bend = GeoPoint(pickup.latitude + 600 / 111_320.0, pickup.longitude + 400 / 111_320.0)
        val bent = collectionCameraFrame(hundred, pickup, listOf(hundred, bend, pickup))
        assertFalse(bent!!.streetLevel)
        assertTrue(bent.points.contains(bend))
        assertTrue(bent.center.latitude > pickup.latitude)
        assertTrue(bent.center.latitude > hundred.latitude)
        val tightBend = GeoPoint(pickup.latitude + 15 / 111_320.0, pickup.longitude + 10 / 111_320.0)
        assertTrue(collectionCameraFrame(pickup, pickup, listOf(pickup, tightBend))!!.streetLevel)
        val unavailable = collectionCameraFrame(null, pickup)
        assertTrue(unavailable!!.streetLevel)
        assertEquals(1, unavailable.points.size)
        assertNull(collectionCameraFrame(null, null))
        val short = listOf(pickup, GeoPoint(pickup.latitude + 200 / 111_320.0, pickup.longitude))
        val routeFrame = withMinimumCameraSpan(short, ROUTE_MIN_FRAME_SPAN_METRES)
        val deliveredFrame = withMinimumCameraSpan(short, MIN_FRAME_SPAN_METRES)
        assertEquals(1_000.0, ROUTE_MIN_FRAME_SPAN_METRES, 0.0)
        assertEquals(1_500.0, MIN_FRAME_SPAN_METRES, 0.0)
        assertTrue(latitudeSpanMetres(routeFrame) >= ROUTE_MIN_FRAME_SPAN_METRES - 1)
        assertTrue(latitudeSpanMetres(deliveredFrame) >= MIN_FRAME_SPAN_METRES - 1)
        assertTrue(latitudeSpanMetres(routeFrame) < latitudeSpanMetres(deliveredFrame))
        val wide = listOf(pickup, GeoPoint(pickup.latitude + 2_000 / 111_320.0, pickup.longitude + 2_000 / 111_320.0))
        assertEquals(wide, withMinimumCameraSpan(wide, ROUTE_MIN_FRAME_SPAN_METRES))
        assertEquals(90, collectionMarkerPaddingPx(36f, 2.5f))
        assertEquals(0, collectionMarkerPaddingPx(36f, 0f))
    }

    @Test
    fun requestCameraUsesTheMeasuredCardWithoutExtraMargin() {
        val insets = requestCameraInsets(
            mapWidthPx = 1080,
            mapHeightPx = 1920,
            density = 2f,
            statusTopPx = 48,
            sheetOverlapPx = 400,
            includeRider = false,
        )
        assertEquals((REQUEST_SIDE_PADDING_DP * 2f).toInt(), insets.startPx)
        assertEquals(insets.startPx, insets.endPx)
        assertEquals(48 + (REQUEST_TOP_CHROME_DP * 2f).toInt(), insets.topPx)
        assertEquals(400 + (REQUEST_PIN_CLEARANCE_DP * 2f).toInt(), insets.bottomPx)
        val withRider = requestCameraInsets(
            mapWidthPx = 1080,
            mapHeightPx = 1920,
            density = 2f,
            statusTopPx = 48,
            sheetOverlapPx = 400,
            includeRider = true,
        )
        assertEquals(48 + ((REQUEST_TOP_CHROME_DP + REQUEST_TAG_CLEARANCE_DP) * 2f).toInt(), withRider.topPx)
        assertEquals(400 + (REQUEST_RIDER_CLEARANCE_DP * 2f).toInt(), withRider.bottomPx)
        assertTrue(withRider.topPx > insets.topPx)
        val crowded = requestCameraInsets(
            mapWidthPx = 400,
            mapHeightPx = 800,
            density = 1f,
            statusTopPx = 0,
            sheetOverlapPx = 700,
            includeRider = false,
        )
        assertEquals(700, crowded.bottomPx)
    }

    @Test
    fun showsRoadDistanceAndTimeOnlyWhenTheRouteProvidesBoth() {
        assertEquals("850 m · 3 min", approachSummary(850.0, 180))
        assertEquals("1.5 km · 4 min", approachSummary(1_500.0, 210))
        assertEquals(12f, TAG_TIP_WIDTH_DP)
        assertEquals(6f, TAG_TIP_HEIGHT_DP)
        assertEquals(6f, TAG_VISIBLE_GAP_DP)
        val topInset = 106f / 1312f
        val belowTip = tagSpaceBelowTipDp(RIDER_MOTORCYCLE_MARKER_DP, topInset)
        val visibleAboveCenter = RIDER_MOTORCYCLE_MARKER_DP / 2f - topInset * RIDER_MOTORCYCLE_MARKER_DP
        assertEquals(visibleAboveCenter + 6f, belowTip, 0.01f)
        assertTrue(tagSpaceBelowTipDp(RIDER_MOTORCYCLE_MARKER_DP, 0.2f) < belowTip)
        assertEquals("10 km · < 1 min", approachSummary(10_000.0, 20))
        assertNull(approachSummary(0.0, 0))
        assertNull(approachSummary(null, 180))
        assertNull(approachSummary(850.0, null))
        assertNull(approachSummary(-1.0, 180))
    }

    @Test
    fun pickupTagShowsZeroOnlyInsideOneHundredStraightMetres() {
        val roadMetres = 477.0
        val roadSeconds = 120
        fun north(metres: Int) = GeoPoint(
            pickup.latitude + (metres / 6_371_000.0) * (180.0 / Math.PI),
            pickup.longitude,
        )
        assertEquals(150, haversineMetres(north(150), pickup))
        assertEquals(49, haversineMetres(north(49), pickup))
        assertEquals(50, haversineMetres(north(50), pickup))
        assertEquals(51, haversineMetres(north(51), pickup))
        assertEquals("477 m · 2 min", pickupTagLabel(north(150), pickup, roadMetres, roadSeconds))
        assertEquals("Arrived", pickupTagLabel(north(49), pickup, roadMetres, roadSeconds))
        assertEquals("Arrived", pickupTagLabel(north(50), pickup, roadMetres, roadSeconds))
        assertEquals("477 m · 2 min", pickupTagLabel(north(51), pickup, roadMetres, roadSeconds))
        assertEquals("477 m · 2 min", pickupTagLabel(null, pickup, roadMetres, roadSeconds))
        assertEquals("477 m · 2 min", pickupTagLabel(north(10), null, roadMetres, roadSeconds))
        val dropoff = GeoPoint(-17.83, 31.04)
        fun northOfDropoff(metres: Int) = GeoPoint(
            dropoff.latitude + (metres / 6_371_000.0) * (180.0 / Math.PI),
            dropoff.longitude,
        )
        assertEquals("Arrived", pickupTagLabel(northOfDropoff(49), dropoff, roadMetres, roadSeconds))
        assertEquals("Arrived", pickupTagLabel(northOfDropoff(50), dropoff, roadMetres, roadSeconds))
        assertEquals("477 m · 2 min", pickupTagLabel(northOfDropoff(51), dropoff, roadMetres, roadSeconds))
        assertEquals("477 m · 2 min", pickupTagLabel(null, dropoff, roadMetres, roadSeconds))
    }

    @Test
    fun dropoffArrivalUsesAFreshFixInsideOneHundredMetresAndDoesNotFlicker() {
        val dropoff = GeoPoint(pickup.latitude + 0.01, pickup.longitude)
        fun northOf(metres: Int) = GeoPoint(
            dropoff.latitude + (metres / 6_371_000.0) * (180.0 / Math.PI),
            dropoff.longitude,
        )
        val inside = northOf(49)
        val boundary = northOf(50)
        val outside = northOf(51)
        assertTrue(riderReachedDropoff(inside, dropoff))
        assertTrue(riderReachedDropoff(boundary, dropoff))
        assertFalse(riderReachedDropoff(outside, dropoff))
        assertTrue(isDispatchUsable(1_000L, 30f))
        assertFalse(isDispatchUsable(LOCATION_MAX_FIX_AGE_MS + 1, 30f))
        assertFalse(isDispatchUsable(1_000L, LOCATION_MAX_ACCURACY_METERS + 1))
        assertTrue(dropoffArrivalReading(inside, dropoff, fixUsable = true))
        assertFalse(dropoffArrivalReading(outside, dropoff, fixUsable = true))
        assertFalse(dropoffArrivalReading(inside, dropoff, fixUsable = false))
        assertFalse(dropoffArrivalReading(null, dropoff, fixUsable = true))
        assertFalse(dropoffArrivalReading(inside, null, fixUsable = true))
        assertTrue(retainDropoffArrival(confirmed = true, reading = false))
        assertFalse(retainDropoffArrival(confirmed = false, reading = false))
        assertEquals(CollectedPrimaryAction.NavigateToDropoff, collectedPrimaryAction(arrived = false, dropoffKnown = true, locationGranted = true))
        assertEquals(CollectedPrimaryAction.MarkAsDelivered, collectedPrimaryAction(arrived = true, dropoffKnown = true, locationGranted = true))
        assertEquals(CollectedPrimaryAction.MarkAsDelivered, collectedPrimaryAction(arrived = true, dropoffKnown = true, locationGranted = false))
        assertEquals(CollectedPrimaryAction.MarkAsDelivered, collectedPrimaryAction(arrived = false, dropoffKnown = false, locationGranted = true))
        assertEquals(CollectedPrimaryAction.MarkAsDelivered, collectedPrimaryAction(arrived = false, dropoffKnown = true, locationGranted = false))
    }

    @Test
    fun treatsOneHundredMetresAsArrivalAndKeepsAFarRiderEnRoute() {
        fun northOf(metres: Int) = GeoPoint(
            pickup.latitude + (metres / 6_371_000.0) * (180.0 / Math.PI),
            pickup.longitude,
        )
        assertTrue(riderReachedPickup(northOf(49), pickup))
        assertTrue(riderReachedPickup(northOf(50), pickup))
        assertTrue(!riderReachedPickup(northOf(51), pickup))
    }

    @Test
    fun decodesRoadGeometryAndDropsASinglePoint() {
        val decoded = decodeEncodedPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
        assertEquals(3, decoded.size)
        assertEquals(38.5, decoded[0].latitude, 0.001)
        assertEquals(-120.2, decoded[0].longitude, 0.001)
        assertTrue(decodeRouteLine(listOf(pickup)).isEmpty())
        assertEquals(2, decodeRouteLine(listOf(pickup, GeoPoint(-17.83, 31.04))).size)
    }

    @Test
    fun drivingRouteKeepsRoadBendsAndDropsAStraightTwoPointLine() {
        val dropoff = GeoPoint(-17.83, 31.04)
        val bend = GeoPoint(-17.828, 31.05)
        assertTrue(drivingRouteLine(listOf(pickup, dropoff)).isEmpty())
        assertTrue(drivingRouteLine(listOf(pickup)).isEmpty())
        assertEquals(listOf(pickup, bend, dropoff), drivingRouteLine(listOf(pickup, bend, dropoff)))
        assertEquals(deliveryRouteKey(pickup, dropoff), deliveryRouteKey(GeoPoint(-17.8252004, 31.0335004), GeoPoint(-17.8300004, 31.0400004)))
        assertTrue(deliveryRouteKey(pickup, dropoff) != deliveryRouteKey(dropoff, pickup))
    }
}

private fun latitudeSpanMetres(points: List<GeoPoint>): Double {
    val latitudes = points.map { it.latitude }
    return (latitudes.max() - latitudes.min()) * 111_320.0
}
