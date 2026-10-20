package com.riders.rider.feature.home

data class AvailabilityChange(
    val availability: String?,
    val changing: Boolean = false,
    val error: String? = null,
)

fun beginAvailabilityChange(current: AvailabilityChange): AvailabilityChange? {
    if (current.changing) {
        return null
    }
    return current.copy(changing = true, error = null)
}

fun confirmAvailability(current: AvailabilityChange, confirmed: String, message: String?): AvailabilityChange {
    return current.copy(availability = confirmed, changing = false, error = message?.takeIf { it.isNotBlank() })
}

fun failAvailability(current: AvailabilityChange, message: String): AvailabilityChange {
    return current.copy(changing = false, error = message)
}
