package com.riders.rider.navigation

import com.riders.rider.feature.onboarding.domain.OnboardingStep

enum class RiderDestination(val label: String) {
    Home("Home"),
    Deliveries("Deliveries"),
    Wallet("Wallet"),
    Profile("Profile"),
}

const val RIDER_SHELL = "main"

fun showsRiderBottomBar(route: String?): Boolean = route == RIDER_SHELL

fun selectRiderTab(current: RiderDestination, next: RiderDestination): RiderDestination = next

fun tabAfterBack(selected: RiderDestination): RiderDestination? {
    return if (selected == RiderDestination.Home) null else RiderDestination.Home
}

fun openedRootTabs(visits: List<RiderDestination>): Set<RiderDestination> = visits.toSet()

fun deliveriesShowsOffers(availability: String?): Boolean = availability == "AVAILABLE"

fun deliveriesShowsActiveDelivery(availability: String?): Boolean = availability == "BUSY"

fun offersPollOnDeliveriesTab(
    tab: RiderDestination,
    resumed: Boolean,
    availability: String?,
): Boolean {
    return tab == RiderDestination.Deliveries && resumed && deliveriesShowsOffers(availability)
}

fun onboardingFocus(step: String?): OnboardingStep? = when (step) {
    "licence" -> OnboardingStep.Licence
    "motorcycle" -> OnboardingStep.Motorcycle
    else -> null
}

fun showsWizardChrome(step: String?): Boolean = onboardingFocus(step) == null

fun profileOnboardingRoute(section: String): String = when (section) {
    "licence" -> "onboarding?step=licence"
    "motorcycle" -> "onboarding?step=motorcycle"
    else -> "onboarding"
}
