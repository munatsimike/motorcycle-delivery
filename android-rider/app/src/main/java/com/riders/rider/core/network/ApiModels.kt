package com.riders.rider.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Err(val error: ApiError) : ApiResult<Nothing>
}

sealed interface ApiError {
    data object Network : ApiError
    data object Timeout : ApiError
    data class Validation(val message: String) : ApiError
    data object SessionEnded : ApiError
    data object Forbidden : ApiError
    data class Conflict(val message: String) : ApiError
    data class TooManyRequests(val message: String) : ApiError
    data object Unavailable : ApiError
    data class Unexpected(val message: String) : ApiError
}

fun ApiError.text(): String = when (this) {
    ApiError.Network -> "Network request failed. Check your connection and try again."
    ApiError.Timeout -> "The request timed out. Check your connection and try again."
    is ApiError.Validation -> message
    ApiError.SessionEnded -> "Your session has ended. Sign in again."
    ApiError.Forbidden -> "Rider access is required."
    is ApiError.Conflict -> message
    is ApiError.TooManyRequests -> message
    ApiError.Unavailable -> "SMS verification is unavailable."
    is ApiError.Unexpected -> message
}

fun mapHttpFailure(code: Int, body: String?, establishedSession: Boolean = true): ApiError {
    val message = apiMessage(body)
    return when (code) {
        400 -> ApiError.Validation(message ?: "The request could not be completed.")
        401 -> if (establishedSession) {
            ApiError.SessionEnded
        } else {
            ApiError.Validation(message ?: "Authentication failed")
        }
        403 -> ApiError.Forbidden
        409 -> ApiError.Conflict(message ?: "This request conflicts with the current delivery.")
        413 -> ApiError.Validation(message ?: "Licence image is too large")
        415 -> ApiError.Validation(message ?: "Licence image must be a JPEG, PNG, or WebP file")
        429 -> ApiError.TooManyRequests(message ?: "Too many verification attempts. Try again later.")
        503 -> message?.let { ApiError.Unexpected(it) } ?: ApiError.Unavailable
        else -> ApiError.Unexpected(message ?: "The request could not be completed.")
    }
}

