package com.riders.rider.feature.delivery.domain

val DeliveryProgress = listOf(
    "ASSIGNED",
    "ARRIVED_AT_PICKUP",
    "PICKED_UP",
    "IN_TRANSIT",
    "ARRIVED_AT_DROPOFF",
    "DELIVERED",
)

fun nextDeliveryStatus(current: String): String? {
    val index = DeliveryProgress.indexOf(current)
    if (index < 0 || index == DeliveryProgress.lastIndex) {
        return null
    }
    return DeliveryProgress[index + 1]
}

fun canRelease(status: String): Boolean {
    return status == "ASSIGNED" || status == "ARRIVED_AT_PICKUP"
}

fun releaseActionVisible(onAcceptedDelivery: Boolean, status: String): Boolean {
    return onAcceptedDelivery && canRelease(status)
}

fun applyDeliveryTransition(current: String, requested: String): String? {
    return requested.takeIf { nextDeliveryStatus(current) == requested }
}

fun deliveryActionLabel(status: String): String? = when (status) {
    "ASSIGNED" -> "Arrived at pickup"
    "ARRIVED_AT_PICKUP" -> "Confirm pickup"
    "PICKED_UP" -> "Start the trip"
    "IN_TRANSIT" -> "Arrived at drop-off"
    "ARRIVED_AT_DROPOFF" -> "Confirm delivery"
    else -> null
}

fun deliveryStepTitle(status: String): String = when (status) {
    "ASSIGNED" -> "Go to pickup"
    "ARRIVED_AT_PICKUP" -> "At pickup"
    "PICKED_UP" -> "Parcel collected"
    "IN_TRANSIT" -> "On the way to drop-off"
    "ARRIVED_AT_DROPOFF" -> "At drop-off"
    else -> deliveryStatusLabel(status)
}

data class ProgressDecision(val status: String, val finished: Boolean)

fun progressDecision(currentStatus: String, confirmedStatus: String): ProgressDecision {
    if (confirmedStatus == "DELIVERED" && nextDeliveryStatus(currentStatus) == "DELIVERED") {
        return ProgressDecision(confirmedStatus, finished = true)
    }
    val accepted = applyDeliveryTransition(currentStatus, confirmedStatus)
    return if (accepted == null) {
        ProgressDecision(currentStatus, finished = false)
    } else {
        ProgressDecision(accepted, finished = false)
    }
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

fun deliveryStatusLabel(status: String): String = when (status) {
    "ASSIGNED" -> "Assigned"
    "ARRIVED_AT_PICKUP" -> "Arrived at pickup"
    "PICKED_UP" -> "Picked up"
    "IN_TRANSIT" -> "In transit"
    "ARRIVED_AT_DROPOFF" -> "Arrived at drop-off"
    "DELIVERED" -> "Delivered"
    else -> status
}
