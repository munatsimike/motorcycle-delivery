package com.riders.rider.feature.profile.presentation

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.auth.data.AuthRepository
import com.riders.rider.feature.auth.domain.normalizeRiderAddress
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.offers.data.DataStoreAcceptKeyStore
import com.riders.rider.feature.offers.notification.OfferPushCoordinator
import com.riders.rider.feature.onboarding.data.VerificationRepository
import com.riders.rider.core.network.ApiError
import com.riders.rider.feature.profile.data.ProfilePhotoRepository
import com.riders.rider.feature.profile.domain.ProfileBoard
import com.riders.rider.feature.profile.domain.ProfilePhotoPhase
import com.riders.rider.feature.profile.domain.ProfilePhotoRetry
import com.riders.rider.feature.profile.domain.ProfilePhotoState
import com.riders.rider.feature.profile.domain.canStartProfilePhotoAction
import com.riders.rider.feature.profile.domain.profileAfterRefresh
import com.riders.rider.feature.profile.domain.profileErrorAfterLeave
import com.riders.rider.feature.profile.domain.profileRefreshError
import com.riders.rider.feature.profile.domain.profilePhotoAfterAccount
import com.riders.rider.feature.profile.domain.profilePhotoAwaitingStored
import com.riders.rider.feature.profile.domain.ProfilePhotoDownloadGate
import com.riders.rider.feature.profile.domain.keepsStoredProfilePhoto
import com.riders.rider.feature.profile.domain.loadProfilePhotoBytes
import com.riders.rider.feature.profile.domain.profilePhotoDownloadFailed
import com.riders.rider.feature.profile.domain.profilePhotoLoadDismissed
import com.riders.rider.feature.profile.domain.profilePhotoLoadFailureIsSilent
import com.riders.rider.feature.profile.domain.profilePhotoDownloadFinished
import com.riders.rider.feature.profile.domain.profilePhotoDownloadMissing
import com.riders.rider.feature.profile.domain.profilePhotoIssue
import com.riders.rider.feature.profile.domain.profilePhotoRemoveFailed
import com.riders.rider.feature.profile.domain.profilePhotoRemoveStarted
import com.riders.rider.feature.profile.domain.profilePhotoRemoved
import com.riders.rider.feature.profile.domain.profilePhotoUploadFailed
import com.riders.rider.feature.profile.domain.profilePhotoUploadStarted
import com.riders.rider.feature.profile.domain.shouldLoadProfile
import com.riders.rider.feature.profile.domain.signOutLeavesRiderOnDuty
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ProfileUi(
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val signingOut: Boolean = false,
    val savingAddress: Boolean = false,
    val addressError: String? = null,
    val savingPassword: Boolean = false,
    val passwordError: String? = null,
    val passwordSaved: Boolean = false,
    val board: ProfileBoard = ProfileBoard(),
    val photo: ProfilePhotoState = ProfilePhotoState(),
    val photoBitmap: android.graphics.Bitmap? = null,
    val photoPreview: android.graphics.Bitmap? = null,
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val verification: VerificationRepository,
    private val photos: ProfilePhotoRepository,
    private val availability: AvailabilityRepository,
    private val deliveries: ActiveDeliveryStore,
    private val assignments: AssignmentRepository,
    private val acceptKeys: DataStoreAcceptKeyStore,
    private val auth: AuthRepository,
    private val offerPush: OfferPushCoordinator,
) : ViewModel() {
    private val state = MutableStateFlow(ProfileUi())
    val ui: StateFlow<ProfileUi> = state.asStateFlow()
    private var busy = false
    private var profileVisible = false
    private var pendingPhoto: ByteArray? = null
    private val photoDownloads = ProfilePhotoDownloadGate()

    fun onProfileVisible() {
        profileVisible = true
    }

    fun onProfileHidden() {
        profileVisible = false
        state.update { current ->
            val error = profileErrorAfterLeave(current.board.error)
            if (error == current.board.error) current else current.copy(board = current.board.copy(error = error))
        }
    }

    fun refresh(force: Boolean = false) {
        if (!shouldLoadProfile(state.value.board.loaded, force, busy)) {
            return
        }
        busy = true
        val cold = state.value.board.onboarding == null && state.value.board.fullName.isBlank() && !state.value.board.loaded
        state.update { it.copy(loading = cold, refreshing = !cold) }
        viewModelScope.launch {
            try {
                val profile = verification.profile(shareInFlight = !force)
                val onboard = verification.onboarding(shareInFlight = !force)
                val motorcycles = verification.motorcycles()
                val reported = profileRefreshError(profile, onboard, motorcycles)
                val failure = if (profileVisible) reported else profileErrorAfterLeave(reported)
                val identity = (profile as? ApiResult.Ok)?.value
                state.update { current ->
                    current.copy(
                        loading = false,
                        board = profileAfterRefresh(
                            current = current.board,
                            fullName = identity?.fullName,
                            phone = identity?.phone,
                            address = identity?.address,
                            onboarding = (onboard as? ApiResult.Ok)?.value,
                            hasLicence = null,
                            motorcycles = (motorcycles as? ApiResult.Ok)?.value,
                            hasProfilePhoto = identity?.hasProfilePhoto,
                            error = failure,
                        ),
                    )
                }
                if (identity != null) {
                    syncStoredPhoto(identity.hasProfilePhoto)
                }
            } finally {
                busy = false
                state.update { it.copy(loading = false, refreshing = false) }
            }
        }
    }

    fun saveAddress(raw: String, onSaved: () -> Unit) {
        val address = try {
            normalizeRiderAddress(raw)
        } catch (_: IllegalArgumentException) {
            state.update { it.copy(addressError = "Address is required") }
            return
        }
        if (address == state.value.board.address) {
            state.update { it.copy(addressError = null) }
            onSaved()
            return
        }
        viewModelScope.launch {
            state.update { it.copy(savingAddress = true, addressError = null) }
            when (val result = verification.updateAddress(address)) {
                is ApiResult.Ok -> {
                    state.update {
                        it.copy(
                            savingAddress = false,
                            addressError = null,
                            board = it.board.copy(address = result.value.address.orEmpty()),
                        )
                    }
                    onSaved()
                }
                is ApiResult.Err -> state.update { it.copy(savingAddress = false, addressError = result.error.text()) }
            }
        }
    }

    fun clearAddressError() {
        state.update { it.copy(addressError = null) }
    }

    fun uploadPhoto(bytes: ByteArray) {
        val issue = profilePhotoIssue(bytes)
        if (!canStartProfilePhotoAction(state.value.photo)) {
            return
        }
        if (issue != null) {
            pendingPhoto = null
            state.update { it.copy(photo = it.photo.copy(error = issue, retry = null)) }
            return
        }
        pendingPhoto = bytes
        val previous = state.value.photoBitmap
        state.update { it.copy(photo = profilePhotoUploadStarted(it.photo)) }
        viewModelScope.launch {
            val (uploadBytes, preview) = withContext(Dispatchers.IO) {
                val prepared = stripJpegMetadata(prepareProfilePhotoUpload(bytes))
                prepared to decodeProfilePhoto(prepared)
            }
            state.update { current ->
                if (current.photo.phase != ProfilePhotoPhase.Uploading) current else current.copy(photoPreview = preview)
            }
            when (val result = photos.upload(uploadBytes) { sent ->
                state.update { current ->
                    if (current.photo.phase != ProfilePhotoPhase.Uploading) {
                        current
                    } else {
                        current.copy(photo = current.photo.copy(progress = sent))
                    }
                }
            }) {
                is ApiResult.Err -> {
                    val removed = result.error is ApiError.Conflict && result.error.message == "Profile photo was removed"
                    pendingPhoto = if (removed) null else bytes
                    state.update { current ->
                        current.copy(
                            board = if (removed) current.board.copy(hasProfilePhoto = false) else current.board,
                            photo = if (removed) profilePhotoRemoved(current.photo) else profilePhotoUploadFailed(current.photo, result.error.text()),
                            photoBitmap = if (removed) null else previous,
                            photoPreview = null,
                        )
                    }
                }
                is ApiResult.Ok -> {
                    verification.invalidateDocuments()
                    pendingPhoto = null
                    state.update { current ->
                        current.copy(
                            board = current.board.copy(hasProfilePhoto = true),
                            photo = profilePhotoAwaitingStored(current.photo),
                            photoPreview = null,
                            photoBitmap = null,
                        )
                    }
                    requestStoredPhoto()
                }
            }
        }
    }

    fun removePhoto() {
        val current = state.value
        if (!current.photo.hasStoredPhoto || !canStartProfilePhotoAction(current.photo)) {
            return
        }
        val previous = current.photoBitmap
        state.update { it.copy(photo = profilePhotoRemoveStarted(it.photo)) }
        viewModelScope.launch {
            when (val result = photos.remove()) {
                is ApiResult.Err -> state.update { latest ->
                    latest.copy(
                        photo = profilePhotoRemoveFailed(latest.photo, result.error.text()),
                        photoBitmap = previous,
                        photoPreview = null,
                    )
                }
                is ApiResult.Ok -> {
                    verification.invalidateDocuments()
                    state.update { latest ->
                        latest.copy(
                            board = latest.board.copy(hasProfilePhoto = false),
                            photo = profilePhotoRemoved(latest.photo),
                            photoBitmap = null,
                            photoPreview = null,
                        )
                    }
                }
            }
        }
    }

    fun retryPhoto() {
        when (state.value.photo.retry) {
            ProfilePhotoRetry.Upload -> pendingPhoto?.let(::uploadPhoto)
            ProfilePhotoRetry.Download -> requestStoredPhoto()
            ProfilePhotoRetry.Remove -> {
                state.update { it.copy(photo = it.photo.copy(phase = ProfilePhotoPhase.Idle, retry = null)) }
                removePhoto()
            }
            null -> Unit
        }
    }

    fun reportPhoto(message: String) {
        if (!canStartProfilePhotoAction(state.value.photo)) {
            return
        }
        state.update { it.copy(photo = it.photo.copy(error = message, retry = null)) }
    }

    fun clearPrivateState() {
        viewModelScope.coroutineContext.cancelChildren()
        pendingPhoto = null
        state.value = ProfileUi()
    }

    fun logout() {
        if (state.value.signingOut) {
            return
        }
        state.update { it.copy(signingOut = true) }
        viewModelScope.launch { finishLocalSignOut() }
    }

    private suspend fun finishLocalSignOut() {
        endAvailabilityForSignOut()
        offerPush.forget()
        auth.logout()
        availability.applySharing()
        clearPrivateState()
    }

    private fun syncStoredPhoto(hasProfilePhoto: Boolean) {
        val current = state.value.photo
        val next = profilePhotoAfterAccount(current, hasProfilePhoto)
        val startDownload = next.phase == ProfilePhotoPhase.Loading && current.phase != ProfilePhotoPhase.Loading
        val cleared = !hasProfilePhoto && current.phase != ProfilePhotoPhase.Uploading && current.phase != ProfilePhotoPhase.Removing
        state.update {
            it.copy(
                photo = next,
                photoBitmap = if (cleared) null else it.photoBitmap,
                photoPreview = if (cleared) null else it.photoPreview,
            )
        }
        if (startDownload) {
            requestStoredPhoto()
        }
    }

    private fun requestStoredPhoto() {
        if (!photoDownloads.tryAcquire()) {
            return
        }
        state.update { current ->
            current.copy(photo = current.photo.copy(phase = ProfilePhotoPhase.Loading, error = null, retry = null))
        }
        viewModelScope.launch {
            try {
                downloadStoredPhoto()
            } finally {
                photoDownloads.release()
            }
        }
    }

    private suspend fun downloadStoredPhoto() {
        val currentPhoto = state.value
        val wasVisible = currentPhoto.photo.showingStored &&
            currentPhoto.photo.hasStoredPhoto &&
            currentPhoto.photoBitmap != null &&
            currentPhoto.board.hasProfilePhoto
        when (val result = loadProfilePhotoBytes { photos.download() }) {
            is ApiResult.Err -> {
                Log.w(PROFILE_PHOTO_LOG, "Profile photo could not be loaded: ${result.error.text()}")
                state.update { current ->
                if (!acceptsStoredPhoto(current.photo)) {
                    return@update current
                }
                val missing = result.error.text() == "No profile photo has been uploaded"
                val silent = !missing && profilePhotoLoadFailureIsSilent(result.error)
                val keepVisiblePhoto = !missing && !silent && keepsStoredProfilePhoto(
                    result.error,
                    wasVisible && current.photoBitmap != null && current.board.hasProfilePhoto && current.photo.hasStoredPhoto,
                )
                current.copy(
                    board = if (missing) current.board.copy(hasProfilePhoto = false) else current.board,
                    photo = when {
                        missing -> profilePhotoDownloadMissing(current.photo)
                        silent -> profilePhotoLoadDismissed(current.photo)
                        else -> profilePhotoDownloadFailed(current.photo, result.error.text(), keepVisiblePhoto)
                    },
                    photoBitmap = if (missing || silent) null else current.photoBitmap,
                    photoPreview = null,
                )
                }
            }
            is ApiResult.Ok -> {
                val bitmap = withContext(Dispatchers.IO) { decodeProfilePhoto(result.value) }
                state.update { current ->
                    if (!acceptsStoredPhoto(current.photo)) {
                        return@update current
                    }
                    if (bitmap == null) {
                        Log.w(PROFILE_PHOTO_LOG, "Profile photo could not be decoded")
                        current.copy(
                            photo = profilePhotoLoadDismissed(current.photo),
                            photoBitmap = null,
                            photoPreview = null,
                        )
                    } else {
                        current.copy(
                            board = current.board.copy(hasProfilePhoto = true),
                            photo = profilePhotoDownloadFinished(current.photo),
                            photoBitmap = bitmap,
                            photoPreview = null,
                        )
                    }
                }
            }
        }
    }

    private suspend fun endAvailabilityForSignOut() {
        val result = availability.offline()
        if (result is ApiResult.Err && signOutLeavesRiderOnDuty(result.error)) {
            return
        }
    }
}

private const val PROFILE_PHOTO_LOG = "RidersProfilePhoto"

private fun acceptsStoredPhoto(photo: ProfilePhotoState): Boolean {
    return photo.phase == ProfilePhotoPhase.Loading || photo.retry == ProfilePhotoRetry.Download
}
