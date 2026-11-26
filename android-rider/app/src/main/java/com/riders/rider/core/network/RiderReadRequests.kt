package com.riders.rider.core.network

import com.riders.rider.core.session.AuthSession
import com.riders.rider.core.session.SessionStore
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RiderReadRequests @Inject constructor(
    private val riders: RiderService,
    private val sessions: SessionStore,
) {
    private val onboardingRead = InFlightRead<AuthSession?, ApiResult<OnboardingResponse>>()
    private val profileRead = InFlightRead<AuthSession?, ApiResult<RiderProfileResponse>>()

    suspend fun onboarding(): ApiResult<OnboardingResponse> =
        onboardingRead.read(sessions.read()) { apiCall { riders.onboarding() } }

    suspend fun profile(): ApiResult<RiderProfileResponse> =
        profileRead.read(sessions.read()) { apiCall { riders.profile() } }
}
