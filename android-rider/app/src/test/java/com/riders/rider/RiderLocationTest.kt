package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LocationCommand
import com.riders.rider.feature.availability.domain.LocationFreshness
import com.riders.rider.feature.availability.domain.LocationPower
import com.riders.rider.feature.availability.domain.LocationRelay
import com.riders.rider.feature.availability.domain.LOCATION_FRESH_MS
import com.riders.rider.feature.availability.domain.commandAfterUploadFailure
import com.riders.rider.feature.availability.domain.isDispatchUsable
import com.riders.rider.feature.availability.domain.locationIsFresh
import com.riders.rider.feature.availability.domain.locationUpdatePolicy
import com.riders.rider.feature.availability.domain.resumeLocationSharing
import com.riders.rider.feature.availability.domain.shouldShareLocation
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderLocationTest {
    @Test
    fun availableStartsLocationSharing() {
        assertTrue(shouldShareLocation("AVAILABLE", hasSession = true, permissionGranted = true))
        val policy = locationUpdatePolicy()
        assertEquals(LocationPower.Balanced, policy.power)
        assertEquals(30_000L, policy.intervalMillis)
        assertTrue(policy.intervalMillis + policy.maxUpdateDelayMillis < LOCATION_FRESH_MS)
    }

    @Test
    fun offlineStopsLocationSharing() {
        assertFalse(shouldShareLocation("OFFLINE", hasSession = true, permissionGranted = true))
    }

    @Test
    fun busyStopsLocationSharing() {
        assertFalse(shouldShareLocation("BUSY", hasSession = true, permissionGranted = true))
    }

    @Test
    fun sessionInvalidationStopsSharing() {
        assertFalse(shouldShareLocation("AVAILABLE", hasSession = false, permissionGranted = true))
        assertEquals(LocationCommand.Stop, commandAfterUploadFailure(ApiError.SessionEnded))
        assertEquals(LocationCommand.Stop, commandAfterUploadFailure(ApiError.Forbidden))
        assertEquals(LocationCommand.KeepSharing, commandAfterUploadFailure(ApiError.Network))
    }

    @Test
    fun permissionLossStopsSharing() {
        assertFalse(shouldShareLocation("AVAILABLE", hasSession = true, permissionGranted = false))
    }

    @Test
    fun serviceRestartRequiresSessionAndServerAvailability() {
        assertFalse(
            resumeLocationSharing(
                hasSession = true,
                permissionGranted = true,
                serverAvailability = null,
                locallyEnabled = true,
            ),
        )
        assertFalse(
            resumeLocationSharing(
                hasSession = false,
                permissionGranted = true,
                serverAvailability = "AVAILABLE",
                locallyEnabled = true,
            ),
        )
        assertFalse(
            resumeLocationSharing(
                hasSession = true,
                permissionGranted = true,
                serverAvailability = "BUSY",
                locallyEnabled = true,
            ),
        )
        assertTrue(
            resumeLocationSharing(
                hasSession = true,
                permissionGranted = true,
                serverAvailability = "AVAILABLE",
                locallyEnabled = false,
            ),
        )
    }

    @Test
    fun freshLocationIsRequiredBeforeAcceptingOffers() {
        val freshness = LocationFreshness()
        assertFalse(freshness.canAccept(1_000L))
        assertFalse(locationIsFresh(60_000L, confirmedAtMillis = 0L))
        freshness.markConfirmed(1_000L)
        assertTrue(freshness.canAccept(60_999L))
        assertFalse(freshness.canAccept(61_000L))
        freshness.invalidate()
        assertFalse(freshness.canAccept(61_000L))
    }

    @Test
    fun poorOrStaleFixesAreNotUploaded() = runTest {
        var now = 0L
        val relay = LocationRelay(clock = { now })
        val fix = GpsFix(-17.8252, 31.0335)
        var attempts = 0
        var uploads = 0
        assertFalse(relay.handle(active = true, fix, ageMillis = 46_000L, accuracyMeters = 20f) { attempts += 1; true })
        assertFalse(relay.handle(active = true, fix, ageMillis = 1_000L, accuracyMeters = 2_000f) { attempts += 1; true })
        assertEquals(0, attempts)
        assertTrue(isDispatchUsable(1_000L, 100f))
        assertTrue(relay.handle(active = true, fix, ageMillis = 1_000L, accuracyMeters = 100f) { attempts += 1; uploads += 1; true })
        assertFalse(relay.handle(active = true, fix, ageMillis = 1_000L, accuracyMeters = 100f) { attempts += 1; true })
        now += 25_000L
        assertFalse(relay.handle(active = true, fix, ageMillis = 1_000L, accuracyMeters = 100f) { attempts += 1; false })
        now += 10_000L
        assertTrue(relay.handle(active = true, fix, ageMillis = 1_000L, accuracyMeters = 100f) { attempts += 1; uploads += 1; true })
        assertEquals(3, attempts)
        assertEquals(2, uploads)
    }
}
