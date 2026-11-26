package com.riders.rider.feature.delivery.data

import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.applyAssignmentRefresh
import com.riders.rider.feature.delivery.domain.updateParcelStatus
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

@Singleton
class AssignmentListStore @Inject constructor() {
    private val parcels = MutableStateFlow<List<CommittedParcel>>(emptyList())
    val parcelsFlow = parcels.asStateFlow()
    private var generation = 0L
    private var revision = 0L
    private var sessionEpoch = 0L

    @Synchronized fun readRevision(): Pair<Long, Long> = sessionEpoch to revision

    @Synchronized fun invalidateRead() { revision += 1; generation += 1; lastRefreshApplied = false }
    private var confirmedGeneration: Long? = null
    private var marketplace: Boolean? = null
    private var assignmentsConfirmed = false
    private var lastRefreshApplied = false
    private var shiftConfirmed = false
    private var rememberedAvailability: String? = null
    private var rememberedReceiving: Boolean? = null

    fun current(): List<CommittedParcel> = parcels.value

    @Synchronized
    fun beginIfRevision(expected: Pair<Long, Long>): Long? = if (readRevision() == expected) begin() else null

    @Synchronized
    fun begin(): Long {
        generation += 1
        return generation
    }

    @Synchronized
    fun confirm(requestGeneration: Long, incoming: List<CommittedParcel>): List<CommittedParcel> {
        val applied = requestGeneration == generation
        if (applied) lastRefreshApplied = true
        val next = applyAssignmentRefresh(parcels.value, requestGeneration, generation, incoming)
        parcels.value = next
        if (applied) {
            assignmentsConfirmed = true
            confirmedGeneration = requestGeneration
        }
        return next
    }

    @Synchronized
    fun isCurrentRefresh(token: Long): Boolean = token == generation && token == confirmedGeneration

    fun hasConfirmedAssignments(): Boolean = assignmentsConfirmed

    fun lastRefreshApplied(): Boolean = lastRefreshApplied

    @Synchronized
    fun confirmStatus(deliveryId: String, status: String) {
        invalidateRead()
        parcels.value = updateParcelStatus(parcels.value, deliveryId, status)
    }

    fun parcel(deliveryId: String): CommittedParcel? {
        return parcels.value.firstOrNull { it.deliveryId == deliveryId }
    }

    @Synchronized
    fun removeAssignment(assignmentId: String) {
        if (assignmentId.isBlank()) {
            return
        }
        invalidateRead()
        parcels.value = parcels.value.filter { it.assignmentId != assignmentId }
    }

    @Synchronized
    fun rememberMarketplace(receivingPresent: Boolean) {
        marketplace = receivingPresent
    }

    fun marketplace(): Boolean? = marketplace

    @Synchronized
    fun rememberShift(availability: String, receiving: Boolean?) {
        shiftConfirmed = true
        rememberedAvailability = availability
        rememberedReceiving = receiving
    }

    fun confirmedAvailability(): String? = if (shiftConfirmed) rememberedAvailability else null

    fun confirmedReceiving(): Boolean? = if (shiftConfirmed) rememberedReceiving else null

    @Synchronized
    fun clearSession() {
        sessionEpoch += 1
        invalidateRead()
        parcels.value = emptyList()
        marketplace = null
        assignmentsConfirmed = false
        confirmedGeneration = null
        shiftConfirmed = false
        rememberedAvailability = null
        rememberedReceiving = null
        lastRefreshApplied = false
    }
}
