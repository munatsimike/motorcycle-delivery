package com.riders.rider

import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.ROUTE_REFRESH_INTERVAL_MS
import com.riders.rider.feature.delivery.domain.RouteManeuver
import com.riders.rider.feature.delivery.domain.isOffRoute
import com.riders.rider.feature.delivery.domain.reliableBearing
import com.riders.rider.feature.delivery.domain.routeProgress
import com.riders.rider.feature.delivery.domain.shouldReplaceGuidance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnByTurnTest {
    private val path = listOf(
        GeoPoint(0.0, 0.0),
        GeoPoint(0.001, 0.0),
        GeoPoint(0.002, 0.0),
    )
    private val steps = listOf(
        maneuver("Head north", "Straight", "First Road", 0, 1),
        maneuver("Turn left", "Left", "Second Road", 1, 2),
    )

    @Test
    fun movingAlongTheRouteDoesNotCountAsOffRoute() {
        val along = GeoPoint(50.0 / 111_320.0, 0.0)
        assertFalse(isOffRoute(along, path, accuracyMetres = 10f))
        assertFalse(
            shouldReplaceGuidance(
                hasRoute = true,
                offRoute = false,
                nowMillis = 20_000L,
                lastRequestAtMillis = 0L,
            ),
        )
    }

    @Test
    fun replacementWaitsForTheCorridorAndTheInterval() {
        val east = GeoPoint(0.0, 60.0 / 111_320.0)
        assertTrue(isOffRoute(east, path, accuracyMetres = 10f))
        assertFalse(isOffRoute(east, path, accuracyMetres = 60f))
        assertFalse(isOffRoute(east, path, accuracyMetres = null))
        assertTrue(isOffRoute(GeoPoint(0.0, 100.0 / 111_320.0), path, accuracyMetres = 60f))
        assertFalse(
            shouldReplaceGuidance(
                hasRoute = true,
                offRoute = true,
                nowMillis = ROUTE_REFRESH_INTERVAL_MS - 1,
                lastRequestAtMillis = 0L,
            ),
        )
        assertTrue(
            shouldReplaceGuidance(
                hasRoute = true,
                offRoute = true,
                nowMillis = ROUTE_REFRESH_INTERVAL_MS,
                lastRequestAtMillis = 0L,
            ),
        )
        assertTrue(shouldReplaceGuidance(hasRoute = false, offRoute = false, nowMillis = 0L, lastRequestAtMillis = null))
    }

    @Test
    fun progressFollowsTheReturnedManeuver() {
        val start = routeProgress(GeoPoint(0.0, 0.0), path, steps, totalSeconds = 40)
        assertEquals("Head north", start?.instruction)
        assertEquals("First Road", start?.street)
        assertEquals(0, start?.stepIndex)
        val later = routeProgress(GeoPoint(0.0015, 0.0), path, steps, totalSeconds = 40)
        assertEquals("Turn left", later?.instruction)
        assertEquals("Second Road", later?.street)
        assertEquals(1, later?.stepIndex)
        assertTrue((later?.metresToManeuver ?: 0.0) > 40.0)
        assertTrue((later?.remainingMetres ?: 0.0) < (start?.remainingMetres ?: 0.0))
    }

    @Test
    fun bearingIgnoresASlowOrInaccurateFix() {
        assertNull(reliableBearing(speedMetresPerSecond = 1f, bearingDegrees = 90f, bearingAccuracyDegrees = 5f))
        assertNull(reliableBearing(speedMetresPerSecond = 3f, bearingDegrees = 90f, bearingAccuracyDegrees = 50f))
        assertEquals(90f, reliableBearing(speedMetresPerSecond = 3f, bearingDegrees = 90f, bearingAccuracyDegrees = 10f))
        assertEquals(90f, reliableBearing(speedMetresPerSecond = 3f, bearingDegrees = 90f, bearingAccuracyDegrees = null))
    }

    private fun maneuver(text: String, type: String, street: String, fromIndex: Int, toIndex: Int): RouteManeuver {
        return RouteManeuver(
            text = text,
            type = type,
            street = street,
            metres = 111.0,
            seconds = 20.0,
            fromIndex = fromIndex,
            toIndex = toIndex,
            point = path[fromIndex],
        )
    }
}
