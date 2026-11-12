package com.riders.rider.feature.wallet.domain

import com.riders.rider.core.money.moneyLabel
import com.riders.rider.feature.auth.domain.normalizeRiderPhone

/**
 * Local EcoCash top-up simulation.
 *
 * The backend accepts a USD amount matching `^\d{1,10}\.\d{2}$` and rejects zero.
 * Wallet configuration has no separate top-up minimum or maximum, so those storage
 * rules are the only limits applied here. A simulated payment never calls the
 * payment API and never changes a wallet balance.
 */
const val ECOCASH_CURRENCY = "USD"
const val ECOCASH_AMOUNT_WHOLE_DIGITS = 10
const val ECOCASH_MAX_CENTS = 999_999_999_999L
const val ECOCASH_INITIATE_PATH = "riders/me/wallet/ecocash-top-ups"
const val ECOCASH_LOOKUP_PATH = "riders/me/wallet/ecocash-top-ups/{paymentId}/lookup"

const val ECOCASH_RELEASE_TITLE = "How to top up"
const val ECOCASH_RELEASE_BODY = "Add funds through a Riders admin using cash or EcoCash."

val ECOCASH_QUICK_AMOUNTS_CENTS: List<Long> = listOf(500L, 1_000L, 2_000L, 5_000L, 10_000L)

enum class EcocashSimulationState {
    IDLE,
    VALIDATING,
    PENDING,
    SUCCESS,
    FAILED,
    CANCELLED,
}

data class EcocashAmount(
    val cents: Long?,
    val error: String?,
)

data class EcocashTopUpState(
    val phase: EcocashSimulationState = EcocashSimulationState.IDLE,
    val observedBalance: String,
    val quickCents: Long? = null,
    val customSelected: Boolean = false,
    val customText: String = "",
    val phone: String = "",
    val amountCents: Long? = null,
    val msisdn: String? = null,
    val amountError: String? = null,
    val phoneError: String? = null,
    val amountTouched: Boolean = false,
    val phoneTouched: Boolean = false,
    val credited: Boolean = false,
    val ledgerEntriesCreated: Int = 0,
    val paymentRecordsCreated: Int = 0,
) {
    override fun toString(): String {
        return "EcocashTopUpState(phase=$phase, amountCents=$amountCents, phone=redacted, credited=$credited)"
    }
}

/**
 * Replacement point for a future backend payment workflow.
 * The simulation records a local confirmation and does not request either payment path.
 */
interface EcocashTopUpProvider {
    val networkPaths: List<String>
    val initiateCalls: Int
    val lookupCalls: Int
    val creditCalls: Int
    fun onDemoConfirmed()
}

class SimulatedEcocashProvider : EcocashTopUpProvider {
    private val requested = mutableListOf<String>()
    override val networkPaths: List<String> = requested
    override var initiateCalls: Int = 0
        private set
    override var lookupCalls: Int = 0
        private set
    override var creditCalls: Int = 0
        private set
    var demoConfirmations: Int = 0
        private set

    override fun onDemoConfirmed() {
        demoConfirmations += 1
    }

    fun initiateTopUp(): Nothing {
        initiateCalls += 1
        requested += ECOCASH_INITIATE_PATH
        throw IllegalStateException("EcoCash payment initiation is not connected")
    }

    fun lookupTopUp(): Nothing {
        lookupCalls += 1
        requested += ECOCASH_LOOKUP_PATH
        throw IllegalStateException("EcoCash payment lookup is not connected")
    }

    fun creditWallet(): Nothing {
        creditCalls += 1
        throw IllegalStateException("Wallet crediting is not part of the EcoCash demo")
    }
}

fun ecocashDemoControlsEnabled(debugBuild: Boolean): Boolean = debugBuild

fun ecocashIdle(balance: String): EcocashTopUpState = EcocashTopUpState(observedBalance = balance)

fun selectQuickAmount(state: EcocashTopUpState, cents: Long): EcocashTopUpState {
    if (state.phase != EcocashSimulationState.IDLE || cents !in ECOCASH_QUICK_AMOUNTS_CENTS) {
        return state
    }
    return state.copy(
        quickCents = cents,
        customSelected = false,
        customText = "",
        amountCents = cents,
        amountError = null,
    )
}

