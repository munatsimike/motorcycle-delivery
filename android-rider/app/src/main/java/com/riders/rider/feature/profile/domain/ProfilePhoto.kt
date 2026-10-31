package com.riders.rider.feature.profile.domain

const val PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024
const val PROFILE_PHOTO_MAX_EDGE = 1024

enum class ProfilePhotoPhase {
    Idle,
    Loading,
    Uploading,
    Removing,
}

enum class ProfilePhotoRetry {
    Upload,
    Download,
    Remove,
}

data class ProfilePhotoState(
    val hasStoredPhoto: Boolean = false,
    val showingStored: Boolean = false,
    val showingPreview: Boolean = false,
    val phase: ProfilePhotoPhase = ProfilePhotoPhase.Idle,
    val progress: Int? = null,
    val error: String? = null,
    val retry: ProfilePhotoRetry? = null,
)

fun profilePhotoIssue(bytes: ByteArray): String? {
    if (bytes.isEmpty()) {
        return "Choose a profile photo"
    }
    if (bytes.size > PROFILE_PHOTO_MAX_BYTES) {
        return "Profile photo is too large"
    }
    if (profilePhotoContentType(bytes) == null) {
        return "Profile photo must be a JPEG, PNG, or WebP file"
    }
    return null
}

fun profilePhotoContentType(bytes: ByteArray): String? = when {
    isJpeg(bytes) -> "image/jpeg"
    isPng(bytes) -> "image/png"
    isWebp(bytes) -> "image/webp"
    else -> null
}

fun profilePhotoFileName(bytes: ByteArray): String = when (profilePhotoContentType(bytes)) {
    "image/png" -> "profile.png"
    "image/webp" -> "profile.webp"
    else -> "profile.jpg"
}

fun profilePhotoSampleSize(width: Int, height: Int, maxEdge: Int = PROFILE_PHOTO_MAX_EDGE): Int {
    val longest = maxOf(width, height)
    if (longest <= 0 || maxEdge <= 0 || longest <= maxEdge) {
        return 1
    }
    var sample = 1
    while (longest / (sample * 2) > maxEdge) {
        sample *= 2
    }
    if (longest / sample > maxEdge) {
        sample *= 2
    }
    return sample
}

fun canStartProfilePhotoAction(state: ProfilePhotoState): Boolean = state.phase == ProfilePhotoPhase.Idle

fun profilePhotoAfterAccount(current: ProfilePhotoState, hasProfilePhoto: Boolean): ProfilePhotoState {
    if (current.phase == ProfilePhotoPhase.Uploading || current.phase == ProfilePhotoPhase.Removing) {
        return current
    }
    if (!hasProfilePhoto) {
        return current.copy(
            hasStoredPhoto = false,
            showingStored = false,
            phase = ProfilePhotoPhase.Idle,
            progress = null,
        )
    }
    if (current.showingStored || current.phase == ProfilePhotoPhase.Loading) {
        return current.copy(hasStoredPhoto = true)
    }
    return current.copy(hasStoredPhoto = true, phase = ProfilePhotoPhase.Loading, error = null, retry = null)
}

fun profilePhotoUploadStarted(current: ProfilePhotoState): ProfilePhotoState {
    return current.copy(
        phase = ProfilePhotoPhase.Uploading,
        showingPreview = true,
        progress = 0,
        error = null,
        retry = null,
    )
}

fun profilePhotoUploadFailed(current: ProfilePhotoState, message: String): ProfilePhotoState {
    return current.copy(
        phase = ProfilePhotoPhase.Idle,
        showingPreview = false,
        progress = null,
        error = message,
        retry = ProfilePhotoRetry.Upload,
    )
}

fun profilePhotoAwaitingStored(current: ProfilePhotoState): ProfilePhotoState {
    return current.copy(
        hasStoredPhoto = true,
        showingPreview = false,
        showingStored = false,
        phase = ProfilePhotoPhase.Loading,
        progress = null,
        error = null,
        retry = null,
    )
}

fun profilePhotoDownloadFinished(current: ProfilePhotoState): ProfilePhotoState {
    return current.copy(
        hasStoredPhoto = true,
        showingStored = true,
        showingPreview = false,
        phase = ProfilePhotoPhase.Idle,
        progress = null,
        error = null,
        retry = null,
    )
}

fun profilePhotoDownloadFailed(current: ProfilePhotoState, message: String): ProfilePhotoState {
    return current.copy(
        phase = ProfilePhotoPhase.Idle,
        showingPreview = false,
        showingStored = false,
        progress = null,
        error = message,
        retry = ProfilePhotoRetry.Download,
    )
}

fun profilePhotoDownloadMissing(current: ProfilePhotoState): ProfilePhotoState {
    return current.copy(
        hasStoredPhoto = false,
        showingStored = false,
        showingPreview = false,
        phase = ProfilePhotoPhase.Idle,
        progress = null,
        error = null,
        retry = null,
    )
}

fun profilePhotoRemoveStarted(current: ProfilePhotoState): ProfilePhotoState {
    return current.copy(phase = ProfilePhotoPhase.Removing, error = null, retry = null, progress = null)
}

fun profilePhotoRemoveFailed(current: ProfilePhotoState, message: String): ProfilePhotoState {
    return current.copy(phase = ProfilePhotoPhase.Idle, error = message, retry = ProfilePhotoRetry.Remove)
}

fun profilePhotoRemoved(current: ProfilePhotoState): ProfilePhotoState {
    return ProfilePhotoState()
}

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
