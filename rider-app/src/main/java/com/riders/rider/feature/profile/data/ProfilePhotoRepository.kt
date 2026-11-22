package com.riders.rider.feature.profile.data

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.ProgressRequestBody
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.network.mapHttpFailure
import com.riders.rider.feature.profile.domain.profilePhotoContentType
import com.riders.rider.feature.profile.domain.profilePhotoFileName
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody

@Singleton
class ProfilePhotoRepository @Inject constructor(
    private val riders: RiderService,
) {
    suspend fun download(): ApiResult<ByteArray> {
        return withContext(Dispatchers.IO) {
            when (val result = apiCall { riders.profilePhoto().use { body -> body.bytes() } }) {
                is ApiResult.Ok -> ApiResult.Ok(result.value)
                is ApiResult.Err -> result
            }
        }
    }

    suspend fun upload(bytes: ByteArray, onProgress: (Int) -> Unit): ApiResult<Unit> {
        val type = profilePhotoContentType(bytes) ?: return ApiResult.Err(
            ApiError.Validation("Profile photo must be a JPEG, PNG, or WebP file"),
        )
        val part = MultipartBody.Part.createFormData(
            "image",
            profilePhotoFileName(bytes),
            ProgressRequestBody(bytes, type.toMediaType(), onProgress),
        )
        return withContext(Dispatchers.IO) {
            when (val result = apiCall { riders.uploadProfilePhoto(part) }) {
                is ApiResult.Ok -> {
                    result.value.close()
                    ApiResult.Ok(Unit)
                }
                is ApiResult.Err -> result
            }
        }
    }

    suspend fun remove(): ApiResult<Unit> {
        return withContext(Dispatchers.IO) {
            when (val result = apiCall { riders.deleteProfilePhoto() }) {
                is ApiResult.Ok -> {
                    val response = result.value
                    if (!response.isSuccessful) {
                        ApiResult.Err(mapHttpFailure(response.code(), response.errorBody()?.string()))
                    } else {
                        response.body()?.close()
                        ApiResult.Ok(Unit)
                    }
                }
                is ApiResult.Err -> result
            }
        }
    }
}
