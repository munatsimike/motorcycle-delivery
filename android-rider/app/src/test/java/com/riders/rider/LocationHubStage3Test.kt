package com.riders.rider

import com.riders.rider.feature.availability.RiderLocationHub
import com.riders.rider.feature.availability.domain.GpsFix
import org.junit.Assert.*
import org.junit.Test

class LocationHubStage3Test {
    @Test fun olderFixCannotOverwriteNewerFix() {
        val hub = RiderLocationHub()
        val newer = GpsFix(1.0, 2.0)
        hub.publish(newer, 2000L)
        hub.publish(GpsFix(3.0, 4.0), 1000L)
        assertEquals(newer, hub.fresh(2000L))
    }

    @Test fun cachedFixExpiresFromCaptureTime() {
        val hub = RiderLocationHub()
        hub.publish(GpsFix(1.0, 2.0), 1000L)
        assertNull(hub.fresh(47000L))
        hub.clear()
        assertNull(hub.fixes.value)
    }
}
