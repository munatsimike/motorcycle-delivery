package com.riders.rider.feature.profile.presentation

import android.annotation.TargetApi
import android.media.ExifInterface
import android.os.Build
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

internal fun stripJpegMetadata(bytes: ByteArray): ByteArray {
    if (Build.VERSION.SDK_INT < 24 || bytes.size < 4 || bytes[0] != 0xff.toByte() || bytes[1] != 0xd8.toByte()) return bytes
    return runCatching { stripJpegMetadata24(bytes) }.getOrDefault(bytes)
}

@TargetApi(24)
private fun stripJpegMetadata24(bytes: ByteArray): ByteArray {
    val orientation = ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1).coerceIn(1, 8)
    val out = ByteArrayOutputStream(bytes.size)
    out.write(bytes, 0, 2)
    // Minimal big-endian TIFF EXIF containing only the orientation tag.
    if (orientation != 1) {
        val exif = byteArrayOf(0xff.toByte(), 0xe1.toByte(), 0, 34, 69,120,105,102,0,0,
            77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,orientation.toByte(),0,0,0,0,0,0)
        out.write(exif)
    }
    var offset = 2
    while (offset + 1 < bytes.size) {
        if (bytes[offset] != 0xff.toByte()) return bytes
        val start = offset
        while (offset < bytes.size && bytes[offset] == 0xff.toByte()) offset++
        if (offset >= bytes.size) return bytes
        val marker = bytes[offset++].toInt() and 255
        if (marker == 0xda || marker == 0xd9) {
            out.write(bytes, start, bytes.size - start)
            return out.toByteArray()
        }
        if (marker == 0x01 || marker in 0xd0..0xd7) { out.write(bytes, start, offset - start); continue }
        if (offset + 1 >= bytes.size) return bytes
        val length = ((bytes[offset].toInt() and 255) shl 8) or (bytes[offset + 1].toInt() and 255)
        if (length < 2 || offset + length > bytes.size) return bytes
        val end = offset + length
        // APP1 (EXIF/XMP), APP13 (IPTC), COM. Keep APP2 colour profiles and compressed scan data.
        if (marker !in setOf(0xe1, 0xed, 0xfe)) out.write(bytes, start, end - start)
        offset = end
    }
    return bytes
}
