package com.riders.rider.feature.availability.data

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.AvailabilityResponse
import com.riders.rider.core.network.ReceivingRequest
import com.riders.rider.core.network.LocationRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.availability.RiderLocationService
import com.riders.rider.feature.availability.domain.GpsFix
import com.riders.rider.feature.availability.domain.LocationCommand
import com.riders.rider.feature.availability.domain.LocationFreshness
import com.riders.rider.feature.availability.domain.LocationRelay
import com.riders.rider.feature.availability.domain.commandAfterUploadFailure
import com.riders.rider.feature.availability.domain.shouldRequestAcceptFix
import com.riders.rider.feature.availability.domain.locationSharingDecision
import com.riders.rider.feature.delivery.data.AssignmentListStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

data class AvailabilityUpdate(val availability: String, val message: String?)

data class ReceivingUpdate(val availability: String, val receiving: Boolean)

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

    suspend fun setReceiving(receiving: Boolean): ApiResult<ReceivingUpdate> {
        return when (val result = apiCall { riders.receiving(ReceivingRequest(receiving)) }) {
            is ApiResult.Ok -> {
                applySharing()
                ApiResult.Ok(ReceivingUpdate(result.value.availability, result.value.receiving))
            }
            is ApiResult.Err -> result
        }
    }

    suspend fun applySharing() {
        val share = shouldShareNow()
        if (!share) {
            freshness.invalidate()
        }
        sharing.setEnabled(share)
        val intent = Intent(context, RiderLocationService::class.java).setAction(RiderLocationService.ACTION_SHARE)
        val permitted = fineLocationGranted()
        if (share && permitted) {
            ContextCompat.startForegroundService(context, intent)
        } else {
            context.stopService(intent)
        }
    }

    suspend fun shouldShareNow(): Boolean {
        if (sessions.read() == null || !fineLocationGranted()) {
            return false
        }
        val onboard = apiCall { riders.onboarding() }
        if (onboard is ApiResult.Ok) {
            committed.rememberShift(onboard.value.availability, onboard.value.receiving)
        }
        val listed = assignments.refreshList()
        val onboardingReached = onboard is ApiResult.Ok
        val receiving = if (onboardingReached) onboard.value.receiving else committed.confirmedReceiving()
        val availability = if (onboardingReached) onboard.value.availability else committed.confirmedAvailability()
        val authoritativeStop = authoritativeLocationStop(onboard) || authoritativeLocationStop(listed)
        return locationSharingDecision(
            hasSession = true,
            permissionGranted = true,
            onboardingReached = onboardingReached || committed.confirmedAvailability() != null || committed.confirmedReceiving() != null,
            receivingRequests = receiving,
            availability = availability,
            assignmentFetchSucceeded = listed is ApiResult.Ok && assignments.lastRefreshApplied(),
            fetchedStatuses = (listed as? ApiResult.Ok)?.value?.map { parcel -> parcel.status }.orEmpty(),
            confirmedStatuses = committed.current().map { parcel -> parcel.status },
            confirmedThisProcess = committed.hasConfirmedAssignments(),
            authoritativeStop = authoritativeStop,
        )
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

private fun authoritativeLocationStop(result: ApiResult<*>): Boolean {
    val error = (result as? ApiResult.Err)?.error ?: return false
    return error is ApiError.SessionEnded || error is ApiError.Forbidden
}
