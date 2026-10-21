package com.riders.rider.feature.offers.domain

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

data class OfferBoard(
    val count: Int = 0,
    val loading: Boolean = false,
    val error: String? = null,
)

const val OFFER_REFRESH_INTERVAL_MS = 20_000L
const val OFFER_CLOCK_INTERVAL_MS = 1_000L
const val OFFER_UNAVAILABLE = "This offer is no longer available."

fun offerBoardAfterLoad(previous: OfferBoard, count: Int?, error: String?): OfferBoard {
    return if (count != null) {
        OfferBoard(count = count, loading = false, error = null)
    } else {
        previous.copy(loading = false, error = error)
    }
}

fun offerPriceLabel(currency: String, offeredPrice: String): String = "$currency $offeredPrice"

fun shouldPollOffers(resumed: Boolean): Boolean = resumed

fun offerUnavailableAfterRefresh(hadSelection: Boolean, stillPresent: Boolean, refreshSucceeded: Boolean): Boolean {
    return refreshSucceeded && hadSelection && !stillPresent
}

fun canAcceptOffer(expiresAt: String, nowMillis: Long, accepting: Boolean, unavailable: Boolean): Boolean {
    if (accepting || unavailable) {
        return false
    }
    return !offerIsExpired(expiresAt, nowMillis)
}

fun httpDateMillis(value: String?): Long? {
    if (value.isNullOrBlank()) {
        return null
    }
    return try {
        ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
    } catch (_: Exception) {
        null
    }
}

fun clockOffsetMillis(serverNowMillis: Long?, deviceNowMillis: Long): Long {
    if (serverNowMillis == null) {
        return 0L
    }
    return serverNowMillis - deviceNowMillis
}

fun adjustedNowMillis(deviceNowMillis: Long, offsetMillis: Long): Long = deviceNowMillis + offsetMillis

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
    val remainingSeconds = ((expiry - nowMillis) + 999L) / 1_000L
    return "Expires at $time · ${remainingSeconds}s"
}

private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

private fun parseExpiry(expiresAt: String): Long? {
    return try {
        Instant.parse(expiresAt).toEpochMilli()
    } catch (_: Exception) {
        null
    }
}
