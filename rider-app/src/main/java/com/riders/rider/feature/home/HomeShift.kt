package com.riders.rider.feature.home

import com.riders.rider.feature.delivery.domain.ActiveDelivery

data class HomeShift(
    val showGoOnline: Boolean,
    val showGoOffline: Boolean,
    val showOffers: Boolean,
    val showActiveDelivery: Boolean,
    val recovering: Boolean = false,
    val recoveryFailed: Boolean = false,
    val recoveryRequired: Boolean,
    val recoveryMessage: String?,
)

private const val BUSY_WITHOUT_DELIVERY = "You are marked as busy, but there is no active delivery to resume. You cannot go online."
private const val RECOVERY_RETRY = "Your current delivery could not be loaded. Check your connection and try again."

fun homeShift(
    availability: String?,
    canAcceptDeliveries: Boolean,
    active: ActiveDelivery?,
    recovering: Boolean = false,
    recoveryFailed: Boolean = false,
    marketplace: Boolean = false,
): HomeShift {
    val resumable = active?.takeIf { it.status != "DELIVERED" }
    if (availability == null) {
        return HomeShift(
            showGoOnline = false,
            showGoOffline = false,
            showOffers = false,
            showActiveDelivery = resumable != null,
            recovering = recovering && resumable == null,
            recoveryFailed = recoveryFailed,
            recoveryRequired = false,
            recoveryMessage = if (recoveryFailed && resumable == null) RECOVERY_RETRY else null,
        )
    }
    if (marketplace && availability == "BUSY") {
        return HomeShift(
            showGoOnline = true,
            showGoOffline = false,
            showOffers = false,
            showActiveDelivery = resumable != null,
            recoveryFailed = recoveryFailed,
            recoveryRequired = false,
            recoveryMessage = null,
        )
    }
    if (availability == "BUSY" && resumable == null && recovering) {
        return HomeShift(
            showGoOnline = false,
            showGoOffline = false,
            showOffers = false,
            showActiveDelivery = false,
            recovering = true,
            recoveryRequired = false,
            recoveryMessage = null,
        )
    }
    if (availability == "BUSY" && resumable == null && recoveryFailed) {
        return HomeShift(
            showGoOnline = false,
            showGoOffline = false,
            showOffers = false,
            showActiveDelivery = false,
            recoveryFailed = true,
            recoveryRequired = false,
            recoveryMessage = RECOVERY_RETRY,
        )
    }
    if (availability == "BUSY" && resumable == null) {
        return HomeShift(
            showGoOnline = false,
            showGoOffline = false,
            showOffers = false,
            showActiveDelivery = false,
            recoveryRequired = true,
            recoveryMessage = BUSY_WITHOUT_DELIVERY,
        )
    }
    if (availability == "BUSY") {
        return HomeShift(
            showGoOnline = false,
            showGoOffline = true,
            showOffers = canAcceptDeliveries,
            showActiveDelivery = true,
            recoveryFailed = recoveryFailed,
            recoveryRequired = false,
            recoveryMessage = null,
        )
    }
    if (availability == "AVAILABLE") {
        return HomeShift(
            showGoOnline = false,
            showGoOffline = true,
            showOffers = canAcceptDeliveries,
            showActiveDelivery = resumable != null,
            recoveryFailed = recoveryFailed,
            recoveryRequired = false,
            recoveryMessage = null,
        )
    }
    return HomeShift(
        showGoOnline = true,
        showGoOffline = false,
        showOffers = false,
        showActiveDelivery = resumable != null,
        recoveryFailed = recoveryFailed,
        recoveryRequired = false,
        recoveryMessage = null,
    )
}
