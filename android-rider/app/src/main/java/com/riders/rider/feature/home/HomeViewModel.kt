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
    val changingAvailability: Boolean = false,
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
    private var dashboardBusy = false

    fun refresh() {
        if (dashboardBusy) {
            return
        }
        dashboardBusy = true
        viewModelScope.launch {
            try {
                load(confirmedAvailability = null, notice = null)
            } finally {
                dashboardBusy = false
            }
        }
    }

    fun goOnline() {
        changeAvailability(online = true)
    }

    fun goOffline() {
        changeAvailability(online = false)
    }

    private fun changeAvailability(online: Boolean) {
        val started = beginAvailabilityChange(
            AvailabilityChange(
                availability = state.value.onboarding?.availability,
                changing = dashboardBusy || state.value.changingAvailability,
            ),
        ) ?: return
        dashboardBusy = true
        state.value = state.value.copy(changingAvailability = started.changing, error = null)
        viewModelScope.launch {
            try {
                val result = if (online) availability.online() else availability.offline()
                when (result) {
                    is ApiResult.Ok -> {
                        val confirmed = confirmAvailability(
                            AvailabilityChange(started.availability, changing = true),
                            result.value.availability,
                            result.value.message,
                        )
                        load(confirmed.availability, confirmed.error)
                    }
                    is ApiResult.Err -> {
                        val failed = failAvailability(
                            AvailabilityChange(started.availability, changing = true),
                            result.error.text(),
                        )
                        state.value = state.value.copy(changingAvailability = failed.changing, error = failed.error)
                    }
                }
            } finally {
                dashboardBusy = false
            }
        }
    }

    private suspend fun load(confirmedAvailability: String?, notice: String?) {
        val stored = deliveries.read()
        val previous = state.value
        state.value = previous.copy(
            loading = true,
            changingAvailability = confirmedAvailability != null || previous.changingAvailability,
            error = null,
            active = stored,
            shift = homeShift(
                confirmedAvailability ?: previous.onboarding?.availability,
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
        val loaded = (onboard as? ApiResult.Ok)?.value
        val current = previous.onboarding
        val shown = when {
            loaded != null && confirmedAvailability != null && loaded.availability != "BUSY" ->
                loaded.copy(availability = confirmedAvailability)
            loaded != null -> loaded
            current != null && confirmedAvailability != null -> current.copy(availability = confirmedAvailability)
            else -> current
        }
        val readiness = shown?.let { riderReadiness(it) }
        if (shown != null) {
            availability.applySharing(shown.availability)
        }
        val offline = recovery.offline || (onboard is ApiResult.Err && onboard.error.isRecoverable())
        val shift = homeShift(
            shown?.availability,
            readiness?.canAcceptDeliveries == true,
            active,
            recovering = false,
            recoveryFailed = offline,
        )
        state.value = HomeUi(
            loading = false,
            changingAvailability = false,
            onboarding = shown,
            readiness = readiness ?: previous.readiness,
            active = active,
            shift = shift,
            error = when {
                !notice.isNullOrBlank() -> notice
                onboard is ApiResult.Err && !onboard.error.isRecoverable() -> onboard.error.text()
                recovery.offline && shift.recoveryMessage == null -> "Your current delivery could not be loaded. Check your connection and try again."
                onboard is ApiResult.Err && shift.recoveryMessage == null -> onboard.error.text()
                else -> null
            },
        )
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
