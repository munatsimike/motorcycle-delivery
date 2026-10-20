package com.riders.rider.feature.auth.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.AuthService
import com.riders.rider.core.network.PhoneRequest
import com.riders.rider.core.network.RegisterRequest
import com.riders.rider.core.network.SessionResponse
import com.riders.rider.core.network.VerifyRequest
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.SessionStorageException
import com.riders.rider.core.session.AuthSession
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.auth.domain.BiometricPreference
import com.riders.rider.feature.auth.domain.MemoryBiometricPreference
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Singleton
class AuthRepository @Inject constructor(
    private val auth: AuthService,
    private val sessions: SessionStore,
    private val biometrics: BiometricPreference = MemoryBiometricPreference(),
) {
    suspend fun requestLogin(phone: String): ApiResult<Unit> {
        return apiCall(establishedSession = false) { auth.requestLogin(PhoneRequest(phone)) }.map { Unit }
    }

    suspend fun requestRegistration(phone: String, fullName: String): ApiResult<Unit> {
        return apiCall(establishedSession = false) { auth.requestRegistration(RegisterRequest(phone, fullName)) }.map { Unit }
    }

    suspend fun verify(flow: String, phone: String, code: String): ApiResult<Unit> {
        val result = apiCall(establishedSession = false) {
            if (flow == "registration") {
                auth.verifyRegistration(VerifyRequest(phone, code))
            } else {
                auth.verifyLogin(VerifyRequest(phone, code))
            }
        }
        if (result is ApiResult.Ok) {
            val saved = withContext(Dispatchers.IO) { sessions.write(result.value.toSession()) }
            if (!saved) {
                return ApiResult.Err(ApiError.Unexpected(SessionStorageException.MESSAGE))
            }
        }
        return result.map { Unit }
    }

    suspend fun logout() {
        try {
            auth.logout()
        } catch (_: Exception) {
            // Local sign-out still clears the session when the server cannot be reached.
        }
        sessions.clear()
        biometrics.clear()
    }
}

private fun SessionResponse.toSession(): AuthSession {
    return AuthSession(accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt)
}

private fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> {
    return when (this) {
        is ApiResult.Ok -> ApiResult.Ok(transform(value))
        is ApiResult.Err -> this
    }
}
