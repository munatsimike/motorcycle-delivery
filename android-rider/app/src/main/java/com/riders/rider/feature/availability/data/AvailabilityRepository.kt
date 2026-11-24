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
import com.riders.rider.feature.availability.domain.LocationNotice
import com.riders.rider.feature.availability.domain.LocationRelay
import com.riders.rider.feature.availability.domain.LocationUploadFailure
import com.riders.rider.feature.availability.domain.SharingAction
import com.riders.rider.feature.availability.domain.classifyLocationNotice
import com.riders.rider.feature.availability.domain.commandAfterUploadFailure
import com.riders.rider.feature.availability.domain.locationSharingDecision
import com.riders.rider.feature.availability.domain.locationSharingPaused
import com.riders.rider.feature.availability.domain.locationUploadFailure
import com.riders.rider.feature.availability.domain.noticeAfterConnectivityRestored
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
    private val noticeLock = Any()
    private val notice = MutableStateFlow<LocationNotice?>(null)
    val locationNotice: StateFlow<LocationNotice?> = notice.asStateFlow()
    private var facts = LocationFacts()
    private var failure = LocationUploadFailure.None
    private var sawUnusableFix = false
    @Volatile private var policyStop = false

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

    fun noteServiceStopped() {
        synchronized(noticeLock) {
            facts = facts.copy(serviceRunning = false)
            if (!policyStop) {
                facts = facts.copy(
                    showWarning = locationSharingPaused(
                        serverReached = facts.serverReached,
                        shouldShare = facts.sharingRequired,
                        permissionGranted = facts.permissionGranted,
                        serviceRunning = false,
                        uploadFresh = facts.uploadFresh,
                        previouslyEnabled = facts.previouslyEnabled,
                    ),
                )
            }
            republish()
        }
    }

    fun noteUnusableFix() {
        synchronized(noticeLock) {
            if (facts.uploadFresh || failure == LocationUploadFailure.Rejected) {
                return
            }
            sawUnusableFix = true
            republish()
        }
    }

    fun noteFixMissing() {
        synchronized(noticeLock) {
            if (facts.uploadFresh || failure == LocationUploadFailure.Rejected) {
                return
            }
            val providers = currentFix.locationProvidersEnabled()
            facts = facts.copy(providersEnabled = providers)
            if (providers) {
                sawUnusableFix = true
            }
            republish()
        }
    }

    suspend fun noteConnectivityRestored() {
        val reevaluate = synchronized(noticeLock) {
            if (failure == LocationUploadFailure.Rejected) {
                return@synchronized false
            }
            val next = noticeAfterConnectivityRestored(failure)
            if (next == failure) {
                false
            } else {
                failure = next
                republish()
                facts.showWarning
            }
        }
        if (reevaluate) {
            applySharing()
        }
    }

    /**
     * Used by the already-started service. A failed refresh keeps the service
     * running; it never treats remembered availability as permission to start.
     */
    suspend fun sharingStillAllowed(): Boolean {
        return when (evaluateSharing().verdict) {
            SharingVerdict.Required, SharingVerdict.Unknown -> true
            SharingVerdict.NotRequired -> false
        }
    }

    private suspend fun recover(userRetry: Boolean) {
        recovery.withLock {
            val evaluation = evaluateSharing()
            val verdict = evaluation.verdict
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
            val freshBefore = freshness.canAccept(System.currentTimeMillis())
            val action = sharingRecovery(
                serverReached = serverReached,
                shouldShare = shouldShare,
                permissionGranted = permitted,
                serviceRunning = running,
                uploadFresh = freshBefore,
                userRetry = userRetry,
            )
            val intent = Intent(context, RiderLocationService::class.java).setAction(RiderLocationService.ACTION_SHARE)
            when (action) {
                SharingAction.Start -> {
                    if (permitted && (!running || userRetry)) {
                        policyStop = false
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
                    policyStop = true
                    freshness.invalidate()
                    context.stopService(intent)
                }
                SharingAction.Keep -> {
                    if (!permitted && running) {
                        policyStop = true
                        context.stopService(intent)
                    }
                }
            }
            val serviceNow = if (action == SharingAction.Stop) false else LocationServiceGate.isRunning()
            if (serviceNow) {
                policyStop = false
            }
            val uploadFresh = freshness.canAccept(System.currentTimeMillis()) && action != SharingAction.Stop
            synchronized(noticeLock) {
                val providers = currentFix.locationProvidersEnabled()
                if (providers && !facts.providersEnabled) {
                    sawUnusableFix = false
                }
                val evaluatedFailure = evaluation.error?.let(::locationUploadFailure)
                if (failure == LocationUploadFailure.Rejected && evaluatedFailure != LocationUploadFailure.Rejected) {
                    failure = LocationUploadFailure.None
                }
                rememberEvaluateFailure(evaluation.error)
                facts = LocationFacts(
                    showWarning = locationSharingPaused(
                        serverReached = serverReached,
                        shouldShare = shouldShare,
                        permissionGranted = permitted,
                        serviceRunning = serviceNow,
                        uploadFresh = uploadFresh,
                        previouslyEnabled = previouslyEnabled,
                    ),
                    permissionGranted = permitted,
                    providersEnabled = providers,
                    serviceRunning = serviceNow,
                    uploadFresh = uploadFresh,
                    sharingRequired = shouldShare,
                    serverReached = serverReached,
                    previouslyEnabled = previouslyEnabled,
                )
                republish()
            }
        }
    }

    private suspend fun evaluateSharing(): SharingEvaluation {
        if (sessions.read() == null) {
            return SharingEvaluation(SharingVerdict.NotRequired, null)
        }
        val onboard = apiCall { riders.onboarding() }
        if (authoritativeLocationStop(onboard)) {
            return SharingEvaluation(SharingVerdict.NotRequired, (onboard as? ApiResult.Err)?.error)
        }
        if (onboard !is ApiResult.Ok) {
            return SharingEvaluation(SharingVerdict.Unknown, (onboard as ApiResult.Err).error)
        }
        committed.rememberShift(onboard.value.availability, onboard.value.receiving)
        val listed = assignments.refreshList()
        if (authoritativeLocationStop(listed)) {
            return SharingEvaluation(SharingVerdict.NotRequired, (listed as? ApiResult.Err)?.error)
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
            val listedError = (listed as? ApiResult.Err)?.error
            return if (shiftShares) {
                SharingEvaluation(SharingVerdict.Required, null)
            } else {
                SharingEvaluation(SharingVerdict.Unknown, listedError)
            }
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
        return SharingEvaluation(
            if (should) SharingVerdict.Required else SharingVerdict.NotRequired,
            null,
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
                synchronized(noticeLock) {
                    failure = LocationUploadFailure.None
                    sawUnusableFix = false
                    val running = LocationServiceGate.isRunning()
                    val fresh = freshness.canAccept(System.currentTimeMillis())
                    facts = facts.copy(
                        serviceRunning = running,
                        uploadFresh = fresh,
                        showWarning = locationSharingPaused(
                            serverReached = facts.serverReached,
                            shouldShare = facts.sharingRequired,
                            permissionGranted = facts.permissionGranted,
                            serviceRunning = running,
                            uploadFresh = fresh,
                            previouslyEnabled = facts.previouslyEnabled,
                        ),
                    )
                    republish()
                }
                true
            }
            is ApiResult.Err -> {
                val mapped = locationUploadFailure(result.error)
                synchronized(noticeLock) {
                    failure = mapped
                    val running = LocationServiceGate.isRunning()
                    facts = facts.copy(
                        serviceRunning = running,
                        uploadFresh = false,
                        showWarning = locationSharingPaused(
                            serverReached = facts.serverReached,
                            shouldShare = facts.sharingRequired,
                            permissionGranted = facts.permissionGranted,
                            serviceRunning = running,
                            uploadFresh = false,
                            previouslyEnabled = facts.previouslyEnabled,
                        ),
                    )
                    republish()
                }
                if (commandAfterUploadFailure(result.error) == LocationCommand.Stop) {
                    applySharing()
                }
                false
            }
        }
    }

    private fun rememberEvaluateFailure(error: ApiError?) {
        if (error == null || failure == LocationUploadFailure.Rejected) {
            return
        }
        when (locationUploadFailure(error)) {
            LocationUploadFailure.Network -> failure = LocationUploadFailure.Network
            LocationUploadFailure.Rejected -> failure = LocationUploadFailure.Rejected
            else -> Unit
        }
    }

    private fun republish() {
        notice.value = classifyLocationNotice(
            showWarning = facts.showWarning,
            permissionGranted = facts.permissionGranted,
            providersEnabled = facts.providersEnabled,
            serviceRunning = facts.serviceRunning,
            uploadFresh = facts.uploadFresh,
            sharingRequired = facts.sharingRequired,
            serverReached = facts.serverReached,
            failure = failure,
            sawUnusableFix = sawUnusableFix,
        )
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

private data class LocationFacts(
    val showWarning: Boolean = false,
    val permissionGranted: Boolean = false,
    val providersEnabled: Boolean = true,
    val serviceRunning: Boolean = false,
    val uploadFresh: Boolean = false,
    val sharingRequired: Boolean = false,
    val serverReached: Boolean = false,
    val previouslyEnabled: Boolean = false,
)

private data class SharingEvaluation(val verdict: SharingVerdict, val error: ApiError?)

private sealed interface SharingVerdict {
    data object Required : SharingVerdict
    data object NotRequired : SharingVerdict
    data object Unknown : SharingVerdict
}

private fun authoritativeLocationStop(result: ApiResult<*>): Boolean {
    val error = (result as? ApiResult.Err)?.error ?: return false
    return error is ApiError.SessionEnded || error is ApiError.SignedInElsewhere || error is ApiError.Forbidden
}
