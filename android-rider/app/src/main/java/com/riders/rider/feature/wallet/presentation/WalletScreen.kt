package com.riders.rider.feature.wallet.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.wallet.domain.WalletEntry
import com.riders.rider.feature.wallet.domain.WalletSummary
import com.riders.rider.feature.wallet.domain.walletBalanceIsNegative
import com.riders.rider.feature.wallet.domain.walletActivityLabel
import com.riders.rider.feature.wallet.domain.walletEntryLabel
import com.riders.rider.feature.wallet.domain.walletMoneyLabel
import com.riders.rider.feature.wallet.domain.walletPaymentMethodLabel

private val HeaderGreen = Color(0xFFC9EFD9)
private val HeaderMid = Color(0xFFE5F7EE)
private val HeaderFade = Color(0xFFF7FCF9)
private val CapacityFill = Color(0xFFE9F8EF)
private val BorrowingFill = Color(0xFFDDF3E8)
private val CashTint = Color(0xFFC56A2D)
private val CashFill = Color(0xFFFFF1E6)
private val EcoCashTint = Color(0xFF0077C8)
private val EcoCashFill = Color(0xFFE5F4FC)
private val GiftFill = Color(0xFFE9F8EF)
private val FeeFill = Color(0xFFF2F4F3)
private val FeeTint = Color(0xFF8A9690)

@Composable
fun WalletScreen(
    onBack: () -> Unit = {},
    showBack: Boolean = true,
    inShell: Boolean = false,
    model: WalletViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                model.refresh()
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            model.refresh()
        }
        onDispose { lifecycle.removeObserver(observer) }
    }
    var showTopUp by remember { mutableStateOf(false) }
    if (showTopUp) {
        AlertDialog(
            onDismissRequest = { showTopUp = false },
            title = { Text("How to top up", style = RidersType.heading, color = RidersColors.text) },
            text = {
                Text(
                    "Add funds through a Riders admin using cash or EcoCash.",
                    style = RidersType.body,
                    color = RidersColors.text,
                )
            },
            confirmButton = {
                TextButton(onClick = { showTopUp = false }) { Text("OK") }
            },
        )
    }
    RidersPullRefresh(
        refreshing = ui.refreshing,
        onRefresh = { model.refresh(fromUser = true) },
        modifier = Modifier
            .fillMaxSize()
            .background(HeaderFade)
            .then(if (inShell) Modifier else Modifier.navigationBarsPadding()),
    ) {
    val board = ui.board
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val historyMinHeight = (maxHeight - 280.dp).coerceAtLeast(360.dp)
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Box(Modifier.fillMaxWidth().clipToBounds()) {
            WalletBackdrop(Modifier.matchParentSize())
            Column(
                Modifier
                    .fillMaxWidth()
                    .then(if (inShell) Modifier else Modifier.statusBarsPadding())
                    .padding(horizontal = RidersSpacing.xl)
                    .padding(top = RidersSpacing.lg, bottom = 40.dp),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
            ) {
                WalletTitle(showBack = showBack, onBack = onBack)
                when {
                    ui.loading && board.summary == null -> RidersLoadingState("Loading your wallet")
                    board.summary == null && board.error != null -> RidersFailureNotice(
                        message = board.error,
                        title = "Wallet unavailable",
                        onRetry = { model.refresh(fromUser = true) },
                    )
                    board.summary != null -> BalanceCard(board.summary, onTopUp = { showTopUp = true })
                }
            }
        }
        if (board.summary != null) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = historyMinHeight)
                    .pullUp(32.dp)
                    .clip(RoundedCornerShape(topStart = RidersRadius.xl, topEnd = RidersRadius.xl))
                    .background(RidersColors.background)
                    .padding(horizontal = RidersSpacing.xl)
                    .padding(top = RidersSpacing.xl, bottom = RidersSpacing.xxl),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
            ) {
                if (board.error != null) {
                    RidersFailureNotice(
                        message = board.error,
                        onRetry = { model.refresh(fromUser = true) },
                    )
                }
                HistoryHeading(
                    canSeeAll = board.nextCursor != null,
                    enabled = !ui.paging && !ui.refreshing,
                    onSeeAll = model::loadMore,
                )
                if (board.entries.isEmpty()) {
                    RidersEmptyState(title = "No wallet activity", body = "Platform fees and credits will appear here.")
                } else {
                    Column(Modifier.fillMaxWidth()) {
                        board.entries.forEachIndexed { index, entry ->
                            EntryRow(entry)
                            if (index < board.entries.lastIndex) {
                                Box(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(start = 48.dp)
                                        .height(1.dp)
                                        .background(RidersColors.border),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
    }
    }
}

private fun Modifier.pullUp(overlap: Dp): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val shift = overlap.roundToPx()
    layout(placeable.width, (placeable.height - shift).coerceAtLeast(0)) {
        placeable.placeRelative(0, -shift)
    }
}

@Composable
private fun WalletTitle(showBack: Boolean, onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showBack) {
            Icon(
                painter = painterResource(R.drawable.ic_chevron_left),
                contentDescription = "Back",
                modifier = Modifier
                    .size(28.dp)
                    .clickable(role = Role.Button, onClick = onBack),
                tint = RidersColors.text,
            )
            Spacer(Modifier.width(RidersSpacing.sm))
        }
        Text("My Wallet", style = RidersType.heading, color = RidersColors.text)
    }
}

