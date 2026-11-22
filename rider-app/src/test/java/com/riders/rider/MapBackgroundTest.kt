package com.riders.rider

import com.riders.rider.feature.delivery.domain.neighborhoodZoom
import kotlin.math.pow
import org.junit.Assert.assertTrue
import org.junit.Test

class MapBackgroundTest {
    @Test
    fun neighborhoodZoomShowsAboutThreeKilometres() {
        listOf(480, 1080, 1440).forEach { pixels ->
            val zoom = neighborhoodZoom(pixels)
            val degrees = 360.0 * pixels / (256.0 * 2.0.pow(zoom.toDouble()))
            val kilometres = degrees * 111.32
            assertTrue(kilometres in 2.7..3.2)
        }
    }
}
