package com.riders.rider.feature.auth.presentation

import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.BuildConfig
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.auth.data.AuthRepository
import com.riders.rider.feature.auth.data.LoginStart
import com.riders.rider.feature.auth.data.VerifyOutcome
import com.riders.rider.feature.auth.data.BiometricAuthResult
import com.riders.rider.feature.auth.data.BiometricAuthenticator
import com.riders.rider.feature.auth.data.BiometricCapability
import com.riders.rider.feature.auth.data.BiometricRequest
import com.riders.rider.feature.auth.domain.AppEntry
import com.riders.rider.feature.auth.domain.BiometricPreference
import com.riders.rider.feature.auth.domain.BiometricSessionState
import com.riders.rider.feature.auth.domain.biometricHomeAction
import com.riders.rider.feature.auth.domain.initialBiometricState
import com.riders.rider.feature.auth.domain.normalizeRiderAddress
import com.riders.rider.feature.auth.domain.normalizeRiderName
import com.riders.rider.feature.auth.domain.normalizeRiderPhone
import com.riders.rider.feature.auth.domain.reduceSession
import com.riders.rider.feature.auth.domain.resolveAppEntry
import androidx.lifecycle.SavedStateHandle
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class FormState(
    val loading: Boolean = false,
    val error: String? = null,
    val completedPhone: String? = null,
    val registrationToken: String? = null,
    val prefillName: String? = null,
    val prefillAddress: String? = null,
    val lockDetails: Boolean = false,
    val useExistingLogin: Boolean = false,
    val accountMissing: Boolean = false,
)

@HiltViewModel
class SignInViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {
    private val state = MutableStateFlow(FormState())
    val ui: StateFlow<FormState> = state.asStateFlow()

    fun clearAccountMissing() {
        if (state.value.accountMissing) {
            state.value = state.value.copy(accountMissing = false)
        }
    }

    fun submit(phone: String) {
        val normalized = try {
            normalizeRiderPhone(phone, allowDutchTestNumbers = BuildConfig.DEBUG)
        } catch (error: IllegalArgumentException) {
            state.value = FormState(error = error.message)
            return
        }
        viewModelScope.launch {
            state.value = FormState(loading = true)
            state.value = when (val result = auth.requestLogin(normalized)) {
                is ApiResult.Ok -> when (result.value) {
                    LoginStart.CodeSent -> FormState(completedPhone = normalized)
                    LoginStart.AccountMissing -> FormState(accountMissing = true)
                }
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

    fun submit(phone: String) {
        val normalizedPhone = try {
            normalizeRiderPhone(phone, allowDutchTestNumbers = BuildConfig.DEBUG)
        } catch (error: IllegalArgumentException) {
            state.value = FormState(error = error.message)
            return
        }
        viewModelScope.launch {
            state.value = FormState(loading = true)
            state.value = when (val result = auth.requestRegistration(normalizedPhone)) {
                is ApiResult.Ok -> FormState(completedPhone = normalizedPhone)
                is ApiResult.Err -> FormState(error = result.error.text())
            }
        }
    }
}

@HiltViewModel
class AccountViewModel @Inject constructor(
    private val auth: AuthRepository,
    savedState: SavedStateHandle,
) : ViewModel() {
    val phone: String = savedState.get<String>("phone").orEmpty()
    val initialName: String = savedState.get<String>("name").orEmpty()
    val initialAddress: String = savedState.get<String>("address").orEmpty()
    val lockDetails: Boolean = savedState.get<String>("locked") == "true"
    private val token: String = savedState.get<String>("token").orEmpty()
    private val state = MutableStateFlow(FormState())
    val ui: StateFlow<FormState> = state.asStateFlow()

    fun submit(name: String, address: String) {
        if (token.isBlank()) {
            state.value = FormState(error = "Verify your phone number again.")
            return
        }
        if (lockDetails) {
            viewModelScope.launch {
                state.value = FormState(loading = true)
                state.value = when (val result = auth.completeRegistration(token, initialName, initialAddress)) {
                    is ApiResult.Ok -> FormState(completedPhone = phone)
                    is ApiResult.Err -> FormState(error = result.error.text())
                }
            }
            return
        }
        val normalizedName = try {
            normalizeRiderName(name)
        } catch (error: IllegalArgumentException) {
            state.value = FormState(error = error.message)
            return
        }
        val normalizedAddress = try {
            normalizeRiderAddress(address)
        } catch (error: IllegalArgumentException) {
            state.value = FormState(error = error.message)
            return
        }
        viewModelScope.launch {
            state.value = FormState(loading = true)
            state.value = when (val result = auth.completeRegistration(token, normalizedName, normalizedAddress)) {
                is ApiResult.Ok -> FormState(completedPhone = phone)
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
                is ApiResult.Ok -> when (val outcome = result.value) {
                    VerifyOutcome.SignedIn -> FormState(completedPhone = phone)
                    VerifyOutcome.UseExistingLogin -> FormState(useExistingLogin = true)
                    is VerifyOutcome.NeedsAccount -> FormState(
                        registrationToken = outcome.registrationToken,
                        prefillName = outcome.fullName,
                        prefillAddress = outcome.address,
                        lockDetails = outcome.lockDetails,
                    )
                }
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
