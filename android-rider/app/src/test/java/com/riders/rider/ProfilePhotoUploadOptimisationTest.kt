package com.riders.rider

import com.riders.rider.feature.profile.domain.PROFILE_PHOTO_MAX_BYTES
import com.riders.rider.feature.profile.domain.profilePhotoUploadSize
import com.riders.rider.feature.profile.domain.smallerProfilePhotoJpeg
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class ProfilePhotoUploadOptimisationTest {
    @Test fun largePhotosKeepAspectRatioAndNeverUpscale() {
        assertEquals(1024 to 768, profilePhotoUploadSize(4000, 3000, 2_000_000))
        assertEquals(768 to 1024, profilePhotoUploadSize(3000, 4000, 2_000_000))
        assertNull(profilePhotoUploadSize(1024, 768, 2_000_000))
        assertNull(profilePhotoUploadSize(4000, 3000, 200_000))
    }

    @Test fun invalidOrOversizedInputsStayOnOriginalValidationPath() {
        assertNull(profilePhotoUploadSize(0, 4000, 2_000_000))
        assertNull(profilePhotoUploadSize(8001, 4000, 2_000_000))
        assertNull(profilePhotoUploadSize(4000, 3000, PROFILE_PHOTO_MAX_BYTES + 1))
    }

    @Test fun onlyMeaningfullySmallerJpegReplacesOriginal() {
        val original = jpeg(100)
        val smaller = jpeg(90)
        assertSame(smaller, smallerProfilePhotoJpeg(original, smaller))
        assertSame(original, smallerProfilePhotoJpeg(original, jpeg(91)))
        assertSame(original, smallerProfilePhotoJpeg(original, ByteArray(20)))
        assertSame(original, smallerProfilePhotoJpeg(original, null))
        val nonJpeg = ByteArray(100)
        assertSame(nonJpeg, smallerProfilePhotoJpeg(nonJpeg, smaller))
    }

    private fun jpeg(size: Int) = ByteArray(size).apply {
        this[0] = 0xff.toByte()
        this[1] = 0xd8.toByte()
        this[2] = 0xff.toByte()
    }
}
