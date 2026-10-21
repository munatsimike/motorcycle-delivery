package com.riders.rider

import com.riders.rider.core.network.ApiJson
import com.riders.rider.core.network.WalletSummaryResponse
import com.riders.rider.core.network.WalletTransactionsResponse
import com.riders.rider.feature.wallet.domain.WALLET_BALANCE_EXPLANATION
import com.riders.rider.feature.wallet.domain.WALLET_BORROWING_EXPLANATION
import com.riders.rider.feature.wallet.domain.WALLET_BORROWING_OVERRIDE
import com.riders.rider.feature.wallet.domain.WALLET_CAPACITY_EXPLANATION
import com.riders.rider.feature.wallet.domain.WALLET_CUSTOMER_PAYMENT
import com.riders.rider.feature.wallet.domain.WALLET_RESERVED_EXPLANATION
import com.riders.rider.feature.wallet.domain.WalletBoard
import com.riders.rider.feature.wallet.domain.WalletEntry
import com.riders.rider.feature.wallet.domain.WalletLoadGate
import com.riders.rider.feature.wallet.domain.WalletRefresh
import com.riders.rider.feature.wallet.domain.WalletSummary
import com.riders.rider.feature.wallet.domain.displayedBalance
import com.riders.rider.feature.wallet.domain.displayedBorrowingLimit
import com.riders.rider.feature.wallet.domain.displayedCapacity
import com.riders.rider.feature.wallet.domain.displayedReserved
import com.riders.rider.feature.wallet.domain.showsTopUpAction
import com.riders.rider.feature.wallet.domain.shouldLoadWalletPage
import com.riders.rider.feature.wallet.domain.walletAfterPage
import com.riders.rider.feature.wallet.domain.walletAfterRefresh
import com.riders.rider.feature.wallet.domain.walletBalanceIsNegative
import com.riders.rider.feature.wallet.domain.walletBorrowingSourceLabel
import com.riders.rider.feature.wallet.domain.walletEarningsTotal
import com.riders.rider.feature.wallet.domain.walletEntryLabel
import com.riders.rider.feature.wallet.domain.walletMoneyLabel
import com.riders.rider.feature.wallet.domain.walletReceiptLabel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderWalletTest {
    @Test
    fun creditAndDeductionLabelsStayWithTheServerType() {
        assertEquals("Platform fee", walletEntryLabel("PLATFORM_FEE"))
        assertEquals("Platform fee released", walletEntryLabel("PLATFORM_FEE_RELEASE"))
        assertEquals("Platform fee refund", walletEntryLabel("PLATFORM_FEE_REFUND"))
        assertEquals("Platform fee hold", walletEntryLabel("PLATFORM_FEE_HOLD"))
        assertEquals("Top-up", walletEntryLabel("TOP_UP"))
        assertEquals("Welcome bonus", walletEntryLabel("WELCOME_BONUS"))
        assertEquals("Promotional credit", walletEntryLabel("PROMOTIONAL_CREDIT"))
        assertEquals("Adjustment", walletEntryLabel("ADJUSTMENT"))
    }

    @Test
    fun signedAmountsAreShownAsTheServerSentThem() {
        val decoded = ApiJson.decodeFromString<WalletTransactionsResponse>(
            """{"transactions":[{"id":"fee","type":"PLATFORM_FEE","amount":"-0.30","balanceAfter":"-0.30","currency":"USD","createdAt":"2026-10-20T12:00:00.000Z","reason":null,"payment":null},{"id":"credit","type":"PROMOTIONAL_CREDIT","amount":"1.40","balanceAfter":"1.10","currency":"USD","createdAt":"2026-10-20T12:05:00.000Z","reason":"Launch credit","payment":null}],"nextCursor":"next"}""",
        )
        val fee = decoded.transactions[0]
        val credit = decoded.transactions[1]
        assertEquals("USD -0.30", walletMoneyLabel(fee.currency, fee.amount))
        assertEquals("USD 1.40", walletMoneyLabel(credit.currency, credit.amount))
        assertTrue(fee.amount.startsWith("-"))
        assertFalse(credit.amount.startsWith("-"))
        assertEquals("Launch credit", credit.reason)
        assertEquals("next", decoded.nextCursor)
    }

    @Test
    fun aNegativeBalanceIsMoneyOwedToThePlatform() {
        val summary = sampleSummary(balance = "-0.30", availableCapacity = "1.20")
        assertTrue(walletBalanceIsNegative(summary.balance))
        assertEquals("USD -0.30", displayedBalance(summary))
        assertTrue(WALLET_BALANCE_EXPLANATION.contains("owed to the platform"))
        assertFalse(WALLET_BALANCE_EXPLANATION.contains("error", ignoreCase = true))
        assertFalse(walletBalanceIsNegative("0.00"))
    }

    @Test
    fun borrowingLimitIsPermissionToOweThePlatform() {
        assertTrue(WALLET_BORROWING_EXPLANATION.contains("permission to owe"))
        assertTrue(WALLET_BORROWING_EXPLANATION.contains("not cash"))
        assertTrue(WALLET_BORROWING_EXPLANATION.contains("earnings"))
        assertTrue(WALLET_BORROWING_EXPLANATION.contains("money received"))
        assertEquals("USD 2.00", displayedBorrowingLimit(sampleSummary()))
        assertEquals("Standard limit", walletBorrowingSourceLabel("DEFAULT"))
    }

    @Test
    fun availableCapacityAndReservedFeesUseTheServerFigures() {
        val summary = sampleSummary(
            balance = "1.00",
            borrowingLimit = "2.00",
            reservedFees = "0.50",
            availableCapacity = "9.99",
        )
        assertEquals("USD 9.99", displayedCapacity(summary))
        assertEquals("USD 0.50", displayedReserved(summary))
        assertTrue(WALLET_CAPACITY_EXPLANATION.contains("platform fees"))
        assertTrue(WALLET_RESERVED_EXPLANATION.contains("not yet deducted"))
        assertTrue(WALLET_CUSTOMER_PAYMENT.contains("pay you directly"))
    }

    @Test
    fun anAccountOverrideHasItsOwnLimitLabel() {
        assertEquals("Account limit", walletBorrowingSourceLabel("OVERRIDE"))
        assertEquals("This limit was set for your account.", WALLET_BORROWING_OVERRIDE)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun theNextPageLoadsOnlyWhenACursorExistsAndRequestsDoNotOverlap() = runTest {
        assertFalse(shouldLoadWalletPage(nextCursor = null, busy = false))
        assertFalse(shouldLoadWalletPage(nextCursor = "cursor", busy = true))
        assertTrue(shouldLoadWalletPage(nextCursor = "cursor", busy = false))
        val gate = WalletLoadGate()
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var peak = 0
        var running = 0
        val first = launch {
            gate.run {
                running += 1
                peak = maxOf(peak, running)
                started.complete(Unit)
                release.await()
                running -= 1
            }
        }
        started.await()
        var secondEntered = false
        val second = launch {
            gate.run {
                secondEntered = true
            }
        }
        runCurrent()
        assertFalse(secondEntered)
        assertEquals(1, peak)
        release.complete(Unit)
        first.join()
        second.join()
    }

    @Test
    fun pagesAreAppendedWithoutDuplicates() {
        val first = entry("fee", "PLATFORM_FEE", "-0.30")
        val repeated = entry("fee", "PLATFORM_FEE", "-0.30")
        val second = entry("credit", "WELCOME_BONUS", "1.00")
        val loaded = walletAfterPage(
            current = WalletBoard(entries = listOf(first), nextCursor = "page-2"),
            entries = listOf(repeated, second),
            nextCursor = null,
            error = null,
        )
        assertEquals(listOf("fee", "credit"), loaded.entries.map { it.id })
        assertNull(loaded.nextCursor)
        assertEquals("USD -0.30", walletMoneyLabel(loaded.entries[0].currency, loaded.entries[0].amount))
        assertEquals("USD 1.00", walletMoneyLabel(loaded.entries[1].currency, loaded.entries[1].amount))
    }

    @Test
    fun aFailedLaterPageKeepsTheHistoryAlreadyLoaded() {
        val current = WalletBoard(
            summary = sampleSummary(),
            entries = listOf(entry("fee", "PLATFORM_FEE", "-0.30")),
            nextCursor = "page-2",
        )
        val kept = walletAfterPage(current, entries = null, nextCursor = null, error = "Network request failed. Check your connection and try again.")
        assertEquals(current.entries, kept.entries)
        assertEquals("page-2", kept.nextCursor)
        assertEquals(current.summary, kept.summary)
        assertEquals("Network request failed. Check your connection and try again.", kept.error)
    }

    @Test
    fun aFailedRefreshKeepsTheSummaryAndHistory() {
        val current = WalletBoard(
            summary = sampleSummary(balance = "1.40"),
            entries = listOf(entry("bonus", "WELCOME_BONUS", "1.40")),
            nextCursor = "page-2",
        )
        val kept = walletAfterRefresh(current, WalletRefresh.Failed("Network request failed. Check your connection and try again."))
        assertEquals(current.summary, kept.summary)
        assertEquals(current.entries, kept.entries)
        assertEquals("page-2", kept.nextCursor)
        assertEquals("USD 1.40", displayedBalance(kept.summary!!))
    }

    @Test
    fun thereIsNoTopUpActionAndNoEarningsTotal() {
        assertFalse(showsTopUpAction())
        val history = listOf(
            entry("bonus", "WELCOME_BONUS", "1.40"),
            entry("fee", "PLATFORM_FEE", "-0.30"),
            entry("promo", "PROMOTIONAL_CREDIT", "0.50"),
        )
        assertNull(walletEarningsTotal(history))
        assertEquals("EcoCash MP-1", walletReceiptLabel("MP-1", "EXT-1", "INT-1"))
    }

    @Test
    fun summaryJsonKeepsTheServerCapacity() {
        val summary = ApiJson.decodeFromString<WalletSummaryResponse>(
            """{"riderProfileId":"rider","balance":"-0.30","borrowingLimit":"2.00","borrowingLimitSource":"OVERRIDE","reservedFees":"0.30","availableCapacity":"1.40","currency":"USD"}""",
        )
        assertEquals("-0.30", summary.balance)
        assertEquals("1.40", summary.availableCapacity)
        assertEquals("OVERRIDE", summary.borrowingLimitSource)
        assertEquals("0.30", summary.reservedFees)
    }

    private fun sampleSummary(
        balance: String = "1.40",
        borrowingLimit: String = "2.00",
        reservedFees: String = "0.00",
        availableCapacity: String = "3.40",
    ) = WalletSummary(
        balance = balance,
        borrowingLimit = borrowingLimit,
        borrowingLimitSource = "DEFAULT",
        reservedFees = reservedFees,
        availableCapacity = availableCapacity,
        currency = "USD",
    )

    private fun entry(id: String, type: String, amount: String) = WalletEntry(
        id = id,
        type = type,
        amount = amount,
        balanceAfter = amount,
        currency = "USD",
        createdAt = "2026-10-20T12:00:00.000Z",
    )
}
