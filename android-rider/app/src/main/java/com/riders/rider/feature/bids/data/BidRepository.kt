package com.riders.rider.feature.bids.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.InFlightRead
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong
import com.riders.rider.core.network.mapHttpFailure
import com.riders.rider.feature.offers.domain.httpDateMillis
import com.riders.rider.feature.offers.domain.clockOffsetMillis
import com.riders.rider.core.network.BidSubmissionRequest
import com.riders.rider.core.network.OwnBidsResponse
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.bids.domain.OpenBidRequest
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.bidListProblemMessage
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.decodeEncodedPolyline
import com.riders.rider.feature.delivery.domain.decodeRouteLine
import com.riders.rider.feature.delivery.domain.parseGeoPoint
import android.os.SystemClock
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class OwnBidPage(
    val bids: List<OwnBid>,
    val nextCursor: String?,
)

@Singleton
class BidRepository @Inject constructor(
    private val riders: RiderService,
) {
    private val ownBidsState = MutableStateFlow(OwnBidPage(emptyList(), null))
    private val ownBidsLock = Mutex()
    private val ownRevision = AtomicLong()
    private val ownSession = AtomicLong()
    private val ownRead = InFlightRead<Triple<Long, String?, Boolean>, ApiResult<OwnBidPage>>(Long.MAX_VALUE)
    private var freshCoverage: OwnBidPage? = null
    private var coverageRevision = -1L
    fun invalidateOwnBids() {
        ownRevision.incrementAndGet()
        ownBidsKnownState.value = false
    }
    private val ownBidsKnownState = MutableStateFlow(false)
    private val bidListProblemState = MutableStateFlow<String?>(null)
    val ownBidPageFlow: StateFlow<OwnBidPage> = ownBidsState.asStateFlow()
    val ownBidsKnownFlow: StateFlow<Boolean> = ownBidsKnownState.asStateFlow()
    val bidListProblemFlow: StateFlow<String?> = bidListProblemState.asStateFlow()
    @Volatile var requestClockOffset: Long = 0L
        private set
    private val openRequestsLock = Mutex()
    private var openRequestsFlight: Deferred<ApiResult<List<OpenBidRequest>>>? = null
    @Volatile private var requestGeneration = 0L
    private var recentOpenRequests: Pair<Long, ApiResult.Ok<List<OpenBidRequest>>>? = null

    suspend fun requestRoad(deliveryId: String): List<GeoPoint> {
        return when (val result = apiCall { riders.requestRoad(deliveryId) }) {
            is ApiResult.Ok -> {
                val decoded = decodeEncodedPolyline(result.value.geometry)
                if (decoded.size > 1) {
                    decoded
                } else {
                    decodeRouteLine(result.value.line.mapNotNull { parseGeoPoint(it.latitude.toString(), it.longitude.toString()) })
                }
            }
            is ApiResult.Err -> emptyList()
        }
    }

    suspend fun openRequests(reuseRecent: Boolean = false): ApiResult<List<OpenBidRequest>> = coroutineScope {
        val flight = openRequestsLock.withLock {
            openRequestsFlight?.takeIf { it.isActive }?.let { return@withLock it }
            val recent = recentOpenRequests
            if (reuseRecent && recent != null && recentOpenRequestsReusable(recent.first, SystemClock.elapsedRealtime())) {
                return@coroutineScope recent.second
            }
            val generation = requestGeneration
            val created = async(start = CoroutineStart.LAZY) {
                val result = loadOpenRequests()
                openRequestsLock.withLock {
                    if (generation == requestGeneration && result is ApiResult.Ok) {
                        recentOpenRequests = SystemClock.elapsedRealtime() to result
                    }
                }
                if (generation == requestGeneration) result else ApiResult.Err(ApiError.SessionEnded)
            }
            openRequestsFlight = created
            created.start()
            created
        }
        try {
            flight.await()
        } finally {
            openRequestsLock.withLock {
                if (openRequestsFlight == flight && flight.isCompleted) openRequestsFlight = null
            }
        }
    }

    /** The shared pages and prefetch must not survive sign-out. */
    suspend fun clearSession() {
        openRequestsLock.withLock {
            requestGeneration += 1
            openRequestsFlight?.cancel()
            openRequestsFlight = null
            recentOpenRequests = null
            requestClockOffset = 0L
        }
        ownSession.incrementAndGet()
        invalidateOwnBids()
        ownBidsLock.withLock {
            freshCoverage = null
            ownBidsState.value = OwnBidPage(emptyList(), null)
            ownBidsKnownState.value = false
            bidListProblemState.value = null
        }
    }

    private suspend fun loadOpenRequests(): ApiResult<List<OpenBidRequest>> {
        return when (val result = apiCall { riders.bidRequests() }) {
            is ApiResult.Ok -> {
                val response = result.value
                if (!response.isSuccessful) {
                    return ApiResult.Err(mapHttpFailure(response.code(), response.errorBody()?.string()))
                }
                val body = response.body() ?: return ApiResult.Err(ApiError.Unexpected("The request could not be completed."))
                httpDateMillis(response.headers()["Date"])?.let { serverNow ->
                    requestClockOffset = clockOffsetMillis(serverNow, System.currentTimeMillis())
                }
                ApiResult.Ok(body.map { request ->
                    OpenBidRequest(
                        id = request.id,
                        serviceClass = request.serviceClass,
                        deliverBy = request.deliverBy,
                        searchStartedAt = request.searchStartedAt,
                        offerResponseExpiresAt = request.offerResponseExpiresAt,
                        suggestedPrice = request.suggestedPrice,
                        offeredPrice = request.offeredPrice,
                        pickupAddress = request.pickupAddress,
                        dropoffAddress = request.dropoffAddress,
                        pickupLatitude = request.pickupLatitude,
                        pickupLongitude = request.pickupLongitude,
                        dropoffLatitude = request.dropoffLatitude,
                        dropoffLongitude = request.dropoffLongitude,
                        parcelDescription = request.parcelDescription,
                        parcelSize = request.parcelSize,
                        distanceMeters = request.distanceMeters,
                        currency = request.currency,
                        paymentMethod = request.paymentMethod,
                    )
                })
            }
            is ApiResult.Err -> result
        }
    }

    suspend fun ownBids(cursor: String?): ApiResult<OwnBidPage> {
        return when (val result = apiCall { riders.ownBids(limit = 20, cursor = cursor) }) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.toPage())
            is ApiResult.Err -> result
        }
    }

    suspend fun refreshOwnBids(cursor: String?, scanAll: Boolean = false): ApiResult<OwnBidPage> {
        val revision = ownRevision.get()
        val session = ownSession.get()
        return ownRead.read(Triple(revision, cursor, scanAll)) {
            ownBidsLock.withLock {
                if (session != ownSession.get()) return@withLock ApiResult.Err(ApiError.SessionEnded)
                if (revision != ownRevision.get()) return@withLock ApiResult.Err(ApiError.Unexpected("Offers changed while refreshing. Try again."))
                val current = ownBidsState.value
                if (cursor != null && cursor != current.nextCursor) return@withLock ApiResult.Ok(current)
                var result = ownBids(cursor)
                if (cursor == null && result is ApiResult.Ok) {
                    var page = result.value
                    // Pending has no history pagination UI. On its initial/manual refresh,
                    // discover every OPEN offer, even behind pages of terminal offers.
                    // Normal shared refreshes only revisit known OPEN bids (and bridge any
                    // gap since the previously fetched head), not the full history.
                    val required = current.bids.filter { it.status == "OPEN" }.map { it.bidId }.toMutableSet()
                    current.bids.firstOrNull()?.let { required.add(it.bidId) }
                    val visited = mutableSetOf<String>()
                    while (page.nextCursor != null && (scanAll || required.any { id -> page.bids.none { it.bidId == id } })) {
                        val next = page.nextCursor ?: break
                        if (!visited.add(next)) {
                            result = ApiResult.Err(ApiError.Unexpected("Offer pagination did not advance."))
                            break
                        }
                        if (session != ownSession.get()) return@withLock ApiResult.Err(ApiError.SessionEnded)
                        if (revision != ownRevision.get()) return@withLock ApiResult.Err(ApiError.Unexpected("Offers changed while refreshing. Try again."))
                        when (val more = ownBids(next)) {
                            is ApiResult.Ok -> {
                                if (more.value.nextCursor?.let { it in visited } == true) {
                                    result = ApiResult.Err(ApiError.Unexpected("Offer pagination did not advance."))
                                    break
                                }
                                page = mergeOwnBidPage(page, more.value, next)
                            }
                            is ApiResult.Err -> { result = more; break }
                        }
                    }
                    if (result is ApiResult.Ok) result = ApiResult.Ok(page)
                }
                if (session != ownSession.get()) return@withLock ApiResult.Err(ApiError.SessionEnded)
                if (revision != ownRevision.get()) return@withLock ApiResult.Err(ApiError.Unexpected("Offers changed while refreshing. Try again."))
                when (result) {
                    is ApiResult.Ok -> {
                        if (cursor == null) { freshCoverage = result.value; coverageRevision = revision }
                        val page = mergeOwnBidPage(current, result.value, cursor)
                        ownBidsState.value = page
                        if (cursor == null) {
                            ownBidsKnownState.value = true
                            bidListProblemState.value = null
                        }
                        ApiResult.Ok(page)
                    }
                    is ApiResult.Err -> {
                        if (cursor == null) markOwnBidsUnknown(result.error)
                        result
                    }
                }
            }
        }
    }

    private fun markOwnBidsUnknown(error: ApiError) {
        freshCoverage = null
        ownBidsKnownState.value = false
        bidListProblemState.value = bidListProblemMessage(error)
    }

    /** Follow the chronological cursor only as far back as active search attempts require. */
    suspend fun ensureRequestBidCoverage(requests: List<OpenBidRequest>) = ownBidsLock.withLock {
        var page = freshCoverage ?: return@withLock
        val revision = ownRevision.get()
        if (coverageRevision != revision) return@withLock
        val session = ownSession.get()
        while (page.nextCursor != null && requestBidCoverageNeeded(requests, page.bids)) {
            val cursor = page.nextCursor ?: break
            when (val result = ownBids(cursor)) {
                is ApiResult.Ok -> {
                    if (revision != ownRevision.get() || session != ownSession.get()) return@withLock
                    if (result.value.nextCursor == cursor) {
                        markOwnBidsUnknown(ApiError.Unexpected("Offer pagination did not advance.")); return@withLock
                    }
                    page = mergeOwnBidPage(page, result.value, cursor)
                }
                is ApiResult.Err -> { markOwnBidsUnknown(result.error); return@withLock }
            }
        }
        if (revision == ownRevision.get() && session == ownSession.get()) {
            freshCoverage = page
            ownBidsState.value = mergeOwnBidPage(ownBidsState.value, page, null)
        }
    }

    suspend fun submit(deliveryId: String, amountCents: Int, idempotencyKey: String, currency: String): ApiResult<Unit> {
        return when (val result = apiCall {
            riders.submitBid(idempotencyKey, BidSubmissionRequest(deliveryId, amountCents, currency))
        }) {
            is ApiResult.Ok -> { invalidateOwnBids(); ApiResult.Ok(Unit) }
            is ApiResult.Err -> result
        }
    }

    suspend fun decline(deliveryId: String): ApiResult<Unit> {
        return when (val result = apiCall { riders.declineRequest(deliveryId) }) {
            is ApiResult.Ok -> ApiResult.Ok(Unit)
            is ApiResult.Err -> result
        }
    }

    suspend fun withdraw(bidId: String): ApiResult<Unit> {
        return when (val result = apiCall { riders.withdrawBid(bidId) }) {
            is ApiResult.Ok -> { invalidateOwnBids(); ApiResult.Ok(Unit) }
            is ApiResult.Err -> result
        }
    }
}

