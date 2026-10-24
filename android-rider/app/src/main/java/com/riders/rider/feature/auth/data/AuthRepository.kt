package com.riders.rider.feature.auth.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.AuthService
import com.riders.rider.BuildConfig
import com.riders.rider.core.network.PasswordLoginRequest
import com.riders.rider.core.network.PasswordResetRequest
import com.riders.rider.core.network.RefreshRequest
import com.riders.rider.core.network.RiderWhatsAppRegistrationRequest
import com.riders.rider.core.network.WhatsAppRecoveryRequest
import com.riders.rider.core.network.PhoneRequest
import com.riders.rider.core.network.RegistrationVerifyResponse
import com.riders.rider.core.network.RiderAccountRequest
import com.riders.rider.core.network.RiderRegistrationRequest
import com.riders.rider.core.network.SetPasswordRequest
import com.riders.rider.core.network.SessionResponse
import com.riders.rider.core.network.VerifyRequest
import com.riders.rider.core.network.apiCall
import com.riders.rider.core.network.mapHttpFailure
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
        if (flow == "whatsapp") {
            return when (val result = apiCall(establishedSession = false) { auth.verifyWhatsAppRegistration(VerifyRequest(phone, code)) }) {
                is ApiResult.Err -> result
                is ApiResult.Ok -> saveSession(result.value)
            }
        }
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

    suspend fun loginWithPassword(phone: String, password: String): ApiResult<VerifyOutcome> {
        val result = apiCall(establishedSession = false) {
            auth.loginWithPassword(PasswordLoginRequest(phone, password))
        }
        return when (result) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> saveSession(result.value)
        }
    }

    suspend fun registerWithPassword(
        phone: String,
        password: String,
        fullName: String,
        address: String,
    ): ApiResult<Unit> {
        return apiCall(establishedSession = false) {
            auth.startWhatsAppRegistration(RiderWhatsAppRegistrationRequest(
                phone,
                password,
                fullName,
                address,
                whatsappConsent = true,
            ))
        }.map { Unit }
    }

    suspend fun resendWhatsAppRegistration(phone: String): ApiResult<Unit> {
        return apiCall(establishedSession = false) { auth.resendWhatsAppRegistration(PhoneRequest(phone)) }.map { Unit }
    }

    suspend fun requestPasswordReset(phone: String): ApiResult<Unit> {
        return apiCall(establishedSession = false) {
            auth.forgotPassword(WhatsAppRecoveryRequest(phone, whatsappConsent = true))
        }.map { Unit }
    }

    suspend fun resetPassword(phone: String, code: String, password: String): ApiResult<Unit> {
        val result = apiCall(establishedSession = false) {
            auth.resetPassword(PasswordResetRequest(phone, code, password))
        }
        return when (result) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> {
                val response = result.value
                if (!response.isSuccessful) {
                    ApiResult.Err(mapHttpFailure(response.code(), response.errorBody()?.string(), establishedSession = false))
                } else {
                    sessions.clear()
                    biometrics.clear()
                    ApiResult.Ok(Unit)
                }
            }
        }
    }

    suspend fun confirmStoredSession(): ApiResult<Unit> {
        val current = sessions.read() ?: return ApiResult.Err(ApiError.SessionEnded)
        return when (val refreshed = apiCall { auth.refresh(RefreshRequest(current.refreshToken)) }) {
            is ApiResult.Err -> {
                if (refreshed.error == ApiError.SessionEnded) {
                    sessions.clear()
                }
                refreshed
            }
            is ApiResult.Ok -> when (val saved = saveSession(refreshed.value)) {
                is ApiResult.Ok -> ApiResult.Ok(Unit)
                is ApiResult.Err -> saved
            }
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

    suspend fun setPassword(password: String, currentPassword: String?): ApiResult<Unit> {
        val refreshToken = sessions.read()?.refreshToken?.takeIf { it.isNotBlank() }
            ?: return ApiResult.Err(ApiError.Validation("Authentication failed"))
        val result = apiCall(establishedSession = false) {
            auth.setPassword(SetPasswordRequest(
                password,
                currentPassword?.takeIf { it.isNotBlank() },
                refreshToken,
            ))
        }
        return when (result) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> {
                val response = result.value
                if (response.isSuccessful) {
                    ApiResult.Ok(Unit)
                } else {
                    ApiResult.Err(mapHttpFailure(response.code(), response.errorBody()?.string(), establishedSession = false))
                }
            }
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
