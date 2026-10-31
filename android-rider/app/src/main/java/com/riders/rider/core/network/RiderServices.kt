package com.riders.rider.core.network

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.Retrofit
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming
import java.util.concurrent.TimeUnit

val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

interface AuthService {
    @POST("auth/rider/login/whatsapp")
    suspend fun startWhatsAppLogin(@Body body: WhatsAppRecoveryRequest): PendingResponse

    @POST("auth/rider/login/whatsapp/resend")
    suspend fun resendWhatsAppLogin(@Body body: PhoneRequest): PendingResponse

    @POST("auth/rider/login/whatsapp/verify")
    suspend fun verifyWhatsAppLogin(@Body body: VerifyRequest): RiderVerificationResponse

    @POST("auth/rider/register/whatsapp")
    suspend fun startWhatsAppRegistration(@Body body: RiderWhatsAppRegistrationRequest): PendingResponse

    @POST("auth/rider/register/whatsapp/resend")
    suspend fun resendWhatsAppRegistration(@Body body: PhoneRequest): PendingResponse

    @POST("auth/rider/register/whatsapp/verify")
    suspend fun verifyWhatsAppRegistration(@Body body: VerifyRequest): RiderVerificationResponse

    @POST("auth/rider/register/whatsapp/complete")
    suspend fun completeWhatsAppRegistration(@Body body: RiderRegistrationCompleteRequest): SessionResponse

    @POST("auth/session/refresh")
    suspend fun refresh(@Body body: RefreshRequest): SessionResponse

    @GET("auth/places")
    suspend fun searchPlaces(
        @Query("text") text: String,
        @Query("sessionToken") sessionToken: String,
    ): PlaceSuggestionsResponse

    @GET("auth/places/detail")
    suspend fun placeDetail(
        @Query("placeId") placeId: String,
        @Query("sessionToken") sessionToken: String,
    ): ResolvedPlaceResponse

    @POST("auth/session/logout")
    suspend fun logout(): Response<ResponseBody>
}

interface RiderService {
    @GET("riders/me/profile")
    suspend fun profile(): RiderProfileResponse

    @Streaming
    @GET("riders/me/profile-photo")
    suspend fun profilePhoto(): ResponseBody

    @Multipart
    @POST("riders/me/profile-photo")
    suspend fun uploadProfilePhoto(@Part image: MultipartBody.Part): ResponseBody

    @DELETE("riders/me/profile-photo")
    suspend fun deleteProfilePhoto(): Response<ResponseBody>

    @GET("riders/me/onboarding")
    suspend fun onboarding(): OnboardingResponse

    @GET("riders/me/licence-image")
    suspend fun licenceImage(): LicenceImageResponse

    @Multipart
    @POST("riders/me/licence-image")
    suspend fun uploadLicence(@Part image: MultipartBody.Part): LicenceImageResponse

    @GET("riders/me/motorcycles")
    suspend fun motorcycles(): List<MotorcycleResponse>

    @POST("riders/me/motorcycles")
    suspend fun registerMotorcycle(@Body body: MotorcycleRequest): MotorcycleResponse

    @PATCH("riders/me/motorcycles/{id}")
    suspend fun updateMotorcycle(
        @Path("id") id: String,
        @Body body: MotorcycleRequest,
    ): MotorcycleResponse

    @PUT("riders/me/motorcycles/{id}/active")
    suspend fun selectMotorcycle(@Path("id") id: String): MotorcycleResponse

    @POST("riders/me/availability/online")
    suspend fun online(): AvailabilityResponse

    @POST("riders/me/availability/offline")
    suspend fun offline(): AvailabilityResponse

    @PUT("riders/me/receiving")
    suspend fun receiving(@Body body: ReceivingRequest): ReceivingResponse

    @PUT("riders/me/location")
    suspend fun location(@Body body: LocationRequest): LocationResponse

    @GET("riders/me/offers")
    suspend fun offers(): Response<OffersResponse>

