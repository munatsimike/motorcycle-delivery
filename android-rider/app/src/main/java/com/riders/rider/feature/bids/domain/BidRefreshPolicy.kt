package com.riders.rider.feature.bids.domain

internal const val IDLE_BID_REFRESH_MS = 60_000L

internal fun shouldRefreshOwnBids(known: Boolean, hasOpenBid: Boolean, lastSuccess: Long?, now: Long, forced: Boolean): Boolean =
    forced || !known || hasOpenBid || lastSuccess == null || now - lastSuccess !in 0L until IDLE_BID_REFRESH_MS
