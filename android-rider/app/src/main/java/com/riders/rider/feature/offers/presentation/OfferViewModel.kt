package com.riders.rider.feature.offers.presentation

import android.os.SystemClock
import com.riders.rider.core.design.NetworkLink
import com.riders.rider.core.design.RiderNetwork
import com.riders.rider.core.design.RidersToastEvent
import com.riders.rider.core.design.ridersSuccessToast
import androidx.lifecycle.ViewModel
import com.riders.rider.feature.bids.domain.shouldRefreshOwnBids
import kotlinx.coroutines.flow.first
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.availability.domain.LocationFreshness
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.delivery.domain.toActiveDelivery
import com.riders.rider.feature.bids.data.BidAttemptStore
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.bids.domain.BID_AMOUNT_INVALID
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.openBidForRequest
import com.riders.rider.feature.bids.domain.availableRequests
import com.riders.rider.feature.bids.domain.notificationBidRequest
import com.riders.rider.feature.bids.domain.bidAmountCents
import com.riders.rider.feature.bids.domain.bidRetryAmountProblem
import com.riders.rider.feature.bids.domain.formatBidDollars
import com.riders.rider.feature.bids.domain.keepsBidAttempt
import com.riders.rider.feature.bids.domain.marketplaceBidButtonsVisible
import com.riders.rider.feature.offers.data.OfferRepository
import com.riders.rider.feature.offers.domain.OfferActionProgress
import com.riders.rider.feature.offers.domain.OfferSubmitTarget
import com.riders.rider.feature.offers.domain.bidSubmissionAfterResult
import com.riders.rider.feature.offers.domain.RequestMapEvent
import com.riders.rider.feature.offers.domain.RequestMapSuccess
import com.riders.rider.feature.offers.domain.offerSentConfirmation
import com.riders.rider.feature.offers.domain.requestActionAllowed
import com.riders.rider.feature.offers.domain.searchAttemptKey
import com.riders.rider.feature.offers.domain.requestSettled
import com.riders.rider.feature.offers.domain.withoutSettledRequests
import com.riders.rider.feature.offers.domain.sentOffersAfterRefresh
import com.riders.rider.feature.offers.domain.AcceptedDelivery
import com.riders.rider.feature.offers.domain.OFFER_UNAVAILABLE
import com.riders.rider.feature.offers.domain.REQUEST_UNAVAILABLE
import com.riders.rider.feature.offers.domain.notificationRequestCanOpen
import com.riders.rider.feature.offers.notification.PendingOffer
import com.riders.rider.feature.offers.domain.OfferBoard
import com.riders.rider.feature.offers.domain.adjustedNowMillis
import com.riders.rider.feature.offers.domain.canAcceptOffer
import com.riders.rider.feature.offers.domain.offerBoardAfterLoad
import com.riders.rider.feature.offers.domain.offerIsExpired
import com.riders.rider.feature.offers.domain.requestAttemptIdentity
import com.riders.rider.feature.offers.domain.requestCountdownExpired
import com.riders.rider.feature.offers.domain.IncomingRequestGate
import com.riders.rider.feature.offers.domain.watchHomeRequests
import com.riders.rider.feature.offers.domain.OFFER_CLOCK_INTERVAL_MS
import com.riders.rider.feature.offers.domain.cachedNotificationOffer
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import com.riders.rider.feature.offers.domain.retainActionableRequests
import com.riders.rider.feature.offers.domain.stepIncomingRequest
import com.riders.rider.feature.offers.domain.matchingOfferIndex
import com.riders.rider.feature.offers.domain.offerUnavailableAfterRefresh
import com.riders.rider.feature.wallet.data.WalletRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OfferUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val requestsConfirmed: Boolean = false,
    val offers: List<OfferResponse> = emptyList(),
    val selected: OfferResponse? = null,
    val accepting: Boolean = false,
    val offerGone: Boolean = false,
    val nowMillis: Long = 0L,
    val error: String? = null,
    val bidError: String? = null,
    val accepted: AcceptedDelivery? = null,
    val submittingBid: Boolean = false,
    val submitProgress: OfferActionProgress? = null,
    val declining: Boolean = false,
    val placingBid: Boolean = false,
    val sentLabels: Map<String, String> = emptyMap(),
    val sentAmounts: Map<String, String> = emptyMap(),
    val ownBids: List<OwnBid> = emptyList(),
    val ownBidsKnown: Boolean = false,
    val bidListError: String? = null,
    val settledIds: Set<String> = emptySet(),
    val expirySeenAt: Map<String, Long> = emptyMap(),
    val retiredAttempts: Set<String> = emptySet(),
    val expiryDismissals: List<String> = emptyList(),
)

