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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.derivedStateOf
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import com.riders.rider.feature.delivery.domain.appendCompletedPage
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.riders.rider.core.design.LocalAppDark
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
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
    suspend fun offlineSnapshot() = assignments.cachedDeliveries("completed")
    private var busy = false
    private var rerun = false
    private var loadedRevision = -1L
    val completedChanges = assignments.completedChanges

    fun ensureLoaded() {
        fetch(force = loadedRevision != completedChanges.value)
    }

    fun refresh() {
        fetch(force = true)
    }

    private fun fetch(force: Boolean) {
        if (busy) {
            rerun = true
            return
        }
        val next = requestCompletedBoard(state.value, force) ?: return
        busy = true
        state.value = next.copy(pageError = null)
        val revision = completedChanges.value
        viewModelScope.launch {
            try {
                state.value = when (val result = assignments.completedPage()) {
                    is ApiResult.Ok -> { loadedRevision = revision; applyCompletedBoard(state.value, result.value.deliveries, null).copy(nextCursor = result.value.nextCursor) }
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
    fun loadMore() {
        val cursor = state.value.nextCursor ?: return
        if (busy || loadedRevision != completedChanges.value) return
        busy = true
        state.value = state.value.copy(paging = true, pageError = null)
        viewModelScope.launch {
            try {
                when (val result = assignments.completedPage(cursor)) {
                    is ApiResult.Ok -> state.value = appendCompletedPage(state.value, result.value.deliveries, result.value.nextCursor)
                    is ApiResult.Err -> state.value = state.value.copy(pageError = result.error.text())
                }
            } finally {
                state.value = state.value.copy(paging = false)
                busy = false
                if (rerun) { rerun = false; fetch(force = true) }
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
        OfflineDeliveryList(saved, contentKind, sort, completed = true, modifier = modifier, reportOffline = offline)
        return
    }
    val revision by model.completedChanges.collectAsStateWithLifecycle()
    LaunchedEffect(revision) {
        model.ensureLoaded()
    }
    val visible = remember(ui.deliveries, contentKind, sort) {
        sortDeliveries(
            ui.deliveries.filter { deliveryContentMatches(it.parcelDescription, contentKind) },
            sort,
            { it.completedAt ?: it.createdAt },
            { it.distanceMeters },
            { it.agreedPrice },
            { it.deliveryId },
        )
    }
    RidersTransientNotice(ui.error.takeIf { ui.deliveries.isNotEmpty() }, passive = true)
    RidersTransientNotice(ui.pageError, passive = true)
    val listState = rememberLazyListState()
    val nearEnd by remember { derivedStateOf {
        val layout = listState.layoutInfo
        layout.totalItemsCount > 0 && (layout.visibleItemsInfo.lastOrNull()?.index ?: -1) >= layout.totalItemsCount - 4
    } }
    LaunchedEffect(nearEnd, ui.nextCursor, ui.paging, ui.refreshing, ui.loading, ui.pageError, ui.error, sort, contentKind) {
        if (nearEnd && sort == DeliveryListSort.Newest && contentKind == null && !ui.paging && !ui.refreshing && !ui.loading && ui.pageError == null && ui.error == null) model.loadMore()
    }
    val centered = (ui.loading && ui.deliveries.isEmpty()) || (ui.deliveries.isEmpty() && ui.error != null) || (visible.isEmpty() && ui.nextCursor == null)
    RidersPullRefresh(refreshing = ui.refreshing, onRefresh = model::refresh, modifier = modifier) {
        if (centered) {
            RidersCenteredContent(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = RidersSpacing.lg)
                    .padding(bottom = RidersSpacing.lg),
            ) {
                when {
                    ui.loading && ui.deliveries.isEmpty() -> RidersLoadingState("Loading completed deliveries")
                    ui.deliveries.isEmpty() && ui.error != null -> RidersFailureNotice(
                        message = ui.error.orEmpty(),
                        title = "Completed deliveries unavailable",
                        onRetry = model::refresh,
                    )
                    else -> RidersEmptyState(
                        title = filteredContentTitle(contentKind, "No completed deliveries yet"),
                        body = "Deliveries you finish appear here.",
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
                if (ui.nextCursor != null && (sort != DeliveryListSort.Newest || contentKind != null)) {
                    item(key = "partial") { Text("Showing matches from loaded deliveries. Load more to search or sort older history.") }
                }
                items(visible, key = { "assignment:${it.assignmentId}" }, contentType = { "delivery" }) { parcel ->
                    CompletedDeliveryCard(parcel, onOpen)
                }
                if (ui.paging) item(key = "paging") { RidersLoadingState("Loading more deliveries") }
                if (ui.nextCursor != null && !ui.paging) item(key = "more") {
                    TextButton(onClick = model::loadMore, enabled = !ui.refreshing && !ui.loading) { Text("Load more") }
                }
            }
        }
    }
}

@Composable
private fun CompletedDeliveryCard(parcel: CommittedParcel, onOpen: (String) -> Unit) {
    DeliverySummaryCard(
        description = parcel.parcelDescription,
        status = parcel.status,
        pickup = parcel.pickupAddress,
        dropoff = parcel.dropoffAddress,
        onClick = { onOpen(parcel.deliveryId) },
        modifier = Modifier.fillMaxWidth(),
        listBadge = true,
        serviceClass = parcel.serviceClass,
        containerColor = if (LocalAppDark.current) null else Color.White,
    )
}
