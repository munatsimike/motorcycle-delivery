package com.riders.rider.feature.bids.domain

import com.riders.rider.core.network.ApiError
import java.time.Instant
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.ParcelResponse
import com.riders.rider.core.network.StopResponse
import com.riders.rider.feature.offers.domain.AWAITING_CUSTOMER
import com.riders.rider.feature.offers.domain.leavesAcceptUnresolved
import com.riders.rider.feature.offers.domain.offerSentConfirmation
import kotlinx.serialization.Serializable

const val EXPRESS_BIDS_UNAVAILABLE = "New bids are unavailable while an Urgent delivery is active."
const val BID_AMOUNT_INVALID = "Enter a bid amount in USD."
const val MARKETPLACE_DISABLED = "Bidding is not available"
const val BID_LIST_UNAVAILABLE = "Your existing offers could not be loaded. Try again before sending another offer."
const val REQUEST_NO_LONGER_OPEN = "This request is no longer open for offers."

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
    val offeredPrice: String? = null,
    val pickupAddress: String,
    val dropoffAddress: String,
    val parcelDescription: String,
    val parcelSize: String,
    val distanceMeters: Int? = null,
    val currency: String? = null,
)

data class OwnBid(
    val bidId: String,
    val deliveryId: String,
    val amount: String,
    val currency: String,
    val status: String,
    val createdAt: String,
    val updatedAt: String? = null,
    val serviceClass: String?,
    val pickupAddress: String,
    val dropoffAddress: String,
    val deliverBy: String?,
    val parcelDescription: String = "",
    val suggestedPrice: String = "",
    val distanceMeters: Int? = null,
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

const val RECENT_BID_WINDOW_MS = 24L * 60L * 60L * 1000L

fun visibleBids(
    serverBids: List<OwnBid>,
    @Suppress("UNUSED_PARAMETER") pending: BidAttempt?,
    nowMillis: Long = System.currentTimeMillis(),
): List<OwnBid> = serverBids.filter { bid ->
    bid.status == "OPEN" || bid.status == "ACCEPTED" || bidIsRecent(bid, nowMillis)
}

fun bidIsRecent(bid: OwnBid, nowMillis: Long): Boolean {
    val stamp = bidTimeMillis(bid.updatedAt) ?: bidTimeMillis(bid.createdAt) ?: return true
    return nowMillis - stamp <= RECENT_BID_WINDOW_MS
}

private fun bidTimeMillis(value: String?): Long? {
    val raw = value?.trim().orEmpty()
    if (raw.isEmpty()) {
        return null
    }
    return runCatching { Instant.parse(raw).toEpochMilli() }.getOrNull()
}

fun newBidsUnavailable(@Suppress("UNUSED_PARAMETER") serviceClasses: List<String?>): Boolean = false

fun bidCanWithdraw(status: String): Boolean = status == "OPEN"

fun acceptedBidNeedsRiderConfirmation(): Boolean = false

fun bidStatusLabel(status: String): String = when (status) {
    "OPEN" -> "Open"
    "WITHDRAWN" -> "Withdrawn"
    "ACCEPTED" -> "Accepted"
    "SUPERSEDED" -> "Not selected"
    "EXPIRED" -> "Expired"
    else -> status
}

fun bidOutcome(
    status: String,
    serviceClass: String? = null,
    currency: String? = null,
    amount: String? = null,
): String? = when {
    status == "ACCEPTED" && serviceClass == "EXPRESS" -> "You've been selected!"
    status == "ACCEPTED" -> "Your bid was accepted."
    status == "SUPERSEDED" && serviceClass == "EXPRESS" -> "Not selected — another rider was chosen."
    status == "SUPERSEDED" -> "Another rider was chosen."
    status == "EXPIRED" -> "This offer has expired."
    status == "OPEN" && !amount.isNullOrBlank() -> offerSentConfirmation(currency ?: "USD", amount)
    status == "OPEN" -> AWAITING_CUSTOMER
    else -> null
}

fun resolvedSubmittedAmount(serverBids: List<OwnBid>, deliveryId: String, optimistic: String?): String? {
    return openBidFor(serverBids, deliveryId)?.amount ?: optimistic?.takeIf { it.isNotBlank() }
}

fun requestStillNeedsOffer(deliveryId: String, serverBids: List<OwnBid>, optimistic: Map<String, String> = emptyMap()): Boolean {
    return resolvedSubmittedAmount(serverBids, deliveryId, optimistic[deliveryId]) == null
}

fun optimisticAmountsAfterServerRefresh(optimistic: Map<String, String>, serverBids: List<OwnBid>): Map<String, String> {
    return optimistic.filterKeys { deliveryId -> openBidFor(serverBids, deliveryId) == null }
}

fun viewDetailsOpensActiveDeliveries(@Suppress("UNUSED_PARAMETER") status: String?): Boolean = false

fun opensAcceptedDelivery(@Suppress("UNUSED_PARAMETER") status: String): Boolean = false

fun offerServiceLabel(serviceClass: String?): String? = when (serviceClass) {
    "EXPRESS" -> "Urgent"
    "FLEXIBLE" -> "Flexible"
    else -> null
}

fun offerListStatus(status: String): String = when (status) {
    "ACCEPTED" -> "Accepted"
    "SUPERSEDED" -> "Not selected"
    "OPEN" -> "Waiting"
    "WITHDRAWN" -> "Withdrawn"
    "EXPIRED" -> "Expired"
    else -> bidStatusLabel(status)
}

fun homeAndMyOffersMatch(home: OwnBid?, listed: OwnBid?): Boolean {
    return home?.bidId == listed?.bidId && home?.amount == listed?.amount && home?.status == listed?.status
}

fun availableRequests(
    @Suppress("UNUSED_PARAMETER") offers: List<OfferResponse>,
    requests: List<OpenBidRequest>,
): List<OfferResponse> = requests.mapNotNull { bidRequestOffer(it) }

fun bidRequestOffer(request: OpenBidRequest): OfferResponse? {
    if (request.serviceClass != "EXPRESS" && request.serviceClass != "FLEXIBLE") {
        return null
    }
    val deadline = request.deliverBy?.takeIf { it.isNotBlank() }
    val customerOffer = request.offeredPrice?.trim().orEmpty()
    val price = customerOffer.ifEmpty { request.suggestedPrice?.trim().orEmpty() }.ifEmpty { "0.00" }
    val currency = request.currency?.trim().orEmpty().ifEmpty { "USD" }
    return OfferResponse(
        assignmentId = "request:${request.id}",
        deliveryId = request.id,
        expiresAt = deadline.orEmpty(),
        offeredPrice = price,
        currency = currency,
        payer = "",
        paymentMethod = "",
        parcel = ParcelResponse(description = request.parcelDescription, size = request.parcelSize),
        pickup = StopResponse(address = request.pickupAddress, contactName = "", contactPhone = ""),
        dropoff = StopResponse(address = request.dropoffAddress, contactName = "", contactPhone = ""),
        serviceClass = request.serviceClass,
        distanceMeters = request.distanceMeters ?: 0,
    )
}

fun marketplaceBidButtonsVisible(serviceClass: String?, ownBidsKnown: Boolean, failure: String?): Boolean {
    if (serviceClass != "EXPRESS" && serviceClass != "FLEXIBLE") {
        return true
    }
    if (!ownBidsKnown) {
        return false
    }
    return failure != MARKETPLACE_DISABLED
        && failure != BID_LIST_UNAVAILABLE
        && failure != "This delivery is not open for bids"
        && failure != "The bidding window has closed"
}

fun bidListProblemMessage(error: ApiError): String {
    return if (error is ApiError.Unexpected && error.message == MARKETPLACE_DISABLED) {
        MARKETPLACE_DISABLED
    } else {
        BID_LIST_UNAVAILABLE
    }
}

fun displayedBidProblem(hasMarketplaceRequest: Boolean, listProblem: String?, submitProblem: String?): String? {
    val submitted = when (submitProblem) {
        "This delivery is not open for bids", "The bidding window has closed" -> REQUEST_NO_LONGER_OPEN
        else -> submitProblem
    }
    if (!submitted.isNullOrBlank()) {
        return submitted
    }
    return if (hasMarketplaceRequest) listProblem else null
}

fun bidAmountLabel(currency: String, amount: String): String = "$currency $amount"

fun requestDistanceLabel(meters: Int?): String? {
    if (meters == null || meters < 0) {
        return null
    }
    if (meters < 1000) {
        return "Distance $meters m"
    }
    val whole = meters / 1000
    val tenth = (meters % 1000) / 100
    return "Distance $whole.$tenth km"
}

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
    ApiError.SessionEnded, ApiError.SignedInElsewhere, ApiError.Forbidden -> BidFailureKind.Authentication
    is ApiError.Unexpected -> if (error.message == MARKETPLACE_DISABLED) {
        BidFailureKind.MarketplaceDisabled
    } else {
        BidFailureKind.Request
    }
    else -> BidFailureKind.Request
}

fun keepsBidAttempt(error: ApiError): Boolean = error.leavesAcceptUnresolved()
