package com.riders.rider.feature.delivery.domain

import com.riders.rider.navigation.DeliveryBoardTab
import com.riders.rider.navigation.RiderDestination

const val RIDER_CANCELLED_EVENT = "riderCancelled"
const val RIDER_CANCELLED_TOAST = "Delivery cancelled"
const val RIDERS_TOAST_DISMISS_MS = 3_000L

data class RiderCancellationLanding(
    val tab: RiderDestination,
    val board: DeliveryBoardTab,
    val toastMessage: String,
    val eventId: String,
)

fun riderCancellationLanding(eventId: String): RiderCancellationLanding {
    return RiderCancellationLanding(
        tab = RiderDestination.Deliveries,
        board = DeliveryBoardTab.Active,
        toastMessage = RIDER_CANCELLED_TOAST,
        eventId = "rider-cancelled:$eventId",
    )
}

fun riderCancellationLeavesScreen(succeeded: Boolean): Boolean = succeeded

fun guidanceRemainsOpenAfterCancellation(succeeded: Boolean): Boolean = !succeeded

/** A blank or already shown id does not start another toast. */
fun acceptToast(eventId: String, consumedId: String?): String? {
    if (eventId.isBlank() || eventId == consumedId) {
        return null
    }
    return eventId
}

fun toastDismissed(shownAtMs: Long, nowMs: Long, dismissMs: Long = RIDERS_TOAST_DISMISS_MS): Boolean {
    return nowMs - shownAtMs >= dismissMs
}

fun assignmentsAfterRiderCancellation(
    current: List<CommittedParcel>,
    assignmentId: String,
    refreshed: List<CommittedParcel>?,
): List<CommittedParcel> {
    val source = refreshed ?: current
    if (assignmentId.isBlank()) {
        return source
    }
    return source.filter { it.assignmentId != assignmentId }
}
