package com.riders.rider.feature.delivery.data

import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.applyAssignmentRefresh
import com.riders.rider.feature.delivery.domain.updateParcelStatus
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

@Singleton
class AssignmentListStore @Inject constructor() {
    private val parcels = MutableStateFlow<List<CommittedParcel>>(emptyList())
    private var generation = 0L
    private var marketplace: Boolean? = null
    private var assignmentsConfirmed = false
    private var lastRefreshApplied = false
    private var shiftConfirmed = false
    private var rememberedAvailability: String? = null
    private var rememberedReceiving: Boolean? = null

    fun observe(): StateFlow<List<CommittedParcel>> = parcels.asStateFlow()

    fun current(): List<CommittedParcel> = parcels.value

    @Synchronized
    fun begin(): Long {
        generation += 1
        return generation
    }

    @Synchronized
    fun confirm(requestGeneration: Long, incoming: List<CommittedParcel>): List<CommittedParcel> {
        val applied = requestGeneration == generation
        lastRefreshApplied = applied
        val next = applyAssignmentRefresh(parcels.value, requestGeneration, generation, incoming)
        parcels.value = next
        if (applied) {
            assignmentsConfirmed = true
        }
        return next
    }

    fun hasConfirmedAssignments(): Boolean = assignmentsConfirmed

    fun lastRefreshApplied(): Boolean = lastRefreshApplied

    @Synchronized
    fun confirmStatus(deliveryId: String, status: String) {
        generation += 1
        parcels.value = updateParcelStatus(parcels.value, deliveryId, status)
    }

    fun parcel(deliveryId: String): CommittedParcel? {
        return parcels.value.firstOrNull { it.deliveryId == deliveryId }
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
        generation += 1
        parcels.value = emptyList()
        marketplace = null
        assignmentsConfirmed = false
        shiftConfirmed = false
        rememberedAvailability = null
        rememberedReceiving = null
        lastRefreshApplied = false
    }
}
