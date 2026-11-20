package com.riders.rider

import com.riders.rider.feature.profile.presentation.profileNeedsScroll
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileScrollTest {
    @Test
    fun aFittingProfileDoesNotScrollOnCommonScreenHeights() {
        val screens = listOf(
            640 to 24,
            800 to 48,
            912 to 63,
            480 to 24,
        )
        screens.forEach { (height, status) ->
            assertFalse(profileNeedsScroll(height, status, topGap = 24, contentHeight = 200))
        }
    }

    @Test
    fun extraBottomPaddingMakesAFittingProfileScroll() {
        assertTrue(profileNeedsScroll(800, 48, topGap = 24, contentHeight = 200, bottomPadding = 32))
    }

    @Test
    fun aSmallScreenOrLargeContentScrolls() {
        assertTrue(profileNeedsScroll(480, 24, topGap = 24, contentHeight = 520))
        assertTrue(profileNeedsScroll(800, 48, topGap = 24, contentHeight = 900))
    }
}
