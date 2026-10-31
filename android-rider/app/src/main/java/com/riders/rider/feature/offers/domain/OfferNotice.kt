package com.riders.rider.feature.offers.domain

import com.riders.rider.feature.auth.domain.AppEntry

const val OFFER_CHANNEL_ID = "rider_delivery_requests"
const val OFFER_NOTICE_TITLE = "New delivery request"
const val OFFER_NOTICE_BODY = "Open the app to respond. This request expires soon."
const val REQUEST_UNAVAILABLE = "Offer no longer available"
const val OFFER_EXTRA_ASSIGNMENT_ID = "rider_offer_assignment_id"
const val ACCEPTED_BID_EXTRA_DELIVERY_ID = "v2_bid_accepted_delivery_id"
const val ACCEPTED_BID_TITLE = "Your bid was accepted"
const val ACCEPTED_BID_BODY = "Open the delivery to continue."
const val OFFER_NOTICE_HISTORY_LIMIT = 50

data class RiderOfferMessage(
    val assignmentId: String,
    val deliveryId: String,
    val expiresAt: String,
)

fun parseRiderOffer(data: Map<String, String>): RiderOfferMessage? {
    if (data["type"] != "rider_offer") {
        return null
    }
    val assignmentId = data["assignmentId"]?.trim().orEmpty()
    val deliveryId = data["deliveryId"]?.trim().orEmpty()
    val expiresAt = data["expiresAt"]?.trim().orEmpty()
    if (assignmentId.isEmpty() || deliveryId.isEmpty() || expiresAt.isEmpty()) {
        return null
    }
    return RiderOfferMessage(assignmentId, deliveryId, expiresAt)
}

sealed interface RiderNotice {
    data class Offer(val assignmentId: String, val deliveryId: String, val expiresAt: String) : RiderNotice
    data class BidAccepted(val deliveryId: String) : RiderNotice
}

fun parseRiderNotice(data: Map<String, String>): RiderNotice? {
    return when (data["type"]) {
        "rider_offer" -> parseRiderOffer(data)?.let { offer ->
            RiderNotice.Offer(offer.assignmentId, offer.deliveryId, offer.expiresAt)
        }
        "v2_bid_accepted" -> {
            val deliveryId = data["deliveryId"]?.trim().orEmpty()
            if (deliveryId.isEmpty()) null else RiderNotice.BidAccepted(deliveryId)
        }
        else -> null
    }
}

fun riderOfferOpensV1Offers(@Suppress("UNUSED_PARAMETER") notice: RiderNotice): Boolean = false

fun acceptedBidDeliveryId(notice: RiderNotice): String? = (notice as? RiderNotice.BidAccepted)?.deliveryId

fun offerNotificationId(assignmentId: String): Int = assignmentId.hashCode() and 0x7fffffff

fun rememberShownOffer(existing: List<String>, assignmentId: String): List<String>? {
    if (assignmentId.isBlank() || existing.contains(assignmentId)) {
        return null
    }
    return (listOf(assignmentId) + existing).take(OFFER_NOTICE_HISTORY_LIMIT)
}

fun shouldAskNotificationPermission(sdkInt: Int, granted: Boolean, alreadyAsked: Boolean): Boolean {
    return sdkInt >= 33 && !granted && !alreadyAsked
}

fun shouldHoldOfferTap(entry: AppEntry): Boolean = entry != AppEntry.Home

fun notificationTapCanOpen(listed: Boolean, expiresAt: String?, nowMillis: Long): Boolean {
    if (!listed || expiresAt == null) {
        return false
    }
    return !offerIsExpired(expiresAt, nowMillis)
}
