package com.riders.rider.feature.offers.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.availability.domain.LocationFreshness
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.domain.toActiveDelivery
import com.riders.rider.feature.offers.data.OfferRepository
import com.riders.rider.feature.offers.domain.AcceptedDelivery
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class OfferUi(
    val loading: Boolean = true,
    val offers: List<OfferResponse> = emptyList(),
    val selected: OfferResponse? = null,
    val accepting: Boolean = false,
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
    private val state = MutableStateFlow(OfferUi())
    val ui: StateFlow<OfferUi> = state.asStateFlow()

    init {
        viewModelScope.launch {
            while (isActive) {
                refresh()
                delay(4_000)
            }
        }
    }

    fun select(offer: OfferResponse?) {
        state.value = state.value.copy(selected = offer, error = null)
    }

    fun accept(offer: OfferResponse) {
        if (!freshness.canAccept(System.currentTimeMillis())) {
            state.value = state.value.copy(error = "A fresh location is required")
            return
        }
        if (state.value.accepting) {
            return
        }
        state.value = state.value.copy(accepting = true, error = null)
        viewModelScope.launch {
            try {
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
                            state.value = state.value.copy(error = "Your delivery could not be saved on this device.")
                            return@launch
                        }
                        state.value = state.value.copy(accepted = result.value, error = null)
                    }
                    is ApiResult.Err -> state.value = state.value.copy(error = result.error.text())
                }
            } finally {
                state.value = state.value.copy(accepting = false)
            }
        }
    }

    private suspend fun refresh() {
        when (val result = offers.list()) {
            is ApiResult.Ok -> state.value = state.value.copy(loading = false, offers = result.value, error = null)
            is ApiResult.Err -> state.value = state.value.copy(loading = false, error = result.error.text())
        }
    }
}
