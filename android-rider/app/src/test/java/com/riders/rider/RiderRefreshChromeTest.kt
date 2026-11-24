package com.riders.rider

import com.riders.rider.core.refresh.clearListedRefresh
import com.riders.rider.core.refresh.goOnlineEnabled
import com.riders.rider.core.refresh.homePageLoading
import com.riders.rider.core.refresh.homePullIndicator
import com.riders.rider.core.refresh.listedRefresh
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderRefreshChromeTest {
    @Test
    fun homeInitialLoadUsesTheCenteredState() {
        assertTrue(homePageLoading(contentVisible = false))
        assertFalse(homePullIndicator(fromUser = false, contentVisible = false, errorVisible = false))
    }

    @Test
    fun homeAutomaticRefreshLeavesThePullIndicatorOff() {
        assertFalse(homePullIndicator(fromUser = false, contentVisible = true, errorVisible = false))
        assertFalse(homePullIndicator(fromUser = false, contentVisible = false, errorVisible = true))
    }

    @Test
    fun homeAutomaticRefreshDoesNotDisableGoOnline() {
        assertFalse(homePageLoading(contentVisible = true))
        assertTrue(goOnlineEnabled(pageLoading = false, changingAvailability = false))
    }

    @Test
    fun homeManualPullShowsTheIndicator() {
        assertTrue(homePullIndicator(fromUser = true, contentVisible = true, errorVisible = false))
        assertTrue(homePullIndicator(fromUser = true, contentVisible = false, errorVisible = true))
        assertFalse(homePageLoading(contentVisible = true))
    }

    @Test
    fun activeDeliveriesAutomaticRefreshStaysSilent() {
        val shown = listedRefresh(fromUser = false, blank = false)
        assertFalse(shown.refreshing)
        assertFalse(shown.loading)
        val firstOpen = listedRefresh(fromUser = false, blank = true)
        assertFalse(firstOpen.refreshing)
        assertTrue(firstOpen.loading)
    }

    @Test
    fun activeDeliveriesManualPullShowsTheIndicator() {
        val pull = listedRefresh(fromUser = true, blank = false)
        assertTrue(pull.refreshing)
        assertFalse(pull.loading)
    }

    @Test
    fun pendingPollingStaysSilent() {
        val poll = listedRefresh(fromUser = false, blank = false)
        assertFalse(poll.refreshing)
        assertFalse(poll.loading)
    }

    @Test
    fun pendingManualPullShowsTheIndicator() {
        val pull = listedRefresh(fromUser = true, blank = false)
        assertTrue(pull.refreshing)
        assertFalse(pull.loading)
    }

    @Test
    fun refreshIndicatorsClearAfterTheOwningRequestFinishes() {
        val cleared = clearListedRefresh(owner = 1, current = 1, loading = true, refreshing = true)
        assertFalse(cleared.loading)
        assertFalse(cleared.refreshing)
    }

    @Test
    fun anOlderRefreshDoesNotClearANewerOne() {
        val kept = clearListedRefresh(owner = 1, current = 2, loading = false, refreshing = true)
        assertFalse(kept.loading)
        assertTrue(kept.refreshing)
    }

    @Test
    fun availabilityActionStillDisablesGoOnline() {
        assertFalse(goOnlineEnabled(pageLoading = false, changingAvailability = true))
    }
}
