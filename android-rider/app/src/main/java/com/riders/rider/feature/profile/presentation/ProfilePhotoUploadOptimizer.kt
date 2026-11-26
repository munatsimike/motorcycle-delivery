package com.riders.rider.feature.profile.presentation

import android.annotation.TargetApi
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.os.Build
import com.riders.rider.feature.profile.domain.profilePhotoContentType
import com.riders.rider.feature.profile.domain.profilePhotoIssue
import com.riders.rider.feature.profile.domain.profilePhotoUploadSize
import com.riders.rider.feature.profile.domain.smallerProfilePhotoJpeg
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/** Best-effort, off-main-thread optimisation for profile photos only (not verification documents). */
internal fun prepareProfilePhotoUpload(original: ByteArray): ByteArray {
    // Preserve PNG/WebP transparency, animation and the original path on older Android versions.
    if (Build.VERSION.SDK_INT < 28 || profilePhotoContentType(original) != "image/jpeg" ||
        profilePhotoIssue(original) != null || original.size < 256 * 1024
    ) return original
    return try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(original, 0, original.size, bounds)
        if (profilePhotoUploadSize(bounds.outWidth, bounds.outHeight, original.size) == null) return original
        smallerProfilePhotoJpeg(original, encodeSmallerJpeg(original))
    } catch (_: Exception) {
        // Preserve the original validation/upload behaviour if decoding or encoding fails.
        original
    }
}

@TargetApi(28)
private fun encodeSmallerJpeg(original: ByteArray): ByteArray? {
    // ImageDecoder applies EXIF orientation, including mirrored orientations, before encoding.
    val source = ImageDecoder.createSource(ByteBuffer.wrap(original))
    val bitmap = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
        val size = profilePhotoUploadSize(info.size.width, info.size.height, original.size)
            ?: throw IllegalArgumentException("Photo does not require resizing")
        decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE)
        decoder.setTargetSize(size.first, size.second)
    }
    return try {
        ByteArrayOutputStream().use { output ->
            if (bitmap.compress(Bitmap.CompressFormat.JPEG, 95, output)) output.toByteArray() else null
        }
    } finally {
        bitmap.recycle()
    }
}
