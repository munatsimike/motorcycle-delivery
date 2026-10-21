package com.riders.rider.feature.auth.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.AuthService
import com.riders.rider.BuildConfig
import com.riders.rider.core.network.PhoneRequest
import com.riders.rider.core.network.RegistrationVerifyResponse
import com.riders.rider.core.network.RiderAccountRequest
import com.riders.rider.core.network.RiderRegistrationRequest
import com.riders.rider.core.network.SessionResponse
import com.riders.rider.core.network.VerifyRequest
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.SessionStorageException
import com.riders.rider.core.session.AuthSession
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.auth.domain.BiometricPreference
import com.riders.rider.feature.auth.domain.MemoryBiometricPreference
import com.riders.rider.feature.auth.domain.registrationFullName
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class LogoutAllAttempt(
    val confirmed: Boolean,
    val httpCode: Int?,
)

sealed class LoginStart {
    data object CodeSent : LoginStart()
    data object AccountMissing : LoginStart()
}

sealed class VerifyOutcome {
    data object SignedIn : VerifyOutcome()

    data object UseExistingLogin : VerifyOutcome()

    data class NeedsAccount(
        val registrationToken: String,
        val fullName: String? = null,
        val address: String? = null,
        val lockDetails: Boolean = false,
    ) : VerifyOutcome()
}

@Singleton
class AuthRepository @Inject constructor(
    private val auth: AuthService,
    private val sessions: SessionStore,
    private val biometrics: BiometricPreference = MemoryBiometricPreference(),
) {
    suspend fun requestLogin(phone: String): ApiResult<LoginStart> {
        return when (val result = apiCall(establishedSession = false) { auth.requestLogin(PhoneRequest(phone)) }) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> when (result.value.status) {
                "pending" -> ApiResult.Ok(LoginStart.CodeSent)
                "unavailable" -> ApiResult.Ok(LoginStart.AccountMissing)
                else -> ApiResult.Err(ApiError.Validation("Sign in could not be started."))
            }
        }
    }

    suspend fun requestRegistration(phone: String): ApiResult<Unit> {
        val body = RiderRegistrationRequest(phone, registrationFullName(BuildConfig.DEBUG))
        return apiCall(establishedSession = false) { auth.requestRegistration(body) }.map { Unit }
    }

    suspend fun verify(flow: String, phone: String, code: String): ApiResult<VerifyOutcome> {
        if (flow == "registration") {
            return when (val result = apiCall(establishedSession = false) { auth.verifyRegistration(VerifyRequest(phone, code)) }) {
                is ApiResult.Err -> result
                is ApiResult.Ok -> registrationVerified(result.value)
            }
        }
        return when (val result = apiCall(establishedSession = false) { auth.verifyLogin(VerifyRequest(phone, code)) }) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> saveSession(result.value)
        }
    }

    suspend fun completeRegistration(token: String, fullName: String, address: String): ApiResult<VerifyOutcome> {
        val result = apiCall(establishedSession = false) {
            auth.completeRegistration(RiderAccountRequest(token, fullName, address))
        }
        return when (result) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> saveSession(result.value)
        }
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

    suspend fun requestLogoutAll(): LogoutAllAttempt {
        return try {
            val response = auth.logoutAll()
            LogoutAllAttempt(confirmed = response.isSuccessful, httpCode = response.code())
        } catch (_: Exception) {
            LogoutAllAttempt(confirmed = false, httpCode = null)
        }
    }

    private suspend fun saveSession(session: SessionResponse): ApiResult<VerifyOutcome> {
        val saved = withContext(Dispatchers.IO) { sessions.write(session.toSession()) }
        if (!saved) {
            return ApiResult.Err(ApiError.Unexpected(SessionStorageException.MESSAGE))
        }
        return ApiResult.Ok(VerifyOutcome.SignedIn)
    }

    private suspend fun registrationVerified(response: RegistrationVerifyResponse): ApiResult<VerifyOutcome> {
        if (response.status == "sign_in") {
            return ApiResult.Ok(VerifyOutcome.UseExistingLogin)
        }
        val token = response.registrationToken?.takeIf { it.isNotBlank() }
        if (token != null) {
            val locked = response.readOnly.contains("fullName")
            return ApiResult.Ok(VerifyOutcome.NeedsAccount(
                registrationToken = token,
                fullName = response.fullName,
                address = response.address,
                lockDetails = locked,
            ))
        }
        val session = response.sessionOrNull() ?: return ApiResult.Err(ApiError.Validation("Authentication failed"))
        return saveSession(session)
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
