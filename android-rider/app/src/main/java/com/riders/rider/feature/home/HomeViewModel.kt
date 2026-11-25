package com.riders.rider.feature.home

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.design.RiderNetwork
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.refresh.clearListedRefresh
import com.riders.rider.core.refresh.homePageLoading
import com.riders.rider.core.refresh.homePullIndicator
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.WalletSummaryResponse
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.availability.domain.LOCATION_PERMISSION_REQUIRED
import com.riders.rider.feature.availability.domain.LocationNotice
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.delivery.domain.ASSIGNMENT_RECOVERY_ATTEMPTS
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
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.bids.domain.OFFERS_NOT_AVAILABLE
import com.riders.rider.feature.bids.domain.OpenBidRequest
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.availableRequests
import com.riders.rider.feature.bids.domain.newMarketplaceOffers
import com.riders.rider.feature.offers.domain.OFFER_REFRESH_INTERVAL_MS
import com.riders.rider.feature.offers.domain.shouldLoadHomeDocuments
import com.riders.rider.feature.offers.domain.shouldPollMarketplace
import com.riders.rider.feature.offers.notification.PendingOffer
import com.riders.rider.feature.onboarding.data.OnboardingRepository
import com.riders.rider.feature.onboarding.data.VerificationRepository
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.RiderReadiness
import com.riders.rider.feature.onboarding.domain.applicationAwaitingReview
import com.riders.rider.feature.onboarding.domain.riderReadiness
import com.riders.rider.feature.wallet.data.WalletRepository
import com.riders.rider.feature.wallet.domain.dashboardWallet
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HomeUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val changingAvailability: Boolean = false,
    val pendingOnline: Boolean? = null,
    val onboarding: RiderOnboarding? = null,
    val readiness: RiderReadiness? = null,
    val active: ActiveDelivery? = null,
    val shift: HomeShift = homeShift(null, false, null),
    val error: String? = null,
    val connectionFailure: Boolean = false,
    val backendFailure: Boolean = false,
    val networkRecoveryOutstanding: Boolean = false,
    val fullName: String = "",
    val walletBalance: String? = null,
    val walletCurrency: String? = null,
    val walletInsufficient: Boolean = false,
    val usdDebtBalance: String? = null,
    val walletRestricted: Boolean = false,
    val activeRequestCount: Int? = null,
    val activeDeliveryTotal: Int? = null,
    val offers: List<OfferResponse> = emptyList(),
    val ownBids: List<OwnBid> = emptyList(),
    val flexibleCount: Int? = null,
    val expressCount: Int? = null,
    val committedV2: Boolean = false,
    val assignmentsUnknown: Boolean = false,
    val assignmentRefreshPending: Boolean = false,
    val applicationSubmitted: Boolean = false,
    val locationNotice: LocationNotice? = null,
    val restartingLocation: Boolean = false,
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
    private val bids: BidRepository,
    private val pendingOffers: PendingOffer,
) : ViewModel() {
    private val state = MutableStateFlow(HomeUi())
    val ui: StateFlow<HomeUi> = state.asStateFlow()
    private var dashboardBusy = false
    private var refreshTicket = 0
    private var openRequests = emptyList<OpenBidRequest>()

    init {
        viewModelScope.launch {
            bids.ownBidsFlow.collect { loaded ->
                state.value = state.value.copy(ownBids = loaded)
            }
        }
        viewModelScope.launch {
            availability.locationNotice.collect { notice ->
                state.value = state.value.copy(locationNotice = notice)
            }
        }
        viewModelScope.launch {
            wallets.updates.collect { wallet ->
                applyWallet(wallet)
            }
        }
        viewModelScope.launch {
            pendingOffers.acceptedArrivals.collect {
                wallets.summary()
            }
        }
    }
    private var recoveryAttempts = 0
    private var locationRestart = false
    private var offerWatch: Job? = null
    private var hasLoaded = false
    private var homeVisits = 0

    init {
        viewModelScope.launch {
            RiderNetwork.connectivityRestored.collect {
                availability.noteConnectivityRestored()
                if (retryWhenConnectivityReturns(state.value.assignmentRefreshPending, networkAvailable = true)) {
                    recoveryAttempts = 0
                    refresh()
                }
            }
        }
        RiderNetwork.ensureInstalled(context)
    }

    override fun onCleared() {
        offerWatch?.cancel()
        super.onCleared()
    }

    fun watchOffers(active: Boolean) {
        offerWatch?.cancel()
        offerWatch = null
        if (!active) {
            return
        }
        offerWatch = viewModelScope.launch {
            refreshOfferCount()
            while (isActive) {
                delay(OFFER_REFRESH_INTERVAL_MS)
                refreshOfferCount()
            }
        }
    }

    fun refresh() {
        startRefresh(fromUser = false)
    }

    fun pullRefresh() {
        startRefresh(fromUser = true)
    }

    fun onHomeShown() {
        val visitsSoFar = homeVisits
        homeVisits += 1
        if (shouldRefreshWalletOnHomeVisit(visitsSoFar)) {
            refreshWallet()
        }
    }

    private fun refreshWallet() {
        viewModelScope.launch { wallets.summary() }
    }

    private fun startRefresh(fromUser: Boolean) {
        if (dashboardBusy) {
            return
        }
        dashboardBusy = true
        val ticket = ++refreshTicket
        val current = state.value
        val showIndicator = homePullIndicator(
            fromUser = fromUser,
            contentVisible = current.readiness != null,
            errorVisible = current.error != null,
        )
        state.value = current.copy(refreshing = showIndicator)
        val launch = !hasLoaded
        hasLoaded = true
        val marketplace = fromUser || launch || shouldPollMarketplace(
            appVisible = true,
            availability = current.onboarding?.availability,
            receiving = current.onboarding?.receiving,
        )
        val wallet = fromUser || launch || current.walletBalance == null
        val profile = fromUser || launch || current.fullName.isBlank()
        viewModelScope.launch {
            try {
                load(
                    confirmedAvailability = null,
                    notice = null,
                    confirmedReceiving = null,
                    includeWallet = wallet,
                    includeMarketplace = marketplace,
                    includeProfile = profile,
                    refreshTicket = ticket,
                )
            } finally {
                if (ticket == refreshTicket) {
                    val cleared = clearListedRefresh(ticket, refreshTicket, state.value.loading, state.value.refreshing)
                    state.value = state.value.copy(loading = cleared.loading, refreshing = cleared.refreshing)
                    dashboardBusy = false
                    scheduleAssignmentRecovery()
                }
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

    private fun changeAvailability(online: Boolean) {
        val started = beginAvailabilityChange(
            AvailabilityChange(
                availability = state.value.onboarding?.availability,
                changing = dashboardBusy || state.value.changingAvailability,
            ),
        ) ?: return
        dashboardBusy = true
        state.value = state.value.copy(
            changingAvailability = started.changing,
            pendingOnline = online,
            error = null,
        )
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
                        load(
                            confirmed.availability,
                            confirmed.error,
                            confirmedReceiving = null,
                            includeWallet = false,
                            includeMarketplace = online,
                            includeProfile = state.value.fullName.isBlank(),
                        )
                    }
                    is ApiResult.Err -> {
                        val failed = failAvailability(
                            AvailabilityChange(started.availability, changing = true),
                            result.error.text(),
                        )
                        state.value = state.value.copy(
                            changingAvailability = failed.changing,
                            pendingOnline = null,
                            error = failed.error,
                        )
                    }
                }
            } finally {
                dashboardBusy = false
                scheduleAssignmentRecovery()
            }
        }
    }

    private suspend fun load(
        confirmedAvailability: String?,
        notice: String?,
        confirmedReceiving: Boolean?,
        includeWallet: Boolean = true,
        includeMarketplace: Boolean = true,
        includeProfile: Boolean = true,
        refreshTicket: Int? = null,
    ) {
        if (refreshTicket != null && refreshTicket != this.refreshTicket) {
            return
        }
        val stored = deliveries.read()
        val previous = state.value
        state.value = previous.copy(
            loading = homePageLoading(previous.readiness != null),
            changingAvailability = confirmedAvailability != null || previous.changingAvailability,
            error = null,
            active = stored,
            shift = homeShift(
                confirmedAvailability ?: previous.onboarding?.availability,
                previous.readiness?.canAcceptDeliveries == true,
                stored,
                recovering = true,
                marketplace = previous.onboarding?.receiving != null,
            ),
        )
        val onboard = onboarding.loadCurrent()
        val approval = (onboard as? ApiResult.Ok)?.value?.approvalStatus ?: previous.onboarding?.approvalStatus
        val includeDocuments = shouldLoadHomeDocuments(approval, identity.documentsConfirmedFor(approval))
        val profileName = if (!includeProfile && previous.fullName.isNotBlank()) {
            previous.fullName
        } else {
            (identity.profile() as? ApiResult.Ok)?.value?.fullName?.trim()?.takeIf { it.isNotEmpty() }
        }
        val (wallet, requestCount, listed, submitted, offers) = coroutineScope {
            val walletCall = if (includeWallet) async { wallets.summary() } else null
            val openCall = if (includeMarketplace) async { bids.openRequests() } else null
            val ownCall = if (includeMarketplace) async { bids.refreshOwnBids(null) } else null
            val assignmentsCall = async { assignments.refreshList() }
            val licenceCall = if (includeDocuments) async { identity.licence() } else null
            val motorcyclesCall = if (includeDocuments) async { identity.motorcycles() } else null
            val walletResult = walletCall?.await()
            val assignmentResult = assignmentsCall.await()
            val licenceResult = licenceCall?.await()
            val motorcycleResult = motorcyclesCall?.await()
            val applicationSubmitted = if (approval == "APPROVED") {
                if (licenceResult is ApiResult.Ok && motorcycleResult is ApiResult.Ok) {
                    identity.confirmApprovedDocuments()
                }
                false
            } else if (licenceResult is ApiResult.Ok && motorcycleResult is ApiResult.Ok) {
                applicationAwaitingReview(
                    approvalStatus = approval ?: "PENDING",
                    hasLicenceImage = licenceResult.value != null,
                    licenceReviewStatus = licenceResult.value?.reviewStatus,
                    motorcycleStatuses = motorcycleResult.value.map { it.verificationStatus },
                )
            } else {
                previous.applicationSubmitted
            }
            val loadedWallet = (walletResult as? ApiResult.Ok)?.value
            val opened = openCall?.await()
            ownCall?.await()
            val actionable = if (opened is ApiResult.Ok) {
                openRequests = opened.value
                newMarketplaceOffers(availableRequests(emptyList(), opened.value), bids.ownBidsFlow.value)
            } else {
                null
            }
            HomeLoad(loadedWallet, actionable?.size, assignmentResult, applicationSubmitted, actionable)
        }
        val recovery = DeliveryRecoveryCoordinator(
            read = deliveries::read,
            write = deliveries::write,
            clear = deliveries::clear,
            lookup = assignments::lookup,
        ).reconcile()
        val active = recovery.visible
        val loaded = alignReceiving((onboard as? ApiResult.Ok)?.value)
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
        if (refreshTicket != null && refreshTicket != this.refreshTicket) {
            return
        }
        availability.applySharing()
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
            marketplace = marketplace,
        )
        val signals = homeNetworkSignals(
            notice = notice,
            onboard = onboardFailure,
            assignments = (listed as? ApiResult.Err)?.error,
            assignmentsUnknown = assignmentsUnknown,
            assignmentError = assignmentError,
            recoveryOffline = recovery.offline,
            recoveryMessage = shift.recoveryMessage,
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
                onboard is ApiResult.Err && dashboardFailure(onboard.error) == DashboardFailure.MarketplaceDisabled -> OFFERS_NOT_AVAILABLE
                assignmentError != null && dashboardFailure(assignmentError) == DashboardFailure.MarketplaceDisabled -> OFFERS_NOT_AVAILABLE
                onboard is ApiResult.Err && !onboard.error.isRecoverable() -> onboard.error.text()
                assignmentsUnknown -> ASSIGNMENT_RECOVERY_MESSAGE
                recovery.offline && shift.recoveryMessage == null -> "Your current delivery could not be loaded. Check your connection and try again."
                onboard is ApiResult.Err && shift.recoveryMessage == null -> onboard.error.text()
                assignmentError != null && shift.recoveryMessage == null -> assignmentError.text()
                else -> null
            },
            connectionFailure = signals.connectionFailure,
            backendFailure = signals.backendFailure,
            networkRecoveryOutstanding = networkRecoveryOutstanding(
                refreshPending = listed is ApiResult.Err && failureUncertain,
                completedAttempts = recoveryAttempts,
                maxAttempts = ASSIGNMENT_RECOVERY_ATTEMPTS,
            ),
            fullName = profileName ?: previous.fullName,
            walletBalance = if (wallet == null) state.value.walletBalance else dashboardWallet(wallet.activeWallet, wallet.balance, wallet.zig?.balance).balance,
            walletCurrency = if (wallet == null) state.value.walletCurrency else dashboardWallet(wallet.activeWallet, wallet.balance, wallet.zig?.balance).currency,
            walletInsufficient = if (wallet == null) state.value.walletInsufficient else dashboardWallet(wallet.activeWallet, wallet.balance, wallet.zig?.balance).insufficient,
            usdDebtBalance = if (wallet == null) state.value.usdDebtBalance else dashboardWallet(wallet.activeWallet, wallet.balance, wallet.zig?.balance).let { shown ->
                if (shown.showUsdDebt) shown.usdBalance else null
            },
            walletRestricted = wallet?.newDeliveriesRestricted ?: state.value.walletRestricted,
            activeRequestCount = requestCount ?: previous.activeRequestCount,
            activeDeliveryTotal = when {
                assignmentsUnknown -> null
                listed is ApiResult.Ok -> dashboardActiveCount(listed.value)
                else -> previous.activeDeliveryTotal
            },
            offers = offers ?: previous.offers,
            ownBids = bids.ownBidsFlow.value,
            flexibleCount = counts?.flexible,
            expressCount = counts?.express,
            committedV2 = committedV2,
            assignmentsUnknown = assignmentsUnknown,
            assignmentRefreshPending = listed is ApiResult.Err && failureUncertain,
            applicationSubmitted = submitted,
            locationNotice = availability.locationNotice.value,
            restartingLocation = locationRestart,
        )
    }

    fun retryLocationSharing() {
        viewModelScope.launch { availability.retryLocationSharing() }
    }

    fun restartLocationSharing() {
        if (locationRestart || state.value.locationNotice != LocationNotice.ServiceStopped) {
            return
        }
        locationRestart = true
        viewModelScope.launch {
            state.value = state.value.copy(restartingLocation = true)
            try {
                availability.retryLocationSharing()
            } finally {
                locationRestart = false
                state.value = state.value.copy(restartingLocation = false)
            }
        }
    }

    private suspend fun alignReceiving(loaded: RiderOnboarding?): RiderOnboarding? {
        if (loaded == null) {
            return null
        }
        return when (receivingAlignment(loaded.availability, loaded.receiving)) {
            ReceivingAlignment.Enable, ReceivingAlignment.ReleaseBusy -> when (val result = availability.online()) {
                is ApiResult.Ok -> loaded.copy(
                    availability = result.value.availability,
                    receiving = result.value.availability == "AVAILABLE",
                )
                is ApiResult.Err -> loaded
            }
            ReceivingAlignment.Disable -> when (val result = availability.offline()) {
                is ApiResult.Ok -> loaded.copy(availability = result.value.availability, receiving = false)
                is ApiResult.Err -> loaded
            }
            ReceivingAlignment.None -> loaded
        }
    }

    private fun applyWallet(wallet: WalletSummaryResponse) {
        val shown = dashboardWallet(wallet.activeWallet, wallet.balance, wallet.zig?.balance)
        state.value = state.value.copy(
            walletBalance = shown.balance,
            walletCurrency = shown.currency,
            walletInsufficient = shown.insufficient,
            usdDebtBalance = if (shown.showUsdDebt) shown.usdBalance else null,
            walletRestricted = wallet.newDeliveriesRestricted,
        )
    }

    private suspend fun refreshOfferCount() {
        if (dashboardBusy) {
            return
        }
        val current = state.value.onboarding
        if (!shouldPollMarketplace(appVisible = true, current?.availability, current?.receiving)) {
            return
        }
        val opened = bids.openRequests()
        if (dashboardBusy || opened !is ApiResult.Ok) {
            return
        }
        openRequests = opened.value
        bids.refreshOwnBids(null)
        if (dashboardBusy) {
            return
        }
        val actionable = newMarketplaceOffers(availableRequests(emptyList(), openRequests), bids.ownBidsFlow.value)
        state.value = state.value.copy(
            activeRequestCount = actionable.size,
            offers = actionable,
            ownBids = bids.ownBidsFlow.value,
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
    val offers: List<OfferResponse>?,
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

private fun ApiError.isRecoverable(): Boolean = dashboardFailureIsRecoverable(this)
