package com.riders.rider

import com.riders.rider.feature.profile.domain.PROFILE_PHOTO_MAX_BYTES
import com.riders.rider.feature.profile.domain.ProfilePhotoPhase
import com.riders.rider.feature.profile.domain.ProfilePhotoRetry
import com.riders.rider.feature.profile.domain.ProfilePhotoState
import com.riders.rider.feature.profile.domain.canStartProfilePhotoAction
import com.riders.rider.feature.profile.domain.profileAfterRefresh
import com.riders.rider.feature.profile.domain.profilePhotoAfterAccount
import com.riders.rider.feature.profile.domain.profilePhotoAwaitingStored
import com.riders.rider.feature.profile.domain.profilePhotoDownloadFailed
import com.riders.rider.feature.profile.domain.profilePhotoIssue
import com.riders.rider.feature.profile.domain.profilePhotoRemoved
import com.riders.rider.feature.profile.domain.profilePhotoSampleSize
import com.riders.rider.feature.profile.domain.profilePhotoUploadFailed
import com.riders.rider.feature.profile.domain.profilePhotoUploadStarted
import com.riders.rider.feature.profile.domain.ProfileBoard
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
        val removed = profilePhotoRemoved(ProfilePhotoState(hasStoredPhoto = true, showingStored = true))
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
}
