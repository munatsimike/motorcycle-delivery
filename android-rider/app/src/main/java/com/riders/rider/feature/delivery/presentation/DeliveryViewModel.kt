package com.riders.rider.feature.delivery.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.feature.delivery.domain.DeliveryActionGate
import com.riders.rider.feature.delivery.domain.DeliveryContacts
import com.riders.rider.feature.delivery.domain.DeliverySyncKind
import com.riders.rider.feature.delivery.domain.MAPS_UNAVAILABLE
import com.riders.rider.feature.delivery.domain.applyDeliveryTransition
import com.riders.rider.feature.delivery.domain.deliveryActionLabel
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.delivery.domain.deliveryStepTitle
import com.riders.rider.feature.delivery.domain.nextDeliveryStatus
import com.riders.rider.feature.delivery.domain.progressDecision
import com.riders.rider.feature.delivery.domain.releaseActionVisible
import com.riders.rider.feature.delivery.domain.syncOpenDelivery
import com.riders.rider.feature.offers.data.OfferRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class DeliveryBusy {
    None,
    Advance,
    Release,
}

data class DeliveryUi(
    val deliveryId: String = "",
    val assignmentId: String = "",
    val status: String = "",
    val title: String = "Delivery",
    val statusLabel: String = "",
    val nextStatus: String? = null,
    val nextLabel: String? = null,
    val canRelease: Boolean = false,
    val parcelDescription: String = "",
    val parcelSize: String = "",
    val parcelInstructions: String? = null,
    val pickupAddress: String = "",
    val pickupLandmark: String? = null,
    val pickupInstructions: String? = null,
    val dropoffAddress: String = "",
    val dropoffLandmark: String? = null,
    val dropoffInstructions: String? = null,
    val contacts: DeliveryContacts? = null,
    val syncing: Boolean = false,
    val refreshing: Boolean = false,
    val busy: DeliveryBusy = DeliveryBusy.None,
    val error: String? = null,
    val finished: Boolean = false,
)