fun apiMessage(body: String?): String? {
    if (body.isNullOrBlank() || body.length > 4_000) {
        return null
    }
    return try {
        val message = Json.parseToJsonElement(body).jsonObject["message"] ?: return null
        when (message) {
            is JsonPrimitive -> message.contentOrNull?.takeIf { it.isNotBlank() }
            is JsonArray -> message.mapNotNull { element ->
                element.jsonPrimitive.contentOrNull?.takeIf { it.isNotBlank() }
            }.takeIf { it.isNotEmpty() }?.joinToString(", ")
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}

@Serializable
data class PendingResponse(val status: String)

@Serializable
data class SessionResponse(
    val accessToken: String,
    val refreshToken: String,
    val accessTokenExpiresAt: String,
    val refreshTokenExpiresAt: String,
)

@Serializable
data class PhoneRequest(val phone: String)

@Serializable
data class RiderRegistrationRequest(
    val phone: String,
    val fullName: String? = null,
)

@Serializable
data class VerifyRequest(val phone: String, val code: String)

@Serializable
data class RegistrationVerifyResponse(
    val status: String? = null,
    val registrationToken: String? = null,
    val fullName: String? = null,
    val phone: String? = null,
    val address: String? = null,
    val readOnly: List<String> = emptyList(),
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val accessTokenExpiresAt: String? = null,
    val refreshTokenExpiresAt: String? = null,
) {
    fun sessionOrNull(): SessionResponse? {
        val access = accessToken ?: return null
        val refresh = refreshToken ?: return null
        val accessExpiry = accessTokenExpiresAt ?: return null
        val refreshExpiry = refreshTokenExpiresAt ?: return null
        return SessionResponse(access, refresh, accessExpiry, refreshExpiry)
    }
}

@Serializable
data class RiderAccountRequest(
    val registrationToken: String,
    val fullName: String,
    val address: String,
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class RiderProfileResponse(
    val fullName: String,
    val phone: String,
    val address: String? = null,
)

@Serializable
data class LicenceImageResponse(
    val id: String,
    val reviewStatus: String,
    val contentType: String,
    val byteSize: Int,
    val uploadedAt: String,
)

@Serializable
data class MotorcycleResponse(
    val id: String,
    val registrationNumber: String,
    val make: String,
    val model: String,
    val colour: String,
    val verificationStatus: String,
    val isActive: Boolean,
)

@Serializable
data class MotorcycleRequest(
    val registrationNumber: String,
    val make: String,
    val model: String,
    val colour: String,
)

@Serializable
data class OnboardingResponse(
    val licenceVerificationStatus: String,
    val approvalStatus: String,
    val availability: String,
    val licenceNumber: String? = null,
    val licenceClass: String? = null,
    val rejectionReason: String? = null,
    val verifiedMotorcycleCount: Int,
    val activeVerifiedMotorcycle: Boolean,
)

@Serializable
data class AvailabilityResponse(
    val availability: String,
    val message: String? = null,
    val eligible: Boolean? = null,
    val reason: String? = null,
)

@Serializable
data class LocationRequest(val latitude: Double, val longitude: Double)

@Serializable
data class LocationResponse(val updatedAt: String)

@Serializable
data class OffersResponse(val offers: List<OfferResponse>)

@Serializable
data class ActiveAssignmentResponse(
    val assignment: ActiveAssignmentBody? = null,
)

@Serializable
data class ActiveAssignmentBody(
    val assignmentId: String,
    val deliveryId: String,
    val status: String,
    val parcel: ParcelResponse,
    val pickup: StopResponse,
    val dropoff: StopResponse,
)

@Serializable
data class OfferResponse(
    val assignmentId: String,
    val deliveryId: String,
    val expiresAt: String,
    val offeredPrice: String,
    val currency: String,
    val payer: String,
    val paymentMethod: String,
    val parcel: ParcelResponse,
    val pickup: StopResponse,
    val dropoff: StopResponse,
)

@Serializable
data class ParcelResponse(
    val description: String,
    val size: String,
    val instructions: String? = null,
)

@Serializable
data class StopResponse(
    val address: String,
    val latitude: String? = null,
    val longitude: String? = null,
    val landmark: String? = null,
    val instructions: String? = null,
    val contactName: String,
    val contactPhone: String,
)

@Serializable
data class AcceptanceResponse(
    val assignmentId: String,
    val deliveryId: String,
    val status: String,
    val availability: String,
    val offeredPrice: String,
    val currency: String,
    val reservedFee: String,
    val configVersion: Int,
    val replayed: Boolean,
)

@Serializable
data class ReleaseRequest(val reason: String)

@Serializable
data class StatusRequest(val status: String)

@Serializable
data class ProgressResponse(
    val deliveryId: String,
    val status: String,
    val availability: String,
)

@Serializable
data class WalletSummaryResponse(
    val riderProfileId: String,
    val balance: String,
    val borrowingLimit: String,
    val borrowingLimitSource: String,
    val reservedFees: String,
    val availableCapacity: String,
    val currency: String,
)

@Serializable
data class WalletPaymentResponse(
    val method: String,
    val internalReceiptId: String? = null,
    val externalReceiptNumber: String? = null,
    val ecocashReference: String? = null,
)

@Serializable
data class WalletTransactionResponse(
    val id: String,
    val type: String,
    val amount: String,
    val balanceAfter: String,
    val currency: String,
    val createdAt: String,
    val reason: String? = null,
    val payment: WalletPaymentResponse? = null,
)

@Serializable
data class WalletTransactionsResponse(
    val transactions: List<WalletTransactionResponse>,
    val nextCursor: String? = null,
)
