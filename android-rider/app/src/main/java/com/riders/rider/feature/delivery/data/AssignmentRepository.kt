package com.riders.rider.feature.delivery.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.delivery.domain.AssignmentLookup
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.toActiveDelivery
import com.riders.rider.feature.delivery.domain.toCommittedParcel
import com.riders.rider.feature.delivery.domain.toContacts
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AssignmentRepository @Inject constructor(
    private val riders: RiderService,
    private val committed: AssignmentListStore,
) {
    suspend fun lookup(): AssignmentLookup {
        return when (val result = apiCall { riders.activeAssignment() }) {
            is ApiResult.Ok -> {
                val assignment = result.value.assignment
                if (assignment == null) {
                    AssignmentLookup.None
                } else {
                    AssignmentLookup.Found(assignment.toActiveDelivery(), assignment.toContacts())
                }
            }
            is ApiResult.Err -> AssignmentLookup.Unavailable(result.error)
        }
    }

    suspend fun refreshList(): ApiResult<List<CommittedParcel>> {
        val token = committed.begin()
        return when (val result = apiCall { riders.assignments() }) {
            is ApiResult.Ok -> ApiResult.Ok(committed.confirm(token, result.value.assignments.map { it.toCommittedParcel() }))
            is ApiResult.Err -> result
        }
    }

    fun current(): List<CommittedParcel> = committed.current()

    fun parcel(deliveryId: String): CommittedParcel? = committed.parcel(deliveryId)

    fun rememberMarketplace(receivingPresent: Boolean) {
        committed.rememberMarketplace(receivingPresent)
    }

    fun marketplace(): Boolean? = committed.marketplace()

    fun hasConfirmedAssignments(): Boolean = committed.hasConfirmedAssignments()

    fun lastRefreshApplied(): Boolean = committed.lastRefreshApplied()

    fun clearSession() {
        committed.clearSession()
    }

    fun confirmStatus(deliveryId: String, status: String) {
        committed.confirmStatus(deliveryId, status)
    }
}
