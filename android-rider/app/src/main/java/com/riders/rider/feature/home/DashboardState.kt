
package com.riders.rider.feature.home

import com.riders.rider.core.design.NetworkAvailability
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.text
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.committedAssignmentsForDisplay

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

fun shouldRefreshWalletOnHomeVisit(visitsSoFar: Int): Boolean = visitsSoFar > 0

fun deliveryStatusRefreshesWallet(status: String): Boolean = status == "DELIVERED"

fun dashboardActiveCount(assignments: List<CommittedParcel>): Int {
    return committedAssignmentsForDisplay(assignments, null, null).size
}

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

fun accountLoadFailureTitle(message: String?): String {
    return if (message == ApiError.SessionUncertain.text()) "Sign in again" else "Connection unavailable"
}

fun dashboardFailure(error: ApiError): DashboardFailure = when {
    error is ApiError.SessionEnded || error is ApiError.SignedInElsewhere || error is ApiError.Forbidden -> DashboardFailure.Authentication
    error is ApiError.Unexpected && error.message == MARKETPLACE_DISABLED -> DashboardFailure.MarketplaceDisabled
    error is ApiError.Network || error is ApiError.Timeout -> DashboardFailure.Network
    else -> DashboardFailure.Other
}

fun dashboardFailureIsRecoverable(error: ApiError): Boolean = when (error) {
    ApiError.Network,
    ApiError.Timeout,
    ApiError.Unavailable,
    -> true
    is ApiError.Unexpected -> true
    else -> false
}

data class HomeNetworkSignals(
    val connectionFailure: Boolean,
    val backendFailure: Boolean,
)

fun homeNetworkSignals(
    notice: String?,
    onboard: ApiError?,
    assignments: ApiError?,
    assignmentsUnknown: Boolean,
    assignmentError: ApiError?,
    recoveryOffline: Boolean,
    recoveryMessage: String?,
): HomeNetworkSignals {
    val surfaced = when {
        !notice.isNullOrBlank() -> null
        onboard != null && dashboardFailure(onboard) == DashboardFailure.Authentication -> null
        assignments != null && dashboardFailure(assignments) == DashboardFailure.Authentication -> null
        onboard != null && dashboardFailure(onboard) == DashboardFailure.MarketplaceDisabled -> null
        assignmentError != null && dashboardFailure(assignmentError) == DashboardFailure.MarketplaceDisabled -> null
        onboard != null && !dashboardFailureIsRecoverable(onboard) -> null
        assignmentsUnknown -> assignments ?: ApiError.Network
        recoveryOffline && recoveryMessage == null -> assignments ?: onboard ?: ApiError.Network
        recoveryMessage == null && onboard != null -> onboard
        recoveryMessage == null && assignmentError != null -> assignmentError
        else -> null
    }
    return when (surfaced?.let(::dashboardFailure)) {
        DashboardFailure.Network -> HomeNetworkSignals(connectionFailure = true, backendFailure = false)
        DashboardFailure.Other -> if (surfaced is ApiError.Unavailable || surfaced is ApiError.Unexpected) {
            HomeNetworkSignals(connectionFailure = false, backendFailure = true)
        } else {
            HomeNetworkSignals(connectionFailure = false, backendFailure = false)
        }
        else -> HomeNetworkSignals(connectionFailure = false, backendFailure = false)
    }
}

enum class HomeConnectionWarning {
    Hidden,
    Snackbar,
    Message,
}

fun homeConnectionWarning(
    availability: NetworkAvailability,
    connectionFailure: Boolean,
    backendFailure: Boolean,
    recoveryOutstanding: Boolean,
    messageLooksLikeConnectionFailure: Boolean,
): HomeConnectionWarning {
    if (connectionFailure && availability == NetworkAvailability.Disconnected) {
        return HomeConnectionWarning.Snackbar
    }
    if (recoveryOutstanding) {
        return HomeConnectionWarning.Hidden
    }
    if (messageLooksLikeConnectionFailure && (backendFailure || availability == NetworkAvailability.BackendUnavailable)) {
        return HomeConnectionWarning.Message
    }
    return HomeConnectionWarning.Hidden
}

fun networkRecoveryOutstanding(refreshPending: Boolean, completedAttempts: Int, maxAttempts: Int): Boolean {
    return refreshPending && completedAttempts < maxAttempts
}

fun homeWalletAmount(availableCapacity: String?): String? {
    val amount = availableCapacity?.trim().orEmpty()
    return amount.ifEmpty { null }
}
