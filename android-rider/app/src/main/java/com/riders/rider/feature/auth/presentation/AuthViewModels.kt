package com.riders.rider.feature.auth.presentation

import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.auth.data.AuthRepository
import com.riders.rider.feature.auth.data.BiometricAuthResult
import com.riders.rider.feature.auth.data.BiometricAuthenticator
import com.riders.rider.feature.auth.data.BiometricCapability
import com.riders.rider.feature.auth.data.BiometricRequest
import com.riders.rider.feature.auth.domain.AppEntry
import com.riders.rider.feature.auth.domain.BiometricPreference
import com.riders.rider.feature.auth.domain.BiometricSessionState
import com.riders.rider.feature.auth.domain.biometricHomeAction
import com.riders.rider.feature.auth.domain.initialBiometricState
import com.riders.rider.feature.auth.domain.normalizeRiderName
import com.riders.rider.feature.auth.domain.normalizeRiderPhone
import com.riders.rider.feature.auth.domain.reduceSession
import com.riders.rider.feature.auth.domain.resolveAppEntry
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class FormState(val loading: Boolean = false, val error: String? = null, val completedPhone: String? = null)

@HiltViewModel
class SignInViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {
    private val state = MutableStateFlow(FormState())
    val ui: StateFlow<FormState> = state.asStateFlow()

    fun submit(phone: String) {
        val normalized = try {
            normalizeRiderPhone(phone)
        } catch (error: IllegalArgumentException) {
            state.value = FormState(error = error.message)
            return
        }
        viewModelScope.launch {
            state.value = FormState(loading = true)
            state.value = when (val result = auth.requestLogin(normalized)) {
                is ApiResult.Ok -> FormState(completedPhone = normalized)
                is ApiResult.Err -> FormState(error = result.error.text())
            }
        }
    }
}

@HiltViewModel
class RegisterViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {
    private val state = MutableStateFlow(FormState())
    val ui: StateFlow<FormState> = state.asStateFlow()

    fun submit(name: String, phone: String) {
        val normalizedName = try {
            normalizeRiderName(name)
        } catch (error: IllegalArgumentException) {
            state.value = FormState(error = error.message)
            return
        }
        val normalizedPhone = try {
            normalizeRiderPhone(phone)
        } catch (error: IllegalArgumentException) {
            state.value = FormState(error = error.message)
            return
        }
        viewModelScope.launch {
            state.value = FormState(loading = true)
            state.value = when (val result = auth.requestRegistration(normalizedPhone, normalizedName)) {
                is ApiResult.Ok -> FormState(completedPhone = normalizedPhone)
                is ApiResult.Err -> FormState(error = result.error.text())
            }
        }
    }
}

@HiltViewModel
class OtpViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {
    private val state = MutableStateFlow(FormState())
    val ui: StateFlow<FormState> = state.asStateFlow()

    fun submit(flow: String, phone: String, code: String) {
        if (!Regex("^\\d{4,10}$").matches(code)) {
            state.value = FormState(error = "Verification code is invalid")
            return
        }
        viewModelScope.launch {
            state.value = FormState(loading = true)
            state.value = when (val result = auth.verify(flow, phone, code)) {
                is ApiResult.Ok -> FormState(completedPhone = phone)
                is ApiResult.Err -> FormState(error = result.error.text())
            }
        }
    }
}

data class SessionUi(
    val entry: AppEntry = AppEntry.SignedOut,
    val canUnlock: Boolean = false,
    val biometricAction: String? = null,
    val error: String? = null,
    val working: Boolean = false,
)

@HiltViewModel
class SessionViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val sessions: SessionStore,
    private val biometrics: BiometricPreference,
    private val capability: BiometricCapability,
    private val authenticator: BiometricAuthenticator,
) : ViewModel() {
    private val state = MutableStateFlow(SessionUi())
    val ui: StateFlow<SessionUi> = state.asStateFlow()
    private var process: BiometricSessionState = initialBiometricState(sessions.read() != null)
    private var promptOpen = false

    init {
        publish()
        viewModelScope.launch {
            sessions.session.collect { session ->
                process = reduceSession(process, session != null)
                publish()
            }
        }
    }

    fun unlock(activity: FragmentActivity) {
        authenticate(activity, UNLOCK) { result ->
            when (result) {
                BiometricAuthResult.Success -> {
                    process = process.copy(unlocked = true)
                    state.value = state.value.copy(error = null)
                    publish()
                }
                BiometricAuthResult.Cancelled -> show("Biometric unlock was cancelled.")
                is BiometricAuthResult.Unavailable -> show(result.message)
                is BiometricAuthResult.Error -> show(result.message)
            }
        }
    }

    fun enable(activity: FragmentActivity) {
        authenticate(activity, ENABLE) { result ->
            when (result) {
                BiometricAuthResult.Success -> {
                    biometrics.enable()
                    process = process.copy(freshSignIn = false, unlocked = true)
                    state.value = state.value.copy(error = null)
                    publish()
                }
                BiometricAuthResult.Cancelled -> show("Biometric sign-in was cancelled.")
                is BiometricAuthResult.Unavailable -> show(result.message)
                is BiometricAuthResult.Error -> show(result.message)
            }
        }
    }

    fun decline() {
        biometrics.decline()
        process = process.copy(freshSignIn = false, unlocked = true)
        state.value = state.value.copy(error = null)
        publish()
    }

    fun disableBiometric() {
        biometrics.disable()
        publish()
    }

    fun onHomeBiometric(activity: FragmentActivity) {
        if (biometrics.isEnabled()) {
            disableBiometric()
        } else {
            enable(activity)
        }
    }

    fun usePhoneNumber() {
        if (state.value.working) {
            return
        }
        state.value = state.value.copy(working = true, error = null)
        viewModelScope.launch { auth.logout() }
    }

    private fun authenticate(
        activity: FragmentActivity,
        request: BiometricRequest,
        onResult: (BiometricAuthResult) -> Unit,
    ) {
        if (promptOpen || state.value.working) {
            return
        }
        promptOpen = true
        state.value = state.value.copy(working = true, error = null)
        try {
            authenticator.authenticate(activity, request) { result ->
                promptOpen = false
                onResult(result)
            }
        } catch (_: Exception) {
            promptOpen = false
            show("Biometric unlock is not available on this phone.")
        }
    }

    private fun show(message: String) {
        state.value = state.value.copy(working = false, error = message)
    }

    private fun publish() {
        val available = capability.strongBiometricAvailable()
        val enabled = biometrics.isEnabled()
        val hasSession = sessions.read() != null
        val entry = resolveAppEntry(
            hasSession = hasSession,
            biometricEnabled = enabled,
            biometricAvailable = available,
            unlocked = process.unlocked,
            freshSignIn = process.freshSignIn,
            declined = biometrics.isDeclined(),
        )
        val keepError = entry == AppEntry.Unlock || entry == AppEntry.Offer
        state.value = SessionUi(
            entry = entry,
            canUnlock = entry == AppEntry.Unlock && available,
            biometricAction = if (entry == AppEntry.Home) biometricHomeAction(enabled, available) else null,
            error = if (keepError) state.value.error else null,
            working = false,
        )
    }

    private companion object {
        val UNLOCK = BiometricRequest(
            title = "Unlock Riders",
            subtitle = "Confirm it is you to open the session already stored on this phone.",
        )
        val ENABLE = BiometricRequest(
            title = "Enable biometric unlock",
            subtitle = "Confirm your fingerprint or face to unlock Riders next time.",
        )
    }
}
