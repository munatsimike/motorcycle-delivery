package com.riders.rider.feature.offers.domain

import java.time.Instant
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

fun acceptOfferLabel(currency: String, offeredPrice: String): String {
    val amount = if (currency == "USD") "\$$offeredPrice" else offerPriceLabel(currency, offeredPrice)
    return "Accept for $amount"
}

fun senderChoosesRider(serviceClass: String?): Boolean {
    return serviceClass == "EXPRESS" || serviceClass == "FLEXIBLE"
}

fun opensDeliveriesAfterListedOffer(serviceClass: String?): Boolean {
    return !senderChoosesRider(serviceClass)
}

@Suppress("UNUSED_PARAMETER")
fun offerSentConfirmation(currency: String, amount: String): String {
    return "Offer sent. Waiting for the customer to choose a rider."
}

fun submittedOfferAmount(sent: Map<String, String>, deliveryId: String): String? = sent[deliveryId]

fun requestNeedsAnotherOffer(deliveryId: String, sent: Map<String, String>): Boolean {
    return submittedOfferAmount(sent, deliveryId) == null
}

fun canStartBidSubmit(submittingBid: Boolean, accepting: Boolean): Boolean {
    return !submittingBid && !accepting
}

fun sentOffersAfterRefresh(sent: Map<String, String>): Map<String, String> = sent

data class BidSubmissionUi(
    val submitting: Boolean,
    val amount: String?,
    val error: String?,
)

fun bidSubmissionAfterResult(amount: String, error: String?): BidSubmissionUi {
    return if (error == null) {
        BidSubmissionUi(submitting = false, amount = amount, error = null)
    } else {
        BidSubmissionUi(submitting = false, amount = null, error = error)
    }
}

const val OFFER_YOUR_PRICE = "Your offer"
const val AWAITING_CUSTOMER = "Awaiting customer"

fun deliveryCategoryTitle(description: String): String = when (description.trim().lowercase()) {
    "food" -> "Food delivery"
    "document", "documents", "doc" -> "Doc delivery"
    else -> "Parcel delivery"
}

fun offerDistanceLabel(meters: Int): String {
    if (meters < 1000) {
        return "$meters m"
    }
    val kilometres = meters / 1000.0
    val text = if (kilometres >= 10.0) {
        kilometres.toInt().toString()
    } else {
        String.format(java.util.Locale.US, "%.1f", kilometres)
    }
    return "$text km"
}

fun offerStopLine(address: String, landmark: String?): String {
    val place = address.trim()
    val mark = landmark?.trim().orEmpty()
    if (mark.isEmpty()) {
        return place
    }
    val placeKey = normalizePlace(place)
    val markKey = normalizePlace(mark)
    if (markKey.isEmpty() || placeKey == markKey || placeKey.contains(markKey) || markKey.contains(placeKey)) {
        return place.ifBlank { mark }
    }
    return if (place.isEmpty()) mark else "$place, $mark"
}

private fun normalizePlace(value: String): String {
    return value.lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()
}

fun shouldPollOffers(resumed: Boolean): Boolean = resumed

fun offerUnavailableAfterRefresh(hadSelection: Boolean, stillPresent: Boolean, refreshSucceeded: Boolean): Boolean {
    return refreshSucceeded && hadSelection && !stillPresent
}

fun matchingOfferIndex(
    selectedAssignmentId: String,
    selectedDeliveryId: String,
    assignmentIds: List<String>,
    deliveryIds: List<String>,
): Int {
    val exact = assignmentIds.indexOf(selectedAssignmentId)
    if (exact >= 0) {
        return exact
    }
    return deliveryIds.indexOf(selectedDeliveryId)
}

fun canAcceptOffer(expiresAt: String, nowMillis: Long, accepting: Boolean, unavailable: Boolean): Boolean {
    if (accepting || unavailable) {
        return false
    }
    if (expiresAt.isBlank()) {
        return true
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
        return "Expired"
    }
    val remainingSeconds = ((expiry - nowMillis) + 999L) / 1_000L
    val minutes = remainingSeconds / 60L
    val seconds = remainingSeconds % 60L
    return "$minutes:${seconds.toString().padStart(2, '0')}"
}

private fun parseExpiry(expiresAt: String): Long? {
    return try {
        Instant.parse(expiresAt).toEpochMilli()
    } catch (_: Exception) {
        null
    }
}
