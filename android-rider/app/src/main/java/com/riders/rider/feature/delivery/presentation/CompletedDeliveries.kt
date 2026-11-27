package com.riders.rider.feature.delivery.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.delivery.data.AssignmentRepository
import com.riders.rider.feature.delivery.domain.CommittedParcel
import com.riders.rider.feature.delivery.domain.CompletedBoard
import com.riders.rider.feature.delivery.domain.HistoryStatus
import com.riders.rider.feature.delivery.domain.DeliveryListSort
import com.riders.rider.feature.delivery.domain.HISTORY_CUSTOMER_CANCELLATION
import com.riders.rider.feature.delivery.domain.historyFetchApplies
import com.riders.rider.feature.delivery.domain.historySortTime
import com.riders.rider.feature.delivery.domain.invalidatesHistory
import com.riders.rider.feature.delivery.domain.parcelRoute
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
    private val cancellations: com.riders.rider.feature.offers.notification.PendingOffer,
) : ViewModel() {
    private val state = MutableStateFlow(CompletedBoard())
    val ui: StateFlow<CompletedBoard> = state.asStateFlow()
    suspend fun offlineSnapshot() = assignments.cachedDeliveries("history")
    private var busy = false
    private var generation = 0
    private var rerun = false
    private var rerunFromUser = false
    private var loadedRevision = -1L
    val completedChanges = assignments.completedChanges

    init {
        viewModelScope.launch {
            cancellations.customerCancelledArrivals.collect {
                if (invalidatesHistory(HISTORY_CUSTOMER_CANCELLATION)) assignments.invalidateCompleted()
            }
        }
    }

    fun ensureLoaded() {
        fetch(force = loadedRevision != completedChanges.value)
    }

    fun refresh(fromUser: Boolean = false) {
        fetch(force = true, fromUser = fromUser)
    }

    private fun fetch(force: Boolean, fromUser: Boolean = false) {
        if (busy) {
            rerun = true
            rerunFromUser = rerunFromUser || fromUser
            return
        }
        val next = requestCompletedBoard(state.value, force, fromUser) ?: return
        busy = true
        val status = state.value.historyStatus
        val ticket = ++generation
        state.value = next.copy(pageError = null, historyStatus = status)
        val revision = completedChanges.value
        viewModelScope.launch {
            try {
                if (!historyFetchApplies(ticket, generation)) return@launch
                val result = assignments.historyPage(status = status.query)
                if (!historyFetchApplies(ticket, generation)) return@launch
                state.value = when (result) {
                    is ApiResult.Ok -> { loadedRevision = revision; applyCompletedBoard(state.value, result.value.deliveries, null).copy(nextCursor = result.value.nextCursor, historyStatus = status) }
                    is ApiResult.Err -> applyCompletedBoard(state.value, null, result.error.text()).copy(historyStatus = status)
                }
            } finally {
                if (ticket == generation) state.value = state.value.copy(loading = false, refreshing = false, syncing = false)
                busy = false
                drainRefresh()
            }
        }
    }
    private fun drainRefresh() {
        if (!rerun) return
        val fromUser = rerunFromUser
        rerun = false
        rerunFromUser = false
        fetch(force = true, fromUser = fromUser)
    }

    fun selectHistory(status: HistoryStatus) {
        if (state.value.historyStatus == status) return
        generation += 1
        state.value = CompletedBoard(historyStatus = status, loading = true)
        if (busy) {
            rerun = true
            return
        }
        fetch(force = true)
    }

    fun loadMore() {
        val cursor = state.value.nextCursor ?: return
        val status = state.value.historyStatus
        if (busy || loadedRevision != completedChanges.value) return
        busy = true
        val ticket = generation
        state.value = state.value.copy(paging = true, pageError = null)
        viewModelScope.launch {
            try {
                if (!historyFetchApplies(ticket, generation)) return@launch
                val result = assignments.historyPage(cursor, status.query)
                if (!historyFetchApplies(ticket, generation)) return@launch
                when (result) {
                    is ApiResult.Ok -> state.value = appendCompletedPage(state.value, result.value.deliveries, result.value.nextCursor)
                    is ApiResult.Err -> state.value = state.value.copy(pageError = result.error.text())
                }
            } finally {
                if (ticket == generation) state.value = state.value.copy(paging = false)
                busy = false
                drainRefresh()
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
            { historySortTime(it) },
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
    LaunchedEffect(nearEnd, ui.nextCursor, ui.paging, ui.syncing, ui.loading, ui.pageError, ui.error, sort, contentKind) {
        if (nearEnd && sort == DeliveryListSort.Newest && contentKind == null && !ui.paging && !ui.syncing && !ui.loading && ui.pageError == null && ui.error == null) model.loadMore()
    }
    val centered = (ui.loading && ui.deliveries.isEmpty()) || (ui.deliveries.isEmpty() && ui.error != null) || (visible.isEmpty() && ui.nextCursor == null)
    val emptyTitle = when (ui.historyStatus) {
        HistoryStatus.Delivered -> "No delivered deliveries yet"
        HistoryStatus.Cancelled -> "No cancelled deliveries yet"
        HistoryStatus.All -> "No history yet"
    }
    Column(modifier) {
    HistoryStatusFilters(ui.historyStatus, model::selectHistory)
    RidersPullRefresh(refreshing = ui.refreshing, onRefresh = { model.refresh(fromUser = true) }, modifier = Modifier.weight(1f)) {
        if (centered) {
            RidersCenteredContent(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = RidersSpacing.lg)
                    .padding(bottom = RidersSpacing.lg),
            ) {
                when {
                    ui.loading && ui.deliveries.isEmpty() -> RidersLoadingState("Loading history")
                    ui.deliveries.isEmpty() && ui.error != null -> RidersFailureNotice(
                        message = ui.error.orEmpty(),
                        title = "History unavailable",
                        onRetry = { model.refresh() },
                    )
                    else -> RidersEmptyState(
                        title = filteredContentTitle(contentKind, emptyTitle),
                        body = "Delivered and cancelled deliveries appear here.",
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
                    TextButton(onClick = model::loadMore, enabled = !ui.syncing && !ui.loading) { Text("Load more") }
                }
            }
        }
    }
    }
}

@Composable
private fun HistoryStatusFilters(selected: HistoryStatus, onSelect: (HistoryStatus) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = RidersSpacing.lg)
            .padding(bottom = RidersSpacing.sm),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        HistoryStatus.entries.forEach { status ->
            val active = status == selected
            val shape = RoundedCornerShape(RidersRadius.pill)
            Text(
                status.label,
                style = RidersType.caption,
                color = if (active) RidersColors.primaryDark else RidersColors.textSecondary,
                modifier = Modifier
                    .clip(shape)
                    .background(if (active) RidersColors.primaryLight else RidersColors.sheet, shape)
                    .clickable { onSelect(status) }
                    .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.sm),
            )
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
        onClick = { onOpen(parcelRoute(parcel.deliveryId, completed = true, assignmentId = parcel.assignmentId)) },
        modifier = Modifier.fillMaxWidth(),
        listBadge = true,
        serviceClass = parcel.serviceClass,
        containerColor = if (LocalAppDark.current) null else Color.White,
    )
}