    @PUT("riders/me/push-devices")
    suspend fun registerPushDevice(@Body body: PushDeviceRequest): PushDeviceResponse

    @HTTP(method = "DELETE", path = "riders/me/push-devices", hasBody = true)
    suspend fun removePushDevice(@Body body: PushDeviceRequest): Response<ResponseBody>

    @GET("riders/me/assignments")
    suspend fun assignments(): LiveAssignmentsResponse

    @GET("riders/me/assignments/completed")
    suspend fun completedAssignments(): LiveAssignmentsResponse

    @GET("riders/me/assignments/active")
    suspend fun activeAssignment(): ActiveAssignmentResponse

    @POST("riders/me/offers/{assignmentId}/acceptance")
    suspend fun accept(
        @Path("assignmentId") assignmentId: String,
        @Header("Idempotency-Key") idempotencyKey: String,
    ): AcceptanceResponse

    @POST("riders/me/deliveries/{deliveryId}/status")
    suspend fun progressWithKey(
        @Path("deliveryId") deliveryId: String,
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body body: StatusRequest,
    ): ProgressResponse

    @POST("riders/me/assignments/{assignmentId}/cancellation")
    suspend fun cancelAssignment(
        @Path("assignmentId") assignmentId: String,
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body body: CancellationRequest,
    ): CancellationResponse

    @GET("riders/me/bid-requests")
    suspend fun bidRequests(): List<BidRequestBody>

    @GET("riders/me/bids")
    suspend fun ownBids(
        @Query("limit") limit: Int,
        @Query("cursor") cursor: String? = null,
    ): OwnBidsResponse

    @POST("riders/me/bids")
    suspend fun submitBid(
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body body: BidSubmissionRequest,
    ): SubmittedBidResponse

    @POST("riders/me/bids/{bidId}/withdrawal")
    suspend fun withdrawBid(@Path("bidId") bidId: String): SubmittedBidResponse

    @GET("riders/me/wallet")
    suspend fun wallet(): WalletSummaryResponse

    @GET("riders/me/wallet/transactions")
    suspend fun walletTransactions(
        @Query("limit") limit: Int,
        @Query("cursor") cursor: String? = null,
    ): WalletTransactionsResponse
}

fun apiBaseUrl(configured: String): String {
    val trimmed = configured.trim().trimEnd('/')
    if (trimmed.isEmpty()) {
        throw IllegalStateException("The app is missing its API address.")
    }
    return "$trimmed/"
}

const val EMULATOR_API_BASE_URL = "http://10.0.2.2:3000"
const val DEVICE_LOOPBACK_API_BASE_URL = "http://127.0.0.1:3000"

fun resolveDebugApiBaseUrl(override: String, emulator: Boolean): String {
    val configured = override.trim().trimEnd('/')
    if (configured.isNotEmpty()) {
        return configured
    }
    return if (emulator) EMULATOR_API_BASE_URL else DEVICE_LOOPBACK_API_BASE_URL
}

fun looksLikeEmulator(
    fingerprint: String,
    model: String,
    hardware: String,
    product: String,
    manufacturer: String,
): Boolean {
    val fp = fingerprint.lowercase()
    val hw = hardware.lowercase()
    val prod = product.lowercase()
    return fp.startsWith("generic")
        || fp.contains("emulator")
        || fp.contains("sdk_gphone")
        || model.contains("Emulator", ignoreCase = true)
        || model.contains("Android SDK built for", ignoreCase = true)
        || hw.contains("goldfish")
        || hw.contains("ranchu")
        || prod.contains("sdk_gphone")
        || prod == "google_sdk"
        || manufacturer.contains("Genymotion", ignoreCase = true)
}

fun retrofit(baseUrl: String, client: OkHttpClient): Retrofit {
    return Retrofit.Builder()
        .baseUrl(apiBaseUrl(baseUrl))
        .client(client)
        .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
        .build()
}

fun httpClient(builder: OkHttpClient.Builder.() -> Unit = {}): OkHttpClient {
    return OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .apply(builder)
        .build()
}
