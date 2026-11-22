package com.riders.rider

import com.riders.rider.feature.wallet.domain.ECOCASH_INITIATE_PATH
import com.riders.rider.feature.wallet.domain.ECOCASH_LOOKUP_PATH
import com.riders.rider.feature.wallet.domain.ECOCASH_MAX_CENTS
import com.riders.rider.feature.wallet.domain.ECOCASH_QUICK_AMOUNTS_CENTS
import com.riders.rider.feature.wallet.domain.ECOCASH_RELEASE_BODY
import com.riders.rider.feature.wallet.domain.ECOCASH_RELEASE_TITLE
import com.riders.rider.feature.wallet.domain.EcocashSimulationState
import com.riders.rider.feature.wallet.domain.EcocashTopUpState
import com.riders.rider.feature.wallet.domain.SimulatedEcocashProvider
import com.riders.rider.feature.wallet.domain.canContinueEcocash
import com.riders.rider.feature.wallet.domain.cancelEcocash
import com.riders.rider.feature.wallet.domain.confirmEcocashDemo
import com.riders.rider.feature.wallet.domain.continueEcocash
import com.riders.rider.feature.wallet.domain.ecocashAmountLabel
import com.riders.rider.feature.wallet.domain.ecocashDemoControlsEnabled
import com.riders.rider.feature.wallet.domain.ecocashIdle
import com.riders.rider.feature.wallet.domain.editCustomAmount
import com.riders.rider.feature.wallet.domain.editEcocashPhone
import com.riders.rider.feature.wallet.domain.formatEcocashCents
import com.riders.rider.feature.wallet.domain.maskEcocashNumber
import com.riders.rider.feature.wallet.domain.normalizeEcocashMsisdn
import com.riders.rider.feature.wallet.domain.parseEcocashAmount
import com.riders.rider.feature.wallet.domain.returnToEcocashForm
import com.riders.rider.feature.wallet.domain.selectCustomAmount
import com.riders.rider.feature.wallet.domain.selectQuickAmount
import com.riders.rider.feature.wallet.domain.simulateEcocashFailure
import com.riders.rider.feature.wallet.domain.simulateEcocashSuccess
import com.riders.rider.feature.wallet.domain.walletBalanceAfterEcocashDemo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EcocashTopUpTest {
    @Test
    fun quickSelectAmountsUseIntegerCents() {
        var state = ecocashIdle("$4.00")
        assertEquals(listOf(500L, 1_000L, 2_000L, 5_000L, 10_000L), ECOCASH_QUICK_AMOUNTS_CENTS)
        state = selectQuickAmount(state, 1_000L)
        assertEquals(1_000L, state.amountCents)
        assertEquals("$10.00", ecocashAmountLabel(state.amountCents!!))
        assertEquals("10.00", formatEcocashCents(state.amountCents!!))
        assertFalse(state.customSelected)
    }

    @Test
    fun customAmountAcceptsDollarsAndCentsWithoutFloatingPoint() {
        val state = editCustomAmount(ecocashIdle("$0.00"), "10.50")
        assertEquals(1_050L, state.amountCents)
        assertEquals("$10.50", ecocashAmountLabel(1_050L))
        assertEquals(1L, parseEcocashAmount("0.01").cents)
        assertEquals(ECOCASH_MAX_CENTS, parseEcocashAmount("9999999999.99").cents)
    }

    @Test
    fun invalidAmountsAreRejected() {
        listOf("0", "0.00", "-5", "abc", "10.999", "05", "10000000000.00", "", "1e2", "10.5.0").forEach { raw ->
            val parsed = parseEcocashAmount(raw)
            assertNull(raw, parsed.cents)
            assertEquals("Enter a top-up amount", parsed.error)
        }
        val edited = editCustomAmount(ecocashIdle("$1.00"), "0")
        assertNull(edited.amountCents)
        assertEquals("Enter a top-up amount", edited.amountError)
    }

    @Test
    fun ecocashNumbersNormalizeToTheSameSubscriber() {
        assertEquals("771234567", normalizeEcocashMsisdn("0771234567"))
        assertEquals("771234567", normalizeEcocashMsisdn("+263771234567"))
        assertEquals("771234567", normalizeEcocashMsisdn("263771234567"))
        assertEquals("771234567", normalizeEcocashMsisdn("771234567"))
        assertEquals("771234567", normalizeEcocashMsisdn("+263 77 123 4567"))
        assertEquals("077 ••• 4567", maskEcocashNumber("771234567"))
        assertFalse(normalizeEcocashMsisdn("0779999999") == "771234567")
    }

    @Test
    fun invalidEcocashNumbersStayRejected() {
        listOf("", "123", "0612345678", "+31612345678", "077123456", "phone", "+2637712345678").forEach { raw ->
            var rejected = false
            try {
                normalizeEcocashMsisdn(raw)
            } catch (error: IllegalArgumentException) {
                rejected = true
                assertEquals("Enter an EcoCash number", error.message)
            }
            assertTrue(raw, rejected)
        }
        val edited = editEcocashPhone(ecocashIdle("$1.00"), "123")
        assertEquals("Enter an EcoCash number", edited.phoneError)
        assertNull(edited.msisdn)
        assertNull(editEcocashPhone(ecocashIdle("$1.00"), "").phoneError)
    }

    @Test
    fun continueStaysDisabledUntilAmountAndNumberAreValid() {
        val idle = ecocashIdle("$1.40")
        assertFalse(canContinueEcocash(idle))
        val amountOnly = selectQuickAmount(idle, 500L)
        assertFalse(canContinueEcocash(amountOnly))
        val ready = editEcocashPhone(amountOnly, "0771234567")
        assertTrue(canContinueEcocash(ready))
        val custom = editCustomAmount(ready, "0")
        assertFalse(canContinueEcocash(custom))
    }

    @Test
    fun continueOpensReviewAndASecondTapDoesNotStartAnotherReview() {
        val ready = editEcocashPhone(selectQuickAmount(ecocashIdle("−$2.00"), 2_000L), "0771234567")
        val review = continueEcocash(ready)
        val again = continueEcocash(review)
        assertEquals(EcocashSimulationState.VALIDATING, review.phase)
        assertEquals(review, again)
        assertEquals("771234567", review.msisdn)
        assertEquals(2_000L, review.amountCents)
        assertFalse(review.credited)
    }

    @Test
    fun pendingSuccessFailureAndCancellationLeaveTheWalletUnchanged() {
        val provider = SimulatedEcocashProvider()
        val balance = "−$2.00"
        val review = continueEcocash(editEcocashPhone(selectQuickAmount(ecocashIdle(balance), 5_000L), "+263771234567"))
        val pending = confirmEcocashDemo(review, provider, demoEnabled = true)
        val repeated = confirmEcocashDemo(pending, provider, demoEnabled = true)
        assertEquals(EcocashSimulationState.PENDING, pending.phase)
        assertEquals(pending, repeated)
        assertEquals(1, provider.demoConfirmations)
        assertEquals(balance, walletBalanceAfterEcocashDemo(balance, pending))

        val success = simulateEcocashSuccess(pending, demoEnabled = true)
        assertEquals(EcocashSimulationState.SUCCESS, success.phase)
        assertFalse(success.credited)
        assertEquals(0, success.ledgerEntriesCreated)
        assertEquals(0, success.paymentRecordsCreated)
        assertEquals(balance, walletBalanceAfterEcocashDemo(balance, success))
        assertEquals(success, simulateEcocashSuccess(success, demoEnabled = true))

        val failed = simulateEcocashFailure(pending, demoEnabled = true)
        assertEquals(EcocashSimulationState.FAILED, failed.phase)
        assertEquals(balance, failed.observedBalance)
        val form = returnToEcocashForm(failed)
        assertEquals(EcocashSimulationState.IDLE, form.phase)
        assertEquals(5_000L, form.amountCents)

        val cancelled = cancelEcocash(pending)
        assertEquals(EcocashSimulationState.CANCELLED, cancelled.phase)
        assertEquals(balance, walletBalanceAfterEcocashDemo(balance, cancelled))
        assertEquals(EcocashSimulationState.IDLE, returnToEcocashForm(cancelled).phase)
        assertEquals(review, cancelEcocash(review))
    }

    @Test
    fun releaseBuildsCannotConfirmOrShowDemoControls() {
        val provider = SimulatedEcocashProvider()
        val review = continueEcocash(editEcocashPhone(selectCustomAmount(editCustomAmount(ecocashIdle("$1.00"), "20")), "771234567"))
        val blocked = confirmEcocashDemo(review, provider, demoEnabled = false)
        assertEquals(EcocashSimulationState.VALIDATING, blocked.phase)
        assertEquals(0, provider.demoConfirmations)
        assertEquals(review, simulateEcocashSuccess(blocked, demoEnabled = false))
        assertEquals(review, simulateEcocashFailure(blocked, demoEnabled = false))
        assertFalse(ecocashDemoControlsEnabled(false))
        assertTrue(ecocashDemoControlsEnabled(true))
        assertEquals("How to top up", ECOCASH_RELEASE_TITLE)
        assertEquals("Add funds through a Riders admin using cash or EcoCash.", ECOCASH_RELEASE_BODY)
        assertFalse(ECOCASH_RELEASE_BODY.contains("DEMO", ignoreCase = true))
    }

    @Test
    fun simulationDoesNotCallPaymentApisOrCreditTheWallet() {
        val provider = SimulatedEcocashProvider()
        val balance = "$4.00"
        var state = editEcocashPhone(selectQuickAmount(ecocashIdle(balance), 10_000L), "0771234567")
        state = continueEcocash(state)
        state = confirmEcocashDemo(state, provider, demoEnabled = true)
        state = simulateEcocashSuccess(state, demoEnabled = true)
        assertEquals(EcocashSimulationState.SUCCESS, state.phase)
        assertEquals(emptyList<String>(), provider.networkPaths)
        assertEquals(0, provider.initiateCalls)
        assertEquals(0, provider.lookupCalls)
        assertEquals(0, provider.creditCalls)
        assertFalse(provider.networkPaths.contains(ECOCASH_INITIATE_PATH))
        assertFalse(provider.networkPaths.contains(ECOCASH_LOOKUP_PATH))
        assertEquals(balance, walletBalanceAfterEcocashDemo(balance, state))
        assertEquals(balance, state.observedBalance)
        assertFalse(state.toString().contains("0771234567"))
        assertFalse(state.toString().contains("771234567"))
    }

    @Test
    fun anUntouchedInvalidContinueShowsInlineErrorsAndStaysIdle() {
        val rejected = continueEcocash(ecocashIdle("$1.00"))
        assertEquals(EcocashSimulationState.IDLE, rejected.phase)
        assertEquals("Enter a top-up amount", rejected.amountError)
        assertEquals("Enter an EcoCash number", rejected.phoneError)
        assertFalse(rejected.credited)
        assertEquals(0, rejected.paymentRecordsCreated)
    }
}
