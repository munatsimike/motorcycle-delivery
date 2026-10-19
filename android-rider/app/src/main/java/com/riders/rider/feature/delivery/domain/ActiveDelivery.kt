package com.riders.rider.feature.delivery.domain

import com.riders.rider.core.network.ActiveAssignmentBody
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.OfferResponse
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
    val pickupAddress: String = "",
    val pickupLandmark: String? = null,
    val pickupInstructions: String? = null,
    val dropoffAddress: String = "",
    val dropoffLandmark: String? = null,
    val dropoffInstructions: String? = null,
)

fun OfferResponse.toActiveDelivery(deliveryId: String, assignmentId: String, status: String): ActiveDelivery {
    return ActiveDelivery(
        deliveryId = deliveryId,
        assignmentId = assignmentId,
        status = status,
        parcelDescription = parcel.description,
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
        pickupAddress = pickup.address,
        pickupLandmark = pickup.landmark,
        pickupInstructions = pickup.instructions,
        dropoffAddress = dropoff.address,
        dropoffLandmark = dropoff.landmark,
        dropoffInstructions = dropoff.instructions,
    )
}

sealed interface AssignmentLookup {
    data class Found(val delivery: ActiveDelivery) : AssignmentLookup
    data object None : AssignmentLookup
    data class Unavailable(val error: ApiError) : AssignmentLookup
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
