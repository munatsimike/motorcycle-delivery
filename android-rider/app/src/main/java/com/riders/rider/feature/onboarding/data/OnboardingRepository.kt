package com.riders.rider.feature.onboarding.data

import com.riders.rider.core.database.OnboardingDao
import com.riders.rider.core.database.OnboardingEntity
import com.riders.rider.core.database.RiderDatabase
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.OnboardingResponse
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OnboardingRepository @Inject constructor(
    private val riders: RiderService,
    database: RiderDatabase,
) {
    private val dao: OnboardingDao = database.onboardingDao()

    suspend fun load(): ApiResult<RiderOnboarding> {
        return when (val result = apiCall { riders.onboarding() }) {
            is ApiResult.Ok -> {
                val onboarding = result.value.toDomain()
                dao.write(onboarding.toEntity())
                ApiResult.Ok(onboarding)
            }
            is ApiResult.Err -> {
                val cached = dao.read()?.toDomain()
                if (cached != null && result.error is ApiError.Network) {
                    ApiResult.Ok(cached)
                } else {
                    result
                }
            }
        }
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
    )
}

private fun RiderOnboarding.toEntity(): OnboardingEntity {
    return OnboardingEntity(
        licenceVerificationStatus = licenceVerificationStatus,
        approvalStatus = approvalStatus,
        availability = availability,
        licenceNumber = licenceNumber,
        licenceClass = licenceClass,
        rejectionReason = rejectionReason,
        verifiedMotorcycleCount = verifiedMotorcycleCount,
        activeVerifiedMotorcycle = activeVerifiedMotorcycle,
    )
}

private fun OnboardingEntity.toDomain(): RiderOnboarding {
    return RiderOnboarding(
        licenceVerificationStatus,
        approvalStatus,
        availability,
        licenceNumber,
        licenceClass,
        rejectionReason,
        verifiedMotorcycleCount,
        activeVerifiedMotorcycle,
    )
}
