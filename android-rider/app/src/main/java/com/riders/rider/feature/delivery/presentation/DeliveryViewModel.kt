package com.riders.rider.feature.delivery.presentation

import com.riders.rider.core.design.RidersToastEvent
import com.riders.rider.core.design.ridersSuccessToast
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.MutableSharedFlow
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
import com.riders.rider.feature.delivery.domain.DELIVERY_STATUS_UNAVAILABLE
import com.riders.rider.feature.delivery.domain.blockedDeliveryConfirmationMessage
import com.riders.rider.feature.delivery.domain.HISTORY_CUSTOMER_CANCELLATION
import com.riders.rider.feature.delivery.domain.HISTORY_RIDER_CANCELLATION
import com.riders.rider.feature.delivery.domain.agreedPriceLabel
import com.riders.rider.feature.delivery.domain.invalidatesHistory
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
import com.riders.rider.feature.delivery.domain.trackingStatusLabel
import com.riders.rider.feature.delivery.domain.v2RiderAction
import com.riders.rider.feature.delivery.domain.v2CancellationVisible
import com.riders.rider.feature.delivery.domain.v2StatusReached
import com.riders.rider.feature.delivery.domain.v2TapTarget
import com.riders.rider.feature.onboarding.data.OnboardingRepository
import com.riders.rider.feature.offers.domain.leavesAcceptUnresolved
import com.riders.rider.feature.delivery.domain.deliveryStatusLabel
import com.riders.rider.feature.delivery.domain.deliveryStepTitle
import com.riders.rider.feature.delivery.domain.syncOpenDelivery
import com.riders.rider.feature.offers.data.OfferRepository
import com.riders.rider.feature.home.deliveryStatusRefreshesWallet
import com.riders.rider.feature.wallet.data.WalletRepository
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
    val serviceClass: String? = null,
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
    val agreedPrice: String? = null,
    val currency: String = "USD",
    val paymentMethod: String? = null,
    val distanceMeters: Int? = null,
    val createdAt: String? = null,
    val completedAt: String? = null,
    val cancelledAt: String? = null,
    val cancelledBy: String? = null,
    val cancellationReason: String? = null,
    val cancellationNote: String? = null,
    val agreedPriceLabel: String? = null,
    val readOnly: Boolean = false,
    val missing: Boolean = false,
    val marketplaceParcel: Boolean = false,
    val cancelVisible: Boolean = false,
    val completionMessage: String? = null,
    val cancellationMessage: String? = null,
    val riderCancelled: Boolean = false,
    val pendingCancelReason: String? = null,
    val pendingCancelNote: String? = null,
)

