package com.riders.rider.feature.delivery.domain

import com.riders.rider.core.network.ActiveAssignmentBody
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

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
    )
}

fun serviceClassLabel(serviceClass: String?): String? = when (serviceClass) {
    "FLEXIBLE" -> "Flexible"
    "EXPRESS" -> "Express"
    else -> null
}

fun deadlineLabel(deliverBy: String?, zone: ZoneId = ZoneId.systemDefault()): String? {
    val raw = deliverBy?.trim().orEmpty()
    if (raw.isEmpty()) {
        return null
    }
    val formatted = try {
        Instant.parse(raw).atZone(zone).format(DEADLINE)
    } catch (_: Exception) {
        raw
    }
    return "Deliver by $formatted"
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

fun committedAssignmentsForDisplay(
    assignments: List<CommittedParcel>,
    @Suppress("UNUSED_PARAMETER") availability: String?,
    @Suppress("UNUSED_PARAMETER") receiving: Boolean?,
): List<CommittedParcel> = assignments

fun selectedParcel(assignments: List<CommittedParcel>, deliveryId: String): CommittedParcel? {
    return assignments.firstOrNull { it.deliveryId == deliveryId }
}

fun parcelRoute(deliveryId: String): String = "delivery/$deliveryId"

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

private val DEADLINE = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.US)
