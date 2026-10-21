package com.riders.rider.feature.wallet.data

import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.RiderService
import com.riders.rider.core.network.WalletSummaryResponse
import com.riders.rider.core.network.apiCall
import com.riders.rider.feature.wallet.domain.WalletEntry
import com.riders.rider.feature.wallet.domain.walletReceiptLabel
import javax.inject.Inject
import javax.inject.Singleton

data class WalletPage(
    val entries: List<WalletEntry>,
    val nextCursor: String?,
)

@Singleton
class WalletRepository @Inject constructor(
    private val riders: RiderService,
) {
    suspend fun summary(): ApiResult<WalletSummaryResponse> = apiCall { riders.wallet() }

    suspend fun transactions(cursor: String?): ApiResult<WalletPage> {
        return when (val result = apiCall { riders.walletTransactions(limit = PAGE_SIZE, cursor = cursor) }) {
            is ApiResult.Ok -> ApiResult.Ok(
                WalletPage(
                    entries = result.value.transactions.map { row ->
                        WalletEntry(
                            id = row.id,
                            type = row.type,
                            amount = row.amount,
                            balanceAfter = row.balanceAfter,
                            currency = row.currency,
                            createdAt = row.createdAt,
                            reason = row.reason?.takeIf { it.isNotBlank() },
                            receipt = walletReceiptLabel(
                                row.payment?.ecocashReference,
                                row.payment?.externalReceiptNumber,
                                row.payment?.internalReceiptId,
                            ),
                        )
                    },
                    nextCursor = result.value.nextCursor?.takeIf { it.isNotBlank() },
                ),
            )
            is ApiResult.Err -> result
        }
    }

    private companion object {
        const val PAGE_SIZE = 20
    }
}
