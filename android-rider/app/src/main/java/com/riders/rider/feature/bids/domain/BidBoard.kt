package com.riders.rider.feature.bids.domain

import com.riders.rider.core.network.ApiError
import com.riders.rider.feature.offers.domain.leavesAcceptUnresolved
import kotlinx.serialization.Serializable

const val EXPRESS_BIDS_UNAVAILABLE = "New bids are unavailable while an Express delivery is active."
const val BID_AMOUNT_INVALID = "Enter a bid amount in USD."
const val MARKETPLACE_DISABLED = "Bidding is not available"

@Serializable
data class BidAttempt(
    val deliveryId: String,
    val amountCents: Int,
    val key: String,
)

data class OpenBidRequest(
    val id: String,
    val serviceClass: String?,
    val deliverBy: String?,
    val suggestedPrice: String?,
    val pickupAddress: String,
    val dropoffAddress: String,
    val parcelDescription: String,
    val parcelSize: String,
)

data class OwnBid(
    val bidId: String,
    val deliveryId: String,
    val amount: String,
    val currency: String,
    val status: String,
    val createdAt: String,
    val serviceClass: String?,
    val pickupAddress: String,
    val dropoffAddress: String,
    val deliverBy: String?,
)

enum class BidBoardPhase {
    Loading,
    Failed,
    Empty,
    Ready,
}

enum class BidFailureKind {
    Network,
    Authentication,
    MarketplaceDisabled,
    Request,
}

class BidSubmitGate {
    private val inFlight = mutableSetOf<String>()

    fun tryStart(id: String): Boolean = inFlight.add(id)

    fun finish(id: String) {
        inFlight.remove(id)
    }
}

fun bidAmountCents(raw: String): Int? {
    val text = raw.trim()
    if (!Regex("""\d+(\.\d{1,2})?""").matches(text)) {
        return null
    }
    val parts = text.split('.')
    val dollars = parts[0].toLongOrNull() ?: return null
    val centsPart = parts.getOrNull(1)?.padEnd(2, '0')?.toIntOrNull() ?: 0
    val cents = dollars * 100 + centsPart
    if (cents <= 0 || cents > Int.MAX_VALUE) {
        return null
    }
    return cents.toInt()
}

fun formatBidDollars(amountCents: Int): String {
    val whole = amountCents / 100
    val fraction = (amountCents % 100).toString().padStart(2, '0')
    return "$whole.$fraction"
}

fun nextBidAttempt(existing: BidAttempt?, deliveryId: String, amountCents: Int, freshKey: String): BidAttempt {
    if (existing != null && existing.deliveryId == deliveryId) {
        return existing
    }
    return BidAttempt(deliveryId, amountCents, freshKey)
}

fun bidAttemptAfterRefresh(existing: BidAttempt?, bids: List<OwnBid>): BidAttempt? {
    if (existing == null) {
        return null
    }
    val amount = formatBidDollars(existing.amountCents)
    val recorded = bids.any { bid -> bid.deliveryId == existing.deliveryId && bid.amount == amount }
    return if (recorded) null else existing
}

fun visibleBids(serverBids: List<OwnBid>, @Suppress("UNUSED_PARAMETER") pending: BidAttempt?): List<OwnBid> = serverBids

fun newBidsUnavailable(serviceClasses: List<String?>): Boolean = serviceClasses.any { it == "EXPRESS" }

fun bidCanWithdraw(status: String): Boolean = status == "OPEN"

fun acceptedBidNeedsRiderConfirmation(): Boolean = false

fun bidStatusLabel(status: String): String = when (status) {
    "OPEN" -> "Open"
    "WITHDRAWN" -> "Withdrawn"
    "ACCEPTED" -> "Accepted"
    "SUPERSEDED" -> "Superseded"
    "EXPIRED" -> "Expired"
    else -> status
}

fun bidAmountLabel(currency: String, amount: String): String = "$currency $amount"

fun suggestedPriceLabel(amount: String?): String? {
    val value = amount?.trim().orEmpty()
    if (value.isEmpty()) {
        return null
    }
    return "Suggested price USD $value"
}

fun parcelSummary(description: String, size: String): String {
    return listOf(description.trim(), size.trim()).filter { it.isNotEmpty() }.joinToString(" · ")
}

fun openBidFor(bids: List<OwnBid>, deliveryId: String): OwnBid? {
    return bids.firstOrNull { it.deliveryId == deliveryId && it.status == "OPEN" }
}

fun bidBoardPhase(loading: Boolean, requestCount: Int, bidCount: Int, error: String?): BidBoardPhase {
    if (loading && requestCount == 0 && bidCount == 0 && error == null) {
        return BidBoardPhase.Loading
    }
    if (error != null && requestCount == 0 && bidCount == 0) {
        return BidBoardPhase.Failed
    }
    if (requestCount == 0 && bidCount == 0) {
        return BidBoardPhase.Empty
    }
    return BidBoardPhase.Ready
}

fun bidFailureKind(error: ApiError): BidFailureKind = when (error) {
    ApiError.Network, ApiError.Timeout -> BidFailureKind.Network
    ApiError.SessionEnded, ApiError.Forbidden -> BidFailureKind.Authentication
    is ApiError.Unexpected -> if (error.message == MARKETPLACE_DISABLED) {
        BidFailureKind.MarketplaceDisabled
    } else {
        BidFailureKind.Request
    }
    else -> BidFailureKind.Request
}

fun keepsBidAttempt(error: ApiError): Boolean = error.leavesAcceptUnresolved()
