
package com.riders.rider.feature.home

import com.riders.rider.core.network.ApiError

const val MARKETPLACE_DISABLED = "Bidding is not available"

data class WorkloadCounts(
    val flexible: Int,
    val express: Int,
)

data class ReceivingControl(
    val visible: Boolean,
    val checked: Boolean,
    val enabled: Boolean,
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

fun receivingControl(
    receiving: Boolean?,
    canAcceptDeliveries: Boolean,
    changing: Boolean,
): ReceivingControl {
    if (receiving == null) {
        return ReceivingControl(visible = false, checked = false, enabled = false)
    }
    return ReceivingControl(
        visible = true,
        checked = receiving,
        enabled = canAcceptDeliveries && !changing,
    )
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
    error is ApiError.SessionEnded || error is ApiError.Forbidden -> DashboardFailure.Authentication
    error is ApiError.Unexpected && error.message == MARKETPLACE_DISABLED -> DashboardFailure.MarketplaceDisabled
    error is ApiError.Network || error is ApiError.Timeout -> DashboardFailure.Network
    else -> DashboardFailure.Other
}

fun walletFigures(marketplace: Boolean, availableCapacity: String?, reservedFees: String?): Pair<String?, String?> {
    return if (marketplace) availableCapacity to reservedFees else null to null
}
