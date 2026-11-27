package com.riders.rider

import com.riders.rider.feature.bids.domain.BID_LIST_UNAVAILABLE
import com.riders.rider.feature.bids.domain.MARKETPLACE_DISABLED
import com.riders.rider.feature.bids.domain.marketplaceBidButtonsVisible
import com.riders.rider.feature.offers.domain.requestActionControlsVisible
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestActionControlsTest {
    @Test
    fun openMapKeepsControlsDuringBidInvalidationAndRecovery() {
        for (service in listOf("FLEXIBLE", "EXPRESS")) {
            for (known in listOf(true, false, true)) {
                val canAct = marketplaceBidButtonsVisible(service, known, null)
                assertTrue(requestActionControlsVisible(false, canAct, service, onMap = true))
                // The live bid gate remains false while the cache is invalidated.
                if (known) assertTrue(canAct) else assertFalse(canAct)
            }
        }
    }

    @Test
    fun unavailableBiddingDoesNotEnableTheVisibleMapControls() {
        for (failure in listOf(BID_LIST_UNAVAILABLE, MARKETPLACE_DISABLED, "The bidding window has closed")) {
            val canAct = marketplaceBidButtonsVisible("FLEXIBLE", true, failure)
            assertFalse(canAct)
            assertTrue(requestActionControlsVisible(false, canAct, "FLEXIBLE", onMap = true))
        }
    }

    @Test
    fun settledRequestsAndNonMapCardsKeepExistingVisibilityRules() {
        assertFalse(requestActionControlsVisible(true, true, "FLEXIBLE", onMap = true))
        assertFalse(requestActionControlsVisible(true, false, "EXPRESS", onMap = true))
        assertFalse(requestActionControlsVisible(false, false, "FLEXIBLE", onMap = false))
        assertTrue(requestActionControlsVisible(false, true, "FLEXIBLE", onMap = false))
        assertTrue(requestActionControlsVisible(false, false, null, onMap = false))
    }
}
