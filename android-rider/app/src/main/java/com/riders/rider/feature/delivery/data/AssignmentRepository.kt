package com.riders.rider.feature.delivery.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.delivery.domain.AssignmentLookup
import com.riders.rider.feature.delivery.domain.toActiveDelivery
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AssignmentRepository @Inject constructor(
    private val riders: RiderService,
) {
    suspend fun lookup(): AssignmentLookup {
        return when (val result = apiCall { riders.activeAssignment() }) {
            is ApiResult.Ok -> {
                val assignment = result.value.assignment
                if (assignment == null) AssignmentLookup.None else AssignmentLookup.Found(assignment.toActiveDelivery())
            }
            is ApiResult.Err -> AssignmentLookup.Unavailable(result.error)
        }
    }
}
