package com.riders.rider

import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LOCATION_MAX_FIX_AGE_MS
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.LiveMapLegCache
import com.riders.rider.feature.delivery.domain.LiveMapLegKey
import com.riders.rider.feature.delivery.domain.MapPositionTracker
import com.riders.rider.feature.delivery.domain.MAP_OFF_ROUTE_REFRESH_MS
import com.riders.rider.feature.delivery.domain.ROUTE_REFRESH_INTERVAL_MS
import com.riders.rider.feature.delivery.domain.TravelHeadingTracker
import com.riders.rider.feature.delivery.domain.routeCalculationFix
import com.riders.rider.feature.delivery.domain.shouldRefreshLiveMapRoute
import com.riders.rider.feature.delivery.domain.shouldReplaceGuidance
import org.junit.Assert.*
import org.junit.Test

class LiveMapTrackingTest {
    private fun point(north: Double, east: Double = 0.0) = GeoPoint(north / 111_320, east / 111_320)
    private val origin = point(0.0)
    private val road = listOf(origin, point(200.0), point(400.0))

    @Test fun firstRouteAndRoutineMovement() {
        assertTrue(shouldRefreshLiveMapRoute(null, origin, null, 0, emptyList(), 5f))
        assertFalse(shouldRefreshLiveMapRoute(origin, point(70.0), 0, 8_000, road, 5f))
        assertTrue(shouldRefreshLiveMapRoute(origin, point(70.0), 0, ROUTE_REFRESH_INTERVAL_MS, road, 5f))
        assertFalse(shouldRefreshLiveMapRoute(origin, point(5.0), 0, 60_000, road, 5f))
    }

    @Test fun deviationCanRefreshEarlierButIsThrottled() {
        val off = point(0.0, 60.0)
        assertFalse(shouldRefreshLiveMapRoute(origin, off, 0, MAP_OFF_ROUTE_REFRESH_MS - 1, road, 5f))
        assertTrue(shouldRefreshLiveMapRoute(origin, off, 0, MAP_OFF_ROUTE_REFRESH_MS, road, 5f))
        assertFalse(shouldRefreshLiveMapRoute(origin, off, 0, MAP_OFF_ROUTE_REFRESH_MS, road, 60f))
        assertFalse(shouldRefreshLiveMapRoute(origin, point(0.0, 100.0), 0, MAP_OFF_ROUTE_REFRESH_MS, road, 120f))
    }

    @Test fun parallelStreetRefreshesWhenTheFixIsPrecise() {
        val parallel = point(0.0, 30.0)
        assertTrue(shouldRefreshLiveMapRoute(origin, parallel, 0, MAP_OFF_ROUTE_REFRESH_MS, road, 10f))
        assertFalse(shouldRefreshLiveMapRoute(origin, parallel, 0, MAP_OFF_ROUTE_REFRESH_MS - 1, road, 10f))
        assertFalse(shouldRefreshLiveMapRoute(origin, point(0.0, 20.0), 0, MAP_OFF_ROUTE_REFRESH_MS, road, 10f))
    }

    @Test fun gpsDriftInsideThePreciseCorridorDoesNotRefreshEarly() {
        val drift = point(0.0, 10.0)
        assertFalse(shouldRefreshLiveMapRoute(origin, drift, 0, MAP_OFF_ROUTE_REFRESH_MS, road, 12f))
        assertFalse(shouldRefreshLiveMapRoute(origin, point(0.0, 30.0), 0, MAP_OFF_ROUTE_REFRESH_MS, road, 20f))
        assertTrue(shouldRefreshLiveMapRoute(origin, point(0.0, 50.0), 0, MAP_OFF_ROUTE_REFRESH_MS, road, 20f))
        assertFalse(shouldRefreshLiveMapRoute(origin, point(0.0, 50.0), 0, MAP_OFF_ROUTE_REFRESH_MS, road, 50f))
    }

    @Test fun rejectedResponsesStayOnTheRefreshCooldown() {
        val rejectedAt = 9_000L
        val off = point(0.0, 30.0)
        assertFalse(shouldRefreshLiveMapRoute(origin, off, rejectedAt, rejectedAt + 1_000L, road, 10f))
        assertFalse(shouldRefreshLiveMapRoute(origin, off, rejectedAt, rejectedAt + MAP_OFF_ROUTE_REFRESH_MS - 1, road, 10f))
        assertTrue(shouldRefreshLiveMapRoute(origin, off, rejectedAt, rejectedAt + MAP_OFF_ROUTE_REFRESH_MS, road, 10f))
        assertFalse(shouldRefreshLiveMapRoute(null, origin, rejectedAt, rejectedAt + MAP_OFF_ROUTE_REFRESH_MS, emptyList(), 10f))
        assertTrue(shouldRefreshLiveMapRoute(null, origin, rejectedAt, rejectedAt + ROUTE_REFRESH_INTERVAL_MS, emptyList(), 10f))
        assertFalse(shouldReplaceGuidance(hasRoute = false, offRoute = false, nowMillis = rejectedAt + 1_000L, lastRequestAtMillis = rejectedAt))
        assertTrue(shouldReplaceGuidance(hasRoute = false, offRoute = false, nowMillis = rejectedAt + ROUTE_REFRESH_INTERVAL_MS, lastRequestAtMillis = rejectedAt))
    }

