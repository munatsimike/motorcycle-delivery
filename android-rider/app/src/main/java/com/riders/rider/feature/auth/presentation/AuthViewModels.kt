package com.riders.rider.feature.auth.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.BuildConfig
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.core.session.SessionStore
import com.riders.rider.feature.auth.data.AuthRepository
import com.riders.rider.feature.auth.data.VerifyOutcome
import com.riders.rider.feature.auth.domain.AppEntry
import com.riders.rider.feature.auth.domain.appEntry
import com.riders.rider.feature.auth.domain.isVerificationCode
import com.riders.rider.feature.auth.domain.normalizeRiderAddress
import com.riders.rider.feature.auth.domain.normalizeRiderName
import com.riders.rider.feature.auth.domain.normalizeRiderPhone
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
    val whatsapp: Boolean = false,
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

    fun startWhatsAppLogin(phone: String) {
        val normalized = try {
            normalizeRiderPhone(phone, allowDutchTestNumbers = BuildConfig.DEBUG)
        } catch (error: IllegalArgumentException) {
            state.value = FormState(error = error.message)
            return
        }
        viewModelScope.launch {
            state.value = FormState(loading = true)
            state.value = when (val result = auth.startWhatsAppLogin(normalized)) {
                is ApiResult.Ok -> when (result.value) {
                    com.riders.rider.feature.auth.data.LoginStart.CodeSent -> FormState(completedPhone = normalized, whatsapp = true)
                    com.riders.rider.feature.auth.data.LoginStart.AccountMissing -> FormState(
                        accountMissing = true,
                        error = "Account not found. Create an account to continue.",
                    )
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

    fun registerWithPassword(phone: String, fullName: String, address: String, consent: Boolean) {
        if (!consent) {
            state.value = FormState(error = "Consent to WhatsApp authentication messages is required")
            return
        }
        val normalizedPhone = try {
            normalizeRiderPhone(phone, allowDutchTestNumbers = BuildConfig.DEBUG)
        } catch (error: IllegalArgumentException) {
            state.value = FormState(error = error.message)
            return
        }
        val normalizedName = try {
            normalizeRiderName(fullName)
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
            state.value = when (val result = auth.registerWithPassword(normalizedPhone, normalizedName, normalizedAddress)) {
                is ApiResult.Ok -> FormState(completedPhone = normalizedPhone, whatsapp = true)
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
        if (!isVerificationCode(code)) {
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

    fun resend(flow: String, phone: String) {
        if (flow != "whatsapp" && flow != "whatsapp_login" && flow != "login") {
            return
        }
        viewModelScope.launch {
            state.value = FormState(loading = true)
            state.value = when (val result = auth.resend(flow, phone)) {
                is ApiResult.Ok -> FormState()
                is ApiResult.Err -> FormState(error = result.error.text())
            }
        }
    }
}

data class SessionUi(
    val entry: AppEntry = AppEntry.SignedOut,
)

@HiltViewModel
class SessionViewModel @Inject constructor(
    private val sessions: SessionStore,
) : ViewModel() {
    private val state = MutableStateFlow(SessionUi())
    val ui: StateFlow<SessionUi> = state.asStateFlow()

    init {
        publish()
        viewModelScope.launch {
            sessions.session.collect {
                publish()
            }
        }
    }

    private fun publish() {
        state.value = SessionUi(entry = appEntry(sessions.read() != null))
    }
}
