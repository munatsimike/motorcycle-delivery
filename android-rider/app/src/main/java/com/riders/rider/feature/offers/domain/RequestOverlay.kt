package com.riders.rider.feature.offers.domain

import com.riders.rider.core.network.OfferResponse

/** Which incoming request, if any, is shown on the home map. Dismissed ids stay closed for this visit. */
data class RequestOverlay(
    val openId: String? = null,
    val dismissed: Set<String> = emptySet(),
) {
    fun sync(offerIds: List<String>, blocked: Boolean): RequestOverlay {
        val available = offerIds.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        val current = openId?.takeIf { it in available }
        if (current != null) {
            return if (current == openId) this else copy(openId = current)
        }
        if (blocked) {
            return if (openId == null) this else copy(openId = null)
        }
        val next = available.firstOrNull { it !in dismissed }
        return if (next == openId) this else copy(openId = next)
    }

    fun open(deliveryId: String): RequestOverlay {
        val id = deliveryId.trim()
        if (id.isEmpty()) {
            return this
        }
        return copy(openId = id)
    }

    fun dismiss(): RequestOverlay {
        val id = openId ?: return this
        return copy(openId = null, dismissed = dismissed + id)
    }
}

enum class RequestMapSuccess {
    Accepted,
    OfferSent,
    Declined,
}

data class RequestMapEvent(
    val deliveryId: String,
    val success: RequestMapSuccess,
)

data class RequestMapHandling(
    val overlay: RequestOverlay,
    val openDeliveries: Boolean,
    val showOfferSent: Boolean,
)

fun handleRequestMapSuccess(overlay: RequestOverlay, event: RequestMapEvent): RequestMapHandling {
    if (overlay.openId != event.deliveryId) {
        return RequestMapHandling(overlay, openDeliveries = false, showOfferSent = false)
    }
    val closed = overlay.dismiss()
    return when (event.success) {
        RequestMapSuccess.Accepted -> RequestMapHandling(closed, openDeliveries = true, showOfferSent = false)
        RequestMapSuccess.OfferSent -> RequestMapHandling(closed, openDeliveries = false, showOfferSent = true)
        RequestMapSuccess.Declined -> RequestMapHandling(closed, openDeliveries = false, showOfferSent = false)
    }
}

const val OFFER_SENT_TOAST_TITLE = "Offer sent"
const val OFFER_SENT_TOAST_DETAIL = "Waiting for the customer to respond."
const val OFFER_SENT_TOAST_DISMISS_MS = 6_000L

data class OfferSentToast(
    val id: String,
    val title: String,
    val detail: String,
    val dismissMs: Long,
)

/** Shown only after a listed or custom offer submission succeeds. */
fun offerSentToast(deliveryId: String, searchDeadline: String?): OfferSentToast? {
    val id = deliveryId.trim()
    if (id.isEmpty()) {
        return null
    }
    return OfferSentToast(
        id = "offer-sent:${searchAttemptKey(id, searchDeadline)}",
        title = OFFER_SENT_TOAST_TITLE,
        detail = OFFER_SENT_TOAST_DETAIL,
        dismissMs = OFFER_SENT_TOAST_DISMISS_MS,
    )
}

fun requestMapAutoOpenBlocked(
    offlineConfirmation: Boolean,
    browsingRequests: Boolean = false,
    offerSentHold: Boolean = false,
): Boolean {
    return offlineConfirmation || browsingRequests || offerSentHold
}

fun requestCatalog(primary: List<OfferResponse>, fallback: List<OfferResponse>): List<OfferResponse> {
    val byId = linkedMapOf<String, OfferResponse>()
    fallback.forEach { offer ->
        val id = offer.deliveryId.trim()
        if (id.isNotEmpty()) {
            byId[id] = offer
        }
    }
    primary.forEach { offer ->
        val id = offer.deliveryId.trim()
        if (id.isNotEmpty()) {
            byId[id] = offer
        }
    }
    return byId.values.toList()
}

fun requestForMap(
    primary: List<OfferResponse>,
    fallback: List<OfferResponse>,
    deliveryId: String?,
): OfferResponse? {
    val id = deliveryId?.trim().orEmpty()
    if (id.isEmpty()) {
        return null
    }
    return primary.firstOrNull { it.deliveryId == id } ?: fallback.firstOrNull { it.deliveryId == id }
}

enum class RequestBackTarget {
    Dashboard,
    Requests,
}

fun requestBackTarget(mapOpen: Boolean, listOpen: Boolean): RequestBackTarget {
    return if (mapOpen && listOpen) RequestBackTarget.Requests else RequestBackTarget.Dashboard
}

fun requestMapNotice(bidError: String?, acceptError: String?): String? {
    return bidError?.takeIf { it.isNotBlank() } ?: acceptError?.takeIf { it.isNotBlank() }
}

fun searchAttemptKey(deliveryId: String, searchDeadline: String?): String {
    val id = deliveryId.trim()
    val deadline = searchDeadline?.trim().orEmpty()
    return if (deadline.isEmpty()) id else "$id|$deadline"
}

fun requestSettled(deliveryId: String, searchDeadline: String?, settled: Set<String>): Boolean {
    val id = deliveryId.trim()
    if (id.isEmpty()) {
        return false
    }
    if (searchAttemptKey(id, searchDeadline) in settled) {
        return true
    }
    return searchDeadline.isNullOrBlank() && id in settled
}

fun requestActionAllowed(
    deliveryId: String,
    settled: Set<String>,
    accepting: Boolean,
    submitting: Boolean,
    declining: Boolean,
    searchDeadline: String? = null,
): Boolean {
    return !requestSettled(deliveryId, searchDeadline, settled) && !accepting && !submitting && !declining
}

fun dismissedForSettledAttempts(
    offers: List<Pair<String, String?>>,
    settled: Set<String>,
): Set<String> {
    return offers.mapNotNull { (deliveryId, deadline) ->
        val id = deliveryId.trim()
        if (id.isNotEmpty() && requestSettled(id, deadline, settled)) id else null
    }.toSet()
}

fun sealDismissedAttempt(
    sealed: Map<String, String>,
    deliveryId: String,
    searchDeadline: String?,
): Map<String, String> {
    val id = deliveryId.trim()
    if (id.isEmpty()) {
        return sealed
    }
    return sealed + (id to searchDeadline?.trim().orEmpty())
}

fun overlayAfterSearchAttempt(
    overlay: RequestOverlay,
    sealedAttempts: Map<String, String>,
    offers: List<Pair<String, String?>>,
): Pair<RequestOverlay, Map<String, String>> {
    val current = offers.associate { (deliveryId, deadline) ->
        deliveryId.trim() to deadline?.trim().orEmpty()
    }
    val released = sealedAttempts.keys.filter { id ->
        val now = current[id] ?: return@filter false
        val sealed = sealedAttempts[id].orEmpty()
        id in overlay.dismissed && now.isNotEmpty() && now != sealed
    }.toSet()
    if (released.isEmpty()) {
        return overlay to sealedAttempts
    }
    return overlay.copy(dismissed = overlay.dismissed - released) to (sealedAttempts - released)
}
