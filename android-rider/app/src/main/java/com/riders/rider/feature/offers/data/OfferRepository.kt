package com.riders.rider.feature.offers.data

import com.riders.rider.core.database.OfferDao
import com.riders.rider.core.database.OfferEntity
import com.riders.rider.core.database.RiderDatabase
import com.riders.rider.core.network.AcceptanceResponse
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiJson
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.CancellationRequest
import com.riders.rider.core.network.CancellationResponse
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.ReleaseRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.StatusRequest
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.network.mapHttpFailure
import com.riders.rider.feature.offers.domain.AcceptKeys
import com.riders.rider.feature.offers.domain.AcceptedDelivery
import com.riders.rider.feature.offers.domain.OfferAcceptance
import com.riders.rider.feature.offers.domain.httpDateMillis
import javax.inject.Inject
import javax.inject.Singleton

data class ListedOffers(
    val offers: List<OfferResponse>,
    val fromNetwork: Boolean,
    val serverNowMillis: Long?,
)

@Singleton
class OfferRepository @Inject constructor(
    private val riders: RiderService,
    database: RiderDatabase,
    acceptKeys: DataStoreAcceptKeyStore,
) {
    private val offers: OfferDao = database.offerDao()
    private val acceptance = OfferAcceptance(AcceptKeys(acceptKeys)) { assignmentId, key ->
        when (val result = apiCall { riders.accept(assignmentId, key) }) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.toAccepted())
            is ApiResult.Err -> result
        }
    }

    suspend fun list(): ApiResult<ListedOffers> {
        return when (val result = apiCall { riders.offers() }) {
            is ApiResult.Ok -> {
                val response = result.value
                if (!response.isSuccessful) {
                    return ApiResult.Err(mapHttpFailure(response.code(), response.errorBody()?.string()))
                }
                val body = response.body()
                    ?: return ApiResult.Err(ApiError.Unexpected("The request could not be completed."))
                val received = body.offers
                offers.clear()
                offers.writeAll(received.map { offer ->
                    OfferEntity(offer.assignmentId, ApiJson.encodeToString(OfferResponse.serializer(), offer))
                })
                ApiResult.Ok(
                    ListedOffers(
                        offers = received,
                        fromNetwork = true,
                        serverNowMillis = httpDateMillis(response.headers()["Date"]),
                    ),
                )
            }
            is ApiResult.Err -> {
                if (result.error is ApiError.Network) {
                    val cached = offers.readAll().map { ApiJson.decodeFromString(OfferResponse.serializer(), it.payloadJson) }
                    if (cached.isNotEmpty()) {
                        ApiResult.Ok(ListedOffers(cached, fromNetwork = false, serverNowMillis = null))
                    } else {
                        result
                    }
                } else {
                    result
                }
            }
        }
    }

    suspend fun accept(assignmentId: String): ApiResult<AcceptedDelivery>? = acceptance.accept(assignmentId)

    suspend fun release(assignmentId: String, reason: String): ApiResult<AcceptedDelivery> {
        return when (val result = apiCall { riders.release(assignmentId, ReleaseRequest(reason)) }) {
            is ApiResult.Ok -> ApiResult.Ok(
                AcceptedDelivery(assignmentId, result.value.deliveryId, result.value.status, result.value.availability),
            )
            is ApiResult.Err -> result
        }
    }

    suspend fun progress(deliveryId: String, status: String): ApiResult<AcceptedDelivery> {
        return when (val result = apiCall { riders.progress(deliveryId, StatusRequest(status)) }) {
            is ApiResult.Ok -> ApiResult.Ok(
                AcceptedDelivery("", result.value.deliveryId, result.value.status, result.value.availability),
            )
            is ApiResult.Err -> result
        }
    }

    suspend fun progressWithKey(deliveryId: String, status: String, idempotencyKey: String): ApiResult<AcceptedDelivery> {
        return when (val result = apiCall { riders.progressWithKey(deliveryId, idempotencyKey, StatusRequest(status)) }) {
            is ApiResult.Ok -> ApiResult.Ok(
                AcceptedDelivery("", result.value.deliveryId, result.value.status, result.value.availability),
            )
            is ApiResult.Err -> result
        }
    }

    suspend fun cancelAssignment(
        assignmentId: String,
        reason: String,
        note: String?,
        idempotencyKey: String,
    ): ApiResult<CancellationResponse> {
        return apiCall { riders.cancelAssignment(assignmentId, idempotencyKey, CancellationRequest(reason, note)) }
    }
}

private fun AcceptanceResponse.toAccepted(): AcceptedDelivery {
    return AcceptedDelivery(assignmentId, deliveryId, status, availability)
}
