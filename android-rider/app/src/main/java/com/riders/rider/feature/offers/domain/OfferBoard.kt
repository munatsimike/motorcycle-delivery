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

fun marketplaceOffersError(openRequestsLoaded: Boolean, legacyOffersError: String?): String? {
    return if (openRequestsLoaded) null else legacyOffersError
}

fun offerPriceLabel(currency: String, offeredPrice: String): String {
    return requestAmountLabel(currency, offeredPrice)
}

fun requestPaymentBadge(paymentMethod: String?): String? {
    return when (paymentMethod?.trim()?.uppercase()) {
        "CASH" -> "Cash"
        "ECOCASH" -> "EcoCash"
        else -> null
    }
}

fun requestCurrencyLabel(currency: String): String {
    return when (currency.trim().uppercase()) {
        "ZWG" -> "ZiG"
        "USD" -> "USD"
        else -> currency.trim().uppercase()
    }
}

fun displayMoneyAmount(amount: String): String {
    val match = Regex("""^(\d+)\.(\d{2})$""").matchEntire(amount.trim()) ?: return amount.trim()
    val whole = match.groupValues[1].trimStart('0').ifEmpty { "0" }
    return when (match.groupValues[2]) {
        "00" -> whole
        "50" -> "$whole.50"
        else -> "$whole.${match.groupValues[2]}"
    }
}

fun requestAmountLabel(currency: String, amount: String): String {
    val trimmed = amount.trim().removePrefix("+")
    val negative = trimmed.startsWith("-")
    val digits = if (negative) trimmed.removePrefix("-") else trimmed
    val label = "${requestCurrencyLabel(currency)} ${displayMoneyAmount(digits)}"
    return if (negative) "−$label" else label
}

fun acceptOfferLabel(): String {
    return "Accept"
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

enum class CustomOfferPhase {
    Idle,
    Waiting,
    InFlight,
}

data class CustomOfferDialogState(
    val open: Boolean = false,
    val amount: String = "",
    val error: String? = null,
    val phase: CustomOfferPhase = CustomOfferPhase.Idle,
    val awaitingError: String? = null,
)

fun openCustomOfferDialog(listedPrice: String): CustomOfferDialogState {
    return CustomOfferDialogState(open = true, amount = listedPrice)
}

fun editCustomOfferAmount(dialog: CustomOfferDialogState, amount: String): CustomOfferDialogState {
    return dialog.copy(amount = amount, error = null)
}

fun beginCustomOfferSubmit(dialog: CustomOfferDialogState, currentError: String?): CustomOfferDialogState? {
    if (!dialog.open || dialog.phase != CustomOfferPhase.Idle) {
        return null
    }
    return dialog.copy(phase = CustomOfferPhase.Waiting, error = null, awaitingError = currentError)
}

fun observeCustomOfferSubmit(
    dialog: CustomOfferDialogState,
    submitting: Boolean,
    submissionError: String?,
): CustomOfferDialogState {
    return when (dialog.phase) {
        CustomOfferPhase.Idle -> dialog
        CustomOfferPhase.Waiting -> when {
            submitting -> dialog.copy(phase = CustomOfferPhase.InFlight)
            submissionError != dialog.awaitingError && !submissionError.isNullOrBlank() ->
                dialog.copy(phase = CustomOfferPhase.Idle, error = submissionError)
            else -> dialog
        }
        CustomOfferPhase.InFlight -> if (submitting) {
            dialog
        } else if (submissionError.isNullOrBlank()) {
            dialog.copy(open = false, phase = CustomOfferPhase.Idle, error = null)
        } else {
            dialog.copy(phase = CustomOfferPhase.Idle, error = submissionError)
        }
    }
}

fun dismissCustomOfferDialog(dialog: CustomOfferDialogState): CustomOfferDialogState {
    if (dialog.phase == CustomOfferPhase.InFlight) {
        return dialog
    }
    return dialog.copy(open = false, phase = CustomOfferPhase.Idle, error = null)
}

fun customOfferButtonLabel(sending: Boolean): String {
    return if (sending) "Sending..." else "Send offer"
}

const val OFFER_YOUR_PRICE = "Your offer"
const val DECLINE_REQUEST = "Decline"
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

fun shouldPollMarketplace(appVisible: Boolean, availability: String?, receiving: Boolean?): Boolean {
    if (!appVisible) {
        return false
    }
    if (receiving == true) {
        return true
    }
    return availability == "AVAILABLE" || availability == "BUSY"
}

fun shouldLoadHomeDocuments(approvalStatus: String?, approvedDocumentsConfirmed: Boolean): Boolean {
    if (approvalStatus == "APPROVED" && approvedDocumentsConfirmed) {
        return false
    }
    return true
}

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

/** Rider-only display. The real action cutoff remains expiresAt. */
fun riderExpiryDisplay(searchExpiresAt: String?, expiresAt: String, nowMillis: Long): String {
    val finalDeadline = parseExpiry(expiresAt) ?: return "Expired"
    val searchDeadline = searchExpiresAt?.let(::parseExpiry) ?: finalDeadline
    // When customer decision ends before search, show the true earlier cutoff.
    if (finalDeadline <= searchDeadline) {
        return if (nowMillis >= finalDeadline) "Expired"
        else "Expires in ${offerExpiryLabel(expiresAt, nowMillis)}"
    }
    if (nowMillis < searchDeadline) {
        return "Expires in ${offerExpiryLabel(searchDeadline.toInstantString(), nowMillis)}"
    }
    // Decide whether the extension is meaningful at the original handoff.
    if (finalDeadline - searchDeadline <= 7_000L || nowMillis >= finalDeadline) return "Expired"
    return "Extra time ${offerExpiryLabel(expiresAt, nowMillis)}"
}

private fun Long.toInstantString(): String = Instant.ofEpochMilli(this).toString()

private fun parseExpiry(expiresAt: String): Long? {
    return try {
        Instant.parse(expiresAt).toEpochMilli()
    } catch (_: Exception) {
        null
    }
}