fun selectCustomAmount(state: EcocashTopUpState): EcocashTopUpState {
    if (state.phase != EcocashSimulationState.IDLE) {
        return state
    }
    val parsed = parseEcocashAmount(state.customText)
    return state.copy(
        quickCents = null,
        customSelected = true,
        amountCents = parsed.cents,
        amountError = if (state.customText.isBlank()) null else parsed.error,
    )
}

fun editCustomAmount(state: EcocashTopUpState, text: String): EcocashTopUpState {
    if (state.phase != EcocashSimulationState.IDLE) {
        return state
    }
    val parsed = parseEcocashAmount(text)
    return state.copy(
        quickCents = null,
        customSelected = true,
        customText = text,
        amountCents = parsed.cents,
        amountError = if (text.isBlank() && !state.amountTouched) null else parsed.error,
        amountTouched = state.amountTouched || text.isNotEmpty(),
    )
}

fun editEcocashPhone(state: EcocashTopUpState, text: String): EcocashTopUpState {
    if (state.phase != EcocashSimulationState.IDLE) {
        return state
    }
    return state.copy(
        phone = text,
        msisdn = null,
        phoneError = if (text.isNotBlank() || state.phoneTouched) ecocashPhoneError(text) else null,
    )
}

fun canContinueEcocash(state: EcocashTopUpState): Boolean {
    if (state.phase != EcocashSimulationState.IDLE) {
        return false
    }
    return selectedEcocashAmount(state).cents != null && ecocashPhoneError(state.phone) == null
}

fun continueEcocash(state: EcocashTopUpState): EcocashTopUpState {
    if (state.phase != EcocashSimulationState.IDLE) {
        return state
    }
    val amount = selectedEcocashAmount(state)
    val msisdn = runCatching { normalizeEcocashMsisdn(state.phone) }.getOrNull()
    if (amount.cents == null || msisdn == null) {
        return state.copy(
            phase = EcocashSimulationState.IDLE,
            amountCents = amount.cents,
            msisdn = null,
            amountError = amount.error,
            phoneError = ecocashPhoneError(state.phone),
            amountTouched = true,
            phoneTouched = true,
            credited = false,
        )
    }
    return state.copy(
        phase = EcocashSimulationState.VALIDATING,
        amountCents = amount.cents,
        msisdn = msisdn,
        amountError = null,
        phoneError = null,
        amountTouched = true,
        phoneTouched = true,
        credited = false,
        ledgerEntriesCreated = 0,
        paymentRecordsCreated = 0,
    )
}

fun confirmEcocashDemo(
    state: EcocashTopUpState,
    provider: EcocashTopUpProvider,
    demoEnabled: Boolean,
): EcocashTopUpState {
    if (!demoEnabled || state.phase != EcocashSimulationState.VALIDATING || state.amountCents == null || state.msisdn == null) {
        return state
    }
    provider.onDemoConfirmed()
    return state.copy(
        phase = EcocashSimulationState.PENDING,
        credited = false,
        ledgerEntriesCreated = 0,
        paymentRecordsCreated = 0,
    )
}

fun simulateEcocashSuccess(state: EcocashTopUpState, demoEnabled: Boolean): EcocashTopUpState {
    if (!demoEnabled || state.phase != EcocashSimulationState.PENDING) {
        return state
    }
    return state.copy(phase = EcocashSimulationState.SUCCESS, credited = false, ledgerEntriesCreated = 0, paymentRecordsCreated = 0)
}

fun simulateEcocashFailure(state: EcocashTopUpState, demoEnabled: Boolean): EcocashTopUpState {
    if (!demoEnabled || state.phase != EcocashSimulationState.PENDING) {
        return state
    }
    return state.copy(phase = EcocashSimulationState.FAILED, credited = false, ledgerEntriesCreated = 0, paymentRecordsCreated = 0)
}

fun cancelEcocash(state: EcocashTopUpState): EcocashTopUpState {
    if (state.phase != EcocashSimulationState.PENDING) {
        return state
    }
    return state.copy(phase = EcocashSimulationState.CANCELLED, credited = false, ledgerEntriesCreated = 0, paymentRecordsCreated = 0)
}

