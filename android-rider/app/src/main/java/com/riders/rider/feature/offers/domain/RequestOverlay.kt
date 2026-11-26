package com.riders.rider.feature.offers.domain

import com.riders.rider.core.network.OfferResponse
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.launch

/** Which incoming request, if any, is shown on the home map. Dismissed ids stay closed for this visit. */
data class RequestOverlay(
    val openId: String? = null,
    val dismissed: Set<String> = emptySet(),
    val minimised: Set<String> = emptySet(),
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

    /** Collapse the map back to the home card without treating the request as closed. */
    fun minimise(): RequestOverlay {
        val id = openId?.trim().orEmpty()
        if (id.isEmpty()) {
            return this
        }
        return copy(openId = null, minimised = minimised + id)
    }
}

/** Keep the request that is already maximised, without choosing a different one. */
fun retainOpenRequest(overlay: RequestOverlay, offerIds: List<String>): RequestOverlay {
    val available = offerIds.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    val current = overlay.openId?.takeIf { it in available }
    return if (current == overlay.openId) overlay else overlay.copy(openId = current)
}

data class IncomingRequestGate(
    val primed: Boolean = false,
    val catchUp: Boolean = false,
    val knownIds: Set<String> = emptySet(),
    val pendingMaximiseId: String? = null,
    /** A request that should open maximised once Home is ready. Not emitted yet. */
    val heldMaximiseId: String? = null,
)

data class IncomingRequestStep(
    val gate: IncomingRequestGate,
    val maximiseId: String? = null,
)

/**
 * A transient startup/resume block must not consume a new request. Deliberate blocks (another
 * map, a dialog, or browsing) remember it without opening. Returning from another screen catches
 * up silently. The caller acknowledges the chosen id synchronously when it updates the overlay.
 */
fun stepIncomingRequest(
    gate: IncomingRequestGate,
    visibleIds: List<String>,
    listSettled: Boolean,
    canMaximise: Boolean,
    suppressedIds: Set<String>,
    deferMaximise: Boolean = !listSettled || !gate.primed,
): IncomingRequestStep {
    val visible = visibleIds.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    val suppressed = suppressedIds.map { it.trim() }.filter { it.isNotEmpty() }.toSet()
    val eligible = visible.filterNot { it in suppressed }
    val known = gate.knownIds + visible
    if (gate.catchUp) {
        return IncomingRequestStep(
            gate.copy(
                primed = gate.primed || listSettled,
                catchUp = !listSettled,
                knownIds = known,
                heldMaximiseId = null,
                pendingMaximiseId = null,
            ),
        )
    }
    val candidate = gate.heldMaximiseId?.takeIf { it in eligible }
        ?: eligible.firstOrNull { !gate.primed || it !in gate.knownIds }
    if (deferMaximise && (!listSettled || !canMaximise)) {
        // Do not mark the arriving ids known yet. If the held request expires before Home
        // becomes ready, another fresh, valid request can still be selected.
        return IncomingRequestStep(gate.copy(heldMaximiseId = candidate, pendingMaximiseId = null))
    }
    val pending = gate.pendingMaximiseId?.takeIf { it in eligible }
    val maximise = if (listSettled && canMaximise && pending == null) candidate else null
    return IncomingRequestStep(
        gate.copy(
            primed = true,
            knownIds = known,
            heldMaximiseId = null,
            pendingMaximiseId = if (canMaximise) maximise ?: pending else null,
        ),
        maximise,
    )
}

/** Refresh immediately on Home entry and push arrivals; polling is only the fallback. */
suspend fun watchHomeRequests(
    signals: ReceiveChannel<Unit>,
    awaitReady: suspend () -> Unit,
    refresh: suspend () -> Boolean,
    intervalMs: Long = OFFER_REFRESH_INTERVAL_MS,
) {
    while (currentCoroutineContext().isActive) {
        awaitReady()
        // A push already queued before this fetch is covered by the fetch itself.
        signals.tryReceive()
        // A refresh invalidated by a concurrent dashboard load is retried once it is ready.
        if (refresh()) {
            withTimeoutOrNull(intervalMs) { signals.receive() }
        }
    }
}

/** Ids that may open on the map. An expired countdown is not one of them. */
fun autoOpenRequestIds(offers: List<OfferResponse>, nowMillis: Long): List<String> {
    return offers.mapNotNull { offer ->
        val id = offer.deliveryId.trim()
        if (id.isEmpty() || requestCountdownExpired(offer.searchExpiresAt, offer.expiresAt, nowMillis)) {
            null
        } else {
            id
        }
    }.distinct()
}

enum class RequestMapSuccess {
    Accepted,
    OfferSent,
    Declined,
}

data class RequestMapEvent(
    val deliveryId: String,
    val success: RequestMapSuccess,
    val searchDeadline: String? = null,
)

data class RequestMapHandling(
    val overlay: RequestOverlay,
    val openDeliveries: Boolean,
    val showOfferSent: Boolean,
)

fun handleRequestMapSuccess(
    overlay: RequestOverlay,
    event: RequestMapEvent,
    currentSearchDeadline: String? = null,
): RequestMapHandling {
    val id = event.deliveryId.trim()
    // A delayed completion must not close a renewed search for the same delivery.
    if (event.success == RequestMapSuccess.Declined && !currentSearchDeadline.isNullOrBlank() &&
        !requestSettled(id, currentSearchDeadline, setOf(searchAttemptKey(id, event.searchDeadline)))) {
        return RequestMapHandling(overlay, openDeliveries = false, showOfferSent = false)
    }
    if (id.isEmpty() || id in overlay.dismissed || (overlay.openId != null && overlay.openId != id)) {
        return RequestMapHandling(overlay, openDeliveries = false, showOfferSent = false)
    }
    val closed = overlay.copy(openId = null, dismissed = overlay.dismissed + id)
    return when (event.success) {
        RequestMapSuccess.Accepted -> RequestMapHandling(closed, openDeliveries = true, showOfferSent = false)
        RequestMapSuccess.OfferSent -> RequestMapHandling(closed, openDeliveries = false, showOfferSent = true)
        RequestMapSuccess.Declined -> RequestMapHandling(closed, openDeliveries = false, showOfferSent = false)
    }
}

