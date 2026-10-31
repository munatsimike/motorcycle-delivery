package com.riders.rider.feature.home

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.RidersBottomSheet
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.feature.delivery.domain.DeliveryListSort
import com.riders.rider.feature.delivery.presentation.AssignmentListPane
import com.riders.rider.feature.delivery.presentation.CompletedDeliveriesPane
import com.riders.rider.feature.delivery.presentation.filteredContentTitle
import com.riders.rider.feature.bids.presentation.BidBoardScreen
import com.riders.rider.navigation.DeliveryBoardTab
import com.riders.rider.navigation.deliveriesShowsAssignmentList
import com.riders.rider.navigation.deliveriesShowsBidBoard
import com.riders.rider.navigation.deliveryBoardTabs

private enum class DeliveryContent(val label: String, val icon: Int) {
    All("All", R.drawable.ic_view_grid_outline),
    Parcel("Parcel", R.drawable.ic_nav_deliveries),
    Document("Doc", R.drawable.ic_file_document_outline),
    Food("Food", R.drawable.ic_silverware_fork_knife),
}

private fun DeliveryContent.kind(): String? = when (this) {
    DeliveryContent.All -> null
    DeliveryContent.Parcel -> "Parcel"
    DeliveryContent.Document -> "Document"
    DeliveryContent.Food -> "Food"
}

@Composable
fun DeliveriesScreen(
    @Suppress("UNUSED_PARAMETER") onAccepted: (String) -> Unit,
    onOpenDelivery: (String) -> Unit,
    onOpenCompleted: (String) -> Unit,
    model: HomeViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(DeliveryBoardTab.Active) }
    var content by remember { mutableStateOf(DeliveryContent.All) }
    var sort by remember { mutableStateOf(DeliveryListSort.Newest) }
    var sortOpen by remember { mutableStateOf(false) }
    val availability = ui.onboarding?.availability
    Column(
        Modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .statusBarsPadding(),
    ) {
        val marketplace = deliveriesShowsBidBoard(ui.onboarding?.receiving)
        val committed = ui.committedV2
        val tabs = deliveryBoardTabs(marketplace)
        val selected = if (tab in tabs) tab else DeliveryBoardTab.Active
        val contentKind = content.kind()
        if (tabs.size > 1) {
            DeliveryTabs(
                tabs = tabs,
                selected = selected,
                onSelect = { tab = it },
                modifier = Modifier.padding(horizontal = RidersSpacing.lg).padding(top = RidersSpacing.lg, bottom = RidersSpacing.sm),
            )
        }
        DeliveryContentFilters(
            selected = content,
            onSelect = { content = it },
            onSort = { sortOpen = true },
            modifier = Modifier
                .padding(horizontal = RidersSpacing.lg)
                .padding(top = if (tabs.size > 1) 0.dp else RidersSpacing.lg, bottom = RidersSpacing.lg),
        )
        DeliverySortSheet(
            visible = sortOpen,
            selected = sort,
            onSelect = {
                sort = it
                sortOpen = false
            },
            onDismiss = { sortOpen = false },
        )
        when (selected) {
            DeliveryBoardTab.Offers -> BidBoardScreen(
                contentKind = contentKind,
                sort = sort,
                modifier = Modifier.weight(1f),
            )
            DeliveryBoardTab.Completed -> CompletedDeliveriesPane(
                onOpen = onOpenCompleted,
                contentKind = contentKind,
                sort = sort,
                modifier = Modifier.weight(1f),
            )
            DeliveryBoardTab.Active -> when {
                ui.loading && ui.onboarding == null -> RidersLoadingState("Loading your deliveries")
                ui.assignmentsUnknown -> RidersFailureNotice(
                    message = ui.error ?: "Your deliveries could not be loaded. Check your connection and try again.",
                    title = "Deliveries unavailable",
                    onRetry = model::refresh,
                    modifier = Modifier.weight(1f),
                )
                deliveriesShowsAssignmentList(ui.onboarding?.receiving, committed) -> AssignmentListPane(
                    onOpen = onOpenDelivery,
                    availability = availability,
                    receiving = ui.onboarding?.receiving,
                    contentKind = contentKind,
                    sort = sort,
                    modifier = Modifier.weight(1f),
                )
                else -> RidersPullRefresh(
                    refreshing = ui.refreshing,
                    onRefresh = model::refresh,
                    modifier = Modifier.weight(1f),
                ) {
                    Column(
                        Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = RidersSpacing.lg)
                            .padding(bottom = RidersSpacing.lg),
                    ) {
                        RidersEmptyState(
                            title = filteredContentTitle(contentKind, "No active deliveries"),
                            body = "Accepted deliveries appear here.",
                            image = R.drawable.parcel_box,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DeliveryContentFilters(
    selected: DeliveryContent,
    onSelect: (DeliveryContent) -> Unit,
    onSort: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .weight(1f)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
        DeliveryContent.entries.forEach { item ->
            val isSelected = item == selected
            val shape = RoundedCornerShape(RidersRadius.pill)
            Box(
                Modifier
                    .clip(shape)
                    .background(if (isSelected) RidersColors.primaryLight else RidersColors.background)
                    .border(1.dp, if (isSelected) RidersColors.primary else RidersColors.border, shape)
                    .clickable(role = Role.RadioButton, onClick = {
                        onSelect(if (isSelected) DeliveryContent.All else item)
                    })
                    .semantics { this.selected = isSelected }
                    .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.xs),
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
                ) {
                    Image(
                        painterResource(item.icon),
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        colorFilter = ColorFilter.tint(if (isSelected) RidersColors.primaryDark else RidersColors.textSecondary),
                    )
                    Text(
                        item.label,
                        style = RidersType.small.copy(fontWeight = FontWeight.SemiBold),
                        color = if (isSelected) RidersColors.primaryDark else RidersColors.textSecondary,
                    )
                }
            }
        }
        }
        Spacer(Modifier.width(RidersSpacing.sm))
        val sortShape = CircleShape
        Box(
            Modifier
                .size(36.dp)
                .clip(sortShape)
                .background(RidersColors.background)
                .border(1.dp, RidersColors.border, sortShape)
                .clickable(role = Role.Button, onClick = onSort),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painterResource(R.drawable.ic_sort),
                contentDescription = "Sort",
                modifier = Modifier.size(18.dp),
                colorFilter = ColorFilter.tint(RidersColors.text),
            )
        }
    }
}