    @Test fun returningToTheMapResumesAnOffRouteRefresh() {
        val awayFor = 60_000L
        assertTrue(shouldRefreshLiveMapRoute(origin, point(0.0, 30.0), 0, awayFor, road, 10f))
        assertFalse(shouldRefreshLiveMapRoute(origin, point(20.0), 0, awayFor, road, 10f))
        assertTrue(shouldRefreshLiveMapRoute(origin, point(50.0), 0, awayFor, road, 10f))
    }

    @Test fun routeCalculationUsesTheFreshRawFix() {
        val raw = GpsFix(latitude = 0.0, longitude = 0.0, accuracyMetres = 12f)
        assertEquals(raw, routeCalculationFix(raw, 1_000L))
        assertNull(routeCalculationFix(raw, LOCATION_MAX_FIX_AGE_MS + 1))
        assertNull(routeCalculationFix(raw.copy(accuracyMetres = 120f), 1_000L))
        assertNull(routeCalculationFix(null, 1_000L))
    }

    @Test fun fallbackAccumulatesWalkingDisplacementAndTurns() {
        val tracker = TravelHeadingTracker()
        assertNull(tracker.update(origin, 0, 3f, 1f, null, null))
        assertNull(tracker.update(point(0.0, 6.0), 6_000, 3f, 1f, null, null))
        assertEquals(90f, tracker.update(point(0.0, 16.0), 16_000, 3f, 1f, null, null)!!, 1f)
        assertEquals(180f, tracker.update(point(-16.0, 16.0), 29_000, 3f, 1f, null, null)!!, 1f)
    }

    @Test fun prefersProviderBearingAndDoesNotTurnOnNoiseOrOldFixes() {
        val tracker = TravelHeadingTracker()
        assertEquals(270f, tracker.update(origin, 1_000, 5f, 5f, 270f, 5f)!!, 1f)
        assertEquals(270f, tracker.update(point(4.0), 2_000, 5f, 0f, null, null)!!, 1f)
        assertEquals(270f, tracker.update(point(60.0), 3_000, 90f, null, null, null)!!, 1f)
        assertEquals(270f, tracker.update(point(0.0, 60.0), 2_000, 5f, 5f, 90f, 5f)!!, 1f)
        tracker.reset()
        assertNull(tracker.update(origin, 4_000, 5f, 0f, null, null))
    }

    @Test fun staleAnchorAndImplausibleJumpDoNotTurnMap() {
        val tracker = TravelHeadingTracker()
        assertNull(tracker.update(origin, 0, 4f, null, null, null))
        assertNull(tracker.update(point(0.0, 80.0), 40_000, 4f, null, null, null))
        assertNull(tracker.update(point(0.0, 300.0), 41_000, 4f, null, null, null))
    }

    @Test fun stationaryDriftDoesNotMoveDisplay() {
        val tracker = MapPositionTracker()
        assertEquals(origin, tracker.update(origin, 0, 5f, 0f, false))
        assertEquals(origin, tracker.update(point(7.0), 2_000, 5f, 0f, false))
        assertEquals(origin, tracker.update(point(-10.0), 4_000, 8f, 0f, false))
        assertEquals(origin, tracker.update(point(0.0, 90.0), 6_000, 90f, null, false))
        assertEquals(origin, tracker.update(point(0.0, 8.0), 8_000, 5f, null, false))
    }

    @Test fun movementStillAdvancesAndCanTurn() {
        val tracker = MapPositionTracker()
        assertEquals(origin, tracker.update(origin, 0, 5f, 4f, false))
        assertEquals(origin, tracker.update(point(2.0), 2_000, 5f, 4f, false))
        assertEquals(point(7.0), tracker.update(point(7.0), 4_000, 5f, 4f, false))
        assertEquals(point(7.0, 12.0), tracker.update(point(7.0, 12.0), 6_000, 5f, 4f, false))
    }

