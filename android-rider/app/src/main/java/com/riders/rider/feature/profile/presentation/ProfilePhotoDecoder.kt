package com.riders.rider.feature.profile.presentation

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.riders.rider.feature.profile.domain.PROFILE_PHOTO_MAX_EDGE
import com.riders.rider.feature.profile.domain.profilePhotoSampleSize

fun decodeProfilePhoto(bytes: ByteArray, maxEdge: Int = PROFILE_PHOTO_MAX_EDGE): Bitmap? {
    if (bytes.isEmpty()) {
        return null
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        return null
    }
    val options = BitmapFactory.Options().apply {
        inSampleSize = profilePhotoSampleSize(bounds.outWidth, bounds.outHeight, maxEdge)
        inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
}
