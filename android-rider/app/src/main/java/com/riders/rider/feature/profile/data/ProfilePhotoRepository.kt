package com.riders.rider.feature.profile.data

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.ProgressRequestBody
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.network.mapHttpFailure
import com.riders.rider.feature.profile.domain.profilePhotoContentType
import com.riders.rider.feature.profile.domain.readBoundedPhoto
import com.riders.rider.feature.profile.domain.profilePhotoIssue
import com.riders.rider.feature.profile.domain.reasonablePhotoDimensions
import android.graphics.BitmapFactory
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
            when (val result = apiCall { riders.profilePhoto().use { body -> readBoundedPhoto(body.byteStream(), body.contentLength()) } }) {
                is ApiResult.Ok -> {
                    val bytes = result.value
                    if (bytes == null || !validPhoto(bytes)) ApiResult.Err(ApiError.Validation("Invalid or oversized profile photo"))
                    else ApiResult.Ok(bytes)
                }
                is ApiResult.Err -> result
            }
        }
    }

    suspend fun upload(bytes: ByteArray, onProgress: (Int) -> Unit): ApiResult<Unit> {
        if (!withContext(Dispatchers.IO) { validPhoto(bytes) }) return ApiResult.Err(ApiError.Validation("Invalid or oversized profile photo"))
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

    private fun validPhoto(bytes: ByteArray): Boolean {
        if (profilePhotoIssue(bytes) != null) return false
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        return reasonablePhotoDimensions(bounds.outWidth, bounds.outHeight)
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