@Composable
private fun WalletBackdrop(modifier: Modifier = Modifier) {
    Box(modifier.clipToBounds()) {
        Box(
            Modifier
                .matchParentSize()
                .background(
                    Brush.verticalGradient(
                        0f to HeaderGreen,
                        0.62f to HeaderMid,
                        1f to HeaderFade,
                    ),
                ),
        )
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = 50.dp, y = (-90).dp)
                .size(220.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.45f)),
        )
        Box(
            Modifier
                .align(Alignment.BottomStart)
                .offset(x = (-120).dp, y = 280.dp)
                .size(720.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.55f)),
        )
    }
}

@Composable
private fun BalanceCard(summary: WalletSummary, onTopUp: () -> Unit) {
    val negative = walletBalanceIsNegative(summary.balance)
    val shape = RoundedCornerShape(RidersRadius.xl)
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(8.dp, shape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
            .clip(shape)
            .background(RidersColors.background)
            .padding(RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
                Text("Balance", style = RidersType.caption, color = RidersColors.textSecondary)
                Text(
                    walletMoneyLabel(summary.currency, summary.balance),
                    style = RidersType.title.copy(fontSize = 32.sp, fontWeight = FontWeight.Bold, lineHeight = 38.sp),
                    color = if (negative) RidersColors.error else RidersColors.text,
                )
                if (negative) {
                    Text("Amount owed to the platform", style = RidersType.caption, color = RidersColors.error)
                }
            }
            Text(
                "Top up",
                style = RidersType.bodyStrong,
                color = RidersColors.textInverse,
                modifier = Modifier
                    .clip(RoundedCornerShape(RidersRadius.pill))
                    .background(RidersColors.primary)
                    .clickable(role = Role.Button, onClick = onTopUp)
                    .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md),
            )
        }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        ) {
            BalanceOption(
                icon = R.drawable.ic_gauge,
                label = "Available capacity",
                value = walletMoneyLabel(summary.currency, summary.availableCapacity),
                fill = CapacityFill,
                modifier = Modifier.weight(1f),
            )
            BalanceOption(
                icon = R.drawable.ic_coins,
                label = "Borrowing limit",
                value = walletMoneyLabel(summary.currency, summary.borrowingLimit),
                fill = BorrowingFill,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun BalanceOption(
    icon: Int,
    label: String,
    value: String,
    fill: Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        Box(
            Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(RidersRadius.md))
                .background(fill),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(icon),
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = RidersColors.primaryDark,
            )
        }
        Text(label, style = RidersType.caption, color = RidersColors.textSecondary, textAlign = TextAlign.Center, maxLines = 2)
        Text(value, style = RidersType.bodyStrong, color = RidersColors.text, textAlign = TextAlign.Center, maxLines = 1)
    }
}

