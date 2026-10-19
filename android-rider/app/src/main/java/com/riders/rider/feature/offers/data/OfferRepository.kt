package com.riders.rider.feature.offers.data

import com.riders.rider.core.database.OfferDao
import com.riders.rider.core.database.OfferEntity
import com.riders.rider.core.database.RiderDatabase
import com.riders.rider.core.network.AcceptanceResponse
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiJson
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.ReleaseRequest
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.StatusRequest
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.offers.domain.AcceptKeys
import com.riders.rider.feature.offers.domain.AcceptedDelivery
import com.riders.rider.feature.offers.domain.OfferAcceptance
import javax.inject.Inject
import javax.inject.Singleton

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

    suspend fun list(): ApiResult<List<OfferResponse>> {
        return when (val result = apiCall { riders.offers() }) {
            is ApiResult.Ok -> {
                offers.clear()
                offers.writeAll(result.value.offers.map { offer ->
                    OfferEntity(offer.assignmentId, ApiJson.encodeToString(OfferResponse.serializer(), offer))
                })
                ApiResult.Ok(result.value.offers)
            }
            is ApiResult.Err -> {
                if (result.error is ApiError.Network) {
                    val cached = offers.readAll().map { ApiJson.decodeFromString(OfferResponse.serializer(), it.payloadJson) }
                    if (cached.isNotEmpty()) {
                        ApiResult.Ok(cached)
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
}

private fun AcceptanceResponse.toAccepted(): AcceptedDelivery {
    return AcceptedDelivery(assignmentId, deliveryId, status, availability)
}
