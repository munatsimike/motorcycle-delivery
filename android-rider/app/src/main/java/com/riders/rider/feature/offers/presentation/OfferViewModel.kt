package com.riders.rider.feature.offers.presentation

import androidx.lifecycle.ViewModel
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
import com.riders.rider.feature.bids.domain.OpenBidRequest
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.availableRequests
import com.riders.rider.feature.bids.domain.notificationBidRequest
import com.riders.rider.feature.bids.domain.bidAmountCents
import com.riders.rider.feature.bids.domain.marketplaceBidButtonsVisible
import com.riders.rider.feature.bids.domain.optimisticAmountsAfterServerRefresh
import com.riders.rider.feature.offers.data.ListedOffers
import com.riders.rider.feature.offers.data.OfferRepository
import com.riders.rider.feature.offers.domain.bidSubmissionAfterResult
import com.riders.rider.feature.offers.domain.RequestMapEvent
import com.riders.rider.feature.offers.domain.RequestMapSuccess
import com.riders.rider.feature.offers.domain.offerSentConfirmation
import com.riders.rider.feature.offers.domain.requestActionAllowed
import com.riders.rider.feature.offers.domain.searchAttemptKey
import com.riders.rider.feature.offers.domain.sentOffersAfterRefresh
import com.riders.rider.feature.offers.domain.AcceptedDelivery
import com.riders.rider.feature.offers.domain.OFFER_UNAVAILABLE
import com.riders.rider.feature.offers.domain.REQUEST_UNAVAILABLE
import com.riders.rider.feature.offers.domain.notificationRequestCanOpen
import com.riders.rider.feature.offers.domain.openNotificationRequest
import com.riders.rider.feature.offers.notification.PendingOffer
import com.riders.rider.feature.offers.domain.OfferBoard
import com.riders.rider.feature.offers.domain.OfferRefreshGate
import com.riders.rider.feature.offers.domain.OfferWatch
import com.riders.rider.feature.offers.domain.adjustedNowMillis
import com.riders.rider.feature.offers.domain.canAcceptOffer
import com.riders.rider.feature.offers.domain.clockOffsetMillis
import com.riders.rider.feature.offers.domain.marketplaceOffersError
import com.riders.rider.feature.offers.domain.offerBoardAfterLoad
import com.riders.rider.feature.offers.domain.offerIsExpired
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
    val offers: List<OfferResponse> = emptyList(),
    val selected: OfferResponse? = null,
    val accepting: Boolean = false,
    val offerGone: Boolean = false,
    val nowMillis: Long = 0L,
    val error: String? = null,
    val bidError: String? = null,
    val accepted: AcceptedDelivery? = null,
    val submittingBid: Boolean = false,
    val declining: Boolean = false,
    val placingBid: Boolean = false,
    val sentLabels: Map<String, String> = emptyMap(),
    val sentAmounts: Map<String, String> = emptyMap(),
    val ownBids: List<OwnBid> = emptyList(),
    val ownBidsKnown: Boolean = false,
    val bidListError: String? = null,
    val settledIds: Set<String> = emptySet(),
)