@Composable
private fun DeliverySortSheet(
    visible: Boolean,
    selected: DeliveryListSort,
    onSelect: (DeliveryListSort) -> Unit,
    onDismiss: () -> Unit,
) {
    val options = listOf(
        SortChoice(DeliveryListSort.Newest, "Newest", R.drawable.ic_clock),
        SortChoice(DeliveryListSort.Oldest, "Oldest", R.drawable.ic_clock),
        SortChoice(DeliveryListSort.Shortest, "Shortest distance", R.drawable.ic_route),
        SortChoice(DeliveryListSort.Longest, "Longest distance", R.drawable.ic_route),
        SortChoice(DeliveryListSort.Highest, "Highest price", R.drawable.ic_currency),
        SortChoice(DeliveryListSort.Lowest, "Lowest price", R.drawable.ic_currency),
    )
    val sheetShape = RoundedCornerShape(topStart = RidersRadius.xl, topEnd = RidersRadius.xl)
    RidersBottomSheet(visible = visible, onDismiss = onDismiss, handle = false) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(sheetShape)
                .background(RidersColors.background)
                .navigationBarsPadding()
                .padding(horizontal = RidersSpacing.lg)
                .padding(bottom = RidersSpacing.lg),
        ) {
            Box(
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(top = RidersSpacing.sm, bottom = RidersSpacing.md)
                    .width(36.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(RidersColors.border),
            )
            Row(
                Modifier.fillMaxWidth().padding(bottom = RidersSpacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Sort by",
                    style = RidersType.heading,
                    color = RidersColors.text,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .clickable(role = Role.Button, onClick = onDismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(
                        painterResource(R.drawable.ic_close),
                        contentDescription = "Close",
                        modifier = Modifier.size(22.dp),
                        colorFilter = ColorFilter.tint(RidersColors.textSecondary),
                    )
                }
            }
            options.forEach { choice ->
                val isSelected = choice.sort == selected
                Row(
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 52.dp)
                        .clip(RoundedCornerShape(RidersRadius.lg))
                        .background(if (isSelected) RidersColors.primaryLight else RidersColors.background)
                        .clickable(role = Role.RadioButton, onClick = { onSelect(choice.sort) })
                        .semantics { this.selected = isSelected }
                        .padding(horizontal = RidersSpacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
                ) {
                    Image(
                        painterResource(choice.icon),
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        colorFilter = ColorFilter.tint(if (isSelected) RidersColors.primaryDark else RidersColors.textSecondary),
                    )
                    Text(
                        choice.label,
                        style = RidersType.body.copy(fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium),
                        color = if (isSelected) RidersColors.primaryDark else RidersColors.text,
                        modifier = Modifier.weight(1f),
                    )
                    Box(
                        Modifier
                            .size(22.dp)
                            .clip(CircleShape)
                            .background(if (isSelected) RidersColors.primary else RidersColors.background)
                            .border(if (isSelected) 0.dp else 1.5.dp, RidersColors.border, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isSelected) {
                            Image(
                                painterResource(R.drawable.ic_check),
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                colorFilter = ColorFilter.tint(RidersColors.textInverse),
                            )
                        }
                    }
                }
            }
        }
    }
}

private data class SortChoice(val sort: DeliveryListSort, val label: String, val icon: Int)

@Composable
private fun DeliveryTabs(
    tabs: List<DeliveryBoardTab>,
    selected: DeliveryBoardTab,
    onSelect: (DeliveryBoardTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        tabs.forEach { tab ->
            val isSelected = tab == selected
            val shape = RoundedCornerShape(RidersRadius.lg)
            Box(
                Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = 44.dp)
                    .clip(shape)
                    .background(if (isSelected) RidersColors.primaryLight else RidersColors.background)
                    .border(1.dp, if (isSelected) RidersColors.primary else RidersColors.border, shape)
                    .clickable(role = Role.Button, onClick = { onSelect(tab) })
                    .semantics { this.selected = isSelected }
                    .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.sm),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    when (tab) {
                        DeliveryBoardTab.Active -> "Active"
                        DeliveryBoardTab.Offers -> "My offers"
                        DeliveryBoardTab.Completed -> "Completed"
                    },
                    style = RidersType.body.copy(fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium),
                    color = if (isSelected) RidersColors.primaryDark else RidersColors.textSecondary,
                )
            }
        }
    }
}
