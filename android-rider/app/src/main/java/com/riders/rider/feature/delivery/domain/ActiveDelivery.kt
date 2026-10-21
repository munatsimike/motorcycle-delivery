package com.riders.rider.feature.delivery.domain

import com.riders.rider.core.network.ActiveAssignmentBody
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.text
import kotlinx.serialization.Serializable

/**
 * Pickup and drop-off details the rider needs after the open-offer list is replaced.
 * Contact names, phone numbers, coordinates, prices, and credentials are not stored.
 */
@Serializable
data class ActiveDelivery(
    val deliveryId: String,
    val assignmentId: String,
    val status: String,
    val parcelDescription: String = "",
    val parcelSize: String = "",
    val parcelInstructions: String? = null,
    val pickupAddress: String = "",
    val pickupLandmark: String? = null,
    val pickupInstructions: String? = null,
    val dropoffAddress: String = "",
    val dropoffLandmark: String? = null,
    val dropoffInstructions: String? = null,
)

data class DeliveryContacts(
    val pickupName: String,
    val pickupPhone: String,
    val pickupLatitude: String? = null,
    val pickupLongitude: String? = null,
    val dropoffName: String,
    val dropoffPhone: String,
    val dropoffLatitude: String? = null,
    val dropoffLongitude: String? = null,
)

data class MapPoint(val latitude: String, val longitude: String)

fun OfferResponse.toActiveDelivery(deliveryId: String, assignmentId: String, status: String): ActiveDelivery {
    return ActiveDelivery(
        deliveryId = deliveryId,
        assignmentId = assignmentId,
        status = status,
        parcelDescription = parcel.description,
        parcelSize = parcel.size,
        parcelInstructions = parcel.instructions,
        pickupAddress = pickup.address,
        pickupLandmark = pickup.landmark,
        pickupInstructions = pickup.instructions,
        dropoffAddress = dropoff.address,
        dropoffLandmark = dropoff.landmark,
        dropoffInstructions = dropoff.instructions,
    )
}

fun ActiveAssignmentBody.toActiveDelivery(): ActiveDelivery {
    return ActiveDelivery(
        deliveryId = deliveryId,
        assignmentId = assignmentId,
        status = status,
        parcelDescription = parcel.description,
        parcelSize = parcel.size,
        parcelInstructions = parcel.instructions,
        pickupAddress = pickup.address,
        pickupLandmark = pickup.landmark,
        pickupInstructions = pickup.instructions,
        dropoffAddress = dropoff.address,
        dropoffLandmark = dropoff.landmark,
        dropoffInstructions = dropoff.instructions,
    )
}

sealed interface AssignmentLookup {
    data class Found(val delivery: ActiveDelivery, val contacts: DeliveryContacts? = null) : AssignmentLookup
    data object None : AssignmentLookup
    data class Unavailable(val error: ApiError) : AssignmentLookup
}

enum class DeliverySyncKind {
    Replace,
    Keep,
    Leave,
}

data class DeliverySync(
    val kind: DeliverySyncKind,
    val snapshot: ActiveDelivery?,
    val contacts: DeliveryContacts?,
    val error: String?,
)

fun ActiveAssignmentBody.toContacts(): DeliveryContacts {
    return DeliveryContacts(
        pickupName = pickup.contactName,
        pickupPhone = pickup.contactPhone,
        pickupLatitude = pickup.latitude,
        pickupLongitude = pickup.longitude,
        dropoffName = dropoff.contactName,
        dropoffPhone = dropoff.contactPhone,
        dropoffLatitude = dropoff.latitude,
        dropoffLongitude = dropoff.longitude,
    )
}

fun mapPointForStatus(status: String, contacts: DeliveryContacts?): MapPoint? {
    if (contacts == null) {
        return null
    }
    val latitude: String?
    val longitude: String?
    when (status) {
        "ASSIGNED", "ARRIVED_AT_PICKUP" -> {
            latitude = contacts.pickupLatitude
            longitude = contacts.pickupLongitude
        }
        "PICKED_UP", "IN_TRANSIT", "ARRIVED_AT_DROPOFF" -> {
            latitude = contacts.dropoffLatitude
            longitude = contacts.dropoffLongitude
        }
        else -> return null
    }
    if (latitude.isNullOrBlank() || longitude.isNullOrBlank()) {
        return null
    }
    return MapPoint(latitude, longitude)
}

