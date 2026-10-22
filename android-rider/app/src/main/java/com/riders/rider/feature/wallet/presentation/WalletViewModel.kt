package com.riders.rider.feature.wallet.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.WalletSummaryResponse
import com.riders.rider.core.network.text
import com.riders.rider.feature.wallet.data.WalletPage
import com.riders.rider.feature.wallet.data.WalletRepository
import com.riders.rider.feature.wallet.domain.WalletBoard
import com.riders.rider.feature.wallet.domain.WalletLoadGate
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

data class WalletUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val paging: Boolean = false,
    val board: WalletBoard = WalletBoard(),
)

@HiltViewModel
class WalletViewModel @Inject constructor(
    private val wallets: WalletRepository,
) : ViewModel() {
    private val state = MutableStateFlow(WalletUi())
    val ui: StateFlow<WalletUi> = state.asStateFlow()
    private val gate = WalletLoadGate()

    fun refresh(fromUser: Boolean = false) {
        viewModelScope.launch {
            gate.run {
                val hasSummary = state.value.board.summary != null
                state.update { it.copy(refreshing = fromUser && hasSummary, loading = !hasSummary) }
                try {
                    val summary = wallets.summary()
                    val page = wallets.transactions(cursor = null)
                    state.update { current ->
                        current.copy(board = walletAfterRefresh(current.board, walletRefresh(summary, page)))
                    }
                } finally {
                    state.update { it.copy(loading = false, refreshing = false) }
                }
            }
        }
    }

    fun loadMore() {
        if (!shouldLoadWalletPage(state.value.board.nextCursor, state.value.refreshing || state.value.paging)) {
            return
        }
        viewModelScope.launch {
            gate.run {
                val cursor = state.value.board.nextCursor ?: return@run
                state.update { it.copy(paging = true) }
                try {
                    when (val page = wallets.transactions(cursor)) {
                        is ApiResult.Ok -> state.update { current ->
                            current.copy(
                                board = walletAfterPage(
                                    current.board,
                                    entries = page.value.entries,
                                    nextCursor = page.value.nextCursor,
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
                    state.update { it.copy(paging = false) }
                }
            }
        }
    }

}

private fun walletRefresh(
    summary: ApiResult<WalletSummaryResponse>,
    page: ApiResult<WalletPage>,
): WalletRefresh {
    val loaded = (summary as? ApiResult.Ok)?.value?.toSummary()
    val history = page as? ApiResult.Ok
    return when {
        loaded != null && history != null -> WalletRefresh.Ready(
            summary = loaded,
            entries = history.value.entries,
            nextCursor = history.value.nextCursor,
        )
        loaded != null -> WalletRefresh.SummaryOnly(loaded, (page as ApiResult.Err).error.text())
        summary is ApiResult.Err -> WalletRefresh.Failed(summary.error.text())
        else -> WalletRefresh.Failed((page as ApiResult.Err).error.text())
    }
}

private fun WalletSummaryResponse.toSummary(): WalletSummary = WalletSummary(
    balance = balance,
    borrowingLimit = borrowingLimit,
    borrowingLimitSource = borrowingLimitSource,
    reservedFees = reservedFees,
    availableCapacity = availableCapacity,
    currency = currency,
)
