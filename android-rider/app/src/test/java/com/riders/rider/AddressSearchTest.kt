package com.riders.rider

import com.riders.rider.feature.auth.presentation.addressSearchResumes
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AddressSearchTest {
    @Test
    fun suggestionsStayClosedUntilTheAddressTextChanges() {
        assertTrue(addressSearchResumes(null, "12 Samora"))
        assertFalse(addressSearchResumes("12 Samora", "12 Samora"))
        assertFalse(addressSearchResumes("12 Samora", "  12 Samora  "))
        assertTrue(addressSearchResumes("12 Samora", "12 Samora Machel"))
        assertTrue(addressSearchResumes("12 Samora", ""))
    }
}
