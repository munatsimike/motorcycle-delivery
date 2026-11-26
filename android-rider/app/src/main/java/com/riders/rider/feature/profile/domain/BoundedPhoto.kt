package com.riders.rider.feature.profile.domain

import java.io.InputStream
import java.io.ByteArrayOutputStream

fun readBoundedPhoto(input: InputStream, declaredLength: Long, max: Int = PROFILE_PHOTO_MAX_BYTES): ByteArray? {
    if (declaredLength > max || max <= 0) return null
    val output = ByteArrayOutputStream(minOf(max, 16 * 1024))
    val buffer = ByteArray(8192)
    var total = 0
    while (true) {
        val count = input.read(buffer, 0, minOf(buffer.size, max - total + 1))
        if (count < 0) break
        if (count == 0) continue
        if (count > max - total) return null
        output.write(buffer, 0, count)
        total += count
    }
    return output.toByteArray()
}

fun reasonablePhotoDimensions(width: Int, height: Int): Boolean =
    width in 1..12000 && height in 1..12000 && width.toLong() * height <= 64_000_000L
