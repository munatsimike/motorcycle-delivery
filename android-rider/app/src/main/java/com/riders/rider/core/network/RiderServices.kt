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
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import java.util.concurrent.TimeUnit

val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

interface AuthService {
    @POST("auth/rider/login/otp")
    suspend fun requestLogin(@Body body: PhoneRequest): PendingResponse

    @POST("auth/rider/login/verify")
    suspend fun verifyLogin(@Body body: VerifyRequest): SessionResponse

    @POST("auth/rider/register/otp")
    suspend fun requestRegistration(@Body body: RegisterRequest): PendingResponse

    @POST("auth/rider/register/verify")
    suspend fun verifyRegistration(@Body body: VerifyRequest): SessionResponse

    @POST("auth/session/refresh")
    suspend fun refresh(@Body body: RefreshRequest): SessionResponse

    @POST("auth/session/logout")
    suspend fun logout(): Response<ResponseBody>
}

interface RiderService {
    @GET("riders/me/profile")
    suspend fun profile(): RiderProfileResponse

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

    @PUT("riders/me/location")
    suspend fun location(@Body body: LocationRequest): LocationResponse

    @GET("riders/me/offers")
    suspend fun offers(): OffersResponse

    @GET("riders/me/assignments/active")
    suspend fun activeAssignment(): ActiveAssignmentResponse

    @POST("riders/me/offers/{assignmentId}/acceptance")
    suspend fun accept(
        @Path("assignmentId") assignmentId: String,
        @Header("Idempotency-Key") idempotencyKey: String,
    ): AcceptanceResponse

    @POST("riders/me/offers/{assignmentId}/release")
    suspend fun release(
        @Path("assignmentId") assignmentId: String,
        @Body body: ReleaseRequest,
    ): ProgressResponse

    @POST("riders/me/deliveries/{deliveryId}/status")
    suspend fun progress(
        @Path("deliveryId") deliveryId: String,
        @Body body: StatusRequest,
    ): ProgressResponse
}

fun apiBaseUrl(configured: String): String {
    val trimmed = configured.trim().trimEnd('/')
    if (trimmed.isEmpty()) {
        throw IllegalStateException("The app is missing its API address.")
    }
    return "$trimmed/"
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
