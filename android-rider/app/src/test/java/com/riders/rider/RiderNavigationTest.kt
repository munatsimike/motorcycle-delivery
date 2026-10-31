package com.riders.rider

import com.riders.rider.feature.onboarding.domain.OnboardingStep
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.canEditMotorcycle
import com.riders.rider.feature.onboarding.domain.canReplaceLicence
import com.riders.rider.feature.onboarding.domain.canSelectMotorcycle
import com.riders.rider.feature.onboarding.domain.riderReadiness
import com.riders.rider.feature.profile.domain.ProfileBoard
import com.riders.rider.feature.profile.domain.canEditProfileName
import com.riders.rider.feature.profile.domain.canEditProfilePhone
import com.riders.rider.feature.profile.domain.profileAfterRefresh
import com.riders.rider.core.network.ApiError
import com.riders.rider.feature.profile.domain.shouldLoadProfile
import com.riders.rider.feature.profile.domain.showsAccountDeactivation
import com.riders.rider.feature.profile.domain.signOutLeavesRiderOnDuty
import com.riders.rider.navigation.RiderDestination
import com.riders.rider.navigation.RIDER_SHELL
import com.riders.rider.navigation.deliveriesShowsActiveDelivery
import com.riders.rider.navigation.deliveriesShowsAssignmentList
import com.riders.rider.navigation.deliveriesShowsOffers
import com.riders.rider.navigation.offersPollOnDeliveriesTab
import com.riders.rider.navigation.onboardingFocus
import com.riders.rider.navigation.openedRootTabs
import com.riders.rider.navigation.profileOnboardingRoute
import com.riders.rider.navigation.selectRiderTab
import com.riders.rider.navigation.showsRiderBottomBar
import com.riders.rider.navigation.showsWizardChrome
import com.riders.rider.navigation.tabAfterBack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderNavigationTest {
    @Test
    fun fourTabsKeepOneSelectedRootAndBackReturnsHome() {
        assertEquals(4, RiderDestination.entries.size)
        var selected = RiderDestination.Home
        val visits = mutableListOf(selected)
        listOf(
            RiderDestination.Deliveries,
            RiderDestination.Wallet,
            RiderDestination.Profile,
            RiderDestination.Deliveries,
            RiderDestination.Home,
            RiderDestination.Wallet,
        ).forEach { next ->
            selected = selectRiderTab(selected, next)
            visits += selected
            assertEquals(next, selected)
        }
        assertEquals(setOf(RiderDestination.Home, RiderDestination.Deliveries, RiderDestination.Wallet, RiderDestination.Profile), openedRootTabs(visits))
        assertEquals(4, openedRootTabs(visits).size)
        assertEquals(RiderDestination.Home, tabAfterBack(RiderDestination.Wallet))
        assertEquals(RiderDestination.Home, tabAfterBack(RiderDestination.Profile))
        assertNull(tabAfterBack(RiderDestination.Home))
    }

    @Test
    fun theBottomBarIsHiddenAwayFromTheSignedInShell() {
        assertTrue(showsRiderBottomBar(RIDER_SHELL))
        assertFalse(showsRiderBottomBar("welcome"))
        assertFalse(showsRiderBottomBar("sign-in"))
        assertFalse(showsRiderBottomBar("register"))
        assertFalse(showsRiderBottomBar("otp/login/%2B263771234567"))
        assertFalse(showsRiderBottomBar("onboarding"))
        assertFalse(showsRiderBottomBar("onboarding?step=licence"))
        assertFalse(showsRiderBottomBar("delivery/delivery-1"))
    }

    @Test
    fun deliveriesShowsOffersOnlyWhileAvailableAndPollsOnlyInTheForeground() {
        assertFalse(deliveriesShowsOffers("AVAILABLE"))
        assertFalse(deliveriesShowsOffers("BUSY"))
        assertFalse(deliveriesShowsOffers("OFFLINE"))
        assertFalse(deliveriesShowsActiveDelivery("BUSY"))
        assertFalse(deliveriesShowsActiveDelivery("AVAILABLE"))
        assertFalse(offersPollOnDeliveriesTab(RiderDestination.Deliveries, resumed = true, availability = "AVAILABLE"))
        assertFalse(offersPollOnDeliveriesTab(RiderDestination.Deliveries, resumed = false, availability = "AVAILABLE"))
        assertFalse(offersPollOnDeliveriesTab(RiderDestination.Home, resumed = true, availability = "AVAILABLE"))
        assertFalse(offersPollOnDeliveriesTab(RiderDestination.Deliveries, resumed = true, availability = "BUSY"))
        assertFalse(deliveriesShowsAssignmentList(null))
        assertTrue(deliveriesShowsAssignmentList(true))
        assertTrue(deliveriesShowsAssignmentList(false))
        assertTrue(deliveriesShowsAssignmentList(null, committedV2 = true))
        assertFalse(com.riders.rider.navigation.deliveriesShowsBidBoard(null))
        assertTrue(com.riders.rider.navigation.deliveriesShowsBidBoard(false))
    }

    @Test
    fun profileKeepsTheLastAccountWhenRefreshFails() {
        val current = ProfileBoard(
            fullName = "Tendai Moyo",
            phone = "+263771234567",
            address = "12 Samora Machel Avenue",
            onboarding = account("APPROVED"),
            hasLicence = true,
            loaded = true,
        )
        assertFalse(shouldLoadProfile(loaded = true, force = false, busy = false))
        assertFalse(shouldLoadProfile(loaded = false, force = true, busy = true))
        assertTrue(shouldLoadProfile(loaded = true, force = true, busy = false))
        val kept = profileAfterRefresh(current, null, null, null, null, null, "Network request failed. Check your connection and try again.")
        assertEquals("Tendai Moyo", kept.fullName)
        assertEquals("+263771234567", kept.phone)
        assertEquals("12 Samora Machel Avenue", kept.address)
        assertEquals("APPROVED", kept.onboarding?.approvalStatus)
        assertEquals("Network request failed. Check your connection and try again.", kept.error)
    }

    @Test
    fun signOutKeepsARiderOnDutyOnlyDuringADelivery() {
        assertTrue(signOutLeavesRiderOnDuty(ApiError.Conflict("You cannot go offline during a delivery")))
        assertTrue(signOutLeavesRiderOnDuty(ApiError.Conflict("Availability cannot be changed while busy")))
        assertFalse(signOutLeavesRiderOnDuty(ApiError.Conflict("Availability cannot be changed while busy.")))
        assertFalse(signOutLeavesRiderOnDuty(ApiError.Network))
    }

    @Test
    fun nameAndPhoneStayReadOnlyAndDeactivationIsUnavailable() {
        assertFalse(canEditProfileName())
        assertFalse(canEditProfilePhone())
        assertFalse(showsAccountDeactivation())
    }

    @Test
    fun licenceAndMotorcycleActionsFollowTheExistingRules() {
        assertFalse(canReplaceLicence("VERIFIED"))
        assertTrue(canReplaceLicence("PENDING"))
        assertTrue(canReplaceLicence("REJECTED"))
        assertTrue(canEditMotorcycle("PENDING"))
        assertTrue(canEditMotorcycle("REJECTED"))
        assertFalse(canEditMotorcycle("VERIFIED"))
        assertTrue(canSelectMotorcycle("VERIFIED", isActive = false))
        assertFalse(canSelectMotorcycle("VERIFIED", isActive = true))
        assertFalse(canSelectMotorcycle("PENDING", isActive = false))
    }

    @Test
    fun approvalStatesUseTheExistingReadinessExplanation() {
        assertEquals("Approved", riderReadiness(account("APPROVED")).approvalLabel)
        assertTrue(riderReadiness(account("PENDING")).message.contains("waiting for approval"))
        assertTrue(riderReadiness(account("REJECTED")).message.contains("not approved"))
        assertTrue(riderReadiness(account("SUSPENDED")).message.contains("suspended"))
    }

    @Test
    fun profileOpensLicenceAndMotorcycleWithoutTheWizardChrome() {
        assertEquals("onboarding?step=licence", profileOnboardingRoute("licence"))
        assertEquals("onboarding?step=motorcycle", profileOnboardingRoute("motorcycle"))
        assertEquals("onboarding", profileOnboardingRoute("setup"))
        assertEquals(OnboardingStep.Licence, onboardingFocus("licence"))
        assertEquals(OnboardingStep.Motorcycle, onboardingFocus("motorcycle"))
        assertNull(onboardingFocus(""))
        assertFalse(showsWizardChrome("licence"))
        assertTrue(showsWizardChrome(""))
    }

    private fun account(approval: String) = RiderOnboarding(
        licenceVerificationStatus = "VERIFIED",
        approvalStatus = approval,
        availability = "OFFLINE",
        licenceNumber = "LIC-1",
        licenceClass = "A",
        rejectionReason = null,
        verifiedMotorcycleCount = 1,
        activeVerifiedMotorcycle = true,
    )
}