fun returnToEcocashForm(state: EcocashTopUpState): EcocashTopUpState {
    if (
        state.phase != EcocashSimulationState.VALIDATING &&
        state.phase != EcocashSimulationState.FAILED &&
        state.phase != EcocashSimulationState.CANCELLED
    ) {
        return state
    }
    return state.copy(
        phase = EcocashSimulationState.IDLE,
        msisdn = null,
        credited = false,
        ledgerEntriesCreated = 0,
        paymentRecordsCreated = 0,
    )
}

fun walletBalanceAfterEcocashDemo(originalBalance: String, state: EcocashTopUpState): String {
    check(!state.credited)
    check(state.ledgerEntriesCreated == 0)
    check(state.paymentRecordsCreated == 0)
    return originalBalance
}

fun ecocashAmountLabel(cents: Long): String = moneyLabel(ECOCASH_CURRENCY, formatEcocashCents(cents))

fun maskEcocashNumber(msisdn: String): String {
    require(msisdn.length == 9 && msisdn.all { it.isDigit() })
    val local = "0$msisdn"
    return "${local.take(3)} ••• ${local.takeLast(4)}"
}

fun formatEcocashCents(cents: Long): String {
    val negative = cents < 0
    var remaining = cents
    if (negative) {
        remaining = -cents
    }
    val whole = remaining / 100
    val fraction = (remaining % 100).toString().padStart(2, '0')
    val body = "$whole.$fraction"
    return if (negative) "-$body" else body
}

fun parseEcocashAmount(raw: String): EcocashAmount {
    val text = raw.trim()
    if (text.isEmpty()) {
        return invalidAmount()
    }
    if (text.any { it == '-' || it == '+' || it.isWhitespace() }) {
        return invalidAmount()
    }
    if (!text.all { it.isDigit() || it == '.' } || text.count { it == '.' } > 1) {
        return invalidAmount()
    }
    val whole = text.substringBefore('.')
    val fraction = if (text.contains('.')) text.substringAfter('.') else ""
    if (whole.isEmpty() || whole.length > ECOCASH_AMOUNT_WHOLE_DIGITS) {
        return invalidAmount()
    }
    if (whole.length > 1 && whole.startsWith('0')) {
        return invalidAmount()
    }
    if (fraction.length > 2) {
        return invalidAmount()
    }
    val wholeCents = whole.toLong() * 100
    val fractionCents = when (fraction.length) {
        0 -> 0L
        1 -> fraction.toLong() * 10
        else -> fraction.toLong()
    }
    val cents = wholeCents + fractionCents
    if (cents <= 0L || cents > ECOCASH_MAX_CENTS) {
        return invalidAmount()
    }
    return EcocashAmount(cents = cents, error = null)
}

fun normalizeEcocashMsisdn(input: String): String {
    val e164 = try {
        normalizeRiderPhone(input, allowDutchTestNumbers = false)
    } catch (_: IllegalArgumentException) {
        throw IllegalArgumentException("Enter an EcoCash number")
    }
    val national = e164.removePrefix("+263")
    if (national.length != 9 || !national.all { it.isDigit() } || !national.startsWith("7")) {
        throw IllegalArgumentException("Enter an EcoCash number")
    }
    val again = normalizeRiderPhone(national, allowDutchTestNumbers = false)
    if (again != e164) {
        throw IllegalArgumentException("Enter an EcoCash number")
    }
    return national
}

fun selectedEcocashAmount(state: EcocashTopUpState): EcocashAmount {
    if (state.customSelected) {
        return parseEcocashAmount(state.customText)
    }
    val quick = state.quickCents
    if (quick != null && quick in ECOCASH_QUICK_AMOUNTS_CENTS) {
        return EcocashAmount(cents = quick, error = null)
    }
    return invalidAmount()
}

private fun ecocashPhoneError(phone: String): String? {
    return try {
        normalizeEcocashMsisdn(phone)
        null
    } catch (_: IllegalArgumentException) {
        "Enter an EcoCash number"
    }
}

private fun invalidAmount(): EcocashAmount = EcocashAmount(cents = null, error = "Enter a top-up amount")