    @Test fun confirmedArrivalHoldsPositionUntilNewLeg() {
        val tracker = MapPositionTracker()
        tracker.update(origin, 0, 5f, 2f, false)
        val arrival = point(30.0)
        assertEquals(arrival, tracker.update(arrival, 2_000, 5f, 1f, true))
        assertEquals(arrival, tracker.update(point(60.0), 4_000, 5f, 4f, true))
        assertEquals(arrival, tracker.update(point(-70.0), 6_000, 100f, null, true))
        tracker.reset()
        assertEquals(point(60.0), tracker.update(point(60.0), 8_000, 5f, 4f, false))
    }

    @Test fun oldFixAndPoorAccuracyDoNotMoveDisplay() {
        val tracker = MapPositionTracker()
        assertEquals(origin, tracker.update(origin, 10_000, 5f, 4f, false))
        assertEquals(origin, tracker.update(point(50.0), 9_000, 5f, 4f, false))
        assertEquals(origin, tracker.update(point(100.0), 12_000, 80f, 4f, false))
    }
    @Test fun smallHeadingChangesDoNotRotateMap() {
        val tracker = TravelHeadingTracker()
        assertEquals(358f, tracker.update(origin, 0, 5f, 4f, 358f, 5f)!!, 1f)
        assertEquals(358f, tracker.update(point(10.0), 2_000, 5f, 4f, 3f, 5f)!!, 1f)
        assertEquals(30f, tracker.update(point(20.0), 4_000, 5f, 4f, 30f, 5f)!!, 1f)
    }

    @Test fun finalTurnAtArrivalIsRetainedEvenWithHeldPosition() {
        val heading = TravelHeadingTracker()
        val position = MapPositionTracker()
        assertEquals(180f, heading.update(origin, 0, 5f, 4f, 180f, 5f)!!, 1f)
        position.update(origin, 0, 5f, 4f, false)
        val arrival = point(2.0)
        assertEquals(origin, position.update(arrival, 2_000, 5f, 4f, true))
        assertEquals(0f, heading.update(arrival, 2_000, 5f, 4f, 0f, 5f, arrived = true)!!, 1f)
        assertEquals(0f, heading.update(point(20.0), 4_000, 5f, 4f, 90f, 5f, arrived = true)!!, 1f)
        heading.reset()
        assertEquals(90f, heading.update(point(20.0), 6_000, 5f, 4f, 90f, 5f)!!, 1f)
    }

    @Test fun arrivalCanUseMovementFallbackAndThenFreeze() {
        val tracker = TravelHeadingTracker()
        assertNull(tracker.update(origin, 0, 3f, 1f, null, null))
        assertEquals(0f, tracker.update(point(16.0), 16_000, 3f, 1f, null, null, arrived = true)!!, 1f)
        assertEquals(0f, tracker.update(point(16.0, 30.0), 20_000, 3f, 5f, 90f, 5f)!!, 1f)
    }

    @Test fun stationaryArrivalDoesNotReplaceLastDirection() {
        val tracker = TravelHeadingTracker()
        assertEquals(270f, tracker.update(origin, 0, 5f, 4f, 270f, 5f)!!, 1f)
        assertEquals(270f, tracker.update(point(2.0), 2_000, 5f, 0f, 90f, 5f, arrived = true)!!, 1f)
        assertEquals(270f, tracker.update(point(20.0), 4_000, 5f, 4f, 90f, 5f)!!, 1f)
    }

    @Test fun repeatedReopeningRetainsArrivalPositionAndHeading() {
        val cache = LiveMapLegCache()
        val key = LiveMapLegKey("assignment-1", true, point(50.0))
        val first = cache.get("owner", key)
        first.update(origin, 0, 5f, 4f, 0f, 5f, false, road)
        val arrival = point(30.0)
        first.update(arrival, 2_000, 5f, 4f, 0f, 5f, true, road)
        repeat(5) { n ->
            val reopened = cache.get("owner", key)
            reopened.update(point(31.0 + n), 4_000L + n * 2_000L, 7f, 0f, 180f, 5f, true, emptyList())
            reopened.chooseHeading(listOf(origin, point(-200.0)))
            assertTrue(reopened.arrived)
            assertEquals(arrival, reopened.point)
            assertEquals(0f, reopened.heading!!, 0f)
        }
    }

    @Test fun reopeningWithoutTravelBearingKeepsFallback() {
        val cache = LiveMapLegCache()
        val key = LiveMapLegKey("assignment-1", false, point(50.0))
        val first = cache.get("owner", key)
        first.update(origin, 0, 5f, 0f, null, null, true, listOf(origin, point(0.0, 100.0)))
        val reopened = cache.get("owner", key)
        reopened.update(point(10.0), 2_000, 5f, 0f, null, null, true, emptyList())
        assertEquals(origin, reopened.point)
        assertEquals(90f, reopened.heading!!, 1f)
    }

