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
import com.riders.rider.feature.delivery.domain.toActiveDelivery
import com.riders.rider.feature.offers.data.ListedOffers
import com.riders.rider.feature.offers.data.OfferRepository
import com.riders.rider.feature.offers.domain.AcceptedDelivery
import com.riders.rider.feature.offers.domain.OFFER_UNAVAILABLE
import com.riders.rider.feature.offers.domain.OfferBoard
import com.riders.rider.feature.offers.domain.OfferRefreshGate
import com.riders.rider.feature.offers.domain.OfferWatch
import com.riders.rider.feature.offers.domain.adjustedNowMillis
import com.riders.rider.feature.offers.domain.canAcceptOffer
import com.riders.rider.feature.offers.domain.clockOffsetMillis
import com.riders.rider.feature.offers.domain.offerBoardAfterLoad
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
    val offers: List<OfferResponse> = emptyList(),
    val selected: OfferResponse? = null,
    val accepting: Boolean = false,
    val offerGone: Boolean = false,
    val nowMillis: Long = 0L,
    val error: String? = null,
    val accepted: AcceptedDelivery? = null,
)

@HiltViewModel
class OfferViewModel @Inject constructor(
    private val offers: OfferRepository,
    private val deliveries: ActiveDeliveryStore,
    private val availability: AvailabilityRepository,
    private val freshness: LocationFreshness,
) : ViewModel() {
    private val state = MutableStateFlow(OfferUi(nowMillis = System.currentTimeMillis()))
    val ui: StateFlow<OfferUi> = state.asStateFlow()
    private val refreshGate = OfferRefreshGate()
    private var clockOffset = 0L
    private val watch = OfferWatch(
        scope = viewModelScope,
        refresh = { refreshOffers() },
        tick = { publishNow() },
    )

    fun setScreenResumed(resumed: Boolean) {
        if (resumed) {
            publishNow()
        }
        watch.setResumed(resumed)
    }

    fun refresh() {
        viewModelScope.launch { refreshOffers() }
    }

    fun select(offer: OfferResponse?) {
        state.update { it.copy(selected = offer, error = null, offerGone = false) }
    }

    fun accept(offer: OfferResponse) {
        val current = state.value
        val now = adjustedNowMillis(System.currentTimeMillis(), clockOffset)
        if (current.accepting) {
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
                        availability.applySharing(result.value.availability)
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
                        state.update { it.copy(accepted = result.value, error = null) }
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
                state.update { it.copy(loading = true) }
                when (val result = offers.list()) {
                    is ApiResult.Ok -> applyListed(result.value)
                    is ApiResult.Err -> keepOffers(result.error.text())
                }
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
        state.update { current ->
            val replacement = current.selected?.let { selected ->
                listed.offers.find { it.assignmentId == selected.assignmentId }
            }
            val gone = offerUnavailableAfterRefresh(
                hadSelection = current.selected != null,
                stillPresent = replacement != null,
                refreshSucceeded = true,
            )
            current.copy(
                loading = false,
                offers = listed.offers,
                selected = if (gone) current.selected else replacement,
                offerGone = gone,
                nowMillis = now,
                error = if (gone) OFFER_UNAVAILABLE else null,
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
