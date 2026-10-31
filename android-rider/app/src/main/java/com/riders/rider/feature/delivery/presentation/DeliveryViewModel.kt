package com.riders.rider.feature.delivery.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.delivery.data.TransitionKeyStore
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.DeliveryActionGate
import com.riders.rider.feature.delivery.domain.DeliveryContacts
import com.riders.rider.feature.delivery.domain.DeliverySyncKind
import com.riders.rider.feature.delivery.domain.DELIVERY_COMPLETED
import com.riders.rider.feature.delivery.domain.agreedPriceLabel
import com.riders.rider.feature.delivery.domain.cancellationNoteError
import com.riders.rider.feature.delivery.domain.cancellationResultMessage
import com.riders.rider.feature.delivery.domain.isIdempotencyConflict
import com.riders.rider.feature.delivery.domain.ASSIGNMENT_RECOVERY_MESSAGE
import com.riders.rider.feature.delivery.domain.AssignmentCertainty
import com.riders.rider.feature.delivery.domain.assignmentFailureIsUncertain
import com.riders.rider.feature.delivery.domain.hasCommittedV2
import com.riders.rider.feature.delivery.domain.parcelActionsAllowed
import com.riders.rider.feature.delivery.domain.recoverAssignments
import com.riders.rider.feature.delivery.domain.selectedParcel
import com.riders.rider.feature.delivery.domain.showsMarketplaceAssignment
import com.riders.rider.feature.delivery.domain.serviceClassLabel
import com.riders.rider.feature.delivery.domain.trackingStatusLabel
import com.riders.rider.feature.delivery.domain.v2RiderAction
import com.riders.rider.feature.delivery.domain.v2CancellationVisible
import com.riders.rider.feature.delivery.domain.v2StatusReached
import com.riders.rider.feature.delivery.domain.v2TapTarget
import com.riders.rider.feature.onboarding.data.OnboardingRepository
import com.riders.rider.feature.offers.domain.leavesAcceptUnresolved
import com.riders.rider.feature.delivery.domain.MAPS_UNAVAILABLE
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.delivery.domain.deliveryStepTitle
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
    val serviceClass: String? = null,
    val serviceClassLabel: String? = null,
    val agreedPrice: String? = null,
    val distanceMeters: Int? = null,
    val createdAt: String? = null,
    val completedAt: String? = null,
    val agreedPriceLabel: String? = null,
    val readOnly: Boolean = false,
    val missing: Boolean = false,
    val marketplaceParcel: Boolean = false,
    val cancelVisible: Boolean = false,
    val completionMessage: String? = null,
    val cancellationMessage: String? = null,
    val pendingCancelReason: String? = null,
    val pendingCancelNote: String? = null,
)

