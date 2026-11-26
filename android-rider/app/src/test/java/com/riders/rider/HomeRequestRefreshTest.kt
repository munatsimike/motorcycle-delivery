package com.riders.rider

import com.riders.rider.feature.home.refreshHomeRequestSnapshot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HomeRequestRefreshTest {
    @Test
    fun startsBothRequestsWithoutWaitingForEitherAndWaitsForOwnBidsBeforePublishing() = runTest {
        val requests = CompletableDeferred<List<String>>()
        val ownBids = CompletableDeferred<Unit>()
        var requestsStarted = false
        var ownBidsStarted = false
        val result = async {
            refreshHomeRequestSnapshot(
                loadRequests = { requestsStarted = true; requests.await() },
                refreshOwnBids = { ownBidsStarted = true; ownBids.await() },
            )
        }
        runCurrent()
        assertTrue(requestsStarted)
        assertTrue(ownBidsStarted)
        requests.complete(listOf("new-delivery"))
        runCurrent()
        assertFalse(result.isCompleted)
        ownBids.complete(Unit)
        assertEquals(listOf("new-delivery"), result.await())
    }

    @Test
    fun waitsForTheRequestListWhenOwnBidsFinishFirst() = runTest {
        val requests = CompletableDeferred<List<String>>()
        val ownBids = CompletableDeferred<Unit>()
        val result = async {
            refreshHomeRequestSnapshot(
                loadRequests = { requests.await() },
                refreshOwnBids = { ownBids.await() },
            )
        }
        runCurrent()
        ownBids.complete(Unit)
        runCurrent()
        assertFalse(result.isCompleted)
        requests.complete(listOf("new-delivery"))
        assertEquals(listOf("new-delivery"), result.await())
    }
}
