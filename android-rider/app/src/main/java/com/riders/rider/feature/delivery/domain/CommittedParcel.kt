package com.riders.rider.feature.delivery.domain

import com.riders.rider.core.network.ActiveAssignmentBody

data class CommittedParcel(
    val deliveryId: String,
    val assignmentId: String,
    val status: String,
    val serviceClass: String? = null,
    val deliverBy: String? = null,
    val agreedPrice: String? = null,
    val parcelDescription: String = "",
    val parcelSize: String = "",
    val parcelInstructions: String? = null,
    val pickupAddress: String = "",
    val pickupLandmark: String? = null,
    val pickupInstructions: String? = null,
    val dropoffAddress: String = "",
    val dropoffLandmark: String? = null,
    val dropoffInstructions: String? = null,
    val contacts: DeliveryContacts? = null,
    val distanceMeters: Int? = null,
    val createdAt: String? = null,
    val completedAt: String? = null,
)

fun ActiveAssignmentBody.toCommittedParcel(): CommittedParcel {
    return CommittedParcel(
        deliveryId = deliveryId,
        assignmentId = assignmentId,
        status = status,
        serviceClass = serviceClass,
        deliverBy = deliverBy,
        agreedPrice = agreedPrice,
        parcelDescription = parcel.description,
        parcelSize = parcel.size,
        parcelInstructions = parcel.instructions,
        pickupAddress = pickup.address,
        pickupLandmark = pickup.landmark,
        pickupInstructions = pickup.instructions,
        dropoffAddress = dropoff.address,
        dropoffLandmark = dropoff.landmark,
        dropoffInstructions = dropoff.instructions,
        contacts = toContacts(),
        distanceMeters = distanceMeters,
        createdAt = createdAt,
        completedAt = completedAt,
    )
}

fun completedDeliveries(parcels: List<CommittedParcel>): List<CommittedParcel> {
    return parcels
        .filter { it.status == "DELIVERED" }
        .sortedWith(compareByDescending<CommittedParcel> { it.completedAt ?: "" }.thenByDescending { it.assignmentId })
}

data class CompletedBoard(
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val loaded: Boolean = false,
    val deliveries: List<CommittedParcel> = emptyList(),
    val error: String? = null,
)

fun requestCompletedBoard(current: CompletedBoard, force: Boolean): CompletedBoard? {
    if (!force && current.loaded && current.error == null) {
        return null
    }
    return current.copy(
        loading = current.deliveries.isEmpty(),
        refreshing = force && (current.deliveries.isNotEmpty() || current.error != null),
        error = null,
    )
}

fun applyCompletedBoard(current: CompletedBoard, incoming: List<CommittedParcel>?, error: String?): CompletedBoard {
    if (incoming != null) {
        return CompletedBoard(loaded = true, deliveries = completedDeliveries(incoming))
    }
    return current.copy(loading = false, refreshing = false, error = error)
}

fun serviceClassLabel(serviceClass: String?): String? = when (serviceClass) {
    "FLEXIBLE" -> "Flexible"
    "EXPRESS" -> "Urgent"
    else -> null
}

fun agreedPriceLabel(agreedPrice: String?): String? {
    val amount = agreedPrice?.trim().orEmpty()
    if (amount.isEmpty()) {
        return null
    }
    return "Agreed price USD $amount"
}

fun isCommittedV2Parcel(serviceClass: String?): Boolean {
    return serviceClass == "EXPRESS" || serviceClass == "FLEXIBLE"
}

fun hasCommittedV2(serviceClasses: Collection<String?>): Boolean {
    return serviceClasses.any(::isCommittedV2Parcel)
}

fun showsMarketplaceAssignment(parcel: CommittedParcel): Boolean {
    return isCommittedV2Parcel(parcel.serviceClass) && v2RiderAction(parcel.status) != null
}

fun committedAssignmentsForDisplay(
    assignments: List<CommittedParcel>,
    @Suppress("UNUSED_PARAMETER") availability: String?,
    @Suppress("UNUSED_PARAMETER") receiving: Boolean?,
): List<CommittedParcel> = assignments.filter(::showsMarketplaceAssignment)

fun selectedParcel(assignments: List<CommittedParcel>, deliveryId: String): CommittedParcel? {
    return assignments.firstOrNull { it.deliveryId == deliveryId }
}

fun parcelRoute(deliveryId: String, completed: Boolean = false): String {
    return if (completed) "delivery/$deliveryId?completed=true" else "delivery/$deliveryId"
}

fun applyAssignmentRefresh(
    current: List<CommittedParcel>,
    requestGeneration: Long,
    latestGeneration: Long,
    incoming: List<CommittedParcel>?,
): List<CommittedParcel> {
    if (incoming == null || requestGeneration != latestGeneration) {
        return current
    }
    return incoming
}
