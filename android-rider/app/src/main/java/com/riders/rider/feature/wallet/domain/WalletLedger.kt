package com.riders.rider.feature.wallet.domain

import kotlinx.coroutines.sync.Mutex
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

const val WALLET_BALANCE_EXPLANATION = "This is your wallet balance. A negative balance is an amount owed to the platform."
const val WALLET_CAPACITY_EXPLANATION = "This is the amount available to cover platform fees."
const val WALLET_BORROWING_EXPLANATION = "This is permission to owe the platform up to this limit. It is not cash, earnings, or money received."
const val WALLET_BORROWING_OVERRIDE = "This limit was set for your account."
const val WALLET_RESERVED_EXPLANATION = "These platform fees are held for accepted deliveries and are not yet deducted."
const val WALLET_CUSTOMER_PAYMENT = "Customers pay you directly. The wallet does not confirm that you have received that payment."
const val WALLET_PROMOTIONAL_EXPLANATION = "Promotional credits and welcome bonuses appear in the history and increase this balance."

data class WalletEntry(
    val id: String,
    val type: String,
    val amount: String,
    val balanceAfter: String,
    val currency: String,
    val createdAt: String,
    val reason: String? = null,
    val receipt: String? = null,
    val method: String? = null,
)

fun walletPaymentMethodLabel(method: String?): String? = when (method) {
    "CASH" -> "Cash"
    "ECOCASH" -> "EcoCash"
    else -> null
}

fun walletEntryLabel(type: String): String = when (type) {
    "PLATFORM_FEE" -> "Platform fee"
    "PLATFORM_FEE_RELEASE" -> "Platform fee released"
    "PLATFORM_FEE_REFUND" -> "Platform fee refund"
    "PLATFORM_FEE_HOLD" -> "Platform fee hold"
    "TOP_UP" -> "Top-up"
    "WELCOME_BONUS" -> "Welcome bonus"
    "PROMOTIONAL_CREDIT" -> "Promotional credit"
    "ADJUSTMENT" -> "Adjustment"
    else -> "Wallet entry"
}

fun walletMoneyLabel(currency: String, amount: String): String = "$currency $amount"

fun walletBalanceIsNegative(amount: String): Boolean = amount.trim().startsWith("-")

fun walletBorrowingSourceLabel(source: String): String = when (source) {
    "OVERRIDE" -> "Account limit"
    else -> "Standard limit"
}

fun walletWhenLabel(createdAt: String): String = formatWalletInstant(createdAt, WHEN)

fun walletDateLabel(createdAt: String): String = formatWalletInstant(createdAt, DATE)

fun walletActivityLabel(createdAt: String): String = formatWalletInstant(createdAt, ACTIVITY)

private fun formatWalletInstant(createdAt: String, formatter: DateTimeFormatter): String {
    return try {
        Instant.parse(createdAt).atZone(ZoneId.systemDefault()).format(formatter)
    } catch (_: Exception) {
        createdAt
    }
}

fun walletReceiptLabel(ecocashReference: String?, externalReceiptNumber: String?, internalReceiptId: String?): String? {
    ecocashReference?.takeIf { it.isNotBlank() }?.let { return "EcoCash $it" }
    externalReceiptNumber?.takeIf { it.isNotBlank() }?.let { return "Receipt $it" }
    internalReceiptId?.takeIf { it.isNotBlank() }?.let { return "Receipt $it" }
    return null
}

fun mergeWalletEntries(existing: List<WalletEntry>, incoming: List<WalletEntry>): List<WalletEntry> {
    val seen = existing.map { it.id }.toMutableSet()
    return existing + incoming.filter { seen.add(it.id) }
}

fun showsTopUpAction(): Boolean = false

fun walletEarningsTotal(entries: List<WalletEntry>): String? = null

data class WalletSummary(
    val balance: String,
    val borrowingLimit: String,
    val borrowingLimitSource: String,
    val reservedFees: String,
    val availableCapacity: String,
    val currency: String,
)

data class WalletBoard(
    val summary: WalletSummary? = null,
    val entries: List<WalletEntry> = emptyList(),
    val nextCursor: String? = null,
    val error: String? = null,
)

sealed interface WalletRefresh {
    data class Ready(
        val summary: WalletSummary,
        val entries: List<WalletEntry>,
        val nextCursor: String?,
    ) : WalletRefresh

    data class SummaryOnly(val summary: WalletSummary, val error: String) : WalletRefresh

    data class Failed(val error: String) : WalletRefresh
}

fun walletAfterRefresh(current: WalletBoard, refresh: WalletRefresh): WalletBoard = when (refresh) {
    is WalletRefresh.Ready -> current.copy(
        summary = refresh.summary,
        entries = refresh.entries,
        nextCursor = refresh.nextCursor,
        error = null,
    )
    is WalletRefresh.SummaryOnly -> current.copy(summary = refresh.summary, error = refresh.error)
    is WalletRefresh.Failed -> current.copy(error = refresh.error)
}

fun walletAfterPage(
    current: WalletBoard,
    entries: List<WalletEntry>?,
    nextCursor: String?,
    error: String?,
): WalletBoard {
    if (entries == null) {
        return current.copy(error = error)
    }
    return current.copy(
        entries = mergeWalletEntries(current.entries, entries),
        nextCursor = nextCursor,
        error = null,
    )
}

fun shouldLoadWalletPage(nextCursor: String?, busy: Boolean): Boolean {
    return !nextCursor.isNullOrBlank() && !busy
}

fun displayedBalance(summary: WalletSummary): String = walletMoneyLabel(summary.currency, summary.balance)

fun displayedCapacity(summary: WalletSummary): String = walletMoneyLabel(summary.currency, summary.availableCapacity)

fun displayedReserved(summary: WalletSummary): String = walletMoneyLabel(summary.currency, summary.reservedFees)

fun displayedBorrowingLimit(summary: WalletSummary): String = walletMoneyLabel(summary.currency, summary.borrowingLimit)

class WalletLoadGate {
    private val lock = Mutex()

    suspend fun run(block: suspend () -> Unit) {
        if (!lock.tryLock()) {
            return
        }
        try {
            block()
        } finally {
            lock.unlock()
        }
    }
}

private val WHEN: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.US)
private val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US)
private val ACTIVITY: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy '·' HH:mm", Locale.US)