internal fun mergeOwnBidPage(current: OwnBidPage, incoming: OwnBidPage, cursor: String?): OwnBidPage {
    if (cursor == null) {
        val head = incoming.bids.distinctBy { it.bidId }
        if (incoming.nextCursor == null) return incoming.copy(bids = head)
        val ids = head.map { it.bidId }.toSet()
        // Only retain older rows beyond the freshly fetched boundary. New rows
        // can shift page boundaries; use the old cursor only if its tail survives.
        val boundary = head.lastOrNull()
        val tail = current.bids.filter { it.bidId !in ids && boundary != null &&
            (it.createdAt < boundary.createdAt || (it.createdAt == boundary.createdAt && it.bidId < boundary.bidId)) }
        return OwnBidPage(head + tail, if (tail.isEmpty()) incoming.nextCursor else current.nextCursor)
    }
    if (cursor != current.nextCursor) return current
    // A bid can straddle page boundaries. Keep the most recently fetched status.
    val merged = (current.bids + incoming.bids).associateBy { it.bidId }.values.toList()
    return incoming.copy(bids = merged)
}

internal fun requestBidCoverageNeeded(requests: List<OpenBidRequest>, bids: List<OwnBid>): Boolean {
    val unresolved = requests.filter { request -> com.riders.rider.feature.bids.domain.openBidForRequest(bids, request.id, request.searchStartedAt) == null }
    if (unresolved.isEmpty()) return false
    val oldest = bids.lastOrNull()?.createdAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return true
    // Older servers may omit searchStartedAt. In that case the existing API has
    // no safe lower bound, so continue until the cursor is exhausted.
    return unresolved.any { request ->
        val start = request.searchStartedAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
        start == null || !oldest.isBefore(start)
    }
}

private fun OwnBidsResponse.toPage(): OwnBidPage {
    return OwnBidPage(
        bids = bids.map { bid ->
            OwnBid(
                bidId = bid.bidId,
                deliveryId = bid.deliveryId,
                amount = bid.amount,
                currency = bid.currency,
                status = bid.status,
                createdAt = bid.createdAt,
                updatedAt = bid.updatedAt,
                serviceClass = bid.serviceClass,
                pickupAddress = bid.pickupAddress,
                dropoffAddress = bid.dropoffAddress,
                deliverBy = bid.deliverBy,
                parcelDescription = bid.parcelDescription,
                suggestedPrice = bid.suggestedPrice,
                distanceMeters = bid.distanceMeters,
            )
        },
        nextCursor = nextCursor,
    )
}

/** A list fetched for a notification can open the request without a second round trip. */
internal const val OPEN_REQUESTS_REUSE_MS = 4_000L

internal fun recentOpenRequestsReusable(fetchedAtElapsedMs: Long, nowElapsedMs: Long): Boolean {
    if (fetchedAtElapsedMs <= 0L) {
        return false
    }
    val age = nowElapsedMs - fetchedAtElapsedMs
    return age in 0..OPEN_REQUESTS_REUSE_MS
}
