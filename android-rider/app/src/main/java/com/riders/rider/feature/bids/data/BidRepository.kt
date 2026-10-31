package com.riders.rider.feature.bids.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.BidSubmissionRequest
import com.riders.rider.core.network.OwnBidsResponse
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.bids.domain.OpenBidRequest
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.bidListProblemMessage
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class OwnBidPage(
    val bids: List<OwnBid>,
    val nextCursor: String?,
)

@Singleton
class BidRepository @Inject constructor(
    private val riders: RiderService,
) {
    private val ownBidsState = MutableStateFlow<List<OwnBid>>(emptyList())
    private val ownBidsKnownState = MutableStateFlow(false)
    private val bidListProblemState = MutableStateFlow<String?>(null)
    val ownBidsFlow: StateFlow<List<OwnBid>> = ownBidsState.asStateFlow()
    val ownBidsKnownFlow: StateFlow<Boolean> = ownBidsKnownState.asStateFlow()
    val bidListProblemFlow: StateFlow<String?> = bidListProblemState.asStateFlow()

    suspend fun openRequests(): ApiResult<List<OpenBidRequest>> {
        return when (val result = apiCall { riders.bidRequests() }) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.map { request ->
                OpenBidRequest(
                    id = request.id,
                    serviceClass = request.serviceClass,
                    deliverBy = request.deliverBy,
                    suggestedPrice = request.suggestedPrice,
                    offeredPrice = request.offeredPrice,
                    pickupAddress = request.pickupAddress,
                    dropoffAddress = request.dropoffAddress,
                    parcelDescription = request.parcelDescription,
                    parcelSize = request.parcelSize,
                    distanceMeters = request.distanceMeters,
                    currency = request.currency,
                )
            })
            is ApiResult.Err -> result
        }
    }

    suspend fun ownBids(cursor: String?): ApiResult<OwnBidPage> {
        return when (val result = apiCall { riders.ownBids(limit = 20, cursor = cursor) }) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.toPage())
            is ApiResult.Err -> result
        }
    }

    suspend fun refreshOwnBids(cursor: String?): ApiResult<OwnBidPage> {
        val result = ownBids(cursor)
        if (result is ApiResult.Ok) {
            ownBidsState.value = if (cursor == null) {
                result.value.bids
            } else {
                ownBidsState.value + result.value.bids
            }
            if (cursor == null) {
                ownBidsKnownState.value = true
                bidListProblemState.value = null
            }
        } else if (cursor == null && result is ApiResult.Err) {
            ownBidsKnownState.value = false
            bidListProblemState.value = bidListProblemMessage(result.error)
        }
        return result
    }

    suspend fun submit(deliveryId: String, amountCents: Int, idempotencyKey: String): ApiResult<Unit> {
        return when (val result = apiCall {
            riders.submitBid(idempotencyKey, BidSubmissionRequest(deliveryId, amountCents))
        }) {
            is ApiResult.Ok -> ApiResult.Ok(Unit)
            is ApiResult.Err -> result
        }
    }

    suspend fun withdraw(bidId: String): ApiResult<Unit> {
        return when (val result = apiCall { riders.withdrawBid(bidId) }) {
            is ApiResult.Ok -> ApiResult.Ok(Unit)
            is ApiResult.Err -> result
        }
    }
}

private fun OwnBidsResponse.toPage(): OwnBidPage {
    return OwnBidPage(
        bids = bids.map { bid ->
            OwnBid(
                bidId = bid.bidId,
                deliveryId = bid.deliveryId,
                amount = bid.amount,
                currency = bid.currency,
                status = bid.status,
                createdAt = bid.createdAt,
                updatedAt = bid.updatedAt,
                serviceClass = bid.serviceClass,
                pickupAddress = bid.pickupAddress,
                dropoffAddress = bid.dropoffAddress,
                deliverBy = bid.deliverBy,
                parcelDescription = bid.parcelDescription,
                suggestedPrice = bid.suggestedPrice,
                distanceMeters = bid.distanceMeters,
            )
        },
        nextCursor = nextCursor,
    )
}
