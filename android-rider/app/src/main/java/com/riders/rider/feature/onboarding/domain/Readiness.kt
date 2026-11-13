package com.riders.rider.feature.onboarding.domain

data class RiderOnboarding(
    val licenceVerificationStatus: String,
    val approvalStatus: String,
    val availability: String,
    val licenceNumber: String?,
    val licenceClass: String?,
    val rejectionReason: String?,
    val verifiedMotorcycleCount: Int,
    val activeVerifiedMotorcycle: Boolean,
    val receiving: Boolean? = null,
)

data class RiderReadiness(
    val canAcceptDeliveries: Boolean,
    val canGoOnline: Boolean,
    val availabilityLabel: String,
    val licenceLabel: String,
    val approvalLabel: String,
    val message: String,
)

fun needsOnboarding(onboarding: RiderOnboarding): Boolean {
    return onboarding.approvalStatus != "APPROVED"
        || onboarding.licenceVerificationStatus != "VERIFIED"
        || !onboarding.activeVerifiedMotorcycle
}

fun applicationAwaitingReview(
    approvalStatus: String,
    hasLicenceImage: Boolean,
    licenceReviewStatus: String?,
    motorcycleStatuses: List<String>,
): Boolean {
    if (approvalStatus != "PENDING") {
        return false
    }
    val licenceSubmitted = hasLicenceImage && licenceReviewStatus != "REJECTED"
    val motorcycleSubmitted = motorcycleStatuses.any { it == "PENDING" || it == "VERIFIED" }
    return licenceSubmitted && motorcycleSubmitted
}

fun riderReadiness(onboarding: RiderOnboarding): RiderReadiness {
    val approved = onboarding.approvalStatus == "APPROVED"
    val licensed = onboarding.licenceVerificationStatus == "VERIFIED"
    val availability = if (approved) onboarding.availability else "OFFLINE"
    val motorcycleReady = onboarding.activeVerifiedMotorcycle
    val marketplace = onboarding.receiving != null
    val staleBusy = marketplace && availability == "BUSY"
    val ready = approved && licensed && motorcycleReady && (availability == "AVAILABLE" || availability == "BUSY")
    return RiderReadiness(
        canAcceptDeliveries = ready,
        canGoOnline = approved && licensed && motorcycleReady && (availability == "OFFLINE" || staleBusy),
        availabilityLabel = if (staleBusy) "Offline" else availabilityLabel(availability),
        licenceLabel = licenceLabel(onboarding.licenceVerificationStatus),
        approvalLabel = approvalLabel(onboarding.approvalStatus),
        message = readinessMessage(onboarding, availability),
    )
}

private fun readinessMessage(onboarding: RiderOnboarding, availability: String): String {
    if (onboarding.approvalStatus == "REJECTED") {
        return "Your rider application was not approved. You cannot accept deliveries."
    }
    if (onboarding.approvalStatus == "SUSPENDED") {
        return "Your rider account is suspended. You cannot accept deliveries."
    }
    if (onboarding.approvalStatus != "APPROVED") {
        return "Your account is waiting for approval. You cannot accept deliveries yet."
    }
    if (onboarding.licenceVerificationStatus == "REJECTED") {
        return onboarding.rejectionReason?.let { "Your licence was rejected: $it" }
            ?: "Your licence was not verified. You cannot accept deliveries yet."
    }
    if (onboarding.licenceVerificationStatus != "VERIFIED") {
        return "Your licence is still being reviewed. You cannot accept deliveries yet."
    }
    if (!onboarding.activeVerifiedMotorcycle) {
        return "You need an active verified motorcycle before you can accept deliveries."
    }
    if (availability == "OFFLINE") {
        return "Your account is approved. You are offline, so you cannot accept deliveries yet."
    }
    return "You are online. Delivery requests appear while you stay available."
}

private fun licenceLabel(status: String): String = when (status) {
    "VERIFIED" -> "Verified"
    "REJECTED" -> "Rejected"
    else -> "Pending review"
}

private fun approvalLabel(status: String): String = when (status) {
    "APPROVED" -> "Approved"
    "SUSPENDED" -> "Suspended"
    "REJECTED" -> "Rejected"
    else -> "Pending"
}

private fun availabilityLabel(status: String): String = when (status) {
    "AVAILABLE", "BUSY" -> "Online"
    else -> "Offline"
}
