package com.riders.rider.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.auth.data.AuthRepository
import com.riders.rider.feature.availability.data.AvailabilityRepository
import com.riders.rider.feature.delivery.data.ActiveDeliveryStore
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.feature.delivery.domain.DeliveryRecoveryCoordinator
import com.riders.rider.feature.offers.data.DataStoreAcceptKeyStore
import com.riders.rider.feature.onboarding.data.OnboardingRepository
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.RiderReadiness
import com.riders.rider.feature.onboarding.domain.riderReadiness
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HomeUi(
    val loading: Boolean = true,
    val onboarding: RiderOnboarding? = null,
    val readiness: RiderReadiness? = null,
    val active: ActiveDelivery? = null,
    val shift: HomeShift = homeShift(null, false, null),
    val error: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val onboarding: OnboardingRepository,
    private val availability: AvailabilityRepository,
    private val deliveries: ActiveDeliveryStore,
    private val assignments: AssignmentRepository,
    private val acceptKeys: DataStoreAcceptKeyStore,
    private val auth: AuthRepository,
) : ViewModel() {
    private val state = MutableStateFlow(HomeUi())
    val ui: StateFlow<HomeUi> = state.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            val stored = deliveries.read()
            val previous = state.value
            state.value = previous.copy(
                loading = true,
                error = null,
                active = stored,
                shift = homeShift(
                    previous.onboarding?.availability,
                    previous.readiness?.canAcceptDeliveries == true,
                    stored,
                    recovering = true,
                ),
            )
            val onboard = onboarding.load()
            val recovery = DeliveryRecoveryCoordinator(
                read = deliveries::read,
                write = deliveries::write,
                clear = deliveries::clear,
                lookup = assignments::lookup,
            ).reconcile()
            val active = recovery.visible
            val availabilityName = (onboard as? ApiResult.Ok)?.value?.availability
            val readiness = (onboard as? ApiResult.Ok)?.value?.let { riderReadiness(it) }
            if (onboard is ApiResult.Ok) {
                availability.applySharing(onboard.value.availability)
            }
            val offline = recovery.offline || (onboard is ApiResult.Err && onboard.error.isRecoverable())
            val shift = homeShift(
                availabilityName ?: previous.onboarding?.availability,
                if (readiness != null) readiness.canAcceptDeliveries else previous.readiness?.canAcceptDeliveries == true,
                active,
                recovering = false,
                recoveryFailed = offline,
            )
            state.value = HomeUi(
                loading = false,
                onboarding = (onboard as? ApiResult.Ok)?.value ?: previous.onboarding,
                readiness = readiness ?: previous.readiness,
                active = active,
                shift = shift,
                error = when {
                    onboard is ApiResult.Err && !onboard.error.isRecoverable() -> onboard.error.text()
                    recovery.offline && shift.recoveryMessage == null -> "Your current delivery could not be loaded. Check your connection and try again."
                    onboard is ApiResult.Err && shift.recoveryMessage == null -> onboard.error.text()
                    else -> null
                },
            )
        }
    }

    fun goOnline() {
        viewModelScope.launch {
            when (val result = availability.online()) {
                is ApiResult.Ok -> refresh()
                is ApiResult.Err -> state.value = state.value.copy(error = result.error.text())
            }
        }
    }

    fun goOffline() {
        viewModelScope.launch {
            when (val result = availability.offline()) {
                is ApiResult.Ok -> refresh()
                is ApiResult.Err -> state.value = state.value.copy(error = result.error.text())
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            availability.applySharing("OFFLINE")
            deliveries.clear()
            acceptKeys.clearAll()
            auth.logout()
        }
    }
}

private fun ApiError.isRecoverable(): Boolean = when (this) {
    ApiError.Network,
    ApiError.Timeout,
    ApiError.Unavailable,
    -> true
    is ApiError.Unexpected -> true
    else -> false
}
