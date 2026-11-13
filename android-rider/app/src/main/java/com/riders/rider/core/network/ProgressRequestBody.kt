package com.riders.rider.core.network

import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink

internal class ProgressRequestBody(
    private val bytes: ByteArray,
    private val mediaType: MediaType,
    private val onProgress: (Int) -> Unit,
) : RequestBody() {
    override fun contentType(): MediaType = mediaType

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
