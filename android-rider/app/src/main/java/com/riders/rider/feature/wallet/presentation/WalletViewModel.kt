package com.riders.rider.feature.wallet.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.WalletSummaryResponse
import com.riders.rider.core.network.text
import com.riders.rider.feature.wallet.data.WalletPage
import com.riders.rider.feature.wallet.data.WalletRepository
import com.riders.rider.feature.wallet.domain.WalletBoard
import com.riders.rider.feature.wallet.domain.WalletRefresh
import com.riders.rider.feature.wallet.domain.WalletSummary
import com.riders.rider.feature.wallet.domain.walletAfterPage
import com.riders.rider.feature.wallet.domain.walletAfterRefresh
import com.riders.rider.feature.wallet.domain.shouldLoadWalletPage
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job

data class WalletUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val paging: Boolean = false,
    val currency: String = "USD",
    val usd: WalletSummary? = null,
    val zig: WalletSummary? = null,
    val board: WalletBoard = WalletBoard(),
)

@HiltViewModel
class WalletViewModel @Inject constructor(
    private val wallets: WalletRepository,
) : ViewModel() {
    private val state = MutableStateFlow(WalletUi())
    val ui: StateFlow<WalletUi> = state.asStateFlow()
    private var request: Job? = null
    private var generation = 0L
    private var currencyChosen = false

    fun refresh(fromUser: Boolean = false) {
        val token = ++generation
        request?.cancel()
        request = viewModelScope.launch {
                val hasSummary = state.value.board.summary != null
                // Only user-initiated refreshes show the pull-to-refresh indicator.
                state.update { it.copy(refreshing = fromUser && hasSummary, loading = !hasSummary, paging = false) }
                try {
                    val summary = wallets.summary()
                    val serverWallet = (summary as? ApiResult.Ok)?.value?.activeWallet
                    val selected = if (!currencyChosen && (serverWallet == "USD" || serverWallet == "ZWG")) {
                        serverWallet
                    } else {
                        state.value.currency
                    }
                    val page = wallets.transactions(cursor = null, currency = selected)
                    if (token != generation) return@launch
                    state.update { current ->
                        val refreshed = walletRefresh(summary, page, selected)
                        if (current.currency != selected && currencyChosen) {
                            current.copy(usd = refreshed.usd ?: current.usd, zig = refreshed.zig ?: current.zig)
                        } else {
                            current.copy(
                                currency = selected,
                                usd = refreshed.usd ?: current.usd,
                                zig = refreshed.zig ?: current.zig,
                                board = walletAfterRefresh(current.board, refreshed.refresh),
                            )
                        }
                    }
                } finally {
                    if (token == generation) state.update { it.copy(loading = false, refreshing = false) }
                }
        }
    }

    fun loadMore() {
        if (!shouldLoadWalletPage(state.value.board.nextCursor, state.value.loading || state.value.refreshing || state.value.paging || request?.isActive == true)) {
            return
        }
        val cursor = state.value.board.nextCursor ?: return
        val currency = state.value.currency
        val token = ++generation
        state.update { it.copy(paging = true) }
        request = viewModelScope.launch {
                try {
                    val page = wallets.transactions(cursor, currency)
                    if (token != generation || state.value.currency != currency) return@launch
                    when (page) {
                        is ApiResult.Ok -> state.update { current ->
                            current.copy(
                                board = walletAfterPage(
                                    current.board,
                                    entries = page.value.entries,
                                    nextCursor = page.value.nextCursor?.takeUnless { it == cursor },
                                    error = null,
                                ),
                            )
                        }
                        is ApiResult.Err -> state.update { current ->
                            current.copy(
                                board = walletAfterPage(
                                    current.board,
                                    entries = null,
                                    nextCursor = null,
                                    error = page.error.text(),
                                ),
                            )
                        }
                    }
                } finally {
                    if (token == generation) state.update { it.copy(paging = false) }
                }
        }
    }

    fun selectCurrency(currency: String) {
        if (currency != "USD" && currency != "ZWG") return
        currencyChosen = true
        if (currency == state.value.currency) return
        state.update { current ->
            current.copy(
                currency = currency,
                board = current.board.copy(
                    summary = if (currency == "ZWG") current.zig else current.usd,
                    entries = emptyList(),
                    nextCursor = null,
                    error = null,
                ),
            )
        }
        // Preserve the loading feedback for an explicit currency change.
        refresh(fromUser = true)
    }

}

private data class LoadedWallets(
    val refresh: WalletRefresh,
    val usd: WalletSummary?,
    val zig: WalletSummary?,
)

private fun walletRefresh(
    summary: ApiResult<WalletSummaryResponse>,
    page: ApiResult<WalletPage>,
    selected: String,
): LoadedWallets {
    val response = (summary as? ApiResult.Ok)?.value
    val usd = response?.toSummary()
    val zig = response?.zig?.toSummary() ?: if (usd != null) emptyZig() else null
    val loaded = if (selected == "ZWG") zig else usd
    val history = page as? ApiResult.Ok
    val refresh = when {
        loaded != null && history != null -> WalletRefresh.Ready(
            summary = loaded,
            entries = history.value.entries,
            nextCursor = history.value.nextCursor,
        )
        loaded != null -> WalletRefresh.SummaryOnly(loaded, (page as ApiResult.Err).error.text())
        summary is ApiResult.Err -> WalletRefresh.Failed(summary.error.text())
        else -> WalletRefresh.Failed((page as ApiResult.Err).error.text())
    }
    return LoadedWallets(refresh, usd, zig)
}

private fun emptyZig(): WalletSummary = WalletSummary(
    balance = "0.00",
    borrowingLimit = "0.00",
    borrowingLimitSource = "NONE",
    reservedFees = "0.00",
    availableCapacity = "0.00",
    currency = "ZWG",
    promotionalBalance = "0.00",
    availablePromotionalCredit = "0.00",
)

private fun com.riders.rider.core.network.ZigWalletResponse.toSummary(): WalletSummary = WalletSummary(
    balance = balance,
    borrowingLimit = "0.00",
    borrowingLimitSource = "NONE",
    reservedFees = reservedFees,
    availableCapacity = availableCapacity,
    currency = "ZWG",
    promotionalBalance = promotionalBalance,
    availablePromotionalCredit = availablePromotionalCredit,
)

private fun WalletSummaryResponse.toSummary(): WalletSummary = WalletSummary(
    balance = balance,
    borrowingLimit = borrowingLimit,
    borrowingLimitSource = borrowingLimitSource,
    reservedFees = reservedFees,
    availableCapacity = availableCapacity,
    currency = currency,
    promotionalBalance = promotionalBalance,
    availablePromotionalCredit = availablePromotionalCredit,
    newDeliveriesRestricted = newDeliveriesRestricted,
)
