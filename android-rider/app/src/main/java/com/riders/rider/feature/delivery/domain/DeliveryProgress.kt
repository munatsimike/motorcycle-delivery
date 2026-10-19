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

fun deliveryStatusLabel(status: String): String = when (status) {
    "ASSIGNED" -> "Assigned"
    "ARRIVED_AT_PICKUP" -> "Arrived at pickup"
    "PICKED_UP" -> "Picked up"
    "IN_TRANSIT" -> "In transit"
    "ARRIVED_AT_DROPOFF" -> "Arrived at drop-off"
    "DELIVERED" -> "Delivered"
    else -> status
}