@Composable
private fun HistoryHeading(canSeeAll: Boolean, enabled: Boolean, onSeeAll: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text("Transaction history", style = RidersType.heading, color = RidersColors.text)
        if (canSeeAll) {
            Text(
                "See all",
                style = RidersType.captionStrong,
                color = RidersColors.primary,
                modifier = Modifier
                    .clip(RoundedCornerShape(RidersRadius.pill))
                    .background(RidersColors.primaryLight)
                    .clickable(enabled = enabled, role = Role.Button, onClick = onSeeAll)
                    .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.xs),
            )
        }
    }
}

@Composable
private fun EntryRow(entry: WalletEntry) {
    val tone = entryTone(entry)
    val detail = historyDetail(entry)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = RidersSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        SoftIcon(tone.icon, tone.fill, tone.tint, rounded = rowMethodLabel(entry) != null)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(rowMethodLabel(entry) ?: tone.title, style = RidersType.bodyStrong, color = RidersColors.text, maxLines = 1)
            Text(walletActivityLabel(entry.createdAt), style = RidersType.caption, color = RidersColors.textSecondary, maxLines = 1)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(activityAmount(entry.currency, entry.amount), style = RidersType.bodyStrong, color = tone.amount, maxLines = 1)
            if (detail != null) {
                Text(detail, style = RidersType.caption, color = RidersColors.textSecondary, maxLines = 1)
            }
        }
    }
}

@Composable
private fun SoftIcon(icon: Int, fill: Color, tint: Color, rounded: Boolean = false) {
    Box(
        Modifier
            .size(36.dp)
            .clip(if (rounded) RoundedCornerShape(RidersRadius.lg) else CircleShape)
            .background(fill),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = tint,
        )
    }
}

private data class EntryTone(
    val title: String,
    val icon: Int,
    val tint: Color,
    val fill: Color,
    val amount: Color,
)

private fun rowMethodLabel(entry: WalletEntry): String? {
    walletPaymentMethodLabel(entry.method?.trim()?.uppercase())?.let { return it }
    val receipt = entry.receipt.orEmpty()
    return when {
        receipt.startsWith("EcoCash") -> "EcoCash"
        entry.type == "TOP_UP" && receipt.startsWith("Receipt") -> "Cash"
        else -> null
    }
}

private fun entryTone(entry: WalletEntry): EntryTone {
    when (rowMethodLabel(entry)) {
        "Cash" -> return EntryTone("Top-up", R.drawable.ic_cash, CashTint, CashFill, RidersColors.primary)
        "EcoCash" -> return EntryTone("Top-up", R.drawable.ic_cellphone, EcoCashTint, EcoCashFill, RidersColors.primary)
    }
    if (entry.type == "PLATFORM_FEE") {
        return EntryTone("Platform fee", R.drawable.ic_motorbike, FeeTint, FeeFill, RidersColors.error)
    }
    val credit = entryCredit(entry.amount)
    val welcome = entry.type == "WELCOME_BONUS" || entry.type == "PROMOTIONAL_CREDIT"
    return EntryTone(
        title = walletEntryLabel(entry.type),
        icon = if (welcome || credit) R.drawable.ic_gift else R.drawable.ic_receipt,
        tint = if (credit) RidersColors.primary else FeeTint,
        fill = if (credit) GiftFill else FeeFill,
        amount = if (credit) RidersColors.primary else RidersColors.error,
    )
}

private fun historyDetail(entry: WalletEntry): String? {
    if (rowMethodLabel(entry) != null) {
        return null
    }
    val receipt = entry.receipt?.takeIf { it.isNotBlank() }
    if (receipt != null) {
        return receipt
    }
    return entry.reason?.takeIf { it.isNotBlank() }
}

private fun entryCredit(amount: String): Boolean = !walletBalanceIsNegative(amount)

private fun activityAmount(currency: String, amount: String): String {
    val trimmed = amount.trim()
    val negative = trimmed.startsWith("-")
    val digits = trimmed.removePrefix("-").removePrefix("+")
    return if (negative) "−$currency $digits" else "+$currency $digits"
}
