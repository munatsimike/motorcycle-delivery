package com.riders.rider.feature.auth.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.auth.data.AuthRepository
import com.riders.rider.feature.auth.domain.normalizeRiderName
import com.riders.rider.feature.auth.domain.normalizeRiderPhone
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

@HiltViewModel
class SessionViewModel @Inject constructor(
    private val auth: AuthRepository,
    store: com.riders.rider.core.session.SessionStore,
) : ViewModel() {
    val signedIn: StateFlow<Boolean> = kotlinx.coroutines.flow.MutableStateFlow(store.read() != null).also { flow ->
        viewModelScope.launch {
            store.session.collect { flow.value = it != null }
        }
    }

    fun logout() {
        viewModelScope.launch { auth.logout() }
    }
}
