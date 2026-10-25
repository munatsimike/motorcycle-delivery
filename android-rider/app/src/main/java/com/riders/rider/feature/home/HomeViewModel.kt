package com.riders.rider.feature.home

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.availability.domain.LOCATION_PERMISSION_REQUIRED
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.delivery.domain.ASSIGNMENT_RECOVERY_DELAY_MS
import com.riders.rider.feature.delivery.domain.ASSIGNMENT_RECOVERY_MESSAGE
import com.riders.rider.feature.delivery.domain.AssignmentCertainty
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.assignmentFailureIsUncertain
import com.riders.rider.feature.delivery.domain.automaticAssignmentRetry
import com.riders.rider.feature.delivery.domain.hasCommittedV2
import com.riders.rider.feature.delivery.domain.recoverAssignments
import com.riders.rider.feature.delivery.domain.retryWhenConnectivityReturns
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.feature.delivery.domain.DeliveryRecoveryCoordinator
import com.riders.rider.feature.offers.data.OfferRepository
import com.riders.rider.feature.onboarding.data.OnboardingRepository
import com.riders.rider.feature.onboarding.data.VerificationRepository
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.RiderReadiness
import com.riders.rider.feature.onboarding.domain.applicationAwaitingReview
import com.riders.rider.feature.onboarding.domain.riderReadiness
import com.riders.rider.feature.wallet.data.WalletRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HomeUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val changingAvailability: Boolean = false,
    val onboarding: RiderOnboarding? = null,
    val readiness: RiderReadiness? = null,
    val active: ActiveDelivery? = null,
    val shift: HomeShift = homeShift(null, false, null),
    val error: String? = null,
    val fullName: String = "",
    val walletBalance: String? = null,
    val walletCurrency: String? = null,
    val walletAvailableCapacity: String? = null,
    val walletReservedFees: String? = null,
    val activeRequestCount: Int? = null,
    val flexibleCount: Int? = null,
    val expressCount: Int? = null,
    val changingReceiving: Boolean = false,
    val committedV2: Boolean = false,
    val assignmentsUnknown: Boolean = false,
    val assignmentRefreshPending: Boolean = false,
    val applicationSubmitted: Boolean = false,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val onboarding: OnboardingRepository,
    private val availability: AvailabilityRepository,
    private val deliveries: ActiveDeliveryStore,
    private val assignments: AssignmentRepository,
    private val identity: VerificationRepository,
    private val wallets: WalletRepository,
    private val offers: OfferRepository,
) : ViewModel() {
    private val state = MutableStateFlow(HomeUi())
    val ui: StateFlow<HomeUi> = state.asStateFlow()
    private var dashboardBusy = false
    private var recoveryAttempts = 0
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            viewModelScope.launch {
                if (retryWhenConnectivityReturns(state.value.assignmentRefreshPending, networkAvailable = true)) {
                    recoveryAttempts = 0
                    refresh()
                }
            }
        }
    }

    init {
        connectivity?.registerDefaultNetworkCallback(networkCallback)
    }

    override fun onCleared() {
        connectivity?.unregisterNetworkCallback(networkCallback)
        super.onCleared()
    }

    fun refresh() {
        if (dashboardBusy) {
            return
        }
        dashboardBusy = true
        val showIndicator = state.value.readiness != null || state.value.error != null
        state.value = state.value.copy(refreshing = showIndicator)
        viewModelScope.launch {
            try {
                load(confirmedAvailability = null, notice = null, confirmedReceiving = null)
            } finally {
                dashboardBusy = false
                scheduleAssignmentRecovery()
            }
        }
    }

    fun goOnline() {
        changeAvailability(online = true)
    }

    fun locationPermissionDenied() {
        state.value = state.value.copy(error = LOCATION_PERMISSION_REQUIRED)
    }

    fun goOffline() {
        changeAvailability(online = false)
    }

    fun setReceiving(receiving: Boolean) {
        val current = state.value
        val control = receivingControl(
            receiving = current.onboarding?.receiving,
            canAcceptDeliveries = current.readiness?.canAcceptDeliveries == true,
            changing = dashboardBusy || current.changingAvailability || current.changingReceiving,
        )
        if (!control.visible || !control.enabled) {
            return
        }
        dashboardBusy = true
        state.value = current.copy(changingReceiving = true, error = null)
        viewModelScope.launch {
            try {
                when (val result = availability.setReceiving(receiving)) {
                    is ApiResult.Ok -> load(confirmedAvailability = null, notice = null, confirmedReceiving = result.value.receiving)
                    is ApiResult.Err -> {
                        state.value = state.value.copy(changingReceiving = false, error = result.error.text())
                    }
                }
            } finally {
                dashboardBusy = false
                scheduleAssignmentRecovery()
            }
        }
    }

    private fun changeAvailability(online: Boolean) {
        val started = beginAvailabilityChange(
            AvailabilityChange(
                availability = state.value.onboarding?.availability,
                changing = dashboardBusy || state.value.changingAvailability,
            ),
        ) ?: return
        dashboardBusy = true
        state.value = state.value.copy(changingAvailability = started.changing, error = null)
        viewModelScope.launch {
            try {
                val result = if (online) availability.online() else availability.offline()
                when (result) {
                    is ApiResult.Ok -> {
                        val confirmed = confirmAvailability(
                            AvailabilityChange(started.availability, changing = true),
                            result.value.availability,
                            result.value.message,
                        )
                        load(confirmed.availability, confirmed.error, confirmedReceiving = null)
                    }
                    is ApiResult.Err -> {
                        val failed = failAvailability(
                            AvailabilityChange(started.availability, changing = true),
                            result.error.text(),
                        )
                        state.value = state.value.copy(changingAvailability = failed.changing, error = failed.error)
                    }
                }
            } finally {
                dashboardBusy = false
                scheduleAssignmentRecovery()
            }
        }
    }

    private suspend fun load(confirmedAvailability: String?, notice: String?, confirmedReceiving: Boolean?) {
        val stored = deliveries.read()
        val previous = state.value
        state.value = previous.copy(
            loading = true,
            changingAvailability = confirmedAvailability != null || previous.changingAvailability,
            error = null,
            active = stored,
            shift = homeShift(
                confirmedAvailability ?: previous.onboarding?.availability,
                previous.readiness?.canAcceptDeliveries == true,
                stored,
                recovering = true,
            ),
        )
        val onboard = onboarding.loadCurrent()
        val profileName = (identity.profile() as? ApiResult.Ok)?.value?.fullName?.trim()?.takeIf { it.isNotEmpty() }
        val (wallet, requestCount, listed, submitted) = coroutineScope {
            val walletCall = async { wallets.summary() }
            val offersCall = async { offers.list() }
            val assignmentsCall = async { assignments.refreshList() }
            val licenceCall = async { identity.licence() }
            val motorcyclesCall = async { identity.motorcycles() }
            val walletResult = walletCall.await()
            val offerResult = offersCall.await()
            val assignmentResult = assignmentsCall.await()
            val licenceResult = licenceCall.await()
            val motorcycleResult = motorcyclesCall.await()
            val applicationSubmitted = if (licenceResult is ApiResult.Ok && motorcycleResult is ApiResult.Ok) {
                val approval = (onboard as? ApiResult.Ok)?.value?.approvalStatus
                    ?: previous.onboarding?.approvalStatus
                    ?: "PENDING"
                applicationAwaitingReview(
                    approvalStatus = approval,
                    hasLicenceImage = licenceResult.value != null,
                    licenceReviewStatus = licenceResult.value?.reviewStatus,
                    motorcycleStatuses = motorcycleResult.value.map { it.verificationStatus },
                )
            } else {
                previous.applicationSubmitted
            }
            val loadedWallet = (walletResult as? ApiResult.Ok)?.value
            val loadedCount = (offerResult as? ApiResult.Ok)?.value?.offers?.size
            HomeLoad(loadedWallet, loadedCount ?: previous.activeRequestCount, assignmentResult, applicationSubmitted)
        }
        val recovery = DeliveryRecoveryCoordinator(
            read = deliveries::read,
            write = deliveries::write,
            clear = deliveries::clear,
            lookup = assignments::lookup,
        ).reconcile()
        val active = recovery.visible
        val loaded = (onboard as? ApiResult.Ok)?.value
        if (loaded != null) {
            assignments.rememberMarketplace(loaded.receiving != null)
        }
        val current = previous.onboarding
        val shown = when {
            loaded != null && confirmedAvailability != null && loaded.availability != "BUSY" ->
                loaded.copy(availability = confirmedAvailability)
            loaded != null -> loaded
            current != null && confirmedReceiving != null -> current.copy(
                availability = confirmedAvailability ?: current.availability,
                receiving = confirmedReceiving,
            )
            current != null && confirmedAvailability != null -> current.copy(availability = confirmedAvailability)
            else -> current
        }
        val readiness = shown?.let { riderReadiness(it) }
        val marketplace = shown?.receiving != null
        val failureUncertain = listed is ApiResult.Err && assignmentFailureIsUncertain(listed.error)
        val assignmentState = recoverAssignments(
            fetchSucceeded = listed is ApiResult.Ok,
            fetched = (listed as? ApiResult.Ok)?.value.orEmpty(),
            confirmed = assignments.current(),
            confirmedThisProcess = assignments.hasConfirmedAssignments(),
            failureUncertain = failureUncertain,
        )
        val committedV2 = assignmentState.certainty == AssignmentCertainty.Confirmed &&
            hasCommittedV2(assignmentState.parcels.map { parcel -> parcel.serviceClass })
        val assignmentsUnknown = assignmentState.certainty == AssignmentCertainty.Unknown
        val counts = workloadFor(!assignmentsUnknown && (marketplace || committedV2), listed, previous)
        if (shown != null) {
            availability.applySharing()
        }
        val onboardFailure = (onboard as? ApiResult.Err)?.error
        val offline = recovery.offline || (
            onboardFailure != null
                && onboardFailure.isRecoverable()
                && dashboardFailure(onboardFailure) != DashboardFailure.MarketplaceDisabled
            )
        val assignmentError = if ((marketplace || committedV2) && listed is ApiResult.Err && !assignmentsUnknown) listed.error else null
        val shift = homeShift(
            shown?.availability,
            readiness?.canAcceptDeliveries == true,
            active,
            recovering = false,
            recoveryFailed = offline,
        )
        state.value = HomeUi(
            loading = false,
            refreshing = false,
            changingAvailability = false,
            onboarding = shown,
            readiness = readiness ?: previous.readiness,
            active = active,
            shift = shift,
            error = when {
                !notice.isNullOrBlank() -> notice
                onboard is ApiResult.Err && dashboardFailure(onboard.error) == DashboardFailure.Authentication -> onboard.error.text()
                listed is ApiResult.Err && dashboardFailure(listed.error) == DashboardFailure.Authentication -> listed.error.text()
                onboard is ApiResult.Err && dashboardFailure(onboard.error) == DashboardFailure.MarketplaceDisabled -> onboard.error.text()
                assignmentError != null && dashboardFailure(assignmentError) == DashboardFailure.MarketplaceDisabled -> assignmentError.text()
                onboard is ApiResult.Err && !onboard.error.isRecoverable() -> onboard.error.text()
                assignmentsUnknown -> ASSIGNMENT_RECOVERY_MESSAGE
                recovery.offline && shift.recoveryMessage == null -> "Your current delivery could not be loaded. Check your connection and try again."
                onboard is ApiResult.Err && shift.recoveryMessage == null -> onboard.error.text()
                assignmentError != null && shift.recoveryMessage == null -> assignmentError.text()
                else -> null
            },
            fullName = profileName ?: previous.fullName,
            walletBalance = wallet?.balance ?: previous.walletBalance,
            walletCurrency = wallet?.currency ?: previous.walletCurrency,
            walletAvailableCapacity = walletFigures(marketplace, wallet?.availableCapacity ?: previous.walletAvailableCapacity, wallet?.reservedFees ?: previous.walletReservedFees).first,
            walletReservedFees = walletFigures(marketplace, wallet?.availableCapacity ?: previous.walletAvailableCapacity, wallet?.reservedFees ?: previous.walletReservedFees).second,
            activeRequestCount = requestCount,
            flexibleCount = counts?.flexible,
            expressCount = counts?.express,
            committedV2 = committedV2,
            assignmentsUnknown = assignmentsUnknown,
            assignmentRefreshPending = listed is ApiResult.Err && failureUncertain,
            applicationSubmitted = submitted,
        )
    }

    private fun scheduleAssignmentRecovery() {
        val pending = state.value.assignmentRefreshPending
        if (!pending) {
            recoveryAttempts = 0
            return
        }
        if (!automaticAssignmentRetry(recoveryAttempts)) {
            return
        }
        recoveryAttempts += 1
        viewModelScope.launch {
            delay(ASSIGNMENT_RECOVERY_DELAY_MS)
            refresh()
        }
    }
}

private data class HomeLoad<TWallet, TListed>(
    val wallet: TWallet,
    val requestCount: Int?,
    val listed: TListed,
    val submitted: Boolean,
)

private fun workloadFor(
    showWorkload: Boolean,
    listed: ApiResult<List<CommittedParcel>>,
    previous: HomeUi,
): WorkloadCounts? {
    if (!showWorkload) {
        return null
    }
    if (listed is ApiResult.Ok) {
        return workloadCounts(listed.value.map { assignment -> assignment.serviceClass })
    }
    val flexible = previous.flexibleCount ?: return null
    return WorkloadCounts(flexible, previous.expressCount ?: 0)
}

private fun ApiError.isRecoverable(): Boolean = when (this) {
    ApiError.Network,
    ApiError.Timeout,
    ApiError.Unavailable,
    -> true
    is ApiError.Unexpected -> true
    else -> false
}