@HiltViewModel
class OfferViewModel @Inject constructor(
    private val offers: OfferRepository,
    private val deliveries: ActiveDeliveryStore,
    private val sessions: com.riders.rider.core.session.SessionStore,
    private val assignments: AssignmentRepository,
    private val bids: BidRepository,
    private val bidAttempts: BidAttemptStore,
    private val availability: AvailabilityRepository,
    private val freshness: LocationFreshness,
    private val pending: PendingOffer,
    private val wallets: WalletRepository,
) : ViewModel() {
    private val sessionIdentity = sessions.snapshot().identity
    private val state = MutableStateFlow(OfferUi(nowMillis = System.currentTimeMillis()))
    val ui: StateFlow<OfferUi> = state.asStateFlow()
    private val mapEvents = MutableSharedFlow<RequestMapEvent>(extraBufferCapacity = 1)
    val requestMapEvents: SharedFlow<RequestMapEvent> = mapEvents.asSharedFlow()
    private val toasts = MutableSharedFlow<RidersToastEvent>(extraBufferCapacity = 4)
    val successToasts = toasts.asSharedFlow()
    private var incomingGate = IncomingRequestGate()
    private val refreshLock = Mutex()
    private val refreshSignals = Channel<Unit>(Channel.CONFLATED)
    private var watchJob: Job? = null
    private var screenResumed = false
    private var pollingEnabled = false
    private var lastOwnBidSuccess: Long? = null
    private var bidRefreshVersion = 0L
    private var bidRefreshHandled = -1L

    fun nowMillis(): Long = adjustedNowMillis(System.currentTimeMillis(), bids.requestClockOffset)

    init {
        viewModelScope.launch {
            bids.ownBidPageFlow.collect { page ->
                val loaded = page.bids
                state.update {
                    it.copy(
                        ownBids = loaded,
                        // A renewed search can reuse the delivery ID. Do not keep a
                        // confirmation from an earlier, now expired/closed bid.
                        sentAmounts = if (it.ownBidsKnown) it.sentAmounts.filterKeys { id ->
                            loaded.any { bid -> bid.deliveryId == id.substringBefore('|') && bid.status == "OPEN" }
                        } else it.sentAmounts,
                        sentLabels = if (it.ownBidsKnown) it.sentLabels.filterKeys { id ->
                            loaded.any { bid -> bid.deliveryId == id.substringBefore('|') && bid.status == "OPEN" }
                        } else it.sentLabels,
                    )
                }
            }
        }
        viewModelScope.launch {
            bids.ownBidsKnownFlow.collect { known ->
                state.update { it.copy(ownBidsKnown = known) }
            }
        }
        viewModelScope.launch {
            bids.bidListProblemFlow.collect { problem ->
                state.update { it.copy(bidListError = problem) }
            }
        }
        viewModelScope.launch {
            pending.bidExpired.collect { scheduleBidRefresh() }
        }
        viewModelScope.launch {
            // New opportunities schedule a read but keep the last confirmed bid state.
            pending.arrived.collect { scheduleBidRefresh() }
        }
        viewModelScope.launch {
            pending.acceptedArrivals.collect { scheduleBidRefresh() }
        }
        viewModelScope.launch {
            pending.customerCancelledArrivals.collect { scheduleBidRefresh() }
        }
    }

    private fun scheduleBidRefresh() {
        bidRefreshVersion += 1
        refreshSignals.trySend(Unit)
    }

    private fun bidStatusDue(force: Boolean): Boolean = shouldRefreshOwnBids(
        bids.ownBidsKnownFlow.value,
        bids.ownBidPageFlow.value.bids.any { it.status == "OPEN" } || state.value.offers.isNotEmpty(),
        lastOwnBidSuccess, SystemClock.elapsedRealtime(), force || bidRefreshVersion != bidRefreshHandled,
    )

    private suspend fun refreshBidStatus(force: Boolean = false) {
        val version = bidRefreshVersion
        if (!bidStatusDue(force)) return
        if (bids.refreshOwnBids(null) is ApiResult.Ok) {
            lastOwnBidSuccess = SystemClock.elapsedRealtime()
            bidRefreshHandled = version
        }
    }

    fun setScreenResumed(resumed: Boolean, poll: Boolean = resumed) {
        if (screenResumed == resumed && pollingEnabled == poll) return
        screenResumed = resumed
        pollingEnabled = poll
        watchJob?.cancel()
        watchJob = null
        if (!resumed) return
        if (poll) {
            bidRefreshVersion += 1
            state.update { it.copy(requestsConfirmed = false) }
        }
        publishNow()
        watchJob = viewModelScope.launch {
            val clock = launch {
                while (true) {
                    state.first { it.offers.isNotEmpty() || it.selected != null }
                    publishNow()
                    delay(OFFER_CLOCK_INTERVAL_MS)
                }
            }
            try {
                if (poll) {
                    watchHomeRequests(refreshSignals, awaitReady = {}, refresh = {
                        refreshOffers()
                        true
                    })
                } else {
                    clock.join()
                }
            } finally {
                clock.cancel()
            }
        }
    }

    fun leaveHomeDashboard() {
        incomingGate = incomingGate.copy(catchUp = true, pendingMaximiseId = null, heldMaximiseId = null)
    }

    fun noteVisibleRequests(
        ids: List<String>,
        listSettled: Boolean,
        canMaximise: Boolean,
        suppressedIds: Set<String>,
        deferMaximise: Boolean,
    ): String? {
        val step = stepIncomingRequest(incomingGate, ids, listSettled, canMaximise, suppressedIds, deferMaximise)
        // Home consumes the decision in the same main-thread call, not through a lossy event flow.
        incomingGate = step.gate.copy(pendingMaximiseId = null)
        return step.maximiseId
    }

    suspend fun resolveNotificationRequest(assignmentId: String): OfferResponse? {
        // Same refresh and same filtered list as Home; never resurrect a settled/retired attempt.
        refreshOffers(reuseRecent = true, forceBids = true)
        val current = state.value
        return cachedNotificationOffer(assignmentId, current.offers, current.settledIds, nowMillis(), ::notificationBidRequest)
    }

    fun refresh() {
        if (pollingEnabled) refreshSignals.trySend(Unit)
        else viewModelScope.launch { refreshOffers() }
    }

    fun pullRefresh() {
        viewModelScope.launch {
            state.update { it.copy(refreshing = true) }
            try {
                refreshOffers(forceBids = true)
            } finally {
                state.update { it.copy(refreshing = false) }
            }
        }
    }

    fun openBid(offer: OfferResponse) {
        state.update { it.copy(selected = offer, placingBid = true, error = null, bidError = null, offerGone = false) }
    }

    fun expressInterest(offer: OfferResponse) {
        submitBidAmount(offer.deliveryId, offer.offeredPrice, offer.currency, offer, OfferSubmitTarget.Accept)
    }

    fun submitBid(deliveryId: String, amountText: String, currency: String, request: OfferResponse? = null) {
        submitBidAmount(deliveryId, amountText, currency, request, OfferSubmitTarget.YourOffer)
    }

    fun acknowledgeAccepted(deliveryId: String) {
        state.update { current ->
            if (current.accepted?.deliveryId == deliveryId) current.copy(accepted = null) else current
        }
    }

    fun decline(request: OfferResponse) {
        if (!sessions.isCurrent(sessionIdentity) || RiderNetwork.link.value == NetworkLink.Disconnected) return
        val deliveryId = request.deliveryId
        val current = state.value
        // Settle the exact search attempt that the rider saw.
        val deadline = request.searchExpiresAt
        if (current.offers.none { requestAttemptIdentity(it) == requestAttemptIdentity(request) } ||
            requestCountdownExpired(request.searchExpiresAt, request.expiresAt, nowMillis())) return
        if (!requestActionAllowed(deliveryId, current.settledIds, current.accepting, current.submittingBid, current.declining, deadline)) {
            return
        }
        val settledKey = searchAttemptKey(deliveryId, deadline)
        state.update { it.copy(declining = true, bidError = null) }
        viewModelScope.launch {
            when (val result = bids.decline(deliveryId)) {
                is ApiResult.Ok -> {
                    state.update { current ->
                        val settled = current.settledIds + settledKey
                        val selectedSettled = current.selected?.let {
                            requestSettled(it.deliveryId, it.searchExpiresAt, settled)
                        } == true
                        current.copy(
                            declining = false,
                            offers = withoutSettledRequests(current.offers, settled),
                            selected = if (selectedSettled) null else current.selected,
                            placingBid = if (selectedSettled) false else current.placingBid,
                            bidError = null,
                            settledIds = settled,
                        )
                    }
                    mapEvents.tryEmit(RequestMapEvent(deliveryId, RequestMapSuccess.Declined, deadline))
                    refresh()
                }
                is ApiResult.Err -> state.update { it.copy(declining = false, bidError = result.error.text()) }
            }
        }
    }

    private fun submitBidAmount(
        deliveryId: String,
        amountText: String,
        currency: String,
        request: OfferResponse? = null,
        target: OfferSubmitTarget = OfferSubmitTarget.Accept,
    ) {
        if (!sessions.isCurrent(sessionIdentity) || RiderNetwork.link.value == NetworkLink.Disconnected) return
        val cents = bidAmountCents(amountText)
        val now = nowMillis()
        if (cents == null) {
            state.update { it.copy(bidError = BID_AMOUNT_INVALID, nowMillis = now) }
            return
        }
        val current = state.value
        val deadline = searchDeadline(current, deliveryId, request)
        if (!requestActionAllowed(deliveryId, current.settledIds, current.accepting, current.submittingBid, current.declining, deadline)) {
            return
        }
        // The selected card must still refer to the current search attempt.
        val offer = current.offers.find { it.deliveryId == deliveryId &&
            (request == null || requestAttemptIdentity(it) == requestAttemptIdentity(request)) }
        if (offer == null || (current.offerGone && current.selected?.deliveryId == deliveryId) ||
            !notificationRequestCanOpen(true, offer.expiresAt, now) ||
            requestCountdownExpired(offer.searchExpiresAt, offer.expiresAt, now)) {
            state.update { it.copy(bidError = REQUEST_UNAVAILABLE, nowMillis = now) }
            refresh()
            return
        }
        if (openBidForRequest(bids.ownBidPageFlow.value.bids, deliveryId, offer.searchStartedAt) != null ||
            !marketplaceBidButtonsVisible(offer.serviceClass, bids.ownBidsKnownFlow.value, current.bidError ?: bids.bidListProblemFlow.value)) {
            return
        }
        state.update {
            it.copy(
                submittingBid = true,
                submitProgress = OfferActionProgress(deliveryId, target),
                error = null,
                bidError = null,
                nowMillis = now,
            )
        }
        viewModelScope.launch {
            try {
                val identity = sessionIdentity
                val previousAttempt = bidAttempts.pending(deliveryId)
                val attempt = bidAttempts.attempt(deliveryId, cents, offer.searchStartedAt)
                val retryProblem = bidRetryAmountProblem(attempt, cents)
                if (retryProblem != null) {
                    state.update { it.copy(bidError = retryProblem) }
                    return@launch
                }
                if (!sessions.isCurrent(identity)) return@launch
                val result = bids.submit(attempt.deliveryId, attempt.amountCents, attempt.key, currency)
                if (!sessions.isCurrent(identity)) return@launch
                when (result) {
                    is ApiResult.Ok -> {
                        bidAttempts.clear(deliveryId)
                        val sentAmount = formatBidDollars(attempt.amountCents)
                        state.update {
                            it.copy(
                                placingBid = false,
                                selected = null,
                                error = null,
                                bidError = null,
                                submittingBid = false,
                                submitProgress = null,
                                sentAmounts = it.sentAmounts + (searchAttemptKey(deliveryId, deadline) to sentAmount),
                                sentLabels = it.sentLabels + (searchAttemptKey(deliveryId, deadline) to offerSentConfirmation(currency, sentAmount)),
                                settledIds = it.settledIds + searchAttemptKey(deliveryId, deadline),
                                offers = withoutSettledRequests(it.offers, it.settledIds + searchAttemptKey(deliveryId, deadline)),
                            )
                        }
                        mapEvents.tryEmit(RequestMapEvent(deliveryId, RequestMapSuccess.OfferSent, deadline))
                        bids.refreshOwnBids(null)
                    }
                    is ApiResult.Err -> {
                        // A definitive first rejection permits a corrected amount. An ambiguous
                        // earlier submission retains its original idempotency key and amount.
                        if ((previousAttempt == null || previousAttempt.key != attempt.key) && !keepsBidAttempt(result.error)) bidAttempts.clear(deliveryId)
                        val outcome = bidSubmissionAfterResult(amountText, result.error.text())
                        state.update { it.copy(bidError = outcome.error, submittingBid = false, submitProgress = null) }
                    }
                }
            } catch (_: java.io.IOException) {
                state.update { it.copy(bidError = "Your offer could not be saved securely. Try again.") }
            } finally {
                state.update { current ->
                    val progress = current.submitProgress
                    val ours = progress?.deliveryId == deliveryId && progress.target == target
                    if (ours) current.copy(submittingBid = false, submitProgress = null) else current
                }
            }
        }
    }

    fun offerListedPrice(offer: OfferResponse) {
        submitBidAmount(offer.deliveryId, offer.offeredPrice, offer.currency, offer)
    }

    fun accept(offer: OfferResponse) {
        val identity = sessionIdentity
        if (!sessions.isCurrent(identity) || RiderNetwork.link.value == NetworkLink.Disconnected) return
        val current = state.value
        val now = nowMillis()
        if (!requestActionAllowed(offer.deliveryId, current.settledIds, current.accepting, current.submittingBid, current.declining, offer.searchExpiresAt)) {
            return
        }
        if (current.offerGone && current.selected?.deliveryId == offer.deliveryId) {
            state.update { it.copy(error = OFFER_UNAVAILABLE, nowMillis = now) }
            return
        }
        if (!canAcceptOffer(offer.expiresAt, now, accepting = false, unavailable = false)) {
            state.update { it.copy(error = "This offer has expired", nowMillis = now) }
            return
        }
        state.update {
            it.copy(
                accepting = true,
                submitProgress = OfferActionProgress(offer.deliveryId, OfferSubmitTarget.Accept),
                error = null,
                nowMillis = now,
            )
        }
        viewModelScope.launch {
            try {
                if (!freshness.canAccept(System.currentTimeMillis()) && !availability.refreshForAccept()) {
                    state.update { it.copy(error = "A fresh location is required") }
                    return@launch
                }
                if (!sessions.isCurrent(identity)) return@launch
                val result = offers.accept(offer.assignmentId)
                if (!sessions.isCurrent(identity)) return@launch
                when (result) {
                    null -> Unit
                    is ApiResult.Ok -> {
                        availability.applySharing()
                        assignments.refreshList()
                        viewModelScope.launch { wallets.summary() }
                        val saved = try {
                            deliveries.write(offer.toActiveDelivery(result.value.deliveryId, result.value.assignmentId, result.value.status), identity)
                            true
                        } catch (_: Exception) {
                            false
                        }
                        if (!saved) {
                            state.update { it.copy(error = "Your delivery could not be saved on this device.") }
                            return@launch
                        }
                        state.update {
                            it.copy(
                                accepted = result.value,
                                error = null,
                                offers = it.offers.filter { listed -> listed.deliveryId != offer.deliveryId },
                                settledIds = it.settledIds + searchAttemptKey(offer.deliveryId, offer.searchExpiresAt),
                            )
                        }
                        if (sessions.isCurrent(identity)) toasts.tryEmit(ridersSuccessToast("Delivery accepted"))
                        mapEvents.tryEmit(RequestMapEvent(offer.deliveryId, RequestMapSuccess.Accepted, offer.searchExpiresAt))
                    }
                    is ApiResult.Err -> state.update { it.copy(error = result.error.text()) }
                }
            } catch (_: java.io.IOException) {
                state.update { it.copy(error = "Your delivery could not be saved securely. Try again.") }
            } finally {
                state.update { current ->
                    val progress = current.submitProgress
                    val ours = progress?.deliveryId == offer.deliveryId && progress.target == OfferSubmitTarget.Accept
                    current.copy(accepting = false, submitProgress = if (ours) null else current.submitProgress)
                }
            }
        }
    }

    private fun searchDeadline(current: OfferUi, deliveryId: String, request: OfferResponse? = null): String? {
        return request?.takeIf { it.deliveryId == deliveryId }?.searchExpiresAt
            ?: current.offers.firstOrNull { it.deliveryId == deliveryId }?.searchExpiresAt
            ?: current.selected?.takeIf { it.deliveryId == deliveryId }?.searchExpiresAt
    }

    fun clearExpiryDismissals(handled: List<String>) {
        if (handled.isEmpty()) {
            return
        }
        val handledSet = handled.toSet()
        state.update { current ->
            val remaining = current.expiryDismissals.filterNot { it in handledSet }
            if (remaining.size == current.expiryDismissals.size) current else current.copy(expiryDismissals = remaining)
        }
    }

    private fun publishNow() {
        if (state.value.offers.isEmpty() && state.value.selected == null) return
        val now = nowMillis()
        state.update { current ->
            val board = retainActionableRequests(current.offers, current.expirySeenAt, current.retiredAttempts, now)
            val selectedExpired = current.selected?.let {
                it.expiresAt.isNotBlank() && offerIsExpired(it.expiresAt, now)
            } == true
            current.copy(
                nowMillis = now,
                offers = board.offers,
                expirySeenAt = board.seenAt,
                retiredAttempts = board.retired,
                expiryDismissals = if (board.justRetired.isEmpty()) current.expiryDismissals else current.expiryDismissals + board.justRetired,
                selected = if (selectedExpired) null else current.selected,
                placingBid = if (selectedExpired) false else current.placingBid,
                offerGone = if (selectedExpired) false else current.offerGone,
                bidError = if (selectedExpired) null else current.bidError,
                error = if (selectedExpired) "Offer expired" else current.error,
            )
        }
    }

    private suspend fun refreshOffers(reuseRecent: Boolean = false, forceBids: Boolean = false) {
        try {
            refreshLock.withLock {
                coroutineScope {
                    val due = bidStatusDue(forceBids)
                    val own = if (due) async { refreshBidStatus(force = true) } else null
                    val opened = bids.openRequests(reuseRecent = reuseRecent)
                    own?.await()
                    when (opened) {
                        is ApiResult.Ok -> {
                            if (!due && opened.value.isNotEmpty()) refreshBidStatus(force = true)
                            // Check beyond the first page only when the search start requires it.
                            if (opened.value.isNotEmpty()) bids.ensureRequestBidCoverage(opened.value)
                            applyListed(availableRequests(emptyList(), opened.value))
                        }
                        is ApiResult.Err -> keepOffers(opened.error.text())
                    }
                }
            }
        } finally {
            state.update { if (it.loading) it.copy(loading = false) else it }
        }
    }

    private fun applyListed(listed: List<OfferResponse>) {
        val now = nowMillis()
        state.update { current ->
            val board = retainActionableRequests(
                withoutSettledRequests(listed, current.settledIds),
                current.expirySeenAt,
                current.retiredAttempts,
                now,
            )
            val visible = board.offers
            val replacement = current.selected?.let { selected ->
                val index = matchingOfferIndex(
                    selected.assignmentId,
                    selected.deliveryId,
                    visible.map { it.assignmentId },
                    visible.map { it.deliveryId },
                )
                visible.getOrNull(index)
            }
            val selectedExpired = current.selected?.let {
                it.expiresAt.isNotBlank() && offerIsExpired(it.expiresAt, now)
            } == true
            val gone = offerUnavailableAfterRefresh(
                hadSelection = current.selected != null && !selectedExpired,
                stillPresent = replacement != null,
                refreshSucceeded = true,
            )
            current.copy(
                loading = false,
                requestsConfirmed = true,
                ownBids = bids.ownBidPageFlow.value.bids,
                ownBidsKnown = bids.ownBidsKnownFlow.value,
                bidListError = bids.bidListProblemFlow.value,
                offers = visible,
                expirySeenAt = board.seenAt,
                retiredAttempts = board.retired,
                expiryDismissals = if (board.justRetired.isEmpty()) current.expiryDismissals else current.expiryDismissals + board.justRetired,
                selected = if (selectedExpired) null else if (gone) current.selected else replacement,
                placingBid = if (selectedExpired) false else current.placingBid,
                offerGone = gone,
                nowMillis = now,
                error = if (selectedExpired) "Offer expired" else if (gone) OFFER_UNAVAILABLE else if (current.submittingBid) current.error else null,
                sentAmounts = sentOffersAfterRefresh(current.sentAmounts),
                sentLabels = sentOffersAfterRefresh(current.sentLabels),
            )
        }
    }

    private fun keepOffers(message: String) {
        state.update { current ->
            val board = offerBoardAfterLoad(OfferBoard(current.offers.size), null, message)
            current.copy(loading = board.loading, error = if (current.offerGone) current.error else board.error)
        }
    }
}