@HiltViewModel
class DeliveryViewModel @Inject constructor(
    private val offers: OfferRepository,
    private val assignments: AssignmentRepository,
    private val deliveries: ActiveDeliveryStore,
    private val availability: AvailabilityRepository,
) : ViewModel() {
    private val state = MutableStateFlow(DeliveryUi())
    val ui: StateFlow<DeliveryUi> = state.asStateFlow()
    private val actions = DeliveryActionGate()
    private var opening = false

    fun load(deliveryId: String, fromUser: Boolean = false) {
        if (opening || state.value.busy != DeliveryBusy.None) {
            return
        }
        opening = true
        viewModelScope.launch {
            try {
                val stored = deliveries.read()?.takeIf { it.deliveryId == deliveryId }
                if (stored != null) {
                    state.update {
                        present(stored, it.error, it.contacts, syncing = true, busy = DeliveryBusy.None)
                            .copy(refreshing = fromUser)
                    }
                } else {
                    state.update { DeliveryUi(deliveryId = deliveryId, syncing = true, refreshing = fromUser) }
                }
                val sync = syncOpenDelivery(deliveryId, stored, assignments.lookup())
                when (sync.kind) {
                    DeliverySyncKind.Replace -> {
                        val snapshot = sync.snapshot ?: return@launch
                        deliveries.write(snapshot)
                        state.value = present(snapshot, null, sync.contacts, syncing = false, busy = DeliveryBusy.None)
                    }
                    DeliverySyncKind.Keep -> {
                        val snapshot = sync.snapshot
                        state.value = if (snapshot == null) {
                            DeliveryUi(deliveryId = deliveryId, error = sync.error ?: "This phone does not have this delivery.")
                        } else {
                            present(snapshot, sync.error, state.value.contacts, syncing = false, busy = DeliveryBusy.None)
                        }
                    }
                    DeliverySyncKind.Leave -> {
                        if (stored != null) {
                            deliveries.clear()
                        }
                        state.update { it.copy(syncing = false, finished = true, error = null, contacts = null) }
                    }
                }
            } finally {
                opening = false
                state.update { it.copy(refreshing = false) }
            }
        }
    }

    fun advance() {
        val current = state.value
        val requested = current.nextStatus ?: return
        if (current.syncing || current.busy != DeliveryBusy.None) {
            return
        }
        if (applyDeliveryTransition(current.status, requested) == null || !actions.tryStart()) {
            return
        }
        state.update { it.copy(busy = DeliveryBusy.Advance, error = null) }
        viewModelScope.launch {
            try {
                when (val result = offers.progress(current.deliveryId, requested)) {
                    is ApiResult.Ok -> {
                        val decision = progressDecision(current.status, result.value.status)
                        availability.applySharing(result.value.availability)
                        if (decision.finished) {
                            deliveries.clear()
                            state.update {
                                it.copy(
                                    status = decision.status,
                                    statusLabel = deliveryStatusLabel(decision.status),
                                    nextStatus = null,
                                    nextLabel = null,
                                    canRelease = false,
                                    finished = true,
                                    error = null,
                                )
                            }
                        } else if (decision.status != current.status) {
                            val updated = deliveries.updateStatus(current.deliveryId, decision.status)
                            val snapshot = updated ?: snapshotFrom(current).copy(status = decision.status)
                            state.value = present(snapshot, null, current.contacts, syncing = false, busy = DeliveryBusy.Advance)
                        }
                    }
                    is ApiResult.Err -> state.update { it.copy(error = result.error.text()) }
                }
            } finally {
                actions.finish()
                state.update { it.copy(busy = DeliveryBusy.None) }
            }
        }
    }

    fun reportNavigationFailure() {
        state.update { it.copy(error = MAPS_UNAVAILABLE) }
    }

    fun release(reason: String) {
        val current = state.value
        if (current.syncing || current.busy != DeliveryBusy.None) {
            return
        }
        if (!releaseActionVisible(current.assignmentId.isNotEmpty(), current.status) || !actions.tryStart()) {
            return
        }
        state.update { it.copy(busy = DeliveryBusy.Release, error = null) }
        viewModelScope.launch {
            try {
                when (val result = offers.release(current.assignmentId, reason)) {
                    is ApiResult.Ok -> {
                        deliveries.clear()
                        availability.applySharing(result.value.availability)
                        state.update { it.copy(finished = true, error = null, contacts = null) }
                    }
                    is ApiResult.Err -> state.update { it.copy(error = result.error.text()) }
                }
            } finally {
                actions.finish()
                state.update { it.copy(busy = DeliveryBusy.None) }
            }
        }
    }

    private fun present(
        delivery: ActiveDelivery,
        error: String?,
        contacts: DeliveryContacts?,
        syncing: Boolean,
        busy: DeliveryBusy,
        finished: Boolean = false,
    ): DeliveryUi {
        val next = nextDeliveryStatus(delivery.status)
        return DeliveryUi(
            deliveryId = delivery.deliveryId,
            assignmentId = delivery.assignmentId,
            status = delivery.status,
            title = deliveryStepTitle(delivery.status),
            statusLabel = deliveryStatusLabel(delivery.status),
            nextStatus = next,
            nextLabel = deliveryActionLabel(delivery.status),
            canRelease = releaseActionVisible(delivery.assignmentId.isNotEmpty(), delivery.status),
            parcelDescription = delivery.parcelDescription,
            parcelSize = delivery.parcelSize,
            parcelInstructions = delivery.parcelInstructions,
            pickupAddress = delivery.pickupAddress,
            pickupLandmark = delivery.pickupLandmark,
            pickupInstructions = delivery.pickupInstructions,
            dropoffAddress = delivery.dropoffAddress,
            dropoffLandmark = delivery.dropoffLandmark,
            dropoffInstructions = delivery.dropoffInstructions,
            contacts = contacts,
            syncing = syncing,
            busy = busy,
            error = error,
            finished = finished,
        )
    }

    private fun snapshotFrom(ui: DeliveryUi): ActiveDelivery {
        return ActiveDelivery(
            deliveryId = ui.deliveryId,
            assignmentId = ui.assignmentId,
            status = ui.status,
            parcelDescription = ui.parcelDescription,
            parcelSize = ui.parcelSize,
            parcelInstructions = ui.parcelInstructions,
            pickupAddress = ui.pickupAddress,
            pickupLandmark = ui.pickupLandmark,
            pickupInstructions = ui.pickupInstructions,
            dropoffAddress = ui.dropoffAddress,
            dropoffLandmark = ui.dropoffLandmark,
            dropoffInstructions = ui.dropoffInstructions,
        )
    }
}
