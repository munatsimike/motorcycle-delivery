package com.riders.rider.feature.bids.presentation

import com.riders.rider.core.design.RidersToastEvent
import com.riders.rider.core.design.ridersSuccessToast
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.refresh.clearListedRefresh
import com.riders.rider.core.refresh.listedRefresh
import com.riders.rider.core.network.text
import com.riders.rider.feature.bids.data.BidAttemptStore
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.bids.domain.BidSubmitGate
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.bidCanWithdraw
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
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
    private val pending: com.riders.rider.feature.offers.notification.PendingOffer,
) : ViewModel() {
    private val state = MutableStateFlow(BidBoardUi())
    private val toasts = MutableSharedFlow<RidersToastEvent>(extraBufferCapacity = 4)
    val successToasts = toasts.asSharedFlow()
    val ui: StateFlow<BidBoardUi> = combine(state, bids.ownBidPageFlow) { chrome, page ->
        chrome.copy(bids = page.bids, nextCursor = page.nextCursor)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, state.value.copy(
        bids = bids.ownBidPageFlow.value.bids,
        nextCursor = bids.ownBidPageFlow.value.nextCursor,
    ))
    private val withdrawGate = BidSubmitGate()
    private var loadingList = false
    private var rerun = false
    private var rerunFromUser = false
    private var refreshTicket = 0

    init {
        viewModelScope.launch {
            pending.bidExpired.collect { refresh() }
        }
        viewModelScope.launch { pending.acceptedArrivals.collect { refresh() } }
        viewModelScope.launch { pending.customerCancelledArrivals.collect { refresh() } }
    }

    fun refresh() {
        begin(fromUser = false)
    }

    fun pullRefresh() {
        begin(fromUser = true)
    }

    private fun begin(fromUser: Boolean) {
        if (loadingList) {
            rerun = true
            if (fromUser) {
                rerunFromUser = true
            }
            return
        }
        loadingList = true
        val ticket = ++refreshTicket
        val current = state.value
        val blank = bids.ownBidPageFlow.value.bids.isEmpty() && current.error == null
        val chrome = listedRefresh(fromUser, blank)
        state.value = current.copy(
            refreshing = chrome.refreshing,
            loading = chrome.loading,
            error = null,
        )
        viewModelScope.launch {
            try {
                reload(null, ticket, refreshLoaded = fromUser)
            } finally {
                val queued = rerun
                val queuedFromUser = rerunFromUser
                if (ticket == refreshTicket) {
                    rerun = false
                    rerunFromUser = false
                    val cleared = clearListedRefresh(ticket, refreshTicket, state.value.loading, state.value.refreshing)
                    state.value = state.value.copy(loading = cleared.loading, refreshing = cleared.refreshing)
                    loadingList = false
                }
                if (ticket == refreshTicket && queued) {
                    begin(queuedFromUser)
                }
            }
        }
    }

    fun withdraw(bidId: String) {
        val bid = bids.ownBidPageFlow.value.bids.firstOrNull { it.bidId == bidId } ?: return
        if (!bidCanWithdraw(bid.status) || !withdrawGate.tryStart(bidId)) {
            return
        }
        state.value = state.value.copy(withdrawingBidId = bidId, error = null)
        viewModelScope.launch {
            try {
                when (val result = bids.withdraw(bidId)) {
                    is ApiResult.Ok -> {
                        toasts.tryEmit(ridersSuccessToast("Offer withdrawn"))
                        reload(null)
                    }
                    is ApiResult.Err -> reload(result.error.text())
                }
            } finally {
                withdrawGate.finish(bidId)
                state.value = state.value.copy(withdrawingBidId = null)
            }
        }
    }

    fun loadMore() {
        val cursor = bids.ownBidPageFlow.value.nextCursor ?: return
        if (state.value.loadingMore || loadingList) {
            return
        }
        state.value = state.value.copy(loadingMore = true)
        viewModelScope.launch {
            try {
                when (val result = bids.refreshOwnBids(cursor)) {
                    is ApiResult.Ok -> {
                        keys.retain(result.value.bids)
                    }
                    is ApiResult.Err -> state.value = state.value.copy(error = result.error.text())
                }
            } finally {
                state.value = state.value.copy(loadingMore = false)
            }
        }
    }

    private suspend fun reload(keepError: String?, ticket: Int? = null, refreshLoaded: Boolean = false) {
        val own = bids.refreshOwnBids(null, refreshLoaded = refreshLoaded)
        val ownValue = (own as? ApiResult.Ok)?.value
        if (ownValue != null) {
            keys.retain(ownValue.bids)
        }
        if (ticket != null && ticket != refreshTicket) {
            return
        }
        state.value = state.value.copy(
            loading = false,
            refreshing = false,
            error = keepError ?: (own as? ApiResult.Err)?.error?.text(),
        )
    }
}
