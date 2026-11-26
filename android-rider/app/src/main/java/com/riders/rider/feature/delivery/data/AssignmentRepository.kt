package com.riders.rider.feature.delivery.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.InFlightRead
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.delivery.domain.AssignmentLookup
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.toActiveDelivery
import com.riders.rider.feature.delivery.domain.completedDeliveries
import com.riders.rider.feature.delivery.domain.toCommittedParcel
import com.riders.rider.feature.delivery.domain.toContacts
import javax.inject.Inject
import javax.inject.Singleton

data class AssignmentRefresh(val result: ApiResult<List<CommittedParcel>>, val token: Long)

@Singleton
class AssignmentRepository @Inject constructor(
    private val riders: RiderService,
    private val committed: AssignmentListStore,
) {
    private var completedParcels: List<CommittedParcel> = emptyList()
    private val assignmentRead = InFlightRead<Pair<Long, Long>, AssignmentRefresh>(maxJoinAgeNanos = Long.MAX_VALUE)
    private val completedRevision = MutableStateFlow(0L)
    val completedChanges = completedRevision.asStateFlow()
    fun invalidateAssignments() = committed.invalidateRead()
    fun invalidateCompleted() {
        completedParcels = emptyList()
        completedRevision.value += 1
    }
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

    suspend fun refreshList(): ApiResult<List<CommittedParcel>> = refreshStamped().result

    suspend fun refreshStamped(): AssignmentRefresh {
        val session = committed.readRevision().first
        repeat(3) {
            val revision = committed.readRevision()
            if (revision.first != session) return AssignmentRefresh(ApiResult.Err(ApiError.SessionEnded), -1L)
            val refresh = assignmentRead.read(revision) {
                val token = committed.beginIfRevision(revision) ?: return@read AssignmentRefresh(
                    ApiResult.Err(ApiError.Unexpected("Deliveries changed while refreshing. Try again.")), -1L)
                val response = apiCall { riders.assignments() }
                val result = when (response) {
                    is ApiResult.Ok -> {
                        val list = committed.confirm(token, response.value.assignments.map { it.toCommittedParcel() })
                        if (committed.isCurrentRefresh(token) && committed.readRevision() == revision) ApiResult.Ok(list)
                        else ApiResult.Err(ApiError.Unexpected("Deliveries changed while refreshing. Try again."))
                    }
                    is ApiResult.Err -> response
                }
                AssignmentRefresh(result, token)
            }
            if (committed.readRevision() == revision &&
                (refresh.result is ApiResult.Err || committed.isCurrentRefresh(refresh.token))) return refresh
        }
        return AssignmentRefresh(ApiResult.Err(ApiError.Unexpected("Deliveries changed while refreshing. Try again.")), -1L)
    }

    val parcelsFlow = committed.parcelsFlow

    fun current(): List<CommittedParcel> = committed.current()

    fun parcel(deliveryId: String): CommittedParcel? = committed.parcel(deliveryId)

    fun rememberMarketplace(receivingPresent: Boolean) {
        committed.rememberMarketplace(receivingPresent)
    }

    fun marketplace(): Boolean? = committed.marketplace()

    fun hasConfirmedAssignments(): Boolean = committed.hasConfirmedAssignments()

    fun lastRefreshApplied(): Boolean = committed.lastRefreshApplied()

    suspend fun refreshCompleted(): ApiResult<List<CommittedParcel>> {
        val revision = completedRevision.value
        return when (val result = apiCall { riders.completedAssignments() }) {
            is ApiResult.Ok -> {
                val parcels = completedDeliveries(result.value.assignments.map { it.toCommittedParcel() })
                if (revision != completedRevision.value) return ApiResult.Err(ApiError.Unexpected("Completed deliveries changed. Refresh again."))
                completedParcels = parcels
                ApiResult.Ok(parcels)
            }
            is ApiResult.Err -> result
        }
    }

    fun completedParcel(deliveryId: String): CommittedParcel? {
        return completedParcels.firstOrNull { it.deliveryId == deliveryId }
    }

    fun clearSession() {
        committed.clearSession()
        invalidateCompleted()
    }

    fun confirmStatus(deliveryId: String, status: String) {
        committed.confirmStatus(deliveryId, status)
        if (status == "DELIVERED") invalidateCompleted()
    }

    fun dropAssignment(assignmentId: String) {
        committed.removeAssignment(assignmentId)
    }
}
