package com.riders.rider.feature.profile.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.auth.data.AuthRepository
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.offers.data.DataStoreAcceptKeyStore
import com.riders.rider.feature.onboarding.data.VerificationRepository
import com.riders.rider.feature.profile.domain.ProfileBoard
import com.riders.rider.feature.profile.domain.profileAfterRefresh
import com.riders.rider.feature.profile.domain.shouldLoadProfile
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProfileUi(
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val signingOut: Boolean = false,
    val board: ProfileBoard = ProfileBoard(),
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val verification: VerificationRepository,
    private val availability: AvailabilityRepository,
    private val deliveries: ActiveDeliveryStore,
    private val acceptKeys: DataStoreAcceptKeyStore,
    private val auth: AuthRepository,
) : ViewModel() {
    private val state = MutableStateFlow(ProfileUi())
    val ui: StateFlow<ProfileUi> = state.asStateFlow()
    private var busy = false

    fun refresh(force: Boolean = false) {
        if (!shouldLoadProfile(state.value.board.loaded, force, busy)) {
            return
        }
        busy = true
        val cold = state.value.board.onboarding == null && state.value.board.fullName.isBlank() && !state.value.board.loaded
        state.update { it.copy(loading = cold, refreshing = !cold) }
        viewModelScope.launch {
            try {
                val profile = verification.profile()
                val onboard = verification.onboarding()
                val licence = verification.licence()
                val motorcycles = verification.motorcycles()
                val failure = firstFailure(profile, onboard, licence, motorcycles)
                state.update { current ->
                    current.copy(
                        loading = false,
                        board = profileAfterRefresh(
                            current = current.board,
                            fullName = (profile as? ApiResult.Ok)?.value?.fullName,
                            phone = (profile as? ApiResult.Ok)?.value?.phone,
                            address = (profile as? ApiResult.Ok)?.value?.address,
                            onboarding = (onboard as? ApiResult.Ok)?.value,
                            hasLicence = (licence as? ApiResult.Ok)?.let { it.value != null },
                            motorcycles = (motorcycles as? ApiResult.Ok)?.value,
                            error = failure?.text(),
                        ),
                    )
                }
            } finally {
                busy = false
                state.update { it.copy(loading = false, refreshing = false) }
            }
        }
    }

    fun logout() {
        if (state.value.signingOut) {
            return
        }
        state.update { it.copy(signingOut = true) }
        viewModelScope.launch { finishLocalSignOut() }
    }

    private suspend fun finishLocalSignOut() {
        availability.applySharing("OFFLINE")
        deliveries.clear()
        acceptKeys.clearAll()
        auth.logout()
        state.update { it.copy(signingOut = false) }
    }
}

private fun firstFailure(vararg results: ApiResult<*>) = results.firstNotNullOfOrNull { result ->
    (result as? ApiResult.Err)?.error
}
