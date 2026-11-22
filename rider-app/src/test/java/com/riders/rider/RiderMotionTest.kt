package com.riders.rider

import com.riders.rider.core.design.RiderTransition
import com.riders.rider.core.design.RidersMotion
import com.riders.rider.core.design.acceptPressEnabled
import com.riders.rider.core.design.acceptanceConfirmationVisible
import com.riders.rider.core.design.acceptanceNavigationDelay
import com.riders.rider.core.design.animatesEntireOfferCard
import com.riders.rider.core.design.bidConfirmationVisible
import com.riders.rider.core.design.motionEnabled
import com.riders.rider.core.design.offerPressScale
import com.riders.rider.core.design.riderTransitionMillis
import com.riders.rider.navigation.routeOpensDelivery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderMotionTest {
    @Test
    fun navigationDurationsStayShortAndReverseUsesTheSameTiming() {
        assertTrue(riderTransitionMillis(RiderTransition.DeliveryForward) in 380..460)
        assertEquals(
            riderTransitionMillis(RiderTransition.DeliveryForward),
            riderTransitionMillis(RiderTransition.DeliveryBack),
        )
        assertTrue(riderTransitionMillis(RiderTransition.BidRise) in 220..280)
        assertEquals(
            riderTransitionMillis(RiderTransition.DeliveryForward),
            riderTransitionMillis(RiderTransition.TabFade),
        )
        assertEquals(RidersMotion.DELIVERY_MS, riderTransitionMillis(RiderTransition.DeliveryForward))
        assertEquals(RidersMotion.BID_MS, riderTransitionMillis(RiderTransition.BidRise))
        assertEquals(RidersMotion.TAB_MS, riderTransitionMillis(RiderTransition.TabFade))
    }

    @Test
    fun reducedMotionAndZeroAnimationScaleRemoveTransitions() {
        assertFalse(motionEnabled(animatorScale = 0f, transitionScale = 1f))
        assertFalse(motionEnabled(animatorScale = 1f, transitionScale = 0f))
        assertEquals(0, riderTransitionMillis(RiderTransition.DeliveryForward, animatorScale = 0f))
        assertEquals(0, riderTransitionMillis(RiderTransition.BidRise, transitionScale = 0f))
        assertEquals(0, riderTransitionMillis(RiderTransition.TabFade, animatorScale = 0f, transitionScale = 0f))
        assertTrue(motionEnabled(animatorScale = 1f, transitionScale = 1f))
        assertTrue(motionEnabled(animatorScale = 0.5f, transitionScale = 1f))
    }

    @Test
    fun stackScreensSlideWhenTheyOpenAndClose() {
        assertTrue(routeOpensDelivery("delivery/delivery-1"))
        assertEquals(RidersMotion.DELIVERY_MS, riderTransitionMillis(RiderTransition.DeliveryForward))
        assertEquals(RidersMotion.DELIVERY_MS, riderTransitionMillis(RiderTransition.DeliveryBack))
    }

    @Test
    fun offerPressIsSubtleAndTheCountdownDoesNotMoveTheCard() {
        assertEquals(1f, offerPressScale(pressed = false, enabled = true))
        assertEquals(1f, offerPressScale(pressed = true, enabled = false))
        val pressed = offerPressScale(pressed = true, enabled = true)
        assertTrue(pressed < 1f)
        assertTrue(pressed >= 0.97f)
        assertFalse(animatesEntireOfferCard())
    }

    @Test
    fun successConfirmationWaitsForTheBackendAndBlocksASecondAccept() {
        assertFalse(acceptanceConfirmationVisible(backendConfirmed = false))
        assertTrue(acceptanceConfirmationVisible(backendConfirmed = true))
        assertFalse(bidConfirmationVisible(backendConfirmed = false))
        assertTrue(bidConfirmationVisible(backendConfirmed = true))
        assertTrue(acceptPressEnabled(canAccept = true, confirmed = false))
        assertFalse(acceptPressEnabled(canAccept = true, confirmed = true))
        assertFalse(acceptPressEnabled(canAccept = false, confirmed = false))
        assertEquals(0, acceptanceNavigationDelay(confirmed = false, enabled = true))
        assertEquals(RidersMotion.CONFIRM_MS, acceptanceNavigationDelay(confirmed = true, enabled = true))
        assertEquals(0, acceptanceNavigationDelay(confirmed = true, enabled = false))
    }
}
