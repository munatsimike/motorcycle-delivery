package com.riders.rider.feature.delivery.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.riders.rider.R
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.CompletedBoard
import com.riders.rider.feature.delivery.domain.DeliveryListSort
import com.riders.rider.feature.delivery.domain.sortDeliveries
import com.riders.rider.feature.delivery.domain.applyCompletedBoard
import com.riders.rider.feature.delivery.domain.requestCompletedBoard
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class CompletedDeliveriesViewModel @Inject constructor(
    private val assignments: AssignmentRepository,
) : ViewModel() {
    private val state = MutableStateFlow(CompletedBoard())
    val ui: StateFlow<CompletedBoard> = state.asStateFlow()
    private var busy = false
    private var rerun = false

    fun ensureLoaded() {
        fetch(force = false)
    }

    fun refresh() {
        fetch(force = true)
    }

    private fun fetch(force: Boolean) {
        val next = requestCompletedBoard(state.value, force) ?: return
        if (busy) {
            rerun = true
            return
        }
        busy = true
        state.value = next
        viewModelScope.launch {
            try {
                state.value = when (val result = assignments.refreshCompleted()) {
                    is ApiResult.Ok -> applyCompletedBoard(state.value, result.value, null)
                    is ApiResult.Err -> applyCompletedBoard(state.value, null, result.error.text())
                }
            } finally {
                busy = false
                if (rerun) {
                    rerun = false
                    fetch(force = true)
                }
            }
        }
    }
}

@Composable
fun CompletedDeliveriesPane(
    onOpen: (String) -> Unit,
    contentKind: String?,
    sort: DeliveryListSort = DeliveryListSort.Newest,
    modifier: Modifier = Modifier,
    model: CompletedDeliveriesViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) {
        model.ensureLoaded()
    }
    val visible = sortDeliveries(
        ui.deliveries.filter { deliveryContentMatches(it.parcelDescription, contentKind) },
        sort,
        { it.completedAt ?: it.createdAt },
        { it.distanceMeters },
        { it.agreedPrice },
        { it.deliveryId },
    )
    RidersPullRefresh(refreshing = ui.refreshing, onRefresh = model::refresh, modifier = modifier) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = RidersSpacing.lg)
                .padding(bottom = RidersSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
        ) {
            when {
                ui.loading && ui.deliveries.isEmpty() -> RidersLoadingState("Loading completed deliveries")
                ui.deliveries.isEmpty() && ui.error != null -> RidersFailureNotice(
                    message = ui.error.orEmpty(),
                    title = "Completed deliveries unavailable",
                    onRetry = model::refresh,
                )
                visible.isEmpty() -> RidersEmptyState(
                    title = filteredContentTitle(contentKind, "No completed deliveries yet"),
                    body = "Deliveries you finish appear here.",
                    image = R.drawable.parcel_box,
                    modifier = Modifier.fillMaxWidth(),
                )
                else -> {
                    visible.forEach { parcel ->
                        CompletedDeliveryCard(parcel, onOpen)
                    }
                    if (ui.error != null) {
                        RidersFailureNotice(message = ui.error.orEmpty(), onRetry = model::refresh)
                    }
                }
            }
        }
    }
}

@Composable
private fun CompletedDeliveryCard(parcel: CommittedParcel, onOpen: (String) -> Unit) {
    DeliverySummaryCard(
        description = parcel.parcelDescription,
        serviceClass = parcel.serviceClass,
        status = parcel.status,
        pickup = parcel.pickupAddress,
        dropoff = parcel.dropoffAddress,
        onClick = { onOpen(parcel.deliveryId) },
        modifier = Modifier.fillMaxWidth(),
    )
}
