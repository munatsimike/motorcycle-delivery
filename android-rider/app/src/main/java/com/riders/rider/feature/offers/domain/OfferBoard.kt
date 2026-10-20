package com.riders.rider.feature.offers.domain

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class OfferBoard(
    val count: Int = 0,
    val loading: Boolean = false,
    val error: String? = null,
)

fun offerBoardAfterLoad(previous: OfferBoard, count: Int?, error: String?): OfferBoard {
    return if (count != null) {
        OfferBoard(count = count, loading = false, error = null)
    } else {
        previous.copy(loading = false, error = error)
    }
}

fun offerIsExpired(expiresAt: String, nowMillis: Long): Boolean {
    val expiry = parseExpiry(expiresAt) ?: return true
    return expiry <= nowMillis
}

fun offerExpiryLabel(expiresAt: String, nowMillis: Long): String {
    val expiry = parseExpiry(expiresAt) ?: return "Expiry time is unavailable"
    if (expiry <= nowMillis) {
        return "This offer has expired"
    }
    val time = Instant.ofEpochMilli(expiry).atZone(ZoneId.systemDefault()).format(CLOCK)
    return "Expires at $time"
}

private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

private fun parseExpiry(expiresAt: String): Long? {
    return try {
        Instant.parse(expiresAt).toEpochMilli()
    } catch (_: Exception) {
        null
    }
}
