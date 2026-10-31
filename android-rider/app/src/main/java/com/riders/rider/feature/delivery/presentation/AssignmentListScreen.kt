package com.riders.rider.feature.delivery.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
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
import com.riders.rider.feature.offers.notification.rememberOfferInbox
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.DeliveryListSort
import com.riders.rider.feature.delivery.domain.committedAssignmentsForDisplay
import com.riders.rider.feature.delivery.domain.sortDeliveries
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AssignmentListUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val assignments: List<CommittedParcel> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class AssignmentListViewModel @Inject constructor(
    private val assignments: AssignmentRepository,
) : ViewModel() {
    private val state = MutableStateFlow(AssignmentListUi(assignments = assignments.current(), loading = assignments.current().isEmpty()))
    val ui: StateFlow<AssignmentListUi> = state.asStateFlow()
    private var busy = false
    private var rerun = false

    fun refresh() {
        if (busy) {
            rerun = true
            return
        }
        busy = true
        val current = state.value
        state.value = current.copy(
            refreshing = current.assignments.isNotEmpty() || current.error != null,
            loading = current.assignments.isEmpty() && current.error == null,
            error = null,
        )
        viewModelScope.launch {
            try {
                when (val result = assignments.refreshList()) {
                    is ApiResult.Ok -> state.value = AssignmentListUi(assignments = result.value)
                    is ApiResult.Err -> state.value = state.value.copy(
                        loading = false,
                        refreshing = false,
                        assignments = assignments.current(),
                        error = result.error.text(),
                    )
                }
            } finally {
                busy = false
                if (rerun) {
                    rerun = false
                    refresh()
                }
            }
        }
    }
}

@Composable
fun AssignmentListPane(
    onOpen: (String) -> Unit,
    availability: String?,
    receiving: Boolean?,
    contentKind: String? = null,
    sort: DeliveryListSort = DeliveryListSort.Newest,
    modifier: Modifier = Modifier,
    model: AssignmentListViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val acceptedBids = rememberOfferInbox()
    LaunchedEffect(acceptedBids) {
        acceptedBids.acceptedArrivals.collect { model.refresh() }
    }
    LaunchedEffect(Unit) {
        model.refresh()
    }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                model.refresh()
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val committed = committedAssignmentsForDisplay(ui.assignments, availability, receiving)
    val visible = sortDeliveries(
        committed.filter { deliveryContentMatches(it.parcelDescription, contentKind) },
        sort,
        { it.createdAt },
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
                ui.loading && committed.isEmpty() -> RidersLoadingState("Loading your deliveries")
                committed.isEmpty() && ui.error != null -> RidersFailureNotice(
                    message = ui.error.orEmpty(),
                    title = "Deliveries unavailable",
                    onRetry = model::refresh,
                )
                visible.isEmpty() -> RidersEmptyState(
                    title = filteredContentTitle(contentKind, "No committed deliveries"),
                    body = "Accepted deliveries appear here, including ones accepted while the app was closed.",
                    image = R.drawable.parcel_box,
                    modifier = Modifier.fillMaxWidth(),
                )
                else -> {
                    visible.forEach { parcel ->
                        AssignmentCard(parcel, onOpen)
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
private fun AssignmentCard(parcel: CommittedParcel, onOpen: (String) -> Unit) {
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