@HiltViewModel
class DeliveryViewModel @Inject constructor(
    private val offers: OfferRepository,
    private val assignments: AssignmentRepository,
    private val deliveries: ActiveDeliveryStore,
    private val sessions: com.riders.rider.core.session.SessionStore,
    private val availability: AvailabilityRepository,
    private val onboarding: OnboardingRepository,
    private val transitions: TransitionKeyStore,
    private val wallets: WalletRepository,
) : ViewModel() {
    private val state = MutableStateFlow(DeliveryUi())
    val ui: StateFlow<DeliveryUi> = state.asStateFlow()
    private val toasts = MutableSharedFlow<RidersToastEvent>(extraBufferCapacity = 4)
    val successToasts = toasts.asSharedFlow()
    private val actions = DeliveryActionGate()
    private var opening = false
    private var eventReload: String? = null
    private var cancellationRefresh = false
    fun refreshForCancellation(deliveryId: String) {
        if (invalidatesHistory(HISTORY_CUSTOMER_CANCELLATION)) assignments.invalidateCompleted()
        eventReload = deliveryId
        state.update { it.copy(readOnly = true) }
        drainEventReload()
    }
    private fun drainEventReload() {
        if (opening || state.value.busy != DeliveryBusy.None) return
        val id = eventReload ?: return
        eventReload = null
        cancellationRefresh = true
        state.update { it.copy(readOnly = true) }
        load(id)
    }

    private val sessionIdentity = sessions.snapshot().identity

    fun load(deliveryId: String, fromUser: Boolean = false, completed: Boolean = false, assignmentId: String = "") {
        if (!sessions.isCurrent(sessionIdentity)) return
        if (completed) {
            loadCompleted(deliveryId, fromUser, assignmentId)
            return
        }
        if (state.value.riderCancelled || opening || state.value.busy != DeliveryBusy.None) {
            return
        }
        if (state.value.status.isBlank() && state.value.pickupAddress.isBlank() && state.value.parcelDescription.isBlank()) {
            state.value = DeliveryUi(deliveryId = deliveryId, syncing = true, refreshing = fromUser)
        } else if (fromUser) {
            state.update { it.copy(refreshing = true) }
        }
        opening = true
        viewModelScope.launch {
            try {
                val onboard = onboarding.loadCurrent(shareInFlight = !fromUser)
                val openForNewBids = when (onboard) {
                    is ApiResult.Ok -> {
                        val present = onboard.value.receiving != null
                        assignments.rememberMarketplace(present)
                        present
                    }
                    is ApiResult.Err -> assignments.marketplace() == true
                }
                val listed = assignments.refreshList()
                if (cancellationRefresh && listed is ApiResult.Err) {
                    state.update { it.copy(readOnly = true, syncing = false, error = listed.error.text()) }
                    return@launch
                }
                if (listed is ApiResult.Ok) cancellationRefresh = false
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
                if (state.value.riderCancelled) {
                    return@launch
                }
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
            } catch (_: java.io.IOException) {
                state.update { it.copy(syncing = false, readOnly = true, error = "Delivery data could not be read securely. Try again.") }
            } finally {
                opening = false
                state.update { it.copy(refreshing = false) }
                drainEventReload()
            }
        }
    }

    private fun loadCompleted(deliveryId: String, fromUser: Boolean, assignmentId: String) {
        if (opening || state.value.busy != DeliveryBusy.None) {
            return
        }
        val assignment = assignmentId.trim()
        val cached = if (assignment.isNotEmpty()) assignments.historyParcel(assignment) else assignments.completedParcel(deliveryId)
        if (cached != null && !fromUser) {
            state.value = presentCompleted(cached, null)
            return
        }
        opening = true
        if (cached == null) {
            state.value = DeliveryUi(deliveryId = deliveryId, assignmentId = assignment, syncing = true, refreshing = fromUser, readOnly = true, title = "Delivery")
        }
        viewModelScope.launch {
            try {
                when (val result = if (assignment.isNotEmpty()) assignments.findHistory(assignment) else assignments.findCompleted(deliveryId)) {
                    is ApiResult.Ok -> {
                        val selected = result.value
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
            serviceClass = parcel.serviceClass,
            parcelSize = parcel.parcelSize,
            parcelInstructions = parcel.parcelInstructions,
            pickupAddress = parcel.pickupAddress,
            pickupLandmark = parcel.pickupLandmark,
            pickupInstructions = parcel.pickupInstructions,
            dropoffAddress = parcel.dropoffAddress,
            dropoffLandmark = parcel.dropoffLandmark,
            dropoffInstructions = parcel.dropoffInstructions,
            contacts = parcel.contacts,
            agreedPrice = parcel.agreedPrice,
            currency = parcel.currency,
            paymentMethod = parcel.paymentMethod,
            distanceMeters = parcel.distanceMeters,
            createdAt = parcel.createdAt,
            completedAt = parcel.completedAt,
            cancelledAt = parcel.cancelledAt,
            cancelledBy = parcel.cancelledBy,
            cancellationReason = parcel.cancellationReason,
            cancellationNote = parcel.cancellationNote,
            agreedPriceLabel = agreedPriceLabel(parcel.agreedPrice, parcel.currency),
            readOnly = true,
            marketplaceParcel = parcel.serviceClass == "EXPRESS" || parcel.serviceClass == "FLEXIBLE",
            error = error,
        )
    }

    private suspend fun showCommitted(deliveryId: String, fromUser: Boolean, result: ApiResult<List<CommittedParcel>>) {
        val stored = assignments.parcel(deliveryId)
        if (state.value.riderCancelled || state.value.completionMessage != null || state.value.cancellationMessage != null) {
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
                val identity = sessionIdentity
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
                if (!sessions.isCurrent(identity)) return
                when (sync.kind) {
                    DeliverySyncKind.Replace -> {
                        val snapshot = sync.snapshot ?: return
                        deliveries.write(snapshot, identity)
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
                            deliveries.clear(identity)
                            refreshWallet()
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
        if (!sessions.isCurrent(sessionIdentity)) return
        val current = state.value
        if (current.readOnly || !assignments.hasConfirmedAssignments() || !current.marketplaceParcel || !current.cancelVisible || current.completionMessage != null) {
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
                if (!sessions.isCurrent(sessionIdentity)) return@launch
                val result = offers.cancelAssignment(attempt.assignmentId, attempt.reason, attempt.note, attempt.key)
                if (!sessions.isCurrent(sessionIdentity)) return@launch
                when (result) {
                    is ApiResult.Ok -> {
                        transitions.clearCancellation(current.assignmentId)
                        transitions.clearProgress(current.deliveryId)
                        assignments.dropAssignment(current.assignmentId)
                        if (invalidatesHistory(HISTORY_RIDER_CANCELLATION)) assignments.invalidateCompleted()
                        val refreshed = assignments.refreshList()
                        if (refreshed is ApiResult.Ok && refreshed.value.any { it.assignmentId == current.assignmentId }) {
                            assignments.dropAssignment(current.assignmentId)
                        }
                        availability.applySharing()
                        refreshWallet()
                        state.update {
                            it.copy(
                                riderCancelled = true,
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
            } catch (_: java.io.IOException) {
                state.update { it.copy(error = "Delivery retry data could not be saved securely. Try again.") }
            } finally {
                actions.finish()
                state.update { it.copy(busy = DeliveryBusy.None) }
                drainEventReload()
            }
        }
    }

    private fun advanceCommitted() {
        if (!sessions.isCurrent(sessionIdentity)) return
        val current = state.value
        if (current.readOnly) return
        val blocked = blockedDeliveryConfirmationMessage(
            marketplaceParcel = current.marketplaceParcel,
            assignmentsConfirmed = assignments.hasConfirmedAssignments(),
            syncing = current.syncing,
            busy = current.busy != DeliveryBusy.None,
            completed = current.completionMessage != null,
        )
        if (blocked != null) {
            state.update { it.copy(error = blocked) }
            return
        }
        if (!current.marketplaceParcel || current.busy != DeliveryBusy.None || current.completionMessage != null) {
            return
        }
        if (!actions.tryStart()) {
            return
        }
        state.update { it.copy(busy = DeliveryBusy.Advance, error = null) }
        viewModelScope.launch {
            try {
                val pending = transitions.clearProgressIfCommitted(current.deliveryId, current.status)
                val target = v2TapTarget(current.status, pending?.targetStatus)
                if (target == null) {
                    state.update { it.copy(error = DELIVERY_STATUS_UNAVAILABLE) }
                    return@launch
                }
                val attempt = transitions.progressKey(current.deliveryId, target)
                if (attempt.targetStatus != target) {
                    state.update { it.copy(error = DELIVERY_STATUS_UNAVAILABLE) }
                    return@launch
                }
                if (!sessions.isCurrent(sessionIdentity)) return@launch
                val result = offers.progressWithKey(current.deliveryId, attempt.targetStatus, attempt.key)
                if (!sessions.isCurrent(sessionIdentity)) return@launch
                when (result) {
                    is ApiResult.Ok -> {
                        val confirmed = result.value.status
                        if (!v2StatusReached(confirmed, attempt.targetStatus)) {
                            settleProgressFailure(
                                current.deliveryId,
                                attempt.targetStatus,
                                DELIVERY_STATUS_UNAVAILABLE,
                                com.riders.rider.core.network.ApiError.Conflict(DELIVERY_STATUS_UNAVAILABLE),
                            )
                            return@launch
                        }
                        transitions.clearProgress(current.deliveryId)
                        assignments.confirmStatus(current.deliveryId, confirmed)
                        assignments.refreshList()
                        availability.applySharing()
                        if (deliveryStatusRefreshesWallet(confirmed)) {
                            refreshWallet()
                        }
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
                            if (sessions.isCurrent(sessionIdentity)) toasts.tryEmit(ridersSuccessToast(DELIVERY_COMPLETED))
                        } else {
                            val selected = assignments.parcel(current.deliveryId)?.copy(status = confirmed)
                            if (selected == null) {
                                state.update { it.copy(error = "Your delivery could not be saved on this device.") }
                                return@launch
                            }
                            state.value = presentParcel(selected, null)
                        }
                    }
                    is ApiResult.Err -> settleProgressFailure(current.deliveryId, attempt.targetStatus, result.error.text(), result.error)
                }
            } catch (_: java.io.IOException) {
                state.update { it.copy(error = "Delivery retry data could not be saved securely. Try again.") }
            } finally {
                actions.finish()
                state.update { it.copy(busy = DeliveryBusy.None) }
                drainEventReload()
            }
        }
    }

    private fun refreshWallet() {
        viewModelScope.launch { wallets.summary() }
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
            serviceClass = parcel.serviceClass,
            parcelSize = parcel.parcelSize,
            parcelInstructions = parcel.parcelInstructions,
            pickupAddress = parcel.pickupAddress,
            pickupLandmark = parcel.pickupLandmark,
            pickupInstructions = parcel.pickupInstructions,
            dropoffAddress = parcel.dropoffAddress,
            dropoffLandmark = parcel.dropoffLandmark,
            dropoffInstructions = parcel.dropoffInstructions,
            contacts = parcel.contacts,
            agreedPrice = parcel.agreedPrice,
            currency = parcel.currency,
            paymentMethod = parcel.paymentMethod,
            distanceMeters = parcel.distanceMeters,
            createdAt = parcel.createdAt,
            completedAt = parcel.completedAt,
            agreedPriceLabel = agreedPriceLabel(parcel.agreedPrice, parcel.currency),
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
            serviceClass = delivery.serviceClass,
            parcelSize = delivery.parcelSize,
            parcelInstructions = delivery.parcelInstructions,
            pickupAddress = delivery.pickupAddress,
            pickupLandmark = delivery.pickupLandmark,
            pickupInstructions = delivery.pickupInstructions,
            dropoffAddress = delivery.dropoffAddress,
            dropoffLandmark = delivery.dropoffLandmark,
            dropoffInstructions = delivery.dropoffInstructions,
            contacts = contacts,
            agreedPrice = delivery.agreedPrice,
            currency = delivery.currency,
            paymentMethod = delivery.paymentMethod,
            distanceMeters = delivery.distanceMeters,
            createdAt = delivery.createdAt,
            agreedPriceLabel = agreedPriceLabel(delivery.agreedPrice, delivery.currency),
            syncing = syncing,
            busy = busy,
            error = error,
            finished = finished,
        )
    }

}
