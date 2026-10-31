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
import com.riders.rider.feature.bids.domain.bidAmountCents
import com.riders.rider.feature.bids.domain.marketplaceBidButtonsVisible
import com.riders.rider.feature.bids.domain.optimisticAmountsAfterServerRefresh
import com.riders.rider.feature.offers.data.ListedOffers
import com.riders.rider.feature.offers.data.OfferRepository
import com.riders.rider.feature.offers.domain.bidSubmissionAfterResult
import com.riders.rider.feature.offers.domain.canStartBidSubmit
import com.riders.rider.feature.offers.domain.offerSentConfirmation
import com.riders.rider.feature.offers.domain.sentOffersAfterRefresh
import com.riders.rider.feature.offers.domain.AcceptedDelivery
import com.riders.rider.feature.offers.domain.OFFER_UNAVAILABLE
import com.riders.rider.feature.offers.domain.REQUEST_UNAVAILABLE
import com.riders.rider.feature.offers.domain.notificationTapCanOpen
import com.riders.rider.feature.offers.notification.PendingOffer
import com.riders.rider.feature.offers.domain.OfferBoard
import com.riders.rider.feature.offers.domain.OfferRefreshGate
import com.riders.rider.feature.offers.domain.OfferWatch
import com.riders.rider.feature.offers.domain.adjustedNowMillis
import com.riders.rider.feature.offers.domain.canAcceptOffer
import com.riders.rider.feature.offers.domain.clockOffsetMillis
import com.riders.rider.feature.offers.domain.offerBoardAfterLoad
import com.riders.rider.feature.offers.domain.matchingOfferIndex
import com.riders.rider.feature.offers.domain.offerUnavailableAfterRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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
    val placingBid: Boolean = false,
    val sentLabels: Map<String, String> = emptyMap(),
    val sentAmounts: Map<String, String> = emptyMap(),
    val ownBids: List<OwnBid> = emptyList(),
    val ownBidsKnown: Boolean = false,
    val bidListError: String? = null,
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
) : ViewModel() {
    private val state = MutableStateFlow(OfferUi(nowMillis = System.currentTimeMillis()))
    val ui: StateFlow<OfferUi> = state.asStateFlow()
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

    init {
        viewModelScope.launch {
            bids.ownBidsFlow.collect { loaded ->
                state.update {
                    it.copy(
                        ownBids = loaded,
                        sentAmounts = optimisticAmountsAfterServerRefresh(it.sentAmounts, loaded),
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
        watch.setResumed(resumed)
    }

    fun openFromNotification(assignmentId: String) {
        viewModelScope.launch {
            val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
            when (val result = offers.list()) {
                is ApiResult.Ok if result.value.fromNetwork -> {
                    applyListed(result.value)
                    val match = availableRequests(result.value.offers, openRequests).find { it.assignmentId == assignmentId }
                    val canOpen = notificationTapCanOpen(match != null, match?.expiresAt, adjustedNowMillis(System.currentTimeMillis(), clockOffset))
                    state.update {
                        it.copy(
                            selected = if (canOpen) match else null,
                            offerGone = false,
                            error = if (canOpen) null else REQUEST_UNAVAILABLE,
                            nowMillis = now,
                        )
                    }
                }
                else -> state.update { it.copy(selected = null, offerGone = false, error = REQUEST_UNAVAILABLE, nowMillis = now) }
            }
            pending.clear()
        }
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

    fun select(offer: OfferResponse?) {
        state.update { it.copy(selected = offer, placingBid = false, error = null, bidError = null, offerGone = false) }
    }

    fun openBid(offer: OfferResponse) {
        state.update { it.copy(selected = offer, placingBid = true, error = null, bidError = null, offerGone = false) }
    }

    fun closeBid() {
        state.update { it.copy(placingBid = false) }
    }

    fun expressInterest(offer: OfferResponse) {
        submitBidAmount(offer.deliveryId, offer.offeredPrice, offer.currency)
    }

    fun submitBid(deliveryId: String, amountText: String, currency: String) {
        submitBidAmount(deliveryId, amountText, currency)
    }

    private fun submitBidAmount(deliveryId: String, amountText: String, currency: String) {
        val cents = bidAmountCents(amountText)
        val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
        if (cents == null) {
            state.update { it.copy(bidError = BID_AMOUNT_INVALID, nowMillis = now) }
            return
        }
        val current = state.value
        if (!canStartBidSubmit(current.submittingBid, current.accepting)) {
            return
        }
        val offer = current.offers.find { it.deliveryId == deliveryId }
        if (offer != null && !marketplaceBidButtonsVisible(offer.serviceClass, current.ownBidsKnown, current.bidError ?: current.bidListError)) {
            return
        }
        state.update { it.copy(submittingBid = true, error = null, bidError = null, nowMillis = now) }
        viewModelScope.launch {
            try {
                val attempt = bidAttempts.attempt(deliveryId, cents)
                when (val result = bids.submit(attempt.deliveryId, attempt.amountCents, attempt.key)) {
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
                            )
                        }
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
        submitBidAmount(offer.deliveryId, offer.offeredPrice, offer.currency)
    }

    fun accept(offer: OfferResponse) {
        val current = state.value
        val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
        if (current.accepting || current.submittingBid) {
            return
        }
        if (current.offerGone) {
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
                                sentLabels = it.sentLabels + (offer.deliveryId to "Offer sent"),
                            )
                        }
                    }
                    is ApiResult.Err -> state.update { it.copy(error = result.error.text()) }
                }
            } finally {
                state.update { it.copy(accepting = false) }
            }
        }
    }

    private fun publishNow() {
        val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
        state.update { it.copy(nowMillis = now) }
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
                    is ApiResult.Err -> keepOffers(result.error.text())
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
            val gone = offerUnavailableAfterRefresh(
                hadSelection = current.selected != null,
                stillPresent = replacement != null,
                refreshSucceeded = true,
            )
            current.copy(
                loading = false,
                offers = visible,
                selected = if (gone) current.selected else replacement,
                offerGone = gone,
                nowMillis = now,
                error = if (gone) OFFER_UNAVAILABLE else if (current.submittingBid) current.error else null,
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
