package com.riders.rider.feature.delivery.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.feature.delivery.domain.applyDeliveryTransition
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.delivery.domain.loadedDelivery
import com.riders.rider.feature.delivery.domain.nextDeliveryStatus
import com.riders.rider.feature.delivery.domain.releaseActionVisible
import com.riders.rider.feature.offers.data.OfferRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DeliveryUi(
    val deliveryId: String = "",
    val assignmentId: String = "",
    val status: String = "",
    val statusLabel: String = "",
    val nextStatus: String? = null,
    val nextLabel: String? = null,
    val canRelease: Boolean = false,
    val pickupAddress: String = "",
    val dropoffAddress: String = "",
    val error: String? = null,
    val finished: Boolean = false,
)

@HiltViewModel
class DeliveryViewModel @Inject constructor(
    private val offers: OfferRepository,
    private val deliveries: ActiveDeliveryStore,
    private val availability: AvailabilityRepository,
) : ViewModel() {
    private val state = MutableStateFlow(DeliveryUi())
    val ui: StateFlow<DeliveryUi> = state.asStateFlow()

    fun load(deliveryId: String) {
        viewModelScope.launch {
            val stored = loadedDelivery(deliveries.read(), emptyList(), deliveryId)
            state.value = if (stored == null) {
                DeliveryUi(deliveryId = deliveryId, error = "This phone does not have this delivery.")
            } else {
                view(stored, null, false)
            }
        }
    }

    fun advance() {
        val current = state.value
        val requested = current.nextStatus ?: return
        if (applyDeliveryTransition(current.status, requested) == null) {
            return
        }
        viewModelScope.launch {
            when (val result = offers.progress(current.deliveryId, requested)) {
                is ApiResult.Ok -> {
                    val finished = result.value.status == "DELIVERED"
                    availability.applySharing(result.value.availability)
                    val updated = if (finished) {
                        deliveries.clear()
                        null
                    } else {
                        deliveries.updateStatus(result.value.deliveryId, result.value.status)
                    }
                    state.value = view(
                        (updated ?: currentDelivery(current)).copy(status = result.value.status),
                        null,
                        finished,
                    )
                }
                is ApiResult.Err -> state.value = state.value.copy(error = result.error.text())
            }
        }
    }

    fun release(reason: String) {
        val assignmentId = state.value.assignmentId
        if (!releaseActionVisible(assignmentId.isNotEmpty(), state.value.status)) {
            return
        }
        viewModelScope.launch {
            when (val result = offers.release(assignmentId, reason)) {
                is ApiResult.Ok -> {
                    deliveries.clear()
                    availability.applySharing(result.value.availability)
                    state.value = state.value.copy(finished = true, error = null)
                }
                is ApiResult.Err -> state.value = state.value.copy(error = result.error.text())
            }
        }
    }

    private fun view(delivery: ActiveDelivery, error: String?, finished: Boolean): DeliveryUi {
        val next = nextDeliveryStatus(delivery.status)
        return DeliveryUi(
            deliveryId = delivery.deliveryId,
            assignmentId = delivery.assignmentId,
            status = delivery.status,
            statusLabel = deliveryStatusLabel(delivery.status),
            nextStatus = next,
            nextLabel = next?.let { deliveryStatusLabel(it) },
            canRelease = releaseActionVisible(delivery.assignmentId.isNotEmpty(), delivery.status),
            pickupAddress = delivery.pickupAddress,
            dropoffAddress = delivery.dropoffAddress,
            error = error,
            finished = finished,
        )
    }

    private fun currentDelivery(ui: DeliveryUi): ActiveDelivery {
        return ActiveDelivery(
            deliveryId = ui.deliveryId,
            assignmentId = ui.assignmentId,
            status = ui.status,
            pickupAddress = ui.pickupAddress,
            dropoffAddress = ui.dropoffAddress,
        )
    }
}