@HiltViewModel
class OfferViewModel @Inject constructor(
    private val offers: OfferRepository,
    private val deliveries: ActiveDeliveryStore,
    private val assignments: AssignmentRepository,
    private val bids: BidRepository,
    private val bidAttempts: BidAttemptStore,
    private val availability: AvailabilityRepository,
    private val freshness: LocationFreshness,
    private val pending: PendingOffer,
    private val wallets: WalletRepository,
) : ViewModel() {
    private val state = MutableStateFlow(OfferUi(nowMillis = System.currentTimeMillis()))
    val ui: StateFlow<OfferUi> = state.asStateFlow()
    private val mapEvents = MutableSharedFlow<RequestMapEvent>(extraBufferCapacity = 1)
    val requestMapEvents: SharedFlow<RequestMapEvent> = mapEvents.asSharedFlow()
    private val refreshGate = OfferRefreshGate()
    private var openRequests = emptyList<OpenBidRequest>()
    private var presented = false
    private var clockOffset = 0L
    private val watch = OfferWatch(
        scope = viewModelScope,
        refresh = { refreshOffers() },
        tick = { publishNow() },
    )
    private var screenResumed = false
    private var requestsEnabled = true

    init {
        viewModelScope.launch {
            bids.ownBidsFlow.collect { loaded ->
                state.update {
                    it.copy(
                        ownBids = loaded,
                        // A renewed search can reuse the delivery ID. Do not keep a
                        // confirmation from an earlier, now expired/closed bid.
                        sentAmounts = if (it.ownBidsKnown) it.sentAmounts.filterKeys { id ->
                            loaded.any { bid -> bid.deliveryId == id && bid.status == "OPEN" }
                        } else it.sentAmounts,
                        sentLabels = if (it.ownBidsKnown) it.sentLabels.filterKeys { id ->
                            loaded.any { bid -> bid.deliveryId == id && bid.status == "OPEN" }
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
            pending.bidExpired.collect {
                if (screenResumed) refreshOffers()
            }
        }
        viewModelScope.launch {
            pending.arrived.collect {
                if (screenResumed) {
                    refreshOffers()
                }
            }
        }
    }

    fun setScreenResumed(resumed: Boolean) {
        screenResumed = resumed
        if (resumed) {
            publishNow()
        }
        watch.setResumed(resumed && requestsEnabled)
    }

    fun setRequestsEnabled(enabled: Boolean) {
        val becameEnabled = enabled && !requestsEnabled
        requestsEnabled = enabled
        watch.setResumed(screenResumed && enabled)
        if (becameEnabled && screenResumed) {
            viewModelScope.launch { refreshOffers() }
        }
    }

    suspend fun resolveNotificationRequest(assignmentId: String): OfferResponse? {
        val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
        val cached = state.value.offers.ifEmpty { availableRequests(emptyList(), openRequests) }
        val result = openNotificationRequest(
            scope = viewModelScope,
            tappedId = assignmentId,
            cached = cached,
            settled = state.value.settledIds,
            nowMillis = now,
            loadRequests = {
                when (val opened = bids.openRequests(reuseRecent = true)) {
                    is ApiResult.Ok -> {
                        openRequests = opened.value
                        availableRequests(emptyList(), opened.value)
                    }
                    else -> null
                }
            },
            loadOwnBids = { bids.refreshOwnBids(null) },
            match = ::notificationBidRequest,
        )
        if (result.confirmed) {
            applyListed(ListedOffers(emptyList(), fromNetwork = true, serverNowMillis = null))
        }
        state.update { it.copy(selected = null, offerGone = false, nowMillis = now, loading = false) }
        return result.offer
    }

    fun refresh() {
        viewModelScope.launch { refreshOffers() }
    }

    fun pullRefresh() {
        viewModelScope.launch {
            state.update { it.copy(refreshing = true) }
            try {
                refreshOffers()
            } finally {
                state.update { it.copy(refreshing = false) }
            }
        }
    }

    fun openBid(offer: OfferResponse) {
        state.update { it.copy(selected = offer, placingBid = true, error = null, bidError = null, offerGone = false) }
    }

    fun expressInterest(offer: OfferResponse) {
        submitBidAmount(offer.deliveryId, offer.offeredPrice, offer.currency, offer)
    }

    fun submitBid(deliveryId: String, amountText: String, currency: String, request: OfferResponse? = null) {
        submitBidAmount(deliveryId, amountText, currency, request)
    }

    fun acknowledgeAccepted(deliveryId: String) {
        state.update { current ->
            if (current.accepted?.deliveryId == deliveryId) current.copy(accepted = null) else current
        }
    }

    fun decline(deliveryId: String) {
        val current = state.value
        val deadline = searchDeadline(current, deliveryId)
        if (!requestActionAllowed(deliveryId, current.settledIds, current.accepting, current.submittingBid, current.declining, deadline)) {
            return
        }
        val settledKey = searchAttemptKey(deliveryId, deadline)
        viewModelScope.launch {
            state.update { it.copy(declining = true, bidError = null) }
            when (val result = bids.decline(deliveryId)) {
                is ApiResult.Ok -> {
                    openRequests = openRequests.filter { it.id != deliveryId }
                    state.update { current ->
                        current.copy(
                            declining = false,
                            offers = current.offers.filter { it.deliveryId != deliveryId },
                            selected = if (current.selected?.deliveryId == deliveryId) null else current.selected,
                            placingBid = if (current.selected?.deliveryId == deliveryId) false else current.placingBid,
                            bidError = null,
                            settledIds = current.settledIds + settledKey,
                        )
                    }
                    mapEvents.tryEmit(RequestMapEvent(deliveryId, RequestMapSuccess.Declined))
                    refreshOffers()
                }
                is ApiResult.Err -> state.update { it.copy(declining = false, bidError = result.error.text()) }
            }
        }
    }

    private fun submitBidAmount(deliveryId: String, amountText: String, currency: String, request: OfferResponse? = null) {
        val cents = bidAmountCents(amountText)
        val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
        if (cents == null) {
            state.update { it.copy(bidError = BID_AMOUNT_INVALID, nowMillis = now) }
            return
        }
        val current = state.value
        val deadline = searchDeadline(current, deliveryId, request)
        if (!requestActionAllowed(deliveryId, current.settledIds, current.accepting, current.submittingBid, current.declining, deadline)) {
            return
        }
        // The Home map and New requests page can have different refresh snapshots.
        // Use the explicitly displayed request when it matches the submitted delivery.
        val offer = current.offers.find { it.deliveryId == deliveryId }
            ?: request?.takeIf { it.deliveryId == deliveryId }
        if (offer == null || (current.offerGone && current.selected?.deliveryId == deliveryId) ||
            !notificationRequestCanOpen(true, offer.expiresAt, now)) {
            state.update { it.copy(bidError = REQUEST_UNAVAILABLE, nowMillis = now) }
            refresh()
            return
        }
        if (!marketplaceBidButtonsVisible(offer.serviceClass, current.ownBidsKnown, current.bidError ?: current.bidListError)) {
            return
        }
        state.update { it.copy(submittingBid = true, error = null, bidError = null, nowMillis = now) }
        viewModelScope.launch {
            try {
                val attempt = bidAttempts.attempt(deliveryId, cents)
                when (val result = bids.submit(attempt.deliveryId, attempt.amountCents, attempt.key, currency)) {
                    is ApiResult.Ok -> {
                        bidAttempts.clear(deliveryId)
                        val outcome = bidSubmissionAfterResult(amountText, null)
                        val sentAmount = outcome.amount ?: amountText
                        state.update {
                            it.copy(
                                placingBid = false,
                                selected = null,
                                error = null,
                                bidError = null,
                                submittingBid = false,
                                sentAmounts = it.sentAmounts + (deliveryId to sentAmount),
                                sentLabels = it.sentLabels + (deliveryId to offerSentConfirmation(currency, sentAmount)),
                                settledIds = it.settledIds + searchAttemptKey(deliveryId, deadline),
                            )
                        }
                        mapEvents.tryEmit(RequestMapEvent(deliveryId, RequestMapSuccess.OfferSent))
                        bids.refreshOwnBids(null)
                    }
                    is ApiResult.Err -> {
                        val outcome = bidSubmissionAfterResult(amountText, result.error.text())
                        state.update { it.copy(bidError = outcome.error, submittingBid = false) }
                    }
                }
            } finally {
                state.update { it.copy(submittingBid = false) }
            }
        }
    }

    fun offerListedPrice(offer: OfferResponse) {
        submitBidAmount(offer.deliveryId, offer.offeredPrice, offer.currency, offer)
    }

    fun accept(offer: OfferResponse) {
        val current = state.value
        val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
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
        state.update { it.copy(accepting = true, error = null, nowMillis = now) }
        viewModelScope.launch {
            try {
                if (!freshness.canAccept(System.currentTimeMillis()) && !availability.refreshForAccept()) {
                    state.update { it.copy(error = "A fresh location is required") }
                    return@launch
                }
                when (val result = offers.accept(offer.assignmentId)) {
                    null -> Unit
                    is ApiResult.Ok -> {
                        availability.applySharing()
                        assignments.refreshList()
                        viewModelScope.launch { wallets.summary() }
                        val saved = try {
                            deliveries.write(offer.toActiveDelivery(result.value.deliveryId, result.value.assignmentId, result.value.status))
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
                                settledIds = it.settledIds + searchAttemptKey(offer.deliveryId, offer.searchExpiresAt),
                            )
                        }
                        mapEvents.tryEmit(RequestMapEvent(offer.deliveryId, RequestMapSuccess.Accepted))
                    }
                    is ApiResult.Err -> state.update { it.copy(error = result.error.text()) }
                }
            } finally {
                state.update { it.copy(accepting = false) }
            }
        }
    }

    private fun searchDeadline(current: OfferUi, deliveryId: String, request: OfferResponse? = null): String? {
        return current.offers.firstOrNull { it.deliveryId == deliveryId }?.searchExpiresAt
            ?: request?.takeIf { it.deliveryId == deliveryId }?.searchExpiresAt
            ?: current.selected?.takeIf { it.deliveryId == deliveryId }?.searchExpiresAt
    }

    private fun publishNow() {
        val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
        state.update { current ->
            val active = current.offers.filterNot { it.expiresAt.isNotBlank() && offerIsExpired(it.expiresAt, now) }
            val selectedExpired = current.selected?.let {
                it.expiresAt.isNotBlank() && offerIsExpired(it.expiresAt, now)
            } == true
            current.copy(
                nowMillis = now,
                offers = active,
                selected = if (selectedExpired) null else current.selected,
                placingBid = if (selectedExpired) false else current.placingBid,
                offerGone = if (selectedExpired) false else current.offerGone,
                bidError = if (selectedExpired) null else current.bidError,
                error = if (selectedExpired) "Offer expired" else current.error,
            )
        }
    }

    private suspend fun refreshOffers() {
        refreshGate.run {
            try {
                if (!presented) {
                    state.update { it.copy(loading = true) }
                }
                val opened = bids.openRequests()
                if (opened is ApiResult.Ok) {
                    openRequests = opened.value
                }
                bids.refreshOwnBids(null)
                when (val result = offers.list()) {
                    is ApiResult.Ok -> applyListed(result.value)
                    is ApiResult.Err -> {
                        val blocked = marketplaceOffersError(opened is ApiResult.Ok, result.error.text())
                        if (blocked == null) {
                            applyListed(ListedOffers(emptyList(), fromNetwork = true, serverNowMillis = null))
                        } else {
                            keepOffers((opened as? ApiResult.Err)?.error?.text() ?: blocked)
                        }
                    }
                }
                presented = true
            } finally {
                state.update { current ->
                    if (current.loading) current.copy(loading = false) else current
                }
            }
        }
    }

    private fun applyListed(listed: ListedOffers) {
        if (!listed.fromNetwork) {
            keepOffers(ApiError.Network.text())
            return
        }
        if (listed.serverNowMillis != null) {
            clockOffset = clockOffsetMillis(listed.serverNowMillis, System.currentTimeMillis())
        }
        val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
        val visible = availableRequests(listed.offers, openRequests)
            .filterNot { it.expiresAt.isNotBlank() && offerIsExpired(it.expiresAt, now) }
        state.update { current ->
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
                offers = visible,
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
