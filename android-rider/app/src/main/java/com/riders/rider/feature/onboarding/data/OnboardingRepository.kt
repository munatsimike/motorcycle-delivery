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
    private var receivingKnown = false
    private var knownReceiving: Boolean? = null

    suspend fun load(): ApiResult<RiderOnboarding> {
        return when (val result = readCurrent()) {
            is ApiResult.Ok -> result
            is ApiResult.Err -> {
                val cached = dao.read()?.toDomain()?.withKnownReceiving()
                if (cached != null && result.error is ApiError.Network) {
                    ApiResult.Ok(cached)
                } else {
                    result
                }
            }
        }
    }

    suspend fun loadCurrent(): ApiResult<RiderOnboarding> = readCurrent()

    private suspend fun readCurrent(): ApiResult<RiderOnboarding> {
        return when (val result = apiCall { riders.onboarding() }) {
            is ApiResult.Ok -> {
                receivingKnown = true
                knownReceiving = result.value.receiving
                val onboarding = result.value.toDomain()
                dao.write(onboarding.toEntity())
                ApiResult.Ok(onboarding)
            }
            is ApiResult.Err -> result
        }
    }

    private fun RiderOnboarding.withKnownReceiving(): RiderOnboarding {
        return if (receivingKnown) copy(receiving = knownReceiving) else this
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
