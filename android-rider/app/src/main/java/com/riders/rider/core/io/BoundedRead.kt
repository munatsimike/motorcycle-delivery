package com.riders.rider.core.io

import java.io.ByteArrayOutputStream
import java.io.InputStream

fun readAtMost(stream: InputStream, limit: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val chunk = ByteArray(8 * 1024)
    var total = 0
    while (total <= limit) {
        val read = stream.read(chunk)
        if (read < 0) {
            break
        }
        val allowed = minOf(read, limit - total + 1)
        if (allowed > 0) {
            output.write(chunk, 0, minOf(read, allowed))
        }
        total += read
        if (total > limit) {
            return ByteArray(limit + 1)
        }
    }
    return output.toByteArray()
}
