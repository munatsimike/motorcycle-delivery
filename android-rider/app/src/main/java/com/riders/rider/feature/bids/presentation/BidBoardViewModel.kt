package com.riders.rider.feature.bids.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.bids.data.BidAttemptStore
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.bids.domain.BidSubmitGate
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.bidCanWithdraw
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class BidBoardUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val bids: List<OwnBid> = emptyList(),
    val nextCursor: String? = null,
    val loadingMore: Boolean = false,
    val withdrawingBidId: String? = null,
    val error: String? = null,
)

@HiltViewModel
class BidBoardViewModel @Inject constructor(
    private val bids: BidRepository,
    private val keys: BidAttemptStore,
) : ViewModel() {
    private val state = MutableStateFlow(BidBoardUi())
    val ui: StateFlow<BidBoardUi> = state.asStateFlow()
    private val withdrawGate = BidSubmitGate()
    private var loadingList = false

    fun refresh() {
        if (loadingList) {
            return
        }
        loadingList = true
        val current = state.value
        state.value = current.copy(
            refreshing = current.bids.isNotEmpty() || current.error != null,
            loading = current.bids.isEmpty() && current.error == null,
            error = null,
        )
        viewModelScope.launch {
            try {
                reload(null)
            } finally {
                loadingList = false
            }
        }
    }

    fun withdraw(bidId: String) {
        val bid = state.value.bids.firstOrNull { it.bidId == bidId } ?: return
        if (!bidCanWithdraw(bid.status) || !withdrawGate.tryStart(bidId)) {
            return
        }
        state.value = state.value.copy(withdrawingBidId = bidId, error = null)
        viewModelScope.launch {
            try {
                when (val result = bids.withdraw(bidId)) {
                    is ApiResult.Ok -> reload(null)
                    is ApiResult.Err -> reload(result.error.text())
                }
            } finally {
                withdrawGate.finish(bidId)
                state.value = state.value.copy(withdrawingBidId = null)
            }
        }
    }

    fun loadMore() {
        val cursor = state.value.nextCursor ?: return
        if (state.value.loadingMore || loadingList) {
            return
        }
        state.value = state.value.copy(loadingMore = true)
        viewModelScope.launch {
            try {
                when (val result = bids.refreshOwnBids(cursor)) {
                    is ApiResult.Ok -> {
                        val merged = bids.ownBidsFlow.value
                        keys.retain(merged)
                        state.value = state.value.copy(
                            bids = merged,
                            nextCursor = result.value.nextCursor,
                        )
                    }
                    is ApiResult.Err -> state.value = state.value.copy(error = result.error.text())
                }
            } finally {
                state.value = state.value.copy(loadingMore = false)
            }
        }
    }

    private suspend fun reload(keepError: String?) {
        val own = bids.refreshOwnBids(null)
        val ownValue = (own as? ApiResult.Ok)?.value
        val nextBids = ownValue?.bids ?: state.value.bids
        if (ownValue != null) {
            keys.retain(nextBids)
        }
        state.value = state.value.copy(
            loading = false,
            refreshing = false,
            bids = nextBids,
            nextCursor = if (ownValue != null) ownValue.nextCursor else state.value.nextCursor,
            error = keepError ?: (own as? ApiResult.Err)?.error?.text(),
        )
    }
}
