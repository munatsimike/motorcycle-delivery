package com.riders.rider.feature.delivery.domain

fun deliveryStepTitle(status: String): String = when (status) {
    "ASSIGNED" -> "Go to pickup"
    "ARRIVED_AT_PICKUP" -> "At pickup"
    "PICKED_UP" -> "Parcel collected"
    "IN_TRANSIT" -> "On the way to drop-off"
    "ARRIVED_AT_DROPOFF" -> "At drop-off"
    "RIDER_ASSIGNED" -> "Rider assigned"
    "COLLECTING" -> "Collecting"
    "COLLECTED" -> "Collected"
    "OUT_FOR_DELIVERY" -> "Out for delivery"
    else -> deliveryStatusLabel(status)
}

class DeliveryActionGate {
    private var busy = false

    fun tryStart(): Boolean {
        if (busy) {
            return false
        }
        busy = true
        return true
    }

    fun finish() {
        busy = false
    }
}

val V2DeliveryProgress = listOf(
    "RIDER_ASSIGNED",
    "COLLECTED",
    "DELIVERED",
)

fun v2NextStatus(current: String): String? {
    if (current == "COLLECTING") {
        return "COLLECTED"
    }
    if (current == "OUT_FOR_DELIVERY") {
        return "DELIVERED"
    }
    val index = V2DeliveryProgress.indexOf(current)
    if (index < 0 || index == V2DeliveryProgress.lastIndex) {
        return null
    }
    return V2DeliveryProgress[index + 1]
}

fun v2RiderAction(current: String): String? = when (current) {
    "RIDER_ASSIGNED", "COLLECTING" -> "Confirm pickup"
    "COLLECTED", "OUT_FOR_DELIVERY" -> "Mark as delivered"
    else -> null
}

// One tap requests only the immediate next status. A stored attempt that is
// already further along is not reused, so a timeout cannot skip a step.
fun v2TapTarget(current: String, pendingTarget: String? = null): String? {
    val next = v2NextStatus(current) ?: return null
    if (pendingTarget == null) {
        return next
    }
    return if (V2DeliveryProgress.indexOf(pendingTarget) == V2DeliveryProgress.indexOf(next)) pendingTarget else next
}

fun navigationActionLabel(status: String): String? = when (status) {
    "ASSIGNED", "ARRIVED_AT_PICKUP", "RIDER_ASSIGNED", "COLLECTING" -> "Navigate to pickup"
    "PICKED_UP", "IN_TRANSIT", "ARRIVED_AT_DROPOFF", "COLLECTED", "OUT_FOR_DELIVERY" -> "Navigate to drop-off"
    else -> null
}

fun v2ActionLabel(targetStatus: String): String? = when (targetStatus) {
    "COLLECTED" -> "Confirm pickup"
    "DELIVERED" -> "Mark as delivered"
    else -> null
}

fun v2CancellationVisible(status: String): Boolean {
    return status == "RIDER_ASSIGNED" || status == "COLLECTING"
}

fun v2StatusReached(serverStatus: String, targetStatus: String): Boolean {
    val server = V2DeliveryProgress.indexOf(serverStatus)
    val target = V2DeliveryProgress.indexOf(targetStatus)
    return server >= 0 && target >= 0 && server >= target
}

fun trackingStatusLabel(status: String): String = when (status) {
    "RIDER_ASSIGNED", "COLLECTING", "ASSIGNED", "ARRIVED_AT_PICKUP" -> "Rider heading to pickup"
    "COLLECTED", "PICKED_UP" -> "Parcel collected"
    "OUT_FOR_DELIVERY", "IN_TRANSIT", "ARRIVED_AT_DROPOFF" -> "In transit"
    "DELIVERED" -> "Delivered"
    else -> deliveryStatusLabel(status)
}

fun riderDetailsHeading(status: String): String = when (status) {
    "RIDER_ASSIGNED", "ASSIGNED", "COLLECTING", "ARRIVED_AT_PICKUP" -> "Ready for collection"
    "COLLECTED", "PICKED_UP" -> "Parcel collected"
    "OUT_FOR_DELIVERY", "IN_TRANSIT" -> "On the way"
    "ARRIVED_AT_DROPOFF" -> "Ready for drop-off"
    "DELIVERED" -> "Delivered"
    else -> deliveryStatusLabel(status)
}

fun riderDetailsSupport(status: String): String = when (status) {
    "RIDER_ASSIGNED", "ASSIGNED", "COLLECTING", "ARRIVED_AT_PICKUP" -> "Collect the parcel from the sender."
    "COLLECTED", "PICKED_UP" -> "The parcel has been collected."
    "OUT_FOR_DELIVERY", "IN_TRANSIT" -> "Take the parcel to the drop-off."
    "ARRIVED_AT_DROPOFF" -> "Hand the parcel to the recipient."
    "DELIVERED" -> "This delivery is complete."
    else -> "This is the latest status for this delivery."
}

fun deliveryStatusLabel(status: String): String = when (status) {
    "ASSIGNED" -> "Assigned"
    "ARRIVED_AT_PICKUP" -> "Arrived at pickup"
    "PICKED_UP" -> "Picked up"
    "IN_TRANSIT" -> "In transit"
    "ARRIVED_AT_DROPOFF" -> "Arrived at drop-off"
    "DELIVERED" -> "Delivered"
    "RIDER_ASSIGNED" -> "Rider assigned"
    "COLLECTING" -> "Collecting"
    "COLLECTED" -> "Collected"
    "OUT_FOR_DELIVERY" -> "Out for delivery"
    else -> status
}
