package com.riders.rider

import com.riders.rider.feature.offers.domain.RequestOverlay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RequestOverlayTest {
    @Test
    fun opensTheFirstEligibleRequestAndKeepsItWhenAnotherArrives() {
        val first = RequestOverlay().sync(listOf("a"), blocked = false)
        assertEquals("a", first.openId)
        val kept = first.sync(listOf("a", "b"), blocked = false)
        assertEquals("a", kept.openId)
    }

    @Test
    fun dismissKeepsTheRequestClosedUntilItIsOpenedAgain() {
        val open = RequestOverlay().sync(listOf("a", "b"), blocked = false)
        val dismissed = open.dismiss()
        assertNull(dismissed.openId)
        assertEquals("b", dismissed.sync(listOf("a", "b"), blocked = false).openId)
        val again = dismissed.sync(listOf("a"), blocked = false)
        assertNull(again.openId)
        assertEquals("a", again.open("a").openId)
    }

    @Test
    fun closesARequestThatLeavesAndDoesNotOpenWhileBlocked() {
        val open = RequestOverlay(openId = "a")
        assertNull(open.sync(emptyList(), blocked = false).openId)
        val waiting = RequestOverlay().sync(listOf("a"), blocked = true)
        assertNull(waiting.openId)
        assertEquals("a", RequestOverlay(openId = "a").sync(listOf("a"), blocked = true).openId)
    }
}
