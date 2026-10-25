package com.riders.rider.feature.auth.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.AuthService
import com.riders.rider.core.network.RefreshRequest
import com.riders.rider.core.network.RiderWhatsAppRegistrationRequest
import com.riders.rider.core.network.WhatsAppRecoveryRequest
import com.riders.rider.core.network.PhoneRequest
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

data class AddressMatch(val label: String, val placeId: String)

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
    suspend fun startWhatsAppLogin(phone: String): ApiResult<LoginStart> {
        val result = apiCall(establishedSession = false) {
            auth.startWhatsAppLogin(WhatsAppRecoveryRequest(phone, whatsappConsent = true))
        }
        return when (result) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> when (result.value.status) {
                "pending" -> ApiResult.Ok(LoginStart.CodeSent)
                "unavailable" -> ApiResult.Ok(LoginStart.AccountMissing)
                else -> ApiResult.Err(ApiError.Validation("Verification could not be started."))
            }
        }
    }

    suspend fun verify(flow: String, phone: String, code: String): ApiResult<VerifyOutcome> {
        val call = when (flow) {
            "whatsapp", "registration" -> suspend { auth.verifyWhatsAppRegistration(VerifyRequest(phone, code)) }
            "whatsapp_login", "login" -> suspend { auth.verifyWhatsAppLogin(VerifyRequest(phone, code)) }
            else -> return ApiResult.Err(ApiError.Validation("Verification code is invalid"))
        }
        return when (val result = apiCall(establishedSession = false) { call() }) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> saveSession(result.value)
        }
    }

    suspend fun searchAddresses(text: String, sessionToken: String): ApiResult<List<AddressMatch>> {
        return apiCall(establishedSession = false) {
            auth.searchPlaces(text, sessionToken).suggestions.mapNotNull { item ->
                val label = item.label.trim()
                val placeId = item.placeId.trim()
                if (label.isEmpty() || placeId.isEmpty()) null else AddressMatch(label, placeId)
            }.take(10)
        }
    }

    suspend fun resolveAddress(placeId: String, sessionToken: String): ApiResult<String> {
        return apiCall(establishedSession = false) {
            auth.placeDetail(placeId, sessionToken).label.trim()
        }
    }

    suspend fun registerWithPassword(
        phone: String,
        fullName: String,
        address: String,
    ): ApiResult<Unit> {
        return apiCall(establishedSession = false) {
            auth.startWhatsAppRegistration(RiderWhatsAppRegistrationRequest(
                phone,
                fullName,
                address,
                whatsappConsent = true,
            ))
        }.map { Unit }
    }

    suspend fun requestLogin(phone: String): ApiResult<LoginStart> = startWhatsAppLogin(phone)

    suspend fun resendWhatsAppRegistration(phone: String): ApiResult<Unit> = resend("whatsapp", phone)

    suspend fun resend(flow: String, phone: String): ApiResult<Unit> {
        val call = when (flow) {
            "whatsapp_login", "login" -> suspend { auth.resendWhatsAppLogin(PhoneRequest(phone)) }
            else -> suspend { auth.resendWhatsAppRegistration(PhoneRequest(phone)) }
        }
        return apiCall(establishedSession = false) { call() }.map { Unit }
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
        return ApiResult.Err(ApiError.Validation("Verify your phone number on WhatsApp to create an account"))
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
