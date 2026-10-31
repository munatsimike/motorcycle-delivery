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

fun deliveriesShowsOffers(@Suppress("UNUSED_PARAMETER") availability: String?): Boolean = false

fun deliveriesShowsActiveDelivery(@Suppress("UNUSED_PARAMETER") availability: String?): Boolean = false

fun deliveriesShowsAssignmentList(receiving: Boolean?, committedV2: Boolean = false): Boolean {
    return receiving != null || committedV2
}

fun deliveriesShowsBidBoard(receiving: Boolean?): Boolean = receiving != null

enum class DeliveryBoardTab {
    Active,
    New,
    Pending,
    Completed,
}

fun defaultDeliveryBoardTab(): DeliveryBoardTab = DeliveryBoardTab.Active

fun deliveryBoardTabLabel(tab: DeliveryBoardTab): String = when (tab) {
    DeliveryBoardTab.Active -> "Active"
    DeliveryBoardTab.New -> "New"
    DeliveryBoardTab.Pending -> "Pending"
    DeliveryBoardTab.Completed -> "Completed"
}

fun deliveryBoardTabs(@Suppress("UNUSED_PARAMETER") showsOffers: Boolean = true): List<DeliveryBoardTab> {
    return listOf(
        DeliveryBoardTab.Active,
        DeliveryBoardTab.New,
        DeliveryBoardTab.Pending,
        DeliveryBoardTab.Completed,
    )
}

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
