package com.riders.rider.feature.delivery.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.riders.rider.R
import com.riders.rider.core.design.RidersCenteredContent
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersTransientNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.refresh.clearListedRefresh
import com.riders.rider.core.refresh.listedRefresh
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
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class AssignmentListUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val loaded: Boolean = false,
    val assignments: List<CommittedParcel> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class AssignmentListViewModel @Inject constructor(
    private val assignments: AssignmentRepository,
) : ViewModel() {
    private val state = MutableStateFlow(initialAssignmentList(assignments.current(), assignments.hasConfirmedAssignments()).copy(assignments = emptyList()))
    val ui: StateFlow<AssignmentListUi> = combine(state, assignments.parcelsFlow) { chrome, parcels ->
        chrome.copy(assignments = parcels)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, state.value.copy(assignments = assignments.current()))
    suspend fun offlineSnapshot() = assignments.cachedDeliveries("active")
    private var busy = false
    private var rerun = false
    private var rerunFromUser = false
    private var refreshTicket = 0

    fun refresh(fromUser: Boolean = false) {
        if (busy) {
            rerun = true
            if (fromUser) {
                rerunFromUser = true
            }
            return
        }
        busy = true
        val ticket = ++refreshTicket
        val current = state.value
        val blank = !current.loaded && assignments.current().isEmpty() && current.error == null
        val chrome = listedRefresh(fromUser, blank)
        state.value = current.copy(
            refreshing = chrome.refreshing,
            loading = chrome.loading,
            error = null,
        )
        viewModelScope.launch {
            try {
                when (val result = assignments.refreshList()) {
                    is ApiResult.Ok -> if (ticket == refreshTicket) {
                        state.value = AssignmentListUi(loading = false, loaded = true)
                    }
                    is ApiResult.Err -> if (ticket == refreshTicket) {
                        state.value = state.value.copy(
                            loading = false,
                            refreshing = false,
                            loaded = current.loaded,
                            error = result.error.text(),
                        )
                    }
                }
            } finally {
                val queued = rerun
                val queuedFromUser = rerunFromUser
                if (ticket == refreshTicket) {
                    rerun = false
                    rerunFromUser = false
                    val cleared = clearListedRefresh(ticket, refreshTicket, state.value.loading, state.value.refreshing)
                    state.value = state.value.copy(loading = cleared.loading, refreshing = cleared.refreshing)
                    busy = false
                }
                if (ticket == refreshTicket && queued) {
                    refresh(queuedFromUser)
                }
            }
        }
    }
}

private fun initialAssignmentList(assignments: List<CommittedParcel>, confirmed: Boolean): AssignmentListUi {
    return AssignmentListUi(
        assignments = assignments,
        loading = !confirmed && assignments.isEmpty(),
        loaded = confirmed,
    )
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
    val link by com.riders.rider.core.design.RiderNetwork.link.collectAsStateWithLifecycle()
    var saved by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<com.riders.rider.feature.delivery.data.OfflineSnapshot?>(null) }
    val offline = link == com.riders.rider.core.design.NetworkLink.Disconnected
    LaunchedEffect(offline, ui.error) {
        saved = if (offline || ui.error != null) model.offlineSnapshot() else null
    }
    LaunchedEffect(Unit) {
        com.riders.rider.core.design.RiderNetwork.connectivityRestored.collect { model.refresh() }
    }
    if (offline || (ui.error != null && saved != null)) {
        if (!offline) RidersTransientNotice(ui.error, passive = true)
        OfflineDeliveryList(saved, contentKind, sort, completed = false, modifier = modifier, reportOffline = offline)
        return
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val acceptedBids = rememberOfferInbox()
    LaunchedEffect(acceptedBids) {
        acceptedBids.acceptedArrivals.collect { model.refresh() }
    }
    LaunchedEffect(acceptedBids) {
        acceptedBids.customerCancelledArrivals.collect { model.refresh() }
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
    val committed = remember(ui.assignments, availability, receiving) {
        committedAssignmentsForDisplay(ui.assignments, availability, receiving)
    }
    val visible = remember(committed, contentKind, sort) {
        sortDeliveries(
            committed.filter { deliveryContentMatches(it.parcelDescription, contentKind) },
            sort,
            { it.createdAt },
            { it.distanceMeters },
            { it.agreedPrice },
            { it.deliveryId },
        )
    }
    RidersTransientNotice(ui.error.takeIf { committed.isNotEmpty() }, passive = true)
    val listState = rememberLazyListState()
    val centered = (ui.loading && committed.isEmpty()) || (committed.isEmpty() && ui.error != null) || visible.isEmpty()
    RidersPullRefresh(refreshing = ui.refreshing, onRefresh = { model.refresh(fromUser = true) }, modifier = modifier) {
        if (centered) {
            RidersCenteredContent(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = RidersSpacing.lg)
                    .padding(bottom = RidersSpacing.lg),
            ) {
                when {
                    ui.loading && committed.isEmpty() -> RidersLoadingState("Loading your deliveries")
                    committed.isEmpty() && ui.error != null -> RidersFailureNotice(
                        message = ui.error.orEmpty(),
                        title = "Deliveries unavailable",
                        onRetry = model::refresh,
                    )
                    else -> RidersEmptyState(
                        title = filteredContentTitle(contentKind, "No active deliveries"),
                        body = "Your assigned deliveries will appear here.",
                        image = R.drawable.parcel_box,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                state = listState,
                contentPadding = PaddingValues(
                    start = RidersSpacing.lg,
                    end = RidersSpacing.lg,
                    bottom = RidersSpacing.lg,
                ),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
            ) {
                items(visible, key = { "assignment:${it.assignmentId}" }, contentType = { "delivery" }) { parcel ->
                    AssignmentCard(parcel, onOpen)
                }
            }
        }
    }
}

@Composable
private fun AssignmentCard(parcel: CommittedParcel, onOpen: (String) -> Unit) {
    DeliverySummaryCard(
        description = parcel.parcelDescription,
        status = parcel.status,
        pickup = parcel.pickupAddress,
        dropoff = parcel.dropoffAddress,
        onClick = { onOpen(parcel.deliveryId) },
        modifier = Modifier.fillMaxWidth(),
        listBadge = true,
        serviceClass = parcel.serviceClass,
        filled = false,
    )
}