const val MAPS_UNAVAILABLE = "No maps application is available."

data class NavigationTarget(val uri: String)

fun navigationTarget(
    status: String,
    contacts: DeliveryContacts?,
    pickupAddress: String,
    pickupLandmark: String?,
    dropoffAddress: String,
    dropoffLandmark: String?,
): NavigationTarget? {
    val point = mapPointForStatus(status, contacts)
    if (point != null) {
        return NavigationTarget("geo:${point.latitude},${point.longitude}?q=${point.latitude},${point.longitude}")
    }
    val query = when (status) {
        "ASSIGNED", "ARRIVED_AT_PICKUP" -> navigationQuery(pickupAddress, pickupLandmark)
        "PICKED_UP", "IN_TRANSIT", "ARRIVED_AT_DROPOFF" -> navigationQuery(dropoffAddress, dropoffLandmark)
        else -> null
    } ?: return null
    return NavigationTarget("geo:0,0?q=${encodeNavigationQuery(query)}")
}

fun navigationQuery(address: String, landmark: String?): String? {
    val place = address.trim()
    if (place.isEmpty()) {
        return null
    }
    val mark = landmark?.trim().orEmpty()
    return if (mark.isEmpty()) place else "$place, $mark"
}

fun encodeNavigationQuery(value: String): String {
    return java.net.URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")
}

fun syncOpenDelivery(deliveryId: String, stored: ActiveDelivery?, lookup: AssignmentLookup): DeliverySync {
    return when (lookup) {
        is AssignmentLookup.Found -> {
            if (lookup.delivery.deliveryId == deliveryId) {
                DeliverySync(DeliverySyncKind.Replace, lookup.delivery, lookup.contacts, null)
            } else {
                DeliverySync(DeliverySyncKind.Leave, null, null, null)
            }
        }
        AssignmentLookup.None -> DeliverySync(DeliverySyncKind.Leave, null, null, null)
        is AssignmentLookup.Unavailable -> DeliverySync(
            DeliverySyncKind.Keep,
            stored?.takeIf { it.deliveryId == deliveryId },
            null,
            lookup.error.text(),
        )
    }
}

data class DeliveryRecovery(
    val visible: ActiveDelivery?,
    val persist: ActiveDelivery?,
    val clearStored: Boolean,
    val offline: Boolean,
)

fun recoverActiveDelivery(stored: ActiveDelivery?, lookup: AssignmentLookup): DeliveryRecovery {
    return when (lookup) {
        is AssignmentLookup.Found -> DeliveryRecovery(
            visible = lookup.delivery,
            persist = lookup.delivery,
            clearStored = false,
            offline = false,
        )
        AssignmentLookup.None -> DeliveryRecovery(
            visible = null,
            persist = null,
            clearStored = stored != null,
            offline = false,
        )
        is AssignmentLookup.Unavailable -> DeliveryRecovery(
            visible = stored,
            persist = null,
            clearStored = false,
            offline = true,
        )
    }
}

class DeliveryRecoveryCoordinator(
    private val read: suspend () -> ActiveDelivery?,
    private val write: suspend (ActiveDelivery) -> Unit,
    private val clear: suspend () -> Unit,
    private val lookup: suspend () -> AssignmentLookup,
) {
    suspend fun reconcile(): DeliveryRecovery {
        val decision = recoverActiveDelivery(read(), lookup())
        if (decision.persist != null) {
            write(decision.persist)
        } else if (decision.clearStored) {
            clear()
        }
        return decision
    }
}

fun loadedDelivery(stored: ActiveDelivery?, offerCache: List<OfferResponse>, deliveryId: String): ActiveDelivery? {
    val snapshot = stored?.takeIf { it.deliveryId == deliveryId } ?: return null
    val replaced = offerCache.none { it.deliveryId == snapshot.deliveryId }
    return if (replaced || snapshot.assignmentId.isNotEmpty()) snapshot else null
}
