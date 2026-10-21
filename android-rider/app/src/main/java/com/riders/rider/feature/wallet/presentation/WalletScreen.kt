package com.riders.rider.feature.wallet.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.navigation.compose.hiltViewModel
import com.riders.rider.core.design.RidersCard
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersEmptyState
import com.riders.rider.core.design.RidersErrorState
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.design.RidersWordmark
import com.riders.rider.feature.wallet.domain.WALLET_BALANCE_EXPLANATION
import com.riders.rider.feature.wallet.domain.WALLET_BORROWING_EXPLANATION
import com.riders.rider.feature.wallet.domain.WALLET_BORROWING_OVERRIDE
import com.riders.rider.feature.wallet.domain.WALLET_CAPACITY_EXPLANATION
import com.riders.rider.feature.wallet.domain.WALLET_CUSTOMER_PAYMENT
import com.riders.rider.feature.wallet.domain.WALLET_PROMOTIONAL_EXPLANATION
import com.riders.rider.feature.wallet.domain.WALLET_RESERVED_EXPLANATION
import com.riders.rider.feature.wallet.domain.WalletEntry
import com.riders.rider.feature.wallet.domain.WalletSummary
import com.riders.rider.feature.wallet.domain.walletBorrowingSourceLabel
import com.riders.rider.feature.wallet.domain.walletEntryLabel
import com.riders.rider.feature.wallet.domain.walletMoneyLabel
import com.riders.rider.feature.wallet.domain.walletWhenLabel

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
    Column(
        Modifier
            .fillMaxSize()
            .background(RidersColors.background)
            .statusBarsPadding()
            .then(if (inShell) Modifier else Modifier.navigationBarsPadding())
            .verticalScroll(rememberScrollState())
            .padding(horizontal = RidersSpacing.xl, vertical = RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
    ) {
        RidersWordmark()
        Text("Wallet", style = RidersType.title, color = RidersColors.text)
        val board = ui.board
        when {
            ui.loading && board.summary == null -> RidersLoadingState("Loading your wallet")
            board.summary == null && board.error != null -> RidersErrorState(
                title = "Wallet unavailable",
                message = board.error,
                retryLabel = "Refresh",
                onRetry = model::refresh,
            )
            board.summary != null -> {
                SummaryCard(board.summary)
                if (board.error != null) {
                    RidersErrorState(message = board.error, retryLabel = "Refresh", onRetry = model::refresh)
                }
                Text("Activity", style = RidersType.heading, color = RidersColors.text)
                if (board.entries.isEmpty()) {
                    RidersEmptyState(title = "No wallet activity", body = "Platform fees and credits will appear here.")
                } else {
                    board.entries.forEach { entry -> EntryCard(entry) }
                }
                if (board.nextCursor != null) {
                    RidersSecondaryButton(
                        label = "Load more",
                        onClick = model::loadMore,
                        enabled = !ui.paging && !ui.refreshing,
                        loading = ui.paging,
                        modifier = Modifier.fillMaxWidth(),
                        soft = false,
                    )
                }
            }
        }
        if (showBack) {
            RidersSecondaryButton(label = "Back", onClick = onBack, modifier = Modifier.fillMaxWidth(), soft = false)
        }
    }
}

@Composable
private fun SummaryCard(summary: WalletSummary) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text("Wallet balance", style = RidersType.caption, color = RidersColors.textSecondary)
        Text(walletMoneyLabel(summary.currency, summary.balance), style = RidersType.heading, color = RidersColors.text)
        Text(WALLET_BALANCE_EXPLANATION, style = RidersType.caption, color = RidersColors.textSecondary)
        Text("Available for platform fees", style = RidersType.caption, color = RidersColors.textSecondary)
        Text(walletMoneyLabel(summary.currency, summary.availableCapacity), style = RidersType.bodyStrong, color = RidersColors.text)
        Text(WALLET_CAPACITY_EXPLANATION, style = RidersType.caption, color = RidersColors.textSecondary)
        Text("Reserved platform fees", style = RidersType.caption, color = RidersColors.textSecondary)
        Text(walletMoneyLabel(summary.currency, summary.reservedFees), style = RidersType.body, color = RidersColors.text)
        Text(WALLET_RESERVED_EXPLANATION, style = RidersType.caption, color = RidersColors.textSecondary)
        Text("Borrowing limit", style = RidersType.caption, color = RidersColors.textSecondary)
        Text(walletMoneyLabel(summary.currency, summary.borrowingLimit), style = RidersType.body, color = RidersColors.text)
        Text(walletBorrowingSourceLabel(summary.borrowingLimitSource), style = RidersType.captionStrong, color = RidersColors.primaryDark)
        Text(WALLET_BORROWING_EXPLANATION, style = RidersType.caption, color = RidersColors.textSecondary)
        if (summary.borrowingLimitSource == "OVERRIDE") {
            Text(WALLET_BORROWING_OVERRIDE, style = RidersType.caption, color = RidersColors.textSecondary)
        }
        Text(WALLET_PROMOTIONAL_EXPLANATION, style = RidersType.caption, color = RidersColors.textSecondary)
        Text(WALLET_CUSTOMER_PAYMENT, style = RidersType.caption, color = RidersColors.textSecondary)
    }
}

@Composable
private fun EntryCard(entry: WalletEntry) {
    RidersCard(modifier = Modifier.fillMaxWidth()) {
        Text(walletEntryLabel(entry.type), style = RidersType.bodyStrong, color = RidersColors.text)
        Text(walletMoneyLabel(entry.currency, entry.amount), style = RidersType.body, color = RidersColors.text)
        Text("Balance ${walletMoneyLabel(entry.currency, entry.balanceAfter)}", style = RidersType.caption, color = RidersColors.textSecondary)
        Text(walletWhenLabel(entry.createdAt), style = RidersType.caption, color = RidersColors.textSecondary)
        entry.reason?.let { Text(it, style = RidersType.caption, color = RidersColors.textSecondary) }
        entry.receipt?.let { Text(it, style = RidersType.caption, color = RidersColors.textSecondary) }
    }
}
