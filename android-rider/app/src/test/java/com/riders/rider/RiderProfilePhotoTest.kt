package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.profile.domain.PROFILE_PHOTO_MAX_BYTES
import com.riders.rider.feature.profile.domain.ProfilePhotoDownloadGate
import com.riders.rider.feature.profile.domain.ProfilePhotoPhase
import com.riders.rider.feature.profile.domain.ProfilePhotoRetry
import com.riders.rider.feature.profile.domain.ProfilePhotoState
import com.riders.rider.feature.profile.domain.canStartProfilePhotoAction
import com.riders.rider.feature.profile.domain.profileAfterRefresh
import com.riders.rider.feature.profile.domain.displayedProfilePhoto
import com.riders.rider.feature.profile.domain.keepsStoredProfilePhoto
import com.riders.rider.feature.profile.domain.loadProfilePhotoBytes
import com.riders.rider.feature.profile.domain.profilePhotoAfterAccount
import com.riders.rider.feature.profile.domain.profilePhotoAwaitingStored
import com.riders.rider.feature.profile.domain.profilePhotoDownloadFailed
import com.riders.rider.feature.profile.domain.profilePhotoLoadDismissed
import com.riders.rider.feature.profile.domain.profilePhotoLoadFailureIsSilent
import com.riders.rider.feature.profile.domain.profilePhotoIssue
import com.riders.rider.feature.profile.domain.profilePhotoRemoveFailed
import com.riders.rider.feature.profile.domain.profilePhotoRemoveStarted
import com.riders.rider.feature.profile.domain.profilePhotoRemoved
import com.riders.rider.feature.profile.domain.profilePhotoSampleSize
import com.riders.rider.feature.profile.domain.profilePhotoUploadFailed
import com.riders.rider.feature.profile.domain.profilePhotoDownloadFinished
import com.riders.rider.feature.profile.domain.profilePhotoUploadStarted
import com.riders.rider.feature.profile.domain.ProfileBoard
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderProfilePhotoTest {
    @Test
    fun profilePhotoValidationStaysSeparateFromLicenceWording() {
        assertEquals("Choose a profile photo", profilePhotoIssue(ByteArray(0)))
        assertEquals("Profile photo is too large", profilePhotoIssue(ByteArray(PROFILE_PHOTO_MAX_BYTES + 1)))
        assertEquals(
            "Profile photo must be a JPEG, PNG, or WebP file",
            profilePhotoIssue(byteArrayOf('G'.code.toByte(), 'I'.code.toByte(), 'F'.code.toByte())),
        )
        assertNull(profilePhotoIssue(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())))
    }

    @Test
    fun sampleSizeDownscalesWithoutEnlarging() {
        assertEquals(1, profilePhotoSampleSize(800, 600))
        assertEquals(1, profilePhotoSampleSize(1024, 100))
        assertEquals(2, profilePhotoSampleSize(1025, 100))
        assertEquals(4, profilePhotoSampleSize(4000, 3000))
    }

    @Test
    fun failedUploadRestoresThePreviousPhotoAndCanRetry() {
        val stored = ProfilePhotoState(hasStoredPhoto = true, showingStored = true)
        val uploading = profilePhotoUploadStarted(stored)
        assertFalse(canStartProfilePhotoAction(uploading))
        assertTrue(uploading.showingPreview)
        val failed = profilePhotoUploadFailed(uploading, "Network request failed. Check your connection and try again.")
        assertEquals(ProfilePhotoPhase.Idle, failed.phase)
        assertTrue(failed.showingStored)
        assertFalse(failed.showingPreview)
        assertEquals(ProfilePhotoRetry.Upload, failed.retry)
        assertTrue(canStartProfilePhotoAction(failed))
    }

    @Test
    fun successfulUploadWaitsForTheStoredImage() {
        val waiting = profilePhotoAwaitingStored(profilePhotoUploadStarted(ProfilePhotoState()))
        assertEquals(ProfilePhotoPhase.Loading, waiting.phase)
        assertTrue(waiting.hasStoredPhoto)
        assertFalse(waiting.showingPreview)
        assertFalse(waiting.showingStored)
        val failedFetch = profilePhotoDownloadFailed(waiting, "Your session has ended. Sign in again.")
        assertEquals(ProfilePhotoRetry.Download, failedFetch.retry)
        assertFalse(failedFetch.showingPreview)
    }

    @Test
    fun removalClearsThePhotoAndARunningUploadIgnoresAccountRefresh() {
        val uploading = profilePhotoUploadStarted(ProfilePhotoState(hasStoredPhoto = true, showingStored = true))
        val duringUpload = profilePhotoAfterAccount(uploading, hasProfilePhoto = false)
        assertEquals(ProfilePhotoPhase.Uploading, duringUpload.phase)
        assertTrue(duringUpload.showingPreview)
        val stored = ProfilePhotoState(hasStoredPhoto = true, showingStored = true)
        val removing = profilePhotoRemoveStarted(stored)
        assertEquals(ProfilePhotoPhase.Removing, removing.phase)
        assertTrue(removing.hasStoredPhoto)
        assertFalse(canStartProfilePhotoAction(removing))
        val failedRemoval = profilePhotoRemoveFailed(removing, "Profile photo could not be removed")
        assertEquals(ProfilePhotoPhase.Idle, failedRemoval.phase)
        assertEquals(ProfilePhotoRetry.Remove, failedRemoval.retry)
        assertTrue(canStartProfilePhotoAction(failedRemoval))
        val removed = profilePhotoRemoved(stored)
        assertFalse(removed.hasStoredPhoto)
        assertFalse(removed.showingStored)
        assertEquals(ProfilePhotoPhase.Idle, removed.phase)
    }

    @Test
    fun accountRefreshLoadsAPhotoOnceAndKeepsTheExistingFlagWhenOmitted() {
        val loading = profilePhotoAfterAccount(ProfilePhotoState(), hasProfilePhoto = true)
        assertEquals(ProfilePhotoPhase.Loading, loading.phase)
        val stillLoading = profilePhotoAfterAccount(loading, hasProfilePhoto = true)
        assertEquals(ProfilePhotoPhase.Loading, stillLoading.phase)
        val board = profileAfterRefresh(
            ProfileBoard(fullName = "Test Rider", hasProfilePhoto = true, loaded = true),
            null,
            null,
            null,
            null,
            null,
            "Network request failed. Check your connection and try again.",
        )
        assertTrue(board.hasProfilePhoto)
        assertEquals("Test Rider", board.fullName)
    }

    @Test
    fun profilePhotoDownloadSucceedsOnTheFirstAttempt() = runBlocking {
        var calls = 0
        val result = loadProfilePhotoBytes {
            calls += 1
            ApiResult.Ok(byteArrayOf(1))
        }
        assertEquals(1, calls)
        assertTrue(result is ApiResult.Ok)
    }

    @Test
    fun profilePhotoDownloadRetriesOneNetworkFailureWithoutPublishingIt() = runBlocking {
        var calls = 0
        val result = loadProfilePhotoBytes {
            calls += 1
            if (calls == 1) ApiResult.Err(ApiError.Network) else ApiResult.Ok(byteArrayOf(1))
        }
        assertEquals(2, calls)
        assertTrue(result is ApiResult.Ok)
    }

    @Test
    fun profilePhotoDownloadFallsBackToInitialsAfterTwoNetworkFailures() = runBlocking {
        var calls = 0
        val result = loadProfilePhotoBytes {
            calls += 1
            ApiResult.Err(ApiError.Network)
        }
        assertEquals(2, calls)
        val error = (result as ApiResult.Err).error
        assertTrue(profilePhotoLoadFailureIsSilent(error))
        val visible = ProfilePhotoState(hasStoredPhoto = true, showingStored = true, phase = ProfilePhotoPhase.Loading)
        val failed = profilePhotoLoadDismissed(visible)
        assertNull(failed.error)
        assertNull(failed.retry)
        assertFalse(failed.showingStored)
        assertNull(displayedProfilePhoto(failed, "photo", null))
        assertFalse(profilePhotoLoadFailureIsSilent(ApiError.SessionEnded))
        val session = profilePhotoDownloadFailed(visible, ApiError.SessionEnded.text())
        assertEquals(ApiError.SessionEnded.text(), session.error)
        assertEquals(ProfilePhotoRetry.Download, session.retry)
    }

    @Test
    fun profilePhotoDownloadDoesNotRetryHttpSessionOrDecodeFailures() = runBlocking {
        val errors = listOf(
            ApiError.Timeout,
            ApiError.SessionEnded,
            ApiError.SessionUncertain,
            ApiError.Unexpected("No profile photo has been uploaded"),
            ApiError.Unexpected("Profile photo could not be loaded"),
        )
        errors.forEach { error ->
            var calls = 0
            val result = loadProfilePhotoBytes {
                calls += 1
                ApiResult.Err(error)
            }
            assertEquals(1, calls)
            assertEquals(error, (result as ApiResult.Err).error)
            assertFalse(keepsStoredProfilePhoto(error, wasVisible = true))
        }
    }

    @Test
    fun profilePhotoDownloadIgnoresASecondRequestWhileOneIsRunning() {
        val gate = ProfilePhotoDownloadGate()
        assertTrue(gate.tryAcquire())
        assertFalse(gate.tryAcquire())
        gate.release()
        assertTrue(gate.tryAcquire())
    }

    @Test
    fun theSameStoredPhotoIsShownOnHomeAndProfile() {
        val stored = profilePhotoDownloadFinished(profilePhotoAfterAccount(ProfilePhotoState(), hasProfilePhoto = true))
        assertEquals("photo", displayedProfilePhoto(stored, "photo", null))
        val preview = profilePhotoUploadStarted(stored)
        assertEquals("preview", displayedProfilePhoto(preview, "photo", "preview"))
        assertNull(displayedProfilePhoto(profilePhotoRemoved(stored), "photo", "preview"))
        assertNull(displayedProfilePhoto(ProfilePhotoState(), null, null))
    }
}
