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
import com.riders.rider.feature.availability.domain.SharingAction
import com.riders.rider.feature.availability.domain.LocationNotice
import com.riders.rider.feature.availability.domain.LocationPermissionAction
import com.riders.rider.feature.availability.domain.LocationUploadFailure
import com.riders.rider.feature.availability.domain.LOCATION_ACQUISITION_GRACE_MS
import com.riders.rider.feature.availability.domain.classifyLocationNotice
import com.riders.rider.feature.availability.domain.locationAcquisitionOpen
import com.riders.rider.feature.availability.domain.locationPermissionAction
import com.riders.rider.feature.availability.domain.locationSharingPaused
import com.riders.rider.feature.availability.domain.locationUploadFailure
import com.riders.rider.feature.availability.domain.noticeAfterConnectivityRestored
import com.riders.rider.feature.availability.domain.resumeLocationSharing
import com.riders.rider.feature.availability.domain.sharingRecovery
import com.riders.rider.feature.availability.domain.shouldRequestAcceptFix
import com.riders.rider.feature.availability.domain.shouldShareLocation
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
        assertFalse(shouldShareLocation(hasSession = true, permissionGranted = true, receivingRequests = true, availability = "OFFLINE"))
        assertTrue(
            shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = true,
                deliveryStatuses = listOf("COLLECTING"),
                availability = "OFFLINE",
            ),
        )
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
        assertFalse(
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
        assertEquals(LocationCommand.Stop, commandAfterUploadFailure(ApiError.SignedInElsewhere))
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
    fun visibleRecoveryDoesNotStartFromAFailedRefresh() {
        assertEquals(
            SharingAction.Keep,
            sharingRecovery(
                serverReached = false,
                shouldShare = false,
                permissionGranted = true,
                serviceRunning = false,
                uploadFresh = false,
                userRetry = false,
            ),
        )
        assertEquals(
            SharingAction.Start,
            sharingRecovery(
                serverReached = true,
                shouldShare = true,
                permissionGranted = true,
                serviceRunning = false,
                uploadFresh = false,
                userRetry = false,
            ),
        )
        assertEquals(
            SharingAction.Keep,
            sharingRecovery(
                serverReached = true,
                shouldShare = true,
                permissionGranted = true,
                serviceRunning = true,
                uploadFresh = false,
                userRetry = false,
            ),
        )
        assertEquals(
            SharingAction.Start,
            sharingRecovery(
                serverReached = true,
                shouldShare = true,
                permissionGranted = true,
                serviceRunning = true,
                uploadFresh = false,
                userRetry = true,
            ),
        )
        assertEquals(
            SharingAction.Stop,
            sharingRecovery(
                serverReached = true,
                shouldShare = false,
                permissionGranted = true,
                serviceRunning = true,
                uploadFresh = true,
                userRetry = false,
            ),
        )
        assertEquals(
            SharingAction.Keep,
            sharingRecovery(
                serverReached = true,
                shouldShare = true,
                permissionGranted = false,
                serviceRunning = false,
                uploadFresh = false,
                userRetry = true,
            ),
        )
    }

    @Test
    fun locationWarningClearsOnlyWhenSharingIsHealthy() {
        assertTrue(
            locationSharingPaused(
                serverReached = true,
                shouldShare = true,
                permissionGranted = true,
                serviceRunning = false,
                uploadFresh = false,
                previouslyEnabled = true,
            ),
        )
        assertTrue(
            locationSharingPaused(
                serverReached = true,
                shouldShare = true,
                permissionGranted = true,
                serviceRunning = true,
                uploadFresh = false,
                previouslyEnabled = true,
            ),
        )
        assertTrue(
            locationSharingPaused(
                serverReached = false,
                shouldShare = false,
                permissionGranted = true,
                serviceRunning = false,
                uploadFresh = false,
                previouslyEnabled = true,
            ),
        )
        assertFalse(
            locationSharingPaused(
                serverReached = false,
                shouldShare = false,
                permissionGranted = true,
                serviceRunning = false,
                uploadFresh = false,
                previouslyEnabled = false,
            ),
        )
        assertFalse(
            locationSharingPaused(
                serverReached = true,
                shouldShare = true,
                permissionGranted = true,
                serviceRunning = true,
                uploadFresh = true,
                previouslyEnabled = true,
            ),
        )
        assertFalse(
            locationSharingPaused(
                serverReached = true,
                shouldShare = false,
                permissionGranted = true,
                serviceRunning = false,
                uploadFresh = false,
                previouslyEnabled = true,
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

    @Test
    fun locationNoticeMatchesTheKnownFailure() {
        assertEquals(LocationNotice.PermissionMissing, classify(permissionGranted = false))
        assertEquals(LocationNotice.LocationDisabled, classify(providersEnabled = false, sawUnusableFix = true))
        assertEquals(LocationNotice.WaitingForFix, classify())
        assertEquals(LocationNotice.FixUnavailable, classify(sawUnusableFix = true))
        assertEquals(LocationNotice.WaitingForFix, classify(sawUnusableFix = true, nowMillis = 1_000L, acquisitionStartedAtMillis = 1_000L))
        assertEquals(
            LocationNotice.FixUnavailable,
            classify(
                sawUnusableFix = true,
                nowMillis = 1_000L + LOCATION_ACQUISITION_GRACE_MS,
                acquisitionStartedAtMillis = 1_000L,
            ),
        )
        assertEquals(LocationNotice.PermissionMissing, classify(permissionGranted = false, nowMillis = 0L, acquisitionStartedAtMillis = 0L))
        assertEquals(LocationNotice.LocationDisabled, classify(providersEnabled = false, nowMillis = 0L, acquisitionStartedAtMillis = 0L))
        assertNull(classify(uploadFresh = true, sawUnusableFix = true, nowMillis = 2_000L, acquisitionStartedAtMillis = 1_000L))
        assertTrue(locationAcquisitionOpen(14_999L, 0L))
        assertFalse(locationAcquisitionOpen(15_000L, 0L))
        assertTrue(locationAcquisitionOpen(20_000L, 10_000L))
        assertEquals(LocationNotice.WaitingForFix, classify(nowMillis = 1_000L, acquisitionStartedAtMillis = 1_000L))
        assertEquals(LocationNotice.FixUnavailable, classify(nowMillis = 16_000L, acquisitionStartedAtMillis = 1_000L))
        assertEquals(LocationNotice.NoInternet, classify(failure = LocationUploadFailure.Network))
        assertEquals(LocationNotice.UploadPending, classify(failure = LocationUploadFailure.Recoverable))
        assertEquals(LocationNotice.ServiceStopped, classify(serviceRunning = false))
        assertNull(classify(showWarning = false, serviceRunning = false))
        assertNull(classify(failure = LocationUploadFailure.Rejected, serviceRunning = false))
        assertEquals(LocationNotice.FixUnavailable, classify(serverReached = false, sharingRequired = false))
        assertNull(
            classify(
                uploadFresh = true,
                failure = LocationUploadFailure.None,
                sawUnusableFix = false,
            ),
        )
    }

    @Test
    fun permissionPromptIsNotRepeatedAfterAPermanentDenial() {
        assertEquals(LocationPermissionAction.Request, locationPermissionAction(granted = false, asked = false, shouldShowRationale = false))
        assertEquals(LocationPermissionAction.Request, locationPermissionAction(granted = false, asked = true, shouldShowRationale = true))
        assertEquals(LocationPermissionAction.Settings, locationPermissionAction(granted = false, asked = true, shouldShowRationale = false))
        assertEquals(LocationPermissionAction.None, locationPermissionAction(granted = true, asked = true, shouldShowRationale = false))
    }

    @Test
    fun uploadFailuresAreClassifiedWithoutGuessing() {
        assertEquals(LocationUploadFailure.Network, locationUploadFailure(ApiError.Network))
        assertEquals(LocationUploadFailure.Network, locationUploadFailure(ApiError.Timeout))
        assertEquals(LocationUploadFailure.Rejected, locationUploadFailure(ApiError.SessionEnded))
        assertEquals(LocationUploadFailure.Rejected, locationUploadFailure(ApiError.SignedInElsewhere))
        assertEquals(LocationUploadFailure.Rejected, locationUploadFailure(ApiError.Forbidden))
        assertEquals(LocationUploadFailure.Recoverable, locationUploadFailure(ApiError.Unexpected("upload failed")))
    }

    @Test
    fun connectivityRestoresOnlyANetworkUploadFailure() {
        assertEquals(LocationUploadFailure.Recoverable, noticeAfterConnectivityRestored(LocationUploadFailure.Network))
        assertEquals(LocationUploadFailure.Recoverable, noticeAfterConnectivityRestored(LocationUploadFailure.Recoverable))
        assertEquals(LocationUploadFailure.Rejected, noticeAfterConnectivityRestored(LocationUploadFailure.Rejected))
        assertEquals(LocationUploadFailure.None, noticeAfterConnectivityRestored(LocationUploadFailure.None))
        assertEquals(
            LocationNotice.UploadPending,
            classify(failure = noticeAfterConnectivityRestored(LocationUploadFailure.Network)),
        )
        assertEquals(
            SharingAction.Keep,
            sharingRecovery(
                serverReached = true,
                shouldShare = true,
                permissionGranted = true,
                serviceRunning = true,
                uploadFresh = false,
                userRetry = false,
            ),
        )
    }

    @Test
    fun aRunningServiceIsNotOfferedARestart() {
        assertEquals(LocationNotice.WaitingForFix, classify(serviceRunning = true, uploadFresh = false))
        assertEquals(
            SharingAction.Keep,
            sharingRecovery(
                serverReached = true,
                shouldShare = true,
                permissionGranted = true,
                serviceRunning = true,
                uploadFresh = false,
                userRetry = false,
            ),
        )
        assertEquals(
            SharingAction.Keep,
            sharingRecovery(
                serverReached = true,
                shouldShare = true,
                permissionGranted = false,
                serviceRunning = false,
                uploadFresh = false,
                userRetry = true,
            ),
        )
    }

    private fun classify(
        showWarning: Boolean = true,
        permissionGranted: Boolean = true,
        providersEnabled: Boolean = true,
        serviceRunning: Boolean = true,
        uploadFresh: Boolean = false,
        sharingRequired: Boolean = true,
        serverReached: Boolean = true,
        failure: LocationUploadFailure = LocationUploadFailure.None,
        sawUnusableFix: Boolean = false,
        nowMillis: Long = 0L,
        acquisitionStartedAtMillis: Long? = null,
    ): LocationNotice? {
        return classifyLocationNotice(
            showWarning = showWarning,
            permissionGranted = permissionGranted,
            providersEnabled = providersEnabled,
            serviceRunning = serviceRunning,
            uploadFresh = uploadFresh,
            sharingRequired = sharingRequired,
            serverReached = serverReached,
            failure = failure,
            sawUnusableFix = sawUnusableFix,
            nowMillis = nowMillis,
            acquisitionStartedAtMillis = acquisitionStartedAtMillis,
        )
    }
}