/** Home and the request map must not keep a request after it has been accepted, declined, or sent. */
fun withoutSettledRequests(offers: List<OfferResponse>, settled: Set<String>): List<OfferResponse> {
    if (offers.isEmpty() || settled.isEmpty()) {
        return offers
    }
    return offers.filterNot { requestSettled(it.deliveryId, it.searchExpiresAt, settled) }
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
): Boolean {
    return offlineConfirmation || browsingRequests
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
            val existing = byId[id]
            byId[id] = if (existing == null) offer else fresherRequest(existing, offer)
        }
    }
    return byId.values.toList()
}

/** A renewed search has a later deadline. An older expired attempt must not replace it. */
fun fresherRequest(current: OfferResponse, incoming: OfferResponse): OfferResponse {
    val currentAttempt = requestAttemptKey(current)
    val incomingAttempt = requestAttemptKey(incoming)
    val newer = incomingAttempt > currentAttempt
    val sameAttempt = incomingAttempt.isNotEmpty() && incomingAttempt == currentAttempt
    return if (newer || sameAttempt) incoming else current
}

private fun requestAttemptKey(offer: OfferResponse): String {
    return offer.searchExpiresAt?.trim().orEmpty().ifEmpty { offer.expiresAt.trim() }
}

data class NotificationOpenResult(
    val offer: OfferResponse?,
    val confirmed: Boolean,
)

/** A request already on screen can open before the network confirms it is still available. */
fun cachedNotificationOffer(
    tappedId: String,
    cached: List<OfferResponse>,
    settled: Set<String>,
    nowMillis: Long,
    match: (List<OfferResponse>, String) -> OfferResponse?,
): OfferResponse? {
    val found = match(cached, tappedId) ?: return null
    if (requestSettled(found.deliveryId, found.searchExpiresAt, settled)) {
        return null
    }
    if (!notificationRequestCanOpen(true, found.expiresAt, nowMillis) ||
        requestCountdownExpired(found.searchExpiresAt, found.expiresAt, nowMillis)) {
        return null
    }
    return found
}

/**
 * Confirms a tapped request from the open-request list.
 * Own bids refresh in parallel and do not delay the result.
 */
suspend fun openNotificationRequest(
    scope: CoroutineScope,
    tappedId: String,
    cached: List<OfferResponse>,
    settled: Set<String>,
    nowMillis: Long,
    loadRequests: suspend () -> List<OfferResponse>?,
    loadOwnBids: suspend () -> Unit,
    match: (List<OfferResponse>, String) -> OfferResponse?,
): NotificationOpenResult {
    scope.launch {
        try {
            loadOwnBids()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
        }
    }
    val loaded = loadRequests()
    if (loaded == null) {
        return NotificationOpenResult(
            offer = cachedNotificationOffer(tappedId, cached, settled, nowMillis, match),
            confirmed = false,
        )
    }
    val found = match(loaded, tappedId)
    val open = found != null &&
        !requestSettled(found.deliveryId, found.searchExpiresAt, settled) &&
        notificationRequestCanOpen(true, found.expiresAt, nowMillis) &&
        !requestCountdownExpired(found.searchExpiresAt, found.expiresAt, nowMillis)
    return NotificationOpenResult(offer = if (open) found else null, confirmed = true)
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
    val fromPrimary = primary.firstOrNull { it.deliveryId == id }
    val fromFallback = fallback.firstOrNull { it.deliveryId == id }
    return when {
        fromPrimary == null -> fromFallback
        fromFallback == null -> fromPrimary
        else -> fresherRequest(fromFallback, fromPrimary)
    }
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
    if (id.isEmpty() || settled.isEmpty()) {
        return false
    }
    if (searchAttemptKey(id, searchDeadline) in settled) {
        return true
    }
    if (searchDeadline.isNullOrBlank()) return id in settled
    // A slower refresh may still contain an older search for this delivery. It is
    // not actionable after a later attempt has been settled, but a renewal is.
    val deadline = runCatching { Instant.parse(searchDeadline.trim()) }.getOrNull() ?: return false
    val prefix = "$id|"
    return settled.any { key ->
        key.startsWith(prefix) && runCatching {
            !Instant.parse(key.removePrefix(prefix)).isBefore(deadline)
        }.getOrDefault(false)
    }
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

/** Closes the open request only when it is still the attempt that expired. */
fun closeExpiredRequest(
    overlay: RequestOverlay,
    openAttempt: String?,
    retiredAttempt: String,
): RequestOverlay {
    val retiredId = retiredAttempt.substringBefore('|').trim()
    if (retiredId.isEmpty()) {
        return overlay
    }
    val openId = overlay.openId?.trim().orEmpty()
    if (openId == retiredId && openAttempt != null && openAttempt != retiredAttempt) {
        return overlay
    }
    val dismissed = overlay.dismissed + retiredId
    val open = if (openId == retiredId) null else overlay.openId
    if (open == overlay.openId && dismissed == overlay.dismissed) {
        return overlay
    }
    return overlay.copy(openId = open, dismissed = dismissed)
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
