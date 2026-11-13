package com.riders.rider.feature.availability.data

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.AvailabilityResponse
import com.riders.rider.core.network.LocationRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.availability.LocationServiceGate
import com.riders.rider.feature.availability.RiderLocationService
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LocationCommand
import com.riders.rider.feature.availability.domain.LocationFreshness
import com.riders.rider.feature.availability.domain.LocationRelay
import com.riders.rider.feature.availability.domain.SharingAction
import com.riders.rider.feature.availability.domain.commandAfterUploadFailure
import com.riders.rider.feature.availability.domain.locationSharingDecision
import com.riders.rider.feature.availability.domain.locationSharingPaused
import com.riders.rider.feature.availability.domain.sharingRecovery
import com.riders.rider.feature.availability.domain.shouldRequestAcceptFix
import com.riders.rider.feature.availability.domain.shouldShareLocation
import com.riders.rider.feature.delivery.data.AssignmentListStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class AvailabilityUpdate(val availability: String, val message: String?)

@Singleton
class AvailabilityRepository @Inject constructor(
    private val riders: RiderService,
    private val sharing: LocationSharingStore,
    private val freshness: LocationFreshness,
    private val currentFix: FusedCurrentFix,
    private val sessions: SessionStore,
    private val committed: AssignmentListStore,
    private val assignments: AssignmentRepository,
    @param:ApplicationContext private val context: Context,
) {
    private val recovery = Mutex()
    private val paused = MutableStateFlow(false)
    val locationSharingPaused: StateFlow<Boolean> = paused.asStateFlow()

    suspend fun online(): ApiResult<AvailabilityUpdate> {
        val result = apiCall { riders.online() }.mapAvailability()
        if (result is ApiResult.Ok) {
            applySharing()
        }
        return result
    }

    suspend fun offline(): ApiResult<AvailabilityUpdate> {
        val result = apiCall { riders.offline() }.mapAvailability()
        if (result is ApiResult.Ok) {
            applySharing()
        }
        return result
    }

    suspend fun applySharing() = recover(userRetry = false)

    suspend fun retryLocationSharing() = recover(userRetry = true)

    /**
     * Used by the already-started service. A failed refresh keeps the service
     * running; it never treats remembered availability as permission to start.
     */
    suspend fun sharingStillAllowed(): Boolean {
        return when (evaluateSharing()) {
            SharingVerdict.Required, SharingVerdict.Unknown -> true
            SharingVerdict.NotRequired -> false
        }
    }

    private suspend fun recover(userRetry: Boolean) {
        recovery.withLock {
            val verdict = evaluateSharing()
            val permitted = fineLocationGranted()
            val running = LocationServiceGate.isRunning()
            val previouslyEnabled = sharing.isEnabled()
            when (verdict) {
                SharingVerdict.Required -> sharing.setEnabled(true)
                SharingVerdict.NotRequired -> sharing.setEnabled(false)
                SharingVerdict.Unknown -> Unit
            }
            val serverReached = verdict != SharingVerdict.Unknown
            val shouldShare = verdict == SharingVerdict.Required
            val action = sharingRecovery(
                serverReached = serverReached,
                shouldShare = shouldShare,
                permissionGranted = permitted,
                serviceRunning = running,
                uploadFresh = freshness.canAccept(System.currentTimeMillis()),
                userRetry = userRetry,
            )
            val intent = Intent(context, RiderLocationService::class.java).setAction(RiderLocationService.ACTION_SHARE)
            when (action) {
                SharingAction.Start -> {
                    if (permitted && (!running || userRetry)) {
                        try {
                            ContextCompat.startForegroundService(context, intent)
                        } catch (error: RuntimeException) {
                            val refused = error is SecurityException ||
                                error.javaClass.name == "android.app.ForegroundServiceStartNotAllowedException"
                            if (!refused) {
                                throw error
                            }
                        }
                    }
                }
                SharingAction.Stop -> {
                    freshness.invalidate()
                    context.stopService(intent)
                }
                SharingAction.Keep -> {
                    if (!permitted && running) {
                        context.stopService(intent)
                    }
                }
            }
            val serviceForWarning = when (action) {
                SharingAction.Start -> running
                SharingAction.Stop -> false
                SharingAction.Keep -> running && permitted
            }
            paused.value = locationSharingPaused(
                serverReached = serverReached,
                shouldShare = shouldShare,
                permissionGranted = permitted,
                serviceRunning = serviceForWarning,
                uploadFresh = freshness.canAccept(System.currentTimeMillis()) && action != SharingAction.Stop,
                previouslyEnabled = previouslyEnabled,
            )
        }
    }

    private suspend fun evaluateSharing(): SharingVerdict {
        if (sessions.read() == null) {
            return SharingVerdict.NotRequired
        }
        val onboard = apiCall { riders.onboarding() }
        if (authoritativeLocationStop(onboard)) {
            return SharingVerdict.NotRequired
        }
        if (onboard !is ApiResult.Ok) {
            return SharingVerdict.Unknown
        }
        committed.rememberShift(onboard.value.availability, onboard.value.receiving)
        val listed = assignments.refreshList()
        if (authoritativeLocationStop(listed)) {
            return SharingVerdict.NotRequired
        }
        val listedOk = listed as? ApiResult.Ok
        if (listedOk == null || !assignments.lastRefreshApplied()) {
            val shiftShares = shouldShareLocation(
                hasSession = true,
                permissionGranted = true,
                receivingRequests = onboard.value.receiving,
                deliveryStatuses = emptyList(),
                availability = onboard.value.availability,
            )
            return if (shiftShares) SharingVerdict.Required else SharingVerdict.Unknown
        }
        val should = locationSharingDecision(
            hasSession = true,
            permissionGranted = true,
            onboardingReached = true,
            receivingRequests = onboard.value.receiving,
            availability = onboard.value.availability,
            assignmentFetchSucceeded = true,
            fetchedStatuses = listedOk.value.map { parcel -> parcel.status },
            confirmedStatuses = emptyList(),
            confirmedThisProcess = false,
        )
        return if (should) SharingVerdict.Required else SharingVerdict.NotRequired
    }

    suspend fun refreshForAccept(): Boolean {
        val now = System.currentTimeMillis()
        val availability = if (sharing.isEnabled()) "AVAILABLE" else "OFFLINE"
        if (!shouldRequestAcceptFix(availability, freshness.canAccept(now))) {
            return freshness.canAccept(now)
        }
        val current = currentFix.read() ?: return false
        return LocationRelay().handle(
            active = true,
            fix = current.fix,
            ageMillis = current.ageMillis,
            accuracyMeters = current.accuracyMeters,
        ) { fix ->
            upload(fix)
        }
    }

    suspend fun upload(fix: GpsFix): Boolean {
        return when (val result = apiCall { riders.location(LocationRequest(fix.latitude, fix.longitude)) }) {
            is ApiResult.Ok -> {
                freshness.markConfirmed(System.currentTimeMillis())
                if (LocationServiceGate.isRunning()) {
                    paused.value = false
                }
                true
            }
            is ApiResult.Err -> {
                if (commandAfterUploadFailure(result.error) == LocationCommand.Stop) {
                    applySharing()
                }
                false
            }
        }
    }

    private fun fineLocationGranted(): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
}

private fun ApiResult<AvailabilityResponse>.mapAvailability(): ApiResult<AvailabilityUpdate> {
    return when (this) {
        is ApiResult.Ok -> ApiResult.Ok(AvailabilityUpdate(value.availability, value.message))
        is ApiResult.Err -> this
    }
}

private sealed interface SharingVerdict {
    data object Required : SharingVerdict
    data object NotRequired : SharingVerdict
    data object Unknown : SharingVerdict
}

private fun authoritativeLocationStop(result: ApiResult<*>): Boolean {
    val error = (result as? ApiResult.Err)?.error ?: return false
    return error is ApiError.SessionEnded || error is ApiError.SignedInElsewhere || error is ApiError.Forbidden
}
