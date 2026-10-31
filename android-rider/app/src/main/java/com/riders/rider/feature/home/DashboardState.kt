
package com.riders.rider.feature.home

import com.riders.rider.core.network.ApiError

const val MARKETPLACE_DISABLED = "Bidding is not available"

data class WorkloadCounts(
    val flexible: Int,
    val express: Int,
)

enum class DashboardFailure {
    Authentication,
    MarketplaceDisabled,
    Network,
    Other,
}

fun workloadCounts(serviceClasses: List<String?>): WorkloadCounts {
    return WorkloadCounts(
        flexible = serviceClasses.count { it == "FLEXIBLE" },
        express = serviceClasses.count { it == "EXPRESS" },
    )
}

const val OFFLINE_WITH_DELIVERIES_TITLE = "Go offline?"
const val OFFLINE_WITH_DELIVERIES_MESSAGE =
    "You will stop receiving new requests. Deliveries you already accepted stay assigned to you."

fun activeDeliveryCount(showActiveDelivery: Boolean, flexibleCount: Int?, expressCount: Int?): Int {
    val listed = (flexibleCount ?: 0) + (expressCount ?: 0)
    if (listed > 0) {
        return listed
    }
    return if (showActiveDelivery) 1 else 0
}

fun offlineConfirmationRequired(activeDeliveryCount: Int): Boolean = activeDeliveryCount > 0

enum class ReceivingAlignment {
    None,
    Enable,
    Disable,
    ReleaseBusy,
}

fun showsReceivingControl(): Boolean = false

fun receivingAlignment(availability: String?, receiving: Boolean?): ReceivingAlignment {
    if (receiving == null) {
        return ReceivingAlignment.None
    }
    if (availability == "BUSY") {
        return ReceivingAlignment.ReleaseBusy
    }
    if (availability == "AVAILABLE" && !receiving) {
        return ReceivingAlignment.Enable
    }
    if (availability == "OFFLINE" && receiving) {
        return ReceivingAlignment.Disable
    }
    return ReceivingAlignment.None
}

fun showsV1ActiveDelivery(
    receiving: Boolean?,
    shift: HomeShift,
    committedV2: Boolean = false,
    assignmentsUnknown: Boolean = false,
): Boolean {
    if (assignmentsUnknown || receiving != null || committedV2) {
        return false
    }
    return shift.showActiveDelivery || shift.recovering || shift.recoveryFailed || shift.recoveryRequired
}

fun receivingAfterRefresh(previous: Boolean?, loaded: Boolean?, loadedFromServer: Boolean): Boolean? {
    return if (loadedFromServer) loaded else previous
}

fun dashboardFailure(error: ApiError): DashboardFailure = when {
    error is ApiError.SessionEnded || error is ApiError.SignedInElsewhere || error is ApiError.Forbidden -> DashboardFailure.Authentication
    error is ApiError.Unexpected && error.message == MARKETPLACE_DISABLED -> DashboardFailure.MarketplaceDisabled
    error is ApiError.Network || error is ApiError.Timeout -> DashboardFailure.Network
    else -> DashboardFailure.Other
}

fun homeWalletAmount(availableCapacity: String?): String? {
    val amount = availableCapacity?.trim().orEmpty()
    return amount.ifEmpty { null }
}
