package com.riders.rider.feature.onboarding.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.OnboardingResponse
import com.riders.rider.core.network.RiderReadRequests
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OnboardingRepository @Inject constructor(
    private val reads: RiderReadRequests,
    private val riders: RiderService,
) {
    suspend fun load(): ApiResult<RiderOnboarding> = loadCurrent()

    suspend fun loadCurrent(shareInFlight: Boolean = false): ApiResult<RiderOnboarding> =
        when (val result = if (shareInFlight) reads.onboarding() else apiCall { riders.onboarding() }) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.toDomain())
            is ApiResult.Err -> result
        }
}

private fun OnboardingResponse.toDomain(): RiderOnboarding {
    return RiderOnboarding(
        licenceVerificationStatus = licenceVerificationStatus,
        approvalStatus = approvalStatus,
        availability = availability,
        licenceNumber = licenceNumber,
        licenceClass = licenceClass,
        rejectionReason = rejectionReason,
        verifiedMotorcycleCount = verifiedMotorcycleCount,
        activeVerifiedMotorcycle = activeVerifiedMotorcycle,
        receiving = receiving,
    )
}
