package com.riders.rider

import com.riders.rider.feature.delivery.domain.MarkerCameraGate
import com.riders.rider.feature.delivery.domain.markerStaysAttached
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkerCameraTest {
    @Test
    fun markersWaitUntilTheInitialFitAndHeadingFinish() {
        val gate = MarkerCameraGate()
        assertFalse(gate.phase().acceptingNew)
        val fitting = gate.begin()
        val heading = gate.begin()
        assertFalse(fitting.acceptingNew)
        assertFalse(heading.acceptingNew)
        assertFalse(markerStaysAttached(attached = false, acceptingNew = false, ready = true))
        assertFalse(gate.end().acceptingNew)
        val idle = gate.end()
        assertTrue(idle.acceptingNew)
        assertTrue(markerStaysAttached(attached = false, acceptingNew = true, ready = true))
    }

    @Test
    fun noCameraAnimationStillReleasesMarkers() {
        val gate = MarkerCameraGate()
        assertTrue(gate.settleWithoutAnimation().acceptingNew)
        assertTrue(markerStaysAttached(attached = false, acceptingNew = true, ready = true))
    }

    @Test
    fun aSheetRefitKeepsMarkersThatAreAlreadyDrawn() {
        val gate = MarkerCameraGate()
        gate.begin()
        val opened = gate.end()
        assertTrue(opened.acceptingNew)
        val attached = markerStaysAttached(attached = false, acceptingNew = true, ready = true)
        val duringRefit = gate.begin()
        assertFalse(duringRefit.acceptingNew)
        assertTrue(markerStaysAttached(attached, duringRefit.acceptingNew, ready = true))
        val settled = gate.end()
        assertTrue(settled.acceptingNew)
        assertTrue(markerStaysAttached(attached, settled.acceptingNew, ready = true))
    }

    @Test
    fun aFixThatArrivesDuringTheAnimationWaitsForIdle() {
        val gate = MarkerCameraGate()
        gate.begin()
        gate.end()
        val pickup = markerStaysAttached(attached = false, acceptingNew = true, ready = true)
        val animating = gate.begin()
        val motorcycleDuring = markerStaysAttached(attached = false, acceptingNew = animating.acceptingNew, ready = true)
        assertTrue(pickup)
        assertFalse(motorcycleDuring)
        val idle = gate.end()
        assertTrue(markerStaysAttached(motorcycleDuring, idle.acceptingNew, ready = true))
        assertTrue(markerStaysAttached(pickup, idle.acceptingNew, ready = true))
    }

    @Test
    fun cancellingAnAnimationDoesNotLeaveTheGateClosed() {
        val gate = MarkerCameraGate()
        gate.begin()
        val idle = gate.end()
        assertTrue(idle.acceptingNew)
        assertFalse(markerStaysAttached(attached = true, acceptingNew = true, ready = false))
    }

    @Test
    fun aSettleDuringAnotherAnimationDoesNotOpenEarly() {
        val gate = MarkerCameraGate()
        gate.begin()
        assertFalse(gate.settleWithoutAnimation().acceptingNew)
        assertTrue(gate.end().acceptingNew)
    }
}