@HiltViewModel
class DeliveryViewModel @Inject constructor(
    private val offers: OfferRepository,
    private val assignments: AssignmentRepository,
    private val deliveries: ActiveDeliveryStore,
    private val availability: AvailabilityRepository,
    private val onboarding: OnboardingRepository,
    private val transitions: TransitionKeyStore,
) : ViewModel() {
    private val state = MutableStateFlow(DeliveryUi())
    val ui: StateFlow<DeliveryUi> = state.asStateFlow()
    private val actions = DeliveryActionGate()
    private var opening = false

    fun load(deliveryId: String, fromUser: Boolean = false, completed: Boolean = false) {
        if (completed) {
            loadCompleted(deliveryId, fromUser)
            return
        }
        if (opening || state.value.busy != DeliveryBusy.None) {
            return
        }
        opening = true
        viewModelScope.launch {
            try {
                val onboard = onboarding.loadCurrent()
                val openForNewBids = when (onboard) {
                    is ApiResult.Ok -> {
                        val present = onboard.value.receiving != null
                        assignments.rememberMarketplace(present)
                        present
                    }
                    is ApiResult.Err -> assignments.marketplace() == true
                }
                val listed = assignments.refreshList()
                val failureUncertain = listed is ApiResult.Err && assignmentFailureIsUncertain(listed.error)
                val recovery = recoverAssignments(
                    fetchSucceeded = listed is ApiResult.Ok,
                    fetched = (listed as? ApiResult.Ok)?.value.orEmpty(),
                    confirmed = assignments.current(),
                    confirmedThisProcess = assignments.hasConfirmedAssignments(),
                    failureUncertain = failureUncertain,
                )
                val useCommitted = parcelActionsAllowed(recovery.certainty) &&
                    (openForNewBids || hasCommittedV2(recovery.parcels.map { parcel -> parcel.serviceClass }))
                when {
                    useCommitted -> showCommitted(deliveryId, fromUser, listed)
                    recovery.certainty == AssignmentCertainty.Unknown -> state.value = DeliveryUi(
                        deliveryId = deliveryId,
                        syncing = false,
                        refreshing = false,
                        readOnly = true,
                        error = (listed as? ApiResult.Err)?.error?.text() ?: ASSIGNMENT_RECOVERY_MESSAGE,
                        title = "Delivery",
                    )
                    onboard is ApiResult.Err && listed is ApiResult.Err -> state.update {
                        it.copy(
                            deliveryId = deliveryId,
                            syncing = false,
                            refreshing = false,
                            readOnly = true,
                            error = onboard.error.text(),
                        )
                    }
                    else -> loadSingular(deliveryId, fromUser)
                }
            } finally {
                opening = false
                state.update { it.copy(refreshing = false) }
            }
        }
    }

    private fun loadCompleted(deliveryId: String, fromUser: Boolean) {
        if (opening || state.value.busy != DeliveryBusy.None) {
            return
        }
        val cached = assignments.completedParcel(deliveryId)
        if (cached != null && !fromUser) {
            state.value = presentCompleted(cached, null)
            return
        }
        opening = true
        if (cached == null) {
            state.value = DeliveryUi(deliveryId = deliveryId, syncing = true, refreshing = fromUser, readOnly = true, title = "Delivery")
        }
        viewModelScope.launch {
            try {
                when (val result = assignments.refreshCompleted()) {
                    is ApiResult.Ok -> {
                        val selected = result.value.firstOrNull { it.deliveryId == deliveryId }
                        state.value = if (selected == null) {
                            DeliveryUi(deliveryId = deliveryId, missing = true, readOnly = true, title = "Delivery")
                        } else {
                            presentCompleted(selected, null)
                        }
                    }
                    is ApiResult.Err -> {
                        val message = result.error.text()
                        state.value = if (cached != null) {
                            presentCompleted(cached, message)
                        } else {
                            DeliveryUi(deliveryId = deliveryId, readOnly = true, error = message, title = "Delivery")
                        }
                    }
                }
            } finally {
                opening = false
                state.update { it.copy(refreshing = false, syncing = false) }
            }
        }
    }

    private fun presentCompleted(parcel: CommittedParcel, error: String?): DeliveryUi {
        return DeliveryUi(
            deliveryId = parcel.deliveryId,
            assignmentId = parcel.assignmentId,
            status = parcel.status,
            title = "Delivery details",
            statusLabel = trackingStatusLabel(parcel.status),
            parcelDescription = parcel.parcelDescription,
            parcelSize = parcel.parcelSize,
            parcelInstructions = parcel.parcelInstructions,
            pickupAddress = parcel.pickupAddress,
            pickupLandmark = parcel.pickupLandmark,
            pickupInstructions = parcel.pickupInstructions,
            dropoffAddress = parcel.dropoffAddress,
            dropoffLandmark = parcel.dropoffLandmark,
            dropoffInstructions = parcel.dropoffInstructions,
            contacts = parcel.contacts,
            serviceClass = parcel.serviceClass,
            serviceClassLabel = serviceClassLabel(parcel.serviceClass),
            agreedPrice = parcel.agreedPrice,
            distanceMeters = parcel.distanceMeters,
            createdAt = parcel.completedAt ?: parcel.createdAt,
            completedAt = parcel.completedAt,
            agreedPriceLabel = agreedPriceLabel(parcel.agreedPrice),
            readOnly = true,
            marketplaceParcel = parcel.serviceClass == "EXPRESS" || parcel.serviceClass == "FLEXIBLE",
            error = error,
        )
    }

    private suspend fun showCommitted(deliveryId: String, fromUser: Boolean, result: ApiResult<List<CommittedParcel>>) {
        val stored = assignments.parcel(deliveryId)
        if (state.value.completionMessage != null || state.value.cancellationMessage != null) {
            return
        }
        state.value = if (stored == null) {
            DeliveryUi(deliveryId = deliveryId, syncing = true, refreshing = fromUser, readOnly = true)
        } else {
            presentParcel(stored, null).copy(syncing = true, refreshing = fromUser)
        }
        state.value = when (result) {
            is ApiResult.Ok -> {
                val selected = selectedParcel(result.value, deliveryId)
                if (selected == null) {
                    DeliveryUi(deliveryId = deliveryId, missing = true, marketplaceParcel = true, title = "Delivery")
                } else {
                    presentParcel(selected, null)
                }
            }
            is ApiResult.Err -> {
                val selected = assignments.parcel(deliveryId)
                if (selected == null) {
                    DeliveryUi(deliveryId = deliveryId, marketplaceParcel = true, error = result.error.text(), title = "Delivery")
                } else {
                    presentParcel(selected, result.error.text())
                }
            }
        }
    }

    private suspend fun loadSingular(deliveryId: String, fromUser: Boolean) {
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
                        val snapshot = sync.snapshot ?: return
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
    }

    fun advance() {
        val current = state.value
        if (current.marketplaceParcel) {
            advanceCommitted()
        }
    }

    fun confirmCancellation(reason: String, note: String) {
        val current = state.value
        if (!assignments.hasConfirmedAssignments() || !current.marketplaceParcel || !current.cancelVisible || current.completionMessage != null) {
            return
        }
        if (current.pendingCancelReason == null && reason.isBlank()) {
            return
        }
        val noteError = cancellationNoteError(reason, note)
        if (noteError != null && current.pendingCancelReason == null) {
            state.update { it.copy(error = noteError) }
            return
        }
        if (current.syncing || current.busy != DeliveryBusy.None || !actions.tryStart()) {
            return
        }
        state.update { it.copy(busy = DeliveryBusy.Release, error = null) }
        viewModelScope.launch {
            try {
                val attempt = transitions.cancellationKey(
                    current.assignmentId,
                    current.pendingCancelReason ?: reason,
                    current.pendingCancelNote ?: note.trim().ifEmpty { null },
                )
                when (val result = offers.cancelAssignment(attempt.assignmentId, attempt.reason, attempt.note, attempt.key)) {
                    is ApiResult.Ok -> {
                        transitions.clearCancellation(current.assignmentId)
                        transitions.clearProgress(current.deliveryId)
                        assignments.refreshList()
                        availability.applySharing()
                        state.update {
                            it.copy(
                                cancellationMessage = cancellationResultMessage(result.value.reopened),
                                cancelVisible = false,
                                nextStatus = null,
                                nextLabel = null,
                                error = null,
                                pendingCancelReason = null,
                                pendingCancelNote = null,
                            )
                        }
                    }
                    is ApiResult.Err -> settleCancellationFailure(current.deliveryId, current.assignmentId, result.error.text(), result.error)
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

    private fun advanceCommitted() {
        val current = state.value
        if (!assignments.hasConfirmedAssignments() || current.syncing || current.busy != DeliveryBusy.None || current.completionMessage != null) {
            return
        }
        if (!actions.tryStart()) {
            return
        }
        state.update { it.copy(busy = DeliveryBusy.Advance, error = null) }
        viewModelScope.launch {
            try {
                val pending = transitions.clearProgressIfCommitted(current.deliveryId, current.status)
                val target = v2TapTarget(current.status, pending?.targetStatus) ?: return@launch
                val attempt = transitions.progressKey(current.deliveryId, target)
                if (attempt.targetStatus != target) {
                    return@launch
                }
                when (val result = offers.progressWithKey(current.deliveryId, attempt.targetStatus, attempt.key)) {
                    is ApiResult.Ok -> {
                        val confirmed = result.value.status
                        if (!v2StatusReached(confirmed, attempt.targetStatus)) {
                            settleProgressFailure(
                                current.deliveryId,
                                attempt.targetStatus,
                                "This delivery status cannot be changed",
                                com.riders.rider.core.network.ApiError.Conflict("This delivery status cannot be changed"),
                            )
                            return@launch
                        }
                        transitions.clearProgress(current.deliveryId)
                        assignments.confirmStatus(current.deliveryId, confirmed)
                        assignments.refreshList()
                        availability.applySharing()
                        if (confirmed == "DELIVERED") {
                            state.update {
                                it.copy(
                                    status = confirmed,
                                    statusLabel = trackingStatusLabel(confirmed),
                                    title = "Delivery details",
                                    nextStatus = null,
                                    nextLabel = null,
                                    cancelVisible = false,
                                    completionMessage = DELIVERY_COMPLETED,
                                    error = null,
                                )
                            }
                        } else {
                            val selected = assignments.parcel(current.deliveryId)?.copy(status = confirmed) ?: return@launch
                            state.value = presentParcel(selected, null)
                        }
                    }
                    is ApiResult.Err -> settleProgressFailure(current.deliveryId, attempt.targetStatus, result.error.text(), result.error)
                }
            } finally {
                actions.finish()
                state.update { it.copy(busy = DeliveryBusy.None) }
            }
        }
    }

    private suspend fun settleProgressFailure(deliveryId: String, targetStatus: String, message: String, error: com.riders.rider.core.network.ApiError) {
        assignments.refreshList()
        val selected = assignments.parcel(deliveryId)
        if (selected != null && v2StatusReached(selected.status, targetStatus)) {
            transitions.clearProgress(deliveryId)
        }
        state.value = if (selected == null) {
            DeliveryUi(deliveryId = deliveryId, marketplaceParcel = true, error = message, title = "Delivery")
        } else {
            presentParcel(selected, message)
        }
    }

    private suspend fun settleCancellationFailure(deliveryId: String, assignmentId: String, message: String, error: com.riders.rider.core.network.ApiError) {
        assignments.refreshList()
        val selected = assignments.parcel(deliveryId)
        if (selected == null && !error.leavesAcceptUnresolved()) {
            transitions.clearCancellation(assignmentId)
            transitions.clearProgress(deliveryId)
        }
        val pending = transitions.pendingCancellation(assignmentId)
        state.value = if (selected == null) {
            DeliveryUi(
                deliveryId = deliveryId,
                marketplaceParcel = true,
                error = if (isIdempotencyConflict(error)) message else message,
                title = "Delivery",
                missing = !isIdempotencyConflict(error),
            )
        } else {
            presentParcel(selected, message).copy(
                pendingCancelReason = pending?.reason,
                pendingCancelNote = pending?.note,
            )
        }
    }

    private suspend fun presentParcel(parcel: CommittedParcel, error: String?): DeliveryUi {
        val pending = transitions.clearProgressIfCommitted(parcel.deliveryId, parcel.status)
            ?: transitions.pendingProgress(parcel.deliveryId)
        val marketplace = showsMarketplaceAssignment(parcel)
        val target = if (marketplace) v2TapTarget(parcel.status, pending?.targetStatus) else null
        val cancellation = transitions.pendingCancellation(parcel.assignmentId)
        return DeliveryUi(
            deliveryId = parcel.deliveryId,
            assignmentId = parcel.assignmentId,
            status = parcel.status,
            title = "Delivery details",
            statusLabel = trackingStatusLabel(parcel.status),
            nextStatus = target,
            nextLabel = if (marketplace) v2RiderAction(parcel.status) else null,
            parcelDescription = parcel.parcelDescription,
            parcelSize = parcel.parcelSize,
            parcelInstructions = parcel.parcelInstructions,
            pickupAddress = parcel.pickupAddress,
            pickupLandmark = parcel.pickupLandmark,
            pickupInstructions = parcel.pickupInstructions,
            dropoffAddress = parcel.dropoffAddress,
            dropoffLandmark = parcel.dropoffLandmark,
            dropoffInstructions = parcel.dropoffInstructions,
            contacts = parcel.contacts,
            serviceClass = parcel.serviceClass,
            serviceClassLabel = serviceClassLabel(parcel.serviceClass),
            agreedPrice = parcel.agreedPrice,
            distanceMeters = parcel.distanceMeters,
            createdAt = parcel.createdAt,
            agreedPriceLabel = agreedPriceLabel(parcel.agreedPrice),
            readOnly = !marketplace,
            marketplaceParcel = marketplace,
            cancelVisible = marketplace && v2CancellationVisible(parcel.status),
            pendingCancelReason = cancellation?.reason,
            pendingCancelNote = cancellation?.note,
            error = error,
        )
    }

    private fun present(
        delivery: ActiveDelivery,
        error: String?,
        contacts: DeliveryContacts?,
        syncing: Boolean,
        busy: DeliveryBusy,
        finished: Boolean = false,
    ): DeliveryUi {
        return DeliveryUi(
            deliveryId = delivery.deliveryId,
            assignmentId = delivery.assignmentId,
            status = delivery.status,
            title = deliveryStepTitle(delivery.status),
            statusLabel = deliveryStatusLabel(delivery.status),
            readOnly = true,
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
            serviceClass = delivery.serviceClass,
            agreedPrice = delivery.agreedPrice,
            distanceMeters = delivery.distanceMeters,
            createdAt = delivery.createdAt,
            agreedPriceLabel = agreedPriceLabel(delivery.agreedPrice),
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
            serviceClass = ui.serviceClass,
            distanceMeters = ui.distanceMeters,
            createdAt = ui.createdAt,
            agreedPrice = ui.agreedPrice,
        )
    }
}
