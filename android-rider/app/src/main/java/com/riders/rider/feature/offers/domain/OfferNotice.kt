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
const val ACCOUNT_APPROVED_EXTRA = "rider_account_approved"
const val ACCOUNT_APPROVED_TITLE = "Account approved"
const val ACCOUNT_APPROVED_BODY = "You can receive delivery requests."
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
    val deliveryId = data["deliveryId"]?.trim().orEmpty()
    if (deliveryId.isEmpty()) {
        return null
    }
    val assignmentId = data["assignmentId"]?.trim().orEmpty().ifEmpty { "request:$deliveryId" }
    val expiresAt = data["expiresAt"]?.trim().orEmpty()
    return RiderOfferMessage(assignmentId, deliveryId, expiresAt)
}

sealed interface RiderNotice {
    data class Offer(val assignmentId: String, val deliveryId: String, val expiresAt: String) : RiderNotice
    data class BidAccepted(val deliveryId: String) : RiderNotice
    data class Approved(val approvedAt: String) : RiderNotice
}

sealed interface RiderNoticeAction {
    data class ShowOffer(val deliveryId: String, val expiresAt: String) : RiderNoticeAction
    data class ShowAccepted(val deliveryId: String) : RiderNoticeAction
    data class ShowApproved(val approvedAt: String) : RiderNoticeAction
    data object Ignore : RiderNoticeAction
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
        "rider_account_approved" -> {
            val approvedAt = data["approvedAt"]?.trim().orEmpty()
            if (approvedAt.isEmpty()) null else RiderNotice.Approved(approvedAt)
        }
        else -> null
    }
}

fun riderNoticeAction(notice: RiderNotice?): RiderNoticeAction {
    return when (notice) {
        is RiderNotice.Offer -> RiderNoticeAction.ShowOffer(notice.deliveryId, notice.expiresAt)
        is RiderNotice.BidAccepted -> RiderNoticeAction.ShowAccepted(notice.deliveryId)
        is RiderNotice.Approved -> RiderNoticeAction.ShowApproved(notice.approvedAt)
        null -> RiderNoticeAction.Ignore
    }
}

enum class RiderSignOutStep { AVAILABILITY, PUSH_DEVICE, SESSION, LOCAL }

fun riderSignOutOrder(): List<RiderSignOutStep> = listOf(
    RiderSignOutStep.AVAILABILITY,
    RiderSignOutStep.PUSH_DEVICE,
    RiderSignOutStep.SESSION,
    RiderSignOutStep.LOCAL,
)

fun pushDeviceRemovedBeforeSession(steps: List<RiderSignOutStep> = riderSignOutOrder()): Boolean {
    val push = steps.indexOf(RiderSignOutStep.PUSH_DEVICE)
    val session = steps.indexOf(RiderSignOutStep.SESSION)
    return push >= 0 && session > push
}

fun canRemovePushDevice(sessionPresent: Boolean, token: String?): Boolean {
    return sessionPresent && !token.isNullOrBlank()
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

fun notificationRequestCanOpen(listed: Boolean, expiresAt: String?, nowMillis: Long): Boolean {
    if (!listed) {
        return false
    }
    if (expiresAt.isNullOrBlank()) {
        return true
    }
    return notificationTapCanOpen(listed = true, expiresAt = expiresAt, nowMillis = nowMillis)
}
