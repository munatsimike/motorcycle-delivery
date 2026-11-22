package com.riders.rider

import com.riders.rider.core.network.DEVICE_LOOPBACK_API_BASE_URL
import com.riders.rider.core.network.EMULATOR_API_BASE_URL
import com.riders.rider.core.network.looksLikeEmulator
import com.riders.rider.core.network.resolveDebugApiBaseUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DebugApiBaseUrlTest {
    @Test
    fun debugBuildUsesTheEmulatorHostOrPhoneLoopback() {
        assertEquals(EMULATOR_API_BASE_URL, resolveDebugApiBaseUrl("", emulator = true))
        assertEquals(DEVICE_LOOPBACK_API_BASE_URL, resolveDebugApiBaseUrl("  ", emulator = false))
    }

    @Test
    fun explicitDebugOverrideWinsForEitherDevice() {
        assertEquals(
            "http://192.168.178.212:3000",
            resolveDebugApiBaseUrl("http://192.168.178.212:3000/", emulator = true),
        )
        assertEquals(
            "http://192.168.178.212:3000",
            resolveDebugApiBaseUrl("http://192.168.178.212:3000", emulator = false),
        )
    }

    @Test
    fun emulatorFingerprintsAreRecognizedAndAPhoneIsNot() {
        assertTrue(looksLikeEmulator(
            fingerprint = "google/sdk_gphone64_arm64/emulator",
            model = "sdk_gphone64_arm64",
            hardware = "ranchu",
            product = "sdk_gphone64_arm64",
            manufacturer = "Google",
        ))
        assertFalse(looksLikeEmulator(
            fingerprint = "samsung/g0sxeea/g0s:14/UP1A",
            model = "SM-S906B",
            hardware = "qcom",
            product = "g0sxeea",
            manufacturer = "samsung",
        ))
    }
}
