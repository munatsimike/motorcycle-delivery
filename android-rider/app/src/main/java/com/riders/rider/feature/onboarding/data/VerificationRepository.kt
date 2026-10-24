package com.riders.rider.feature.onboarding.data

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.MotorcycleRequest
import com.riders.rider.core.network.MotorcycleResponse
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.network.text
import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.MotorcycleDraft
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.StoredLicence
import com.riders.rider.feature.onboarding.domain.licenceContentType
import com.riders.rider.feature.onboarding.domain.licenceFileName
import javax.inject.Inject
import javax.inject.Singleton
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okio.BufferedSink

data class RiderIdentity(
    val fullName: String,
    val phone: String,
    val address: String? = null,
)

@Singleton
class VerificationRepository @Inject constructor(
    private val riders: RiderService,
) {
    suspend fun profile(): ApiResult<RiderIdentity> {
        return when (val result = apiCall { riders.profile() }) {
            is ApiResult.Ok -> ApiResult.Ok(RiderIdentity(result.value.fullName, result.value.phone, result.value.address))
            is ApiResult.Err -> result
        }
    }

    suspend fun onboarding(): ApiResult<RiderOnboarding> {
        return when (val result = apiCall { riders.onboarding() }) {
            is ApiResult.Ok -> ApiResult.Ok(
                RiderOnboarding(
                    licenceVerificationStatus = result.value.licenceVerificationStatus,
                    approvalStatus = result.value.approvalStatus,
                    availability = result.value.availability,
                    licenceNumber = result.value.licenceNumber,
                    licenceClass = result.value.licenceClass,
                    rejectionReason = result.value.rejectionReason,
                    verifiedMotorcycleCount = result.value.verifiedMotorcycleCount,
                    activeVerifiedMotorcycle = result.value.activeVerifiedMotorcycle,
                    receiving = result.value.receiving,
                ),
            )
            is ApiResult.Err -> result
        }
    }

    suspend fun licence(): ApiResult<StoredLicence?> {
        return when (val result = apiCall { riders.licenceImage() }) {
            is ApiResult.Ok -> ApiResult.Ok(
                StoredLicence(
                    id = result.value.id,
                    reviewStatus = result.value.reviewStatus,
                    contentType = result.value.contentType,
                    byteSize = result.value.byteSize,
                ),
            )
            is ApiResult.Err -> {
                if (result.error.text() == "No licence image has been uploaded") {
                    ApiResult.Ok(null)
                } else {
                    result
                }
            }
        }
    }

    suspend fun uploadLicence(bytes: ByteArray, onProgress: (Int) -> Unit): ApiResult<StoredLicence> {
        val type = licenceContentType(bytes) ?: return ApiResult.Err(
            ApiError.Validation("Licence image must be a JPEG, PNG, or WebP file"),
        )
        val part = MultipartBody.Part.createFormData(
            "image",
            licenceFileName(bytes),
            ProgressRequestBody(bytes, type.toMediaType(), onProgress),
        )
        return when (val result = apiCall { riders.uploadLicence(part) }) {
            is ApiResult.Ok -> ApiResult.Ok(
                StoredLicence(
                    id = result.value.id,
                    reviewStatus = result.value.reviewStatus,
                    contentType = result.value.contentType,
                    byteSize = result.value.byteSize,
                ),
            )
            is ApiResult.Err -> result
        }
    }

    suspend fun motorcycles(): ApiResult<List<MotorcycleDetails>> {
        return when (val result = apiCall { riders.motorcycles() }) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.map { it.toDomain() })
            is ApiResult.Err -> result
        }
    }

    suspend fun saveMotorcycle(id: String?, draft: MotorcycleDraft): ApiResult<MotorcycleDetails> {
        val body = MotorcycleRequest(
            registrationNumber = draft.registrationNumber.trim(),
            make = draft.make.trim(),
            model = draft.model.trim(),
            colour = draft.colour.trim(),
        )
        val result = if (id == null) {
            apiCall { riders.registerMotorcycle(body) }
        } else {
            apiCall { riders.updateMotorcycle(id, body) }
        }
        return when (result) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.toDomain())
            is ApiResult.Err -> result
        }
    }

    suspend fun selectMotorcycle(id: String): ApiResult<MotorcycleDetails> {
        return when (val result = apiCall { riders.selectMotorcycle(id) }) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.toDomain())
            is ApiResult.Err -> result
        }
    }
}

private fun MotorcycleResponse.toDomain(): MotorcycleDetails {
    return MotorcycleDetails(
        id = id,
        registrationNumber = registrationNumber,
        make = make,
        model = model,
        colour = colour,
        verificationStatus = verificationStatus,
        isActive = isActive,
    )
}

private class ProgressRequestBody(
    private val bytes: ByteArray,
    private val mediaType: okhttp3.MediaType,
    private val onProgress: (Int) -> Unit,
) : RequestBody() {
    override fun contentType(): okhttp3.MediaType = mediaType

    override fun contentLength(): Long = bytes.size.toLong()

    override fun writeTo(sink: BufferedSink) {
        var sent = 0
        val chunk = 8 * 1024
        while (sent < bytes.size) {
            val end = minOf(sent + chunk, bytes.size)
            sink.write(bytes, sent, end - sent)
            sent = end
            onProgress(((sent * 100L) / bytes.size).toInt())
        }
    }
}
