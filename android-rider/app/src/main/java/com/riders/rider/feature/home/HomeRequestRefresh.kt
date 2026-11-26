package com.riders.rider.feature.home

import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** Fetch both inputs together, but publish only after own bids have been refreshed. */
internal suspend fun <T> refreshHomeRequestSnapshot(
    loadRequests: suspend () -> T,
    refreshOwnBids: suspend () -> Unit,
): T = coroutineScope {
    val requests = async { loadRequests() }
    val ownBids = async { refreshOwnBids() }
    val result = requests.await()
    ownBids.await()
    result
}