    @Test fun reopeningBeforeArrivalFiltersDriftButAllowsMovement() {
        val cache = LiveMapLegCache()
        val key = LiveMapLegKey("assignment-1", false, point(400.0))
        cache.get("owner", key).update(origin, 0, 5f, 4f, 0f, 5f, false, road)
        val reopened = cache.get("owner", key)
        reopened.update(point(7.0), 2_000, 5f, 0f, null, null, false, emptyList())
        assertEquals(origin, reopened.point)
        assertEquals(0f, reopened.heading!!, 0f)
        reopened.update(point(0.0, 30.0), 4_000, 5f, 4f, 90f, 5f, false, emptyList())
        assertEquals(point(0.0, 30.0), reopened.point)
        assertEquals(90f, reopened.heading!!, 0f)
        assertFalse(reopened.arrived)
    }

    @Test fun separateAssignmentsStagesTargetsAndSessionsDoNotShareArrival() {
        val cache = LiveMapLegCache()
        val key = LiveMapLegKey("assignment-1", false, origin)
        cache.get("owner", key).update(origin, 0, 5f, 0f, null, null, true, emptyList())
        for (different in listOf(key.copy(dropoff = true), key.copy(assignmentId = "assignment-2"), key.copy(stop = point(30.0)))) {
            assertFalse(cache.get("owner", different).arrived)
            assertNull(cache.get("owner", different).point)
        }
        assertTrue(cache.get("owner", key).arrived)
        assertFalse(cache.get("another-owner", key).arrived)
        assertFalse(cache.get("owner", key).arrived)
        cache.get("owner", key).update(origin, 0, 5f, 0f, null, null, true, emptyList())
        cache.clear()
        assertNull(cache.get("owner", key).point)
    }

    @Test fun cacheIsBoundedAndRetainsRecentlyOpenedLegs() {
        val cache = LiveMapLegCache(2)
        val first = LiveMapLegKey("one", false, origin)
        val second = first.copy(assignmentId = "two")
        val third = first.copy(assignmentId = "three")
        val held = cache.get("owner", first)
        val evicted = cache.get("owner", second)
        assertTrue(held === cache.get("owner", first))
        cache.get("owner", third)
        assertTrue(held === cache.get("owner", first))
        assertFalse(evicted === cache.get("owner", second))
    }

    @Test fun coldArrivalUsesLegDirectionNotReversedGpsOffset() {
        val cache = LiveMapLegCache()
        val pickup = point(200.0)
        val stop = origin
        val key = LiveMapLegKey("assignment-1", true, stop)
        val first = cache.get("owner", key)
        // Rider is just south of the stop: the vector back to the pin points north.
        first.update(point(-10.0), 0, 5f, 0f, null, null, true, emptyList(), pickup)
        assertEquals(180f, first.heading!!, 0.1f)
        repeat(5) { n ->
            val reopened = cache.get("owner", key)
            reopened.update(point(5.0 + n), 2_000L + n * 2_000L, 5f, 0f, null, null,
                true, emptyList(), pickup)
            assertEquals(180f, reopened.heading!!, 0.1f)
            assertEquals(point(-10.0), reopened.point)
        }
    }

    @Test fun actualArrivalHeadingWinsEvenWhenPickupIsAhead() {
        val pickup = point(200.0)
        val state = LiveMapLegCache().get("owner", LiveMapLegKey("one", true, origin))
        state.update(point(-70.0), 0, 5f, 4f, 0f, 5f, false, emptyList(), pickup)
        state.update(point(-30.0), 10_000, 5f, 4f, 0f, 5f, true, emptyList(), pickup)
        assertEquals(0f, state.heading!!, 0.1f)
        state.update(point(10.0), 12_000, 5f, 0f, null, null, true, emptyList(), pickup)
        assertEquals(0f, state.heading!!, 0.1f)
    }

    @Test fun arrivalWithoutTravelReplacesProvisionalRouteHeading() {
        val pickup = point(200.0)
        val state = LiveMapLegCache().get("owner", LiveMapLegKey("one", true, origin))
        state.update(point(70.0), 0, 5f, 0f, null, null, false,
            listOf(point(70.0), point(100.0)), pickup)
        assertEquals(0f, state.heading!!, 0.1f)
        state.update(point(30.0), 40_000, 5f, 0f, null, null, true, emptyList(), pickup)
        assertEquals(180f, state.heading!!, 0.1f)
    }

    @Test fun arrivalAtIdenticalStopWithoutOriginOrMotionIsDeterministic() {
        val state = LiveMapLegCache().get("owner", LiveMapLegKey("one", false, origin))
        state.update(origin, 0, 5f, 0f, null, null, true, emptyList())
        assertEquals(0f, state.heading!!, 0.1f)
        state.update(point(0.0, 5.0), 2_000, 5f, 0f, null, null, true, emptyList())
        assertEquals(0f, state.heading!!, 0.1f)
    }

}
