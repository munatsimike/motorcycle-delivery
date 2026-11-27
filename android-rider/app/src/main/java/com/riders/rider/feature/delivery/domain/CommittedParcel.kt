package com.riders.rider.feature.delivery.domain

import com.riders.rider.feature.offers.domain.requestAmountLabel
import com.riders.rider.core.network.ActiveAssignmentBody

@kotlinx.serialization.Serializable
data class CommittedParcel(
    val deliveryId: String,
    val assignmentId: String,
    val status: String,
    val serviceClass: String? = null,
    val deliverBy: String? = null,
    val agreedPrice: String? = null,
    val currency: String = "USD",
    val paymentMethod: String? = null,
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
    val cancelledAt: String? = null,
    val cancelledBy: String? = null,
    val cancellationReason: String? = null,
    val cancellationNote: String? = null,
)

fun ActiveAssignmentBody.toCommittedParcel(): CommittedParcel {
    return CommittedParcel(
        deliveryId = deliveryId,
        assignmentId = assignmentId,
        status = status,
        serviceClass = serviceClass,
        deliverBy = deliverBy,
        agreedPrice = agreedPrice,
        currency = currency,
        paymentMethod = paymentMethod,
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
        cancelledAt = cancelledAt,
        cancelledBy = cancelledBy,
        cancellationReason = cancellationReason,
        cancellationNote = cancellationNote,
    )
}

fun completedDeliveries(parcels: List<CommittedParcel>): List<CommittedParcel> {
    return parcels
        .filter { it.status == "DELIVERED" }
        .sortedWith(compareByDescending<CommittedParcel> { it.completedAt ?: "" }.thenByDescending { it.assignmentId })
}

enum class HistoryStatus(val label: String, val query: String) {
    All("All", "all"),
    Delivered("Delivered", "delivered"),
    Cancelled("Cancelled", "cancelled"),
}

const val HISTORY_CACHE_LIMIT = 5

fun historyDeliveries(parcels: List<CommittedParcel>): List<CommittedParcel> {
    return parcels.filter { it.status == "DELIVERED" || it.status == "CANCELLED" }
}

fun historyCache(parcels: List<CommittedParcel>): List<CommittedParcel> = parcels.take(HISTORY_CACHE_LIMIT)

fun historySortTime(parcel: CommittedParcel): String? {
    return if (parcel.status == "CANCELLED") parcel.cancelledAt ?: parcel.createdAt else parcel.completedAt ?: parcel.createdAt
}

fun showsDeliveredConfirmation(status: String): Boolean = status == "DELIVERED"

fun historyStopLines(status: String, pickup: String, dropoff: String): Pair<String, String> {
    return if (status == "CANCELLED") pickup to dropoff else pickup to ""
}

fun historyRecord(parcels: List<CommittedParcel>, assignmentId: String?, deliveryId: String): CommittedParcel? {
    val assignment = assignmentId?.trim().orEmpty()
    if (assignment.isNotEmpty()) {
        return parcels.firstOrNull { it.assignmentId == assignment }
    }
    return parcels.firstOrNull { it.deliveryId == deliveryId }
}

fun historyFetchApplies(ticket: Int, generation: Int): Boolean = ticket == generation

const val HISTORY_RIDER_CANCELLATION = "RIDER_CANCELLED"
const val HISTORY_CUSTOMER_CANCELLATION = "CUSTOMER_CANCELLED"

fun invalidatesHistory(event: String): Boolean {
    return event == HISTORY_RIDER_CANCELLATION || event == HISTORY_CUSTOMER_CANCELLATION
}

fun historyCancellationCopy(reason: String?, note: String?): List<String> {
    return listOf(reason?.trim().orEmpty(), note?.trim().orEmpty()).filter { it.isNotEmpty() }
}

data class CompletedBoard(
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val loaded: Boolean = false,
    val nextCursor: String? = null,
    val paging: Boolean = false,
    val pageError: String? = null,
    val deliveries: List<CommittedParcel> = emptyList(),
    val error: String? = null,
    val syncing: Boolean = false,
    val historyStatus: HistoryStatus = HistoryStatus.All,
)

fun requestCompletedBoard(current: CompletedBoard, force: Boolean, fromUser: Boolean = false): CompletedBoard? {
    if (!force && current.loaded && current.error == null) {
        return null
    }
    val blank = !current.loaded && current.deliveries.isEmpty() && current.error == null
    val chrome = com.riders.rider.core.refresh.listedRefresh(fromUser, blank)
    return current.copy(
        loading = chrome.loading,
        refreshing = chrome.refreshing,
        syncing = true,
        error = null,
    )
}

fun applyCompletedBoard(current: CompletedBoard, incoming: List<CommittedParcel>?, error: String?): CompletedBoard {
    if (incoming != null) {
        return current.copy(
            loading = false,
            refreshing = false,
            syncing = false,
            loaded = true,
            deliveries = historyDeliveries(incoming),
            error = null,
            pageError = null,
            paging = false,
        )
    }
    return current.copy(loading = false, refreshing = false, syncing = false, error = error)
}

fun appendCompletedPage(current: CompletedBoard, incoming: List<CommittedParcel>, nextCursor: String?): CompletedBoard =
    current.copy(deliveries = (current.deliveries + historyDeliveries(incoming)).distinctBy { it.assignmentId },
        nextCursor = nextCursor, paging = false, pageError = null)

fun serviceClassLabel(serviceClass: String?): String? = when (serviceClass) {
    "FLEXIBLE" -> "Flexible"
    "EXPRESS" -> "Urgent"
    else -> null
}

fun agreedPriceLabel(agreedPrice: String?, currency: String = "USD"): String? {
    val amount = agreedPrice?.trim().orEmpty()
    if (amount.isEmpty()) {
        return null
    }
    return "Agreed price ${requestAmountLabel(currency, amount)}"
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

fun parcelRoute(deliveryId: String, completed: Boolean = false, assignmentId: String? = null): String {
    if (!completed) {
        return "delivery/$deliveryId"
    }
    val assignment = assignmentId?.trim().orEmpty()
    return if (assignment.isEmpty()) {
        "delivery/$deliveryId?completed=true"
    } else {
        "delivery/$deliveryId?completed=true&assignment=$assignment"
    }
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
