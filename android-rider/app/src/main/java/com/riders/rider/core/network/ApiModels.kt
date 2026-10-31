package com.riders.rider.core.network

import com.riders.rider.feature.auth.domain.DeviceReplacementNotice
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
    data object SignedInElsewhere : ApiError
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
    ApiError.SignedInElsewhere -> DeviceReplacementNotice.MESSAGE
    ApiError.Forbidden -> "Rider access is required."
    is ApiError.Conflict -> message
    is ApiError.TooManyRequests -> message
    ApiError.Unavailable -> "WhatsApp verification is unavailable."
    is ApiError.Unexpected -> message
}

fun mapHttpFailure(code: Int, body: String?, establishedSession: Boolean = true): ApiError {
    val message = apiMessage(body)
    return when (code) {
        400 -> ApiError.Validation(message ?: "The request could not be completed.")
        401 -> if (establishedSession && message == DeviceReplacementNotice.MESSAGE) {
            ApiError.SignedInElsewhere
        } else if (establishedSession) {
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
data class PlaceSuggestionsResponse(val suggestions: List<PlaceSuggestionResponse> = emptyList())

@Serializable
data class PlaceSuggestionResponse(
    val label: String = "",
    val placeId: String = "",
    val exact: Boolean = false,
)

@Serializable
data class ResolvedPlaceResponse(
    val label: String = "",
    val latitude: Double? = null,
    val longitude: Double? = null,
)

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
data class RiderWhatsAppRegistrationRequest(
    val phone: String,
    val whatsappConsent: Boolean,
)

@Serializable
data class RiderRegistrationCompleteRequest(
    val registrationToken: String,
    val fullName: String,
    val address: String,
)

@Serializable
data class RiderVerificationResponse(
    val status: String? = null,
    val registrationToken: String? = null,
    val fullName: String? = null,
    val address: String? = null,
    val readOnly: List<String> = emptyList(),
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val accessTokenExpiresAt: String? = null,
    val refreshTokenExpiresAt: String? = null,
)

@Serializable
data class WhatsAppRecoveryRequest(
    val phone: String,
    val whatsappConsent: Boolean,
)

@Serializable
data class VerifyRequest(val phone: String, val code: String)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class RiderProfileResponse(
    val fullName: String,
    val phone: String,
    val address: String? = null,
    val hasProfilePhoto: Boolean = false,
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
    val receiving: Boolean? = null,
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
data class PushDeviceRequest(val fcmToken: String)

@Serializable
data class PushDeviceResponse(val registered: Boolean = false)

@Serializable
data class ActiveAssignmentResponse(
    val assignment: ActiveAssignmentBody? = null,
)

@Serializable
data class LiveAssignmentsResponse(
    val assignments: List<ActiveAssignmentBody> = emptyList(),
)

@Serializable
data class ActiveAssignmentBody(
    val assignmentId: String,
    val deliveryId: String,
    val status: String,
    val parcel: ParcelResponse,
    val pickup: StopResponse,
    val dropoff: StopResponse,
    val serviceClass: String? = null,
    val deliverBy: String? = null,
    val agreedPrice: String? = null,
    val distanceMeters: Int? = null,
    val createdAt: String? = null,
    val completedAt: String? = null,
)

@Serializable
data class ReceivingRequest(val receiving: Boolean)

@Serializable
data class ReceivingResponse(
    val availability: String,
    val receiving: Boolean,
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
    val serviceClass: String? = null,
    val distanceMeters: Int = 0,
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
data class StatusRequest(val status: String)

@Serializable
data class CancellationRequest(val reason: String, val note: String? = null)

@Serializable
data class BidRequestBody(
    val id: String,
    val serviceClass: String? = null,
    val deliverBy: String? = null,
    val currency: String? = null,
    val suggestedPrice: String? = null,
    val offeredPrice: String? = null,
    val distanceMeters: Int? = null,
    val pickupAddress: String = "",
    val dropoffAddress: String = "",
    val parcelDescription: String = "",
    val parcelSize: String = "",
)

@Serializable
data class BidSubmissionRequest(
    val deliveryId: String,
    val amountCents: Int,
)

@Serializable
data class SubmittedBidResponse(
    val id: String,
    val deliveryId: String,
    val amount: String,
    val currency: String,
    val status: String,
    val createdAt: String,
)

@Serializable
data class OwnBidBody(
    val bidId: String,
    val deliveryId: String,
    val amount: String,
    val currency: String,
    val status: String,
    val createdAt: String,
    val updatedAt: String? = null,
    val serviceClass: String? = null,
    val pickupAddress: String = "",
    val dropoffAddress: String = "",
    val deliverBy: String? = null,
    val parcelDescription: String = "",
    val suggestedPrice: String = "",
    val distanceMeters: Int? = null,
)

@Serializable
data class OwnBidsResponse(
    val bids: List<OwnBidBody> = emptyList(),
    val nextCursor: String? = null,
)

@Serializable
data class CancellationResponse(
    val assignmentId: String,
    val deliveryId: String,
    val status: String,
    val reopened: Boolean,
    val released: Boolean = false,
    val availability: String,
    val replayed: Boolean = false,
)

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
    val promotionalBalance: String = "0.00",
    val availablePromotionalCredit: String = "0.00",
    val newDeliveriesRestricted: Boolean = false,
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
