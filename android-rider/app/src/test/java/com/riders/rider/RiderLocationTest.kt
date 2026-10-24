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
import com.riders.rider.feature.availability.domain.locationSharingDecision
import com.riders.rider.feature.availability.domain.locationStatuses
import com.riders.rider.feature.availability.domain.locationUpdatePolicy
import com.riders.rider.feature.availability.domain.resumeLocationSharing
import com.riders.rider.feature.availability.domain.shouldRequestAcceptFix
import com.riders.rider.feature.availability.domain.shouldShareLocation
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderLocationTest {
    @Test
    fun availableStartsLocationSharing() {
        assertTrue(shouldShareLocation(hasSession = true, permissionGranted = true, receivingRequests = true))
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = null,
                availability = "AVAILABLE",
            ),
        )
        val policy = locationUpdatePolicy()
        assertEquals(LocationPower.Balanced, policy.power)
        assertEquals(30_000L, policy.intervalMillis)
        assertTrue(policy.intervalMillis + policy.maxUpdateDelayMillis < LOCATION_FRESH_MS)
    }

    @Test
    fun locationUploadsWhileReceivingOrACommittedParcelRemains() {
        assertTrue(shouldShareLocation(hasSession = true, permissionGranted = true, receivingRequests = true))
        assertFalse(shouldShareLocation(hasSession = true, permissionGranted = true, receivingRequests = false, availability = "AVAILABLE"))
        assertFalse(shouldShareLocation(hasSession = true, permissionGranted = true, receivingRequests = false, availability = "OFFLINE"))
        assertFalse(shouldShareLocation(hasSession = true, permissionGranted = true, receivingRequests = null, availability = "OFFLINE"))
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = false,
                deliveryStatuses = listOf("RIDER_ASSIGNED"),
                availability = "AVAILABLE",
            ),
        )
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = false,
                deliveryStatuses = listOf("COLLECTING"),
                availability = "OFFLINE",
            ),
        )
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = false,
                deliveryStatuses = listOf("RIDER_ASSIGNED", "COLLECTED", "OUT_FOR_DELIVERY"),
            ),
        )
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = false,
                deliveryStatuses = listOf("COLLECTING"),
            ),
        )
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = false,
                deliveryStatuses = listOf("DELIVERED", "COLLECTED"),
            ),
        )
        assertFalse(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = false,
                deliveryStatuses = listOf("DELIVERED", "CANCELLED", "RELEASED"),
            ),
        )
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = false,
                deliveryStatuses = listOf("ASSIGNED", "PICKED_UP", "IN_TRANSIT"),
                availability = "BUSY",
            ),
        )
    }

    @Test
    fun offlineStopsLocationSharing() {
        assertFalse(shouldShareLocation(hasSession = true, permissionGranted = true, receivingRequests = null, availability = "OFFLINE"))
    }

    @Test
    fun aFailedLocationRefreshKeepsSharingForACachedCollectingParcel() {
        val cached = locationStatuses(fetchSucceeded = false, fetched = emptyList(), cached = listOf("COLLECTING"))
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = null,
                deliveryStatuses = cached,
                availability = "OFFLINE",
            ),
        )
        val cleared = locationStatuses(fetchSucceeded = true, fetched = emptyList(), cached = listOf("COLLECTING"))
        assertFalse(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = null,
                deliveryStatuses = cleared,
                availability = "OFFLINE",
            ),
        )
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = true,
                deliveryStatuses = locationStatuses(fetchSucceeded = false, fetched = emptyList(), cached = emptyList()),
                availability = "OFFLINE",
            ),
        )
    }

    @Test
    fun aTemporaryOnboardingFailureKeepsSharingForAConfirmedAssignment() {
        assertTrue(
            locationSharingDecision(
                hasSession = true,
                permissionGranted = true,
                onboardingReached = false,
                receivingRequests = null,
                availability = "OFFLINE",
                assignmentFetchSucceeded = true,
                fetchedStatuses = listOf("COLLECTING"),
                confirmedStatuses = emptyList(),
                confirmedThisProcess = true,
            ),
        )
        assertTrue(
            locationSharingDecision(
                hasSession = true,
                permissionGranted = true,
                onboardingReached = false,
                receivingRequests = null,
                availability = null,
                assignmentFetchSucceeded = false,
                fetchedStatuses = emptyList(),
                confirmedStatuses = listOf("COLLECTING"),
                confirmedThisProcess = true,
            ),
        )
    }

    @Test
    fun anUnconfirmedRestartDoesNotShareFromStaleAssignments() {
        assertFalse(
            locationSharingDecision(
                hasSession = true,
                permissionGranted = true,
                onboardingReached = false,
                receivingRequests = null,
                availability = null,
                assignmentFetchSucceeded = false,
                fetchedStatuses = emptyList(),
                confirmedStatuses = listOf("COLLECTING"),
                confirmedThisProcess = false,
            ),
        )
        assertFalse(
            locationSharingDecision(
                hasSession = true,
                permissionGranted = true,
                onboardingReached = true,
                receivingRequests = null,
                availability = "OFFLINE",
                assignmentFetchSucceeded = true,
                fetchedStatuses = emptyList(),
                confirmedStatuses = listOf("COLLECTING"),
                confirmedThisProcess = true,
            ),
        )
    }

    @Test
    fun logoutSessionExpiryAndPermissionLossStopSharing() {
        assertFalse(
            locationSharingDecision(
                hasSession = false,
                permissionGranted = true,
                onboardingReached = true,
                receivingRequests = true,
                availability = "AVAILABLE",
                assignmentFetchSucceeded = true,
                fetchedStatuses = listOf("COLLECTING"),
                confirmedStatuses = listOf("COLLECTING"),
                confirmedThisProcess = true,
            ),
        )
        assertFalse(
            locationSharingDecision(
                hasSession = true,
                permissionGranted = true,
                onboardingReached = true,
                receivingRequests = true,
                availability = "AVAILABLE",
                assignmentFetchSucceeded = true,
                fetchedStatuses = listOf("COLLECTING"),
                confirmedStatuses = listOf("COLLECTING"),
                confirmedThisProcess = true,
                authoritativeStop = true,
            ),
        )
        assertFalse(
            locationSharingDecision(
                hasSession = true,
                permissionGranted = false,
                onboardingReached = true,
                receivingRequests = true,
                availability = "AVAILABLE",
                assignmentFetchSucceeded = true,
                fetchedStatuses = listOf("COLLECTING"),
                confirmedStatuses = listOf("COLLECTING"),
                confirmedThisProcess = true,
            ),
        )
    }

    @Test
    fun busyWithoutACommitmentStopsLocationSharing() {
        assertFalse(shouldShareLocation(hasSession = true, permissionGranted = true, receivingRequests = null, availability = "BUSY"))
        assertFalse(shouldShareLocation(hasSession = true, permissionGranted = true, receivingRequests = false, availability = "BUSY"))
    }

    @Test
    fun sessionInvalidationStopsSharing() {
        assertFalse(shouldShareLocation(hasSession = false, permissionGranted = true, receivingRequests = true))
        assertEquals(LocationCommand.Stop, commandAfterUploadFailure(ApiError.SessionEnded))
        assertEquals(LocationCommand.Stop, commandAfterUploadFailure(ApiError.Forbidden))
        assertEquals(LocationCommand.KeepSharing, commandAfterUploadFailure(ApiError.Network))
    }

    @Test
    fun permissionLossStopsSharing() {
        assertFalse(shouldShareLocation(hasSession = true, permissionGranted = false, receivingRequests = true, deliveryStatuses = listOf("COLLECTING")))
    }

    @Test
    fun serviceRestartRequiresSessionAndServerAvailability() {
        assertFalse(
            resumeLocationSharing(
                hasSession = true,
                permissionGranted = true,
                serverAvailability = null,
                receivingRequests = null,
                deliveryStatuses = emptyList(),
                locallyEnabled = true,
            ),
        )
        assertFalse(
            resumeLocationSharing(
                hasSession = false,
                permissionGranted = true,
                serverAvailability = "AVAILABLE",
                receivingRequests = true,
                deliveryStatuses = emptyList(),
                locallyEnabled = true,
            ),
        )
        assertFalse(
            resumeLocationSharing(
                hasSession = true,
                permissionGranted = true,
                serverAvailability = "BUSY",
                receivingRequests = null,
                deliveryStatuses = emptyList(),
                locallyEnabled = true,
            ),
        )
        assertTrue(
            resumeLocationSharing(
                hasSession = true,
                permissionGranted = true,
                serverAvailability = "AVAILABLE",
                receivingRequests = null,
                deliveryStatuses = emptyList(),
                locallyEnabled = false,
            ),
        )
        assertTrue(
            resumeLocationSharing(
                hasSession = true,
                permissionGranted = true,
                serverAvailability = "OFFLINE",
                receivingRequests = false,
                deliveryStatuses = listOf("OUT_FOR_DELIVERY"),
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

    @Test
    fun aStaleAcceptAsksForOneFixOnlyWhileAvailable() {
        assertTrue(shouldRequestAcceptFix("AVAILABLE", locationIsFresh = false))
        assertFalse(shouldRequestAcceptFix("AVAILABLE", locationIsFresh = true))
        assertFalse(shouldRequestAcceptFix("BUSY", locationIsFresh = false))
        assertFalse(shouldRequestAcceptFix("OFFLINE", locationIsFresh = false))
        assertFalse(shouldRequestAcceptFix(null, locationIsFresh = false))
    }
}
