package com.riders.rider.feature.offers.domain

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
