package com.riders.rider

import com.riders.rider.feature.delivery.presentation.RiderMapTheme
import com.riders.rider.feature.delivery.domain.APPROACH_PLACE_ZOOM
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.NEAR_PLACE_ZOOM
import com.riders.rider.feature.delivery.domain.ROUTE_REFRESH_INTERVAL_MS
import com.riders.rider.feature.delivery.domain.STREET_LEVEL_ZOOM
import com.riders.rider.feature.delivery.domain.approachSummary
import com.riders.rider.feature.delivery.domain.collectionCameraFrame
import com.riders.rider.feature.delivery.domain.collectionMarkerPaddingPx
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
        assertEquals(90, collectionMarkerPaddingPx(36f, 2.5f))
        assertEquals(0, collectionMarkerPaddingPx(36f, 0f))
    }

    @Test
    fun showsRoadDistanceAndTimeOnlyWhenTheRouteProvidesBoth() {
        assertEquals("850 m · 3 min", approachSummary(850.0, 180))
        assertEquals("1.5 km · 4 min", approachSummary(1_500.0, 210))
        assertEquals("10 km · < 1 min", approachSummary(10_000.0, 20))
        assertNull(approachSummary(0.0, 0))
        assertNull(approachSummary(null, 180))
        assertNull(approachSummary(850.0, null))
        assertNull(approachSummary(-1.0, 180))
    }

    @Test
    fun dropoffArrivalUsesAFreshFixInsideOneHundredMetresAndDoesNotFlicker() {
        val dropoff = GeoPoint(pickup.latitude + 0.01, pickup.longitude)
        val inside = GeoPoint(dropoff.latitude + 80 / 111_320.0, dropoff.longitude)
        val outside = GeoPoint(dropoff.latitude + 180 / 111_320.0, dropoff.longitude)
        assertTrue(riderReachedDropoff(inside, dropoff))
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
        val nearby = GeoPoint(pickup.latitude + 80 / 111_320.0, pickup.longitude)
        val away = GeoPoint(pickup.latitude + 180 / 111_320.0, pickup.longitude)
        assertTrue(riderReachedPickup(nearby, pickup))
        assertTrue(!riderReachedPickup(away, pickup))
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
