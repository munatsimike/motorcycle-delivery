package com.riders.rider.feature.bids.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.bids.data.BidAttemptStore
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.bids.domain.BID_AMOUNT_INVALID
import com.riders.rider.feature.bids.domain.BidAttempt
import com.riders.rider.feature.bids.domain.BidSubmitGate
import com.riders.rider.feature.bids.domain.OpenBidRequest
import com.riders.rider.feature.bids.domain.OwnBid
import com.riders.rider.feature.bids.domain.bidAmountCents
import com.riders.rider.feature.bids.domain.bidCanWithdraw
import com.riders.rider.feature.bids.domain.formatBidDollars
import com.riders.rider.feature.bids.domain.keepsBidAttempt
import com.riders.rider.feature.bids.domain.newBidsUnavailable
import com.riders.rider.feature.delivery.data.AssignmentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class BidBoardUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val requests: List<OpenBidRequest> = emptyList(),
    val bids: List<OwnBid> = emptyList(),
    val nextCursor: String? = null,
    val loadingMore: Boolean = false,
    val selectedRequestId: String? = null,
    val amountText: String = "",
    val amountError: String? = null,
    val submitting: Boolean = false,
    val withdrawingBidId: String? = null,
    val expressBlocksBids: Boolean = false,
    val error: String? = null,
    val pendingAttempt: BidAttempt? = null,
)

@HiltViewModel
class BidBoardViewModel @Inject constructor(
    private val bids: BidRepository,
    private val assignments: AssignmentRepository,
    private val keys: BidAttemptStore,
) : ViewModel() {
    private val state = MutableStateFlow(BidBoardUi())
    val ui: StateFlow<BidBoardUi> = state.asStateFlow()
    private val submitGate = BidSubmitGate()
    private val withdrawGate = BidSubmitGate()
    private var loadingList = false

    fun refresh() {
        if (loadingList) {
            return
        }
        loadingList = true
        val current = state.value
        state.value = current.copy(
            refreshing = current.requests.isNotEmpty() || current.bids.isNotEmpty() || current.error != null,
            loading = current.requests.isEmpty() && current.bids.isEmpty() && current.error == null,
            error = null,
            amountError = null,
        )
        viewModelScope.launch {
            try {
                reload(null)
            } finally {
                loadingList = false
            }
        }
    }

    fun select(requestId: String?) {
        val pending = state.value.pendingAttempt
        val amount = if (pending != null && pending.deliveryId == requestId) {
            formatBidDollars(pending.amountCents)
        } else {
            ""
        }
        state.value = state.value.copy(selectedRequestId = requestId, amountText = amount, amountError = null)
    }

    fun amountChanged(value: String) {
        val pending = state.value.pendingAttempt
        if (pending != null && pending.deliveryId == state.value.selectedRequestId) {
            return
        }
        state.value = state.value.copy(amountText = value, amountError = null)
    }

    fun submit(deliveryId: String) {
        val cents = bidAmountCents(state.value.amountText)
        if (cents == null) {
            state.value = state.value.copy(amountError = BID_AMOUNT_INVALID)
            return
        }
        if (!submitGate.tryStart(deliveryId)) {
            return
        }
        state.value = state.value.copy(submitting = true, amountError = null, error = null)
        viewModelScope.launch {
            try {
                val attempt = keys.attempt(deliveryId, cents)
                state.value = state.value.copy(
                    pendingAttempt = attempt,
                    amountText = formatBidDollars(attempt.amountCents),
                )
                when (val result = bids.submit(attempt.deliveryId, attempt.amountCents, attempt.key)) {
                    is ApiResult.Ok -> {
                        keys.clear(deliveryId)
                        state.value = state.value.copy(pendingAttempt = null, selectedRequestId = null, amountText = "")
                        reload(null)
                    }
                    is ApiResult.Err -> {
                        if (!keepsBidAttempt(result.error)) {
                            keys.clear(deliveryId)
                            state.value = state.value.copy(pendingAttempt = null)
                        }
                        reload(result.error.text())
                    }
                }
            } finally {
                submitGate.finish(deliveryId)
                state.value = state.value.copy(submitting = false)
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
                when (val result = bids.ownBids(cursor)) {
                    is ApiResult.Ok -> {
                        val merged = state.value.bids + result.value.bids
                        keys.retain(merged)
                        state.value = state.value.copy(
                            bids = merged,
                            nextCursor = result.value.nextCursor,
                            pendingAttempt = keys.pending(state.value.selectedRequestId.orEmpty()),
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
        val open = bids.openRequests()
        val own = bids.ownBids(null)
        assignments.refreshList()
        val openValue = (open as? ApiResult.Ok)?.value
        val ownValue = (own as? ApiResult.Ok)?.value
        val nextBids = ownValue?.bids ?: state.value.bids
        if (ownValue != null) {
            keys.retain(nextBids)
        }
        val selected = state.value.selectedRequestId
        val pending = if (selected == null) null else keys.pending(selected)
        state.value = state.value.copy(
            loading = false,
            refreshing = false,
            requests = openValue ?: state.value.requests,
            bids = nextBids,
            nextCursor = if (ownValue != null) ownValue.nextCursor else state.value.nextCursor,
            expressBlocksBids = newBidsUnavailable(assignments.current().map { it.serviceClass }),
            pendingAttempt = pending,
            amountText = if (pending != null) formatBidDollars(pending.amountCents) else state.value.amountText,
            error = keepError
                ?: (open as? ApiResult.Err)?.error?.text()
                ?: (own as? ApiResult.Err)?.error?.text(),
        )
    }
}
