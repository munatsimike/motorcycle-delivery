package com.riders.rider.feature.home

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
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
import androidx.compose.ui.text.style.TextOverflow
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
import com.riders.rider.feature.offers.presentation.OffersScreen
import com.riders.rider.navigation.DeliveryBoardTab
import com.riders.rider.navigation.defaultDeliveryBoardTab
import com.riders.rider.navigation.deliveriesShowsAssignmentList
import com.riders.rider.navigation.deliveryBoardTabLabel
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
    boardTab: DeliveryBoardTab = defaultDeliveryBoardTab(),
    requestId: String? = null,
    onRequestHandled: () -> Unit = {},
    model: HomeViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var tab by remember(boardTab) { mutableStateOf(boardTab) }
    var content by remember { mutableStateOf(DeliveryContent.All) }
    var sort by remember { mutableStateOf(DeliveryListSort.Newest) }
    var sortOpen by remember { mutableStateOf(false) }
    var filterOpen by remember { mutableStateOf(false) }
    val availability = ui.onboarding?.availability
    Column(
        Modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .statusBarsPadding(),
    ) {
        val committed = ui.committedV2
        val tabs = deliveryBoardTabs()
        val selected = if (tab in tabs) tab else defaultDeliveryBoardTab()
        val contentKind = content.kind()
        if (tabs.size > 1) {
            DeliveryTabs(
                tabs = tabs,
                selected = selected,
                onSelect = { tab = it },
                modifier = Modifier.padding(horizontal = RidersSpacing.lg).padding(top = RidersSpacing.lg, bottom = RidersSpacing.sm),
            )
        }
        DeliveryToolbar(
            content = content,
            sort = sort,
            onFilter = {
                sortOpen = false
                filterOpen = true
            },
            onSort = {
                filterOpen = false
                sortOpen = true
            },
            modifier = Modifier
                .padding(horizontal = RidersSpacing.lg)
                .padding(top = if (tabs.size > 1) 0.dp else RidersSpacing.lg, bottom = RidersSpacing.lg),
        )
        DeliveryFilterSheet(
            visible = filterOpen,
            selected = content,
            onSelect = {
                content = if (it == content || it == DeliveryContent.All) DeliveryContent.All else it
                filterOpen = false
            },
            onDismiss = { filterOpen = false },
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
            DeliveryBoardTab.New -> OffersScreen(
                onAccepted = onOpenDelivery,
                inShell = true,
                modifier = Modifier.weight(1f),
                contentKind = contentKind,
                sort = sort,
                unbidOnly = true,
                offerAssignmentId = requestId,
                onRequestHandled = onRequestHandled,
            )
            DeliveryBoardTab.Pending -> BidBoardScreen(
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
                            body = "Your assigned deliveries will appear here.",
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
private fun DeliveryToolbar(
    content: DeliveryContent,
    sort: DeliveryListSort,
    onFilter: () -> Unit,
    onSort: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val selectedSort = sortChoices.first { it.sort == sort }
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ToolbarMenu(
            label = content.label,
            leading = R.drawable.ic_filter,
            trailing = content.icon,
            contentDescription = "Filter deliveries, ${content.label}",
            onClick = onFilter,
        )
        ToolbarMenu(
            label = selectedSort.shortLabel,
            leading = R.drawable.ic_sort,
            trailing = selectedSort.icon,
            contentDescription = "Sort deliveries, ${selectedSort.label}",
            onClick = onSort,
        )
    }
}

@Composable
private fun ToolbarMenu(
    label: String,
    leading: Int,
    trailing: Int,
    contentDescription: String,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(RidersRadius.pill)
    Row(
        Modifier
            .clip(shape)
            .background(RidersColors.background)
            .border(1.dp, RidersColors.border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.xs),
    ) {
        Image(
            painterResource(leading),
            contentDescription = contentDescription,
            modifier = Modifier.size(18.dp),
            colorFilter = ColorFilter.tint(RidersColors.text),
        )
        Text(label, style = RidersType.caption.copy(fontWeight = FontWeight.SemiBold), color = RidersColors.text)
        Image(
            painterResource(trailing),
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            colorFilter = ColorFilter.tint(RidersColors.text),
        )
        Image(
            painterResource(R.drawable.ic_chevron_down),
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            colorFilter = ColorFilter.tint(RidersColors.textSecondary),
        )
    }
}

@Composable
private fun DeliveryFilterSheet(
    visible: Boolean,
    selected: DeliveryContent,
    onSelect: (DeliveryContent) -> Unit,
    onDismiss: () -> Unit,
) {
    ChoiceSheet(visible = visible, title = "Filter", onDismiss = onDismiss) {
        DeliveryContent.entries.forEach { item ->
            val isSelected = item == selected
            SheetOption(
                label = if (item == DeliveryContent.Document) "Document" else item.label,
                icon = item.icon,
                selected = isSelected,
                onClick = { onSelect(item) },
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
    ChoiceSheet(visible = visible, title = "Sort by", onDismiss = onDismiss) {
        sortChoices.forEach { choice ->
            SheetOption(
                label = choice.label,
                icon = choice.icon,
                selected = choice.sort == selected,
                onClick = { onSelect(choice.sort) },
            )
        }
    }
}

@Composable
private fun ChoiceSheet(
    visible: Boolean,
    title: String,
    onDismiss: () -> Unit,
    options: @Composable () -> Unit,
) {
    val sheetShape = RoundedCornerShape(topStart = RidersRadius.xl, topEnd = RidersRadius.xl)
    RidersBottomSheet(visible = visible, onDismiss = onDismiss, handle = false) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(sheetShape)
                .background(RidersColors.background)
                .navigationBarsPadding()
                .padding(RidersSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
        ) {
            Text(title, style = RidersType.heading, color = RidersColors.text)
            options()
        }
    }
}

@Composable
private fun SheetOption(
    label: String,
    icon: Int,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RidersRadius.md))
            .background(if (selected) RidersColors.surface else RidersColors.background)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .semantics { this.selected = selected }
            .padding(vertical = RidersSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        Image(
            painterResource(icon),
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            colorFilter = ColorFilter.tint(if (selected) RidersColors.primaryDark else RidersColors.textSecondary),
        )
        Text(
            label,
            style = RidersType.body.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal),
            color = if (selected) RidersColors.primaryDark else RidersColors.text,
            modifier = Modifier.weight(1f),
        )
        Box(
            Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(if (selected) RidersColors.primary else RidersColors.background)
                .border(1.dp, if (selected) RidersColors.primary else RidersColors.border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) {
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

private val sortChoices = listOf(
    SortChoice(DeliveryListSort.Oldest, "Date: oldest to newest", "Date", R.drawable.ic_sort_ascending),
    SortChoice(DeliveryListSort.Newest, "Date: newest to oldest", "Date", R.drawable.ic_sort_descending),
    SortChoice(DeliveryListSort.Shortest, "Distance: shortest to longest", "Distance", R.drawable.ic_sort_ascending),
    SortChoice(DeliveryListSort.Longest, "Distance: longest to shortest", "Distance", R.drawable.ic_sort_descending),
    SortChoice(DeliveryListSort.Lowest, "Price: lowest to highest", "Price", R.drawable.ic_sort_ascending),
    SortChoice(DeliveryListSort.Highest, "Price: highest to lowest", "Price", R.drawable.ic_sort_descending),
)

private data class SortChoice(val sort: DeliveryListSort, val label: String, val shortLabel: String, val icon: Int)

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
                    .padding(horizontal = RidersSpacing.xs, vertical = RidersSpacing.sm),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    deliveryBoardTabLabel(tab),
                    style = RidersType.caption.copy(fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium),
                    color = if (isSelected) RidersColors.primaryDark else RidersColors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
