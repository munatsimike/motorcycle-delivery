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
import com.riders.rider.feature.delivery.domain.historyCache
import com.riders.rider.feature.delivery.domain.historyDeliveries
import com.riders.rider.feature.delivery.domain.historyRecord
import com.riders.rider.feature.delivery.domain.toCommittedParcel
import com.riders.rider.feature.delivery.domain.toContacts
import javax.inject.Inject
import javax.inject.Singleton

data class CompletedPage(val deliveries: List<CommittedParcel>, val nextCursor: String?)

data class AssignmentRefresh(val result: ApiResult<List<CommittedParcel>>, val token: Long)

@Singleton
class AssignmentRepository @Inject constructor(
    private val riders: RiderService,
    private val committed: AssignmentListStore,
    private val offline: OfflineDeliveryCache,
    private val sessions: com.riders.rider.core.session.SessionStore,
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
        val owner = sessions.snapshot().identity
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
                        if (!sessions.isCurrent(owner)) return@read AssignmentRefresh(ApiResult.Err(ApiError.SessionEnded), -1L)
                        val list = committed.confirm(token, response.value.assignments.map { it.toCommittedParcel() })
                        if (committed.isCurrentRefresh(token) && committed.readRevision() == revision) {
                            offline.save(owner, "active", list)
                            ApiResult.Ok(list)
                        }
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

    suspend fun cachedDeliveries(kind: String) = offline.read(kind)

    suspend fun completedPage(cursor: String? = null): ApiResult<CompletedPage> {
        val owner = sessions.snapshot().identity
        val revision = completedRevision.value
        return when (val result = apiCall { riders.completedAssignmentsPage(cursor = cursor) }) {
            is ApiResult.Ok -> {
                if (!sessions.isCurrent(owner)) return ApiResult.Err(ApiError.SessionEnded)
                if (revision != completedRevision.value) return ApiResult.Err(ApiError.Unexpected("Completed deliveries changed. Refresh again."))
                val parcels = completedDeliveries(result.value.assignments.map { it.toCommittedParcel() })
                val next = result.value.nextCursor
                if (next != null && (next.isBlank() || next == cursor)) return ApiResult.Err(ApiError.Unexpected("Invalid history page. Refresh again."))
                completedParcels = (completedParcels + parcels).distinctBy { it.assignmentId }.let { merged ->
                    val updated = parcels.associateBy { it.assignmentId }
                    merged.map { updated[it.assignmentId] ?: it }
                }
                if (cursor == null) offline.save(owner, "completed", historyCache(parcels))
                if (!sessions.isCurrent(owner)) return ApiResult.Err(ApiError.SessionEnded)
                ApiResult.Ok(CompletedPage(parcels, next))
            }
            is ApiResult.Err -> result
        }
    }

    suspend fun historyPage(cursor: String? = null, status: String = "all"): ApiResult<CompletedPage> {
        val owner = sessions.snapshot().identity
        val revision = completedRevision.value
        return when (val result = apiCall { riders.historyAssignmentsPage(cursor = cursor, status = status) }) {
            is ApiResult.Ok -> {
                if (!sessions.isCurrent(owner)) return ApiResult.Err(ApiError.SessionEnded)
                if (revision != completedRevision.value) return ApiResult.Err(ApiError.Unexpected("Completed deliveries changed. Refresh again."))
                val parcels = historyDeliveries(result.value.assignments.map { it.toCommittedParcel() })
                val next = result.value.nextCursor
                if (next != null && (next.isBlank() || next == cursor)) return ApiResult.Err(ApiError.Unexpected("Invalid history page. Refresh again."))
                completedParcels = (completedParcels + parcels).distinctBy { it.assignmentId }.let { merged ->
                    val updated = parcels.associateBy { it.assignmentId }
                    merged.map { updated[it.assignmentId] ?: it }
                }
                if (cursor == null && status == "all") offline.save(owner, "history", historyCache(parcels))
                if (!sessions.isCurrent(owner)) return ApiResult.Err(ApiError.SessionEnded)
                ApiResult.Ok(CompletedPage(parcels, next))
            }
            is ApiResult.Err -> result
        }
    }

    suspend fun findHistory(assignmentId: String): ApiResult<CommittedParcel?> {
        val owner = sessions.snapshot().identity
        return when (val result = apiCall { riders.historyAssignment(assignmentId) }) {
            is ApiResult.Ok -> {
                if (!sessions.isCurrent(owner)) return ApiResult.Err(ApiError.SessionEnded)
                val parcel = result.value.assignment?.toCommittedParcel()?.takeIf { it.assignmentId == assignmentId && (it.status == "DELIVERED" || it.status == "CANCELLED") }
                if (parcel != null) {
                    completedParcels = (completedParcels + parcel).distinctBy { it.assignmentId }.let { merged ->
                        val updated = merged.associateBy { it.assignmentId }
                        merged.map { updated[it.assignmentId] ?: it }
                    }
                }
                ApiResult.Ok(parcel)
            }
            is ApiResult.Err -> if (result.error is ApiError.Unexpected && result.error.message == "Delivery not found") {
                ApiResult.Ok(null)
            } else {
                result
            }
        }
    }

    // Historical deep links and explicit detail refresh: traverse bounded pages.
    suspend fun findCompleted(deliveryId: String): ApiResult<CommittedParcel?> {
        return findHistoryMatch { it.deliveryId == deliveryId }
    }

    private suspend fun findHistoryMatch(matches: (CommittedParcel) -> Boolean): ApiResult<CommittedParcel?> {
        val revision = completedRevision.value
        var cursor: String? = null
        val seen = mutableSetOf<String>()
        do {
            when (val result = historyPage(cursor)) {
                is ApiResult.Err -> return result
                is ApiResult.Ok -> {
                    if (revision != completedRevision.value) return ApiResult.Err(ApiError.Unexpected("Completed deliveries changed. Refresh again."))
                    result.value.deliveries.firstOrNull(matches)?.let { return ApiResult.Ok(it) }
                    cursor = result.value.nextCursor
                    if (cursor != null && !seen.add(cursor)) return ApiResult.Err(ApiError.Unexpected("Invalid history page. Refresh again."))
                }
            }
        } while (cursor != null)
        return ApiResult.Ok(null)
    }

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
        return historyRecord(completedParcels, assignmentId = null, deliveryId = deliveryId)
    }

    fun historyParcel(assignmentId: String): CommittedParcel? {
        return historyRecord(completedParcels, assignmentId = assignmentId, deliveryId = "")
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
