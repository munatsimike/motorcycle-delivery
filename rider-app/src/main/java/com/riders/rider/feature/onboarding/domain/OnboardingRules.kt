package com.riders.rider.feature.onboarding.domain

const val LICENCE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

enum class OnboardingStep {
    Profile,
    Licence,
    Motorcycle,
    Status,
}

data class MotorcycleDraft(
    val registrationNumber: String = "",
    val make: String = "",
    val model: String = "",
    val colour: String = "",
)

data class MotorcycleDetails(
    val id: String,
    val registrationNumber: String,
    val make: String,
    val model: String,
    val colour: String,
    val verificationStatus: String,
    val isActive: Boolean,
)

data class StoredLicence(
    val id: String,
    val reviewStatus: String,
    val contentType: String,
    val byteSize: Int,
)

fun licenceImageIssue(bytes: ByteArray): String? {
    if (bytes.isEmpty()) {
        return "Choose a licence image"
    }
    if (bytes.size > LICENCE_IMAGE_MAX_BYTES) {
        return "Licence image is too large"
    }
    if (!isJpeg(bytes) && !isPng(bytes) && !isWebp(bytes)) {
        return "Licence image must be a JPEG, PNG, or WebP file"
    }
    return null
}

fun licenceContentType(bytes: ByteArray): String? = when {
    isJpeg(bytes) -> "image/jpeg"
    isPng(bytes) -> "image/png"
    isWebp(bytes) -> "image/webp"
    else -> null
}

fun licenceFileName(bytes: ByteArray): String = when (licenceContentType(bytes)) {
    "image/png" -> "licence.png"
    "image/webp" -> "licence.webp"
    else -> "licence.jpg"
}

fun licenceStatusAfterImageUpload(currentLicenceStatus: String): String = currentLicenceStatus

fun canReplaceLicence(licenceVerificationStatus: String): Boolean {
    return licenceVerificationStatus != "VERIFIED"
}

fun motorcycleIssue(draft: MotorcycleDraft): String? {
    val registration = collapse(draft.registrationNumber)
    if (registration.isEmpty() || registration.length > 20) {
        return "Enter a registration number"
    }
    if (!fits(draft.make, 80)) {
        return "Enter a make"
    }
    if (!fits(draft.model, 80)) {
        return "Enter a model"
    }
    if (!fits(draft.colour, 40)) {
        return "Enter a colour"
    }
    return null
}

fun canEditMotorcycle(verificationStatus: String): Boolean {
    return verificationStatus == "PENDING" || verificationStatus == "REJECTED"
}

fun canSelectMotorcycle(verificationStatus: String, isActive: Boolean): Boolean {
    return verificationStatus == "VERIFIED" && !isActive
}

fun nextOnboardingStep(current: OnboardingStep, licenceReady: Boolean, hasMotorcycle: Boolean): OnboardingStep? {
    return when (current) {
        OnboardingStep.Profile -> OnboardingStep.Licence
        OnboardingStep.Licence -> if (licenceReady) OnboardingStep.Motorcycle else null
        OnboardingStep.Motorcycle -> if (hasMotorcycle) OnboardingStep.Status else null
        OnboardingStep.Status -> null
    }
}

fun previousOnboardingStep(current: OnboardingStep): OnboardingStep? = when (current) {
    OnboardingStep.Profile -> null
    OnboardingStep.Licence -> OnboardingStep.Profile
    OnboardingStep.Motorcycle -> OnboardingStep.Licence
    OnboardingStep.Status -> OnboardingStep.Motorcycle
}

fun approvalStatusTitle(status: String): String = when (status) {
    "APPROVED" -> "Approved"
    "REJECTED" -> "Rejected"
    "SUSPENDED" -> "Suspended"
    else -> "Pending review"
}

fun motorcycleStatusTitle(status: String): String = when (status) {
    "VERIFIED" -> "Verified"
    "REJECTED" -> "Rejected"
    "REVOKED" -> "Revoked"
    else -> "Pending review"
}

fun profileCompletion(onboarding: RiderOnboarding, hasLicenceImage: Boolean, motorcycleCount: Int): String {
    val missing = remainingRequirements(onboarding, hasLicenceImage, motorcycleCount)
    if (missing.isEmpty()) {
        return "Your profile is complete."
    }
    return "Still needed: ${missing.joinToString(", ")}."
}

fun remainingRequirements(onboarding: RiderOnboarding, hasLicenceImage: Boolean, motorcycleCount: Int): List<String> {
    val missing = mutableListOf<String>()
    if (onboarding.licenceVerificationStatus != "VERIFIED" && !hasLicenceImage) {
        missing += "a driving licence photo"
    } else if (onboarding.licenceVerificationStatus != "VERIFIED") {
        missing += "licence verification"
    }
    if (motorcycleCount == 0) {
        missing += "motorcycle details"
    } else if (!onboarding.activeVerifiedMotorcycle) {
        missing += "a verified active motorcycle"
    }
    if (onboarding.approvalStatus != "APPROVED") {
        missing += "account approval"
    }
    return missing
}

fun retainDraft(draft: MotorcycleDraft): MotorcycleDraft = draft

private fun fits(value: String, max: Int): Boolean {
    val collapsed = collapse(value)
    return collapsed.isNotEmpty() && collapsed.length <= max
}

private fun collapse(value: String): String = value.trim().replace(Regex("\\s+"), " ")

private fun isJpeg(bytes: ByteArray): Boolean {
    return bytes.size >= 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() && bytes[2] == 0xFF.toByte()
}

private fun isPng(bytes: ByteArray): Boolean {
    val signature = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    return bytes.size >= signature.size && signature.indices.all { bytes[it] == signature[it] }
}

private fun isWebp(bytes: ByteArray): Boolean {
    return bytes.size >= 12
        && bytes[0] == 'R'.code.toByte()
        && bytes[1] == 'I'.code.toByte()
        && bytes[2] == 'F'.code.toByte()
        && bytes[3] == 'F'.code.toByte()
        && bytes[8] == 'W'.code.toByte()
        && bytes[9] == 'E'.code.toByte()
        && bytes[10] == 'B'.code.toByte()
        && bytes[11] == 'P'.code.toByte()
}
