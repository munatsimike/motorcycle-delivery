package com.riders.rider

import com.riders.rider.core.network.InFlightRead
import com.riders.rider.feature.bids.domain.shouldRefreshOwnBids
import com.riders.rider.feature.delivery.data.AssignmentListStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderPerformanceTest {
    @Test fun idleBidPollingSkipsOnlyFreshIdleState() {
        assertFalse(shouldRefreshOwnBids(true, false, 1_000, 21_000, false))
        assertTrue(shouldRefreshOwnBids(true, false, 1_000, 61_000, false))
        assertTrue(shouldRefreshOwnBids(false, false, 1_000, 21_000, false))
        assertTrue(shouldRefreshOwnBids(true, true, 1_000, 21_000, false))
        assertTrue(shouldRefreshOwnBids(true, false, 1_000, 21_000, true))
        assertTrue(shouldRefreshOwnBids(true, false, null, 21_000, false))
        assertTrue(shouldRefreshOwnBids(true, false, 21_000, 1_000, false))
    }

    @Test fun concurrentReadsShareButCompletedReadsAreNotCached() = runBlocking {
        val reads = InFlightRead<String, Int>()
        val release = CompletableDeferred<Unit>()
        val started = CompletableDeferred<Unit>()
        var calls = 0
        val first = async { reads.read("rider-a") { calls++; started.complete(Unit); release.await(); 7 } }
        started.await()
        val second = async { reads.read("rider-a") { calls++; 9 } }
        yield()
        release.complete(Unit)
        assertEquals(7, first.await())
        assertEquals(7, second.await())
        assertEquals(1, calls)
        assertEquals(9, reads.read("rider-a") { calls++; 9 })
        assertEquals(2, calls)
    }

    @Test fun differentSessionsNeverShareReads() = runBlocking {
        val reads = InFlightRead<String, Int>()
        val release = CompletableDeferred<Unit>()
        val started = CompletableDeferred<Unit>()
        val first = async { reads.read("rider-a") { started.complete(Unit); release.await(); 1 } }
        started.await()
        assertEquals(2, reads.read("rider-b") { 2 })
        release.complete(Unit)
        assertEquals(1, first.await())
    }

    @Test fun cancellationOfOwnerDoesNotStrandWaiter() = runBlocking {
        val reads = InFlightRead<String, Int>()
        val release = CompletableDeferred<Unit>()
        val started = CompletableDeferred<Unit>()
        val first = async { reads.read("rider-a") { started.complete(Unit); release.await(); 1 } }
        started.await()
        val second = async { reads.read("rider-a") { 2 } }
        yield()
        first.cancelAndJoin()
        assertEquals(2, second.await())
    }

    @Test fun assignmentSnapshotMustBeSuccessfulAndCurrent() {
        val store = AssignmentListStore()
        val first = store.begin()
        assertFalse(store.isCurrentRefresh(first))
        store.confirm(first, emptyList())
        assertTrue(store.isCurrentRefresh(first))
        val second = store.begin()
        assertFalse(store.isCurrentRefresh(first))
        assertFalse(store.isCurrentRefresh(second))
        store.confirm(first, emptyList())
        assertFalse(store.isCurrentRefresh(second))
        store.confirm(second, emptyList())
        assertTrue(store.isCurrentRefresh(second))
        store.confirmStatus("delivery", "COLLECTED")
        assertFalse(store.isCurrentRefresh(second))
        val third = store.begin()
        store.confirm(third, emptyList())
        store.clearSession()
        assertFalse(store.isCurrentRefresh(third))
    }
}
