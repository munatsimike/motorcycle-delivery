package com.riders.rider

import com.riders.rider.core.network.ApiError
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.core.network.ParcelResponse
import com.riders.rider.core.network.StopResponse
import com.riders.rider.feature.delivery.domain.ActiveDelivery
import com.riders.rider.feature.delivery.domain.AssignmentLookup
import com.riders.rider.feature.delivery.domain.DeliveryActionGate
import com.riders.rider.feature.delivery.domain.DeliveryContacts
import com.riders.rider.feature.delivery.domain.DeliveryRecoveryCoordinator
import com.riders.rider.feature.delivery.domain.DeliverySyncKind
import com.riders.rider.feature.delivery.domain.deliveryCardAddress
import com.riders.rider.feature.delivery.domain.destinationSuburb
import com.riders.rider.feature.delivery.domain.deliveryPriceLabel
import com.riders.rider.feature.delivery.domain.deliveryWhenLabel
import com.riders.rider.feature.delivery.domain.shortDeliveryReference
import com.riders.rider.feature.delivery.domain.loadedDelivery
import com.riders.rider.feature.delivery.domain.MAPS_UNAVAILABLE
import com.riders.rider.feature.delivery.domain.mapPointForStatus
import com.riders.rider.feature.delivery.domain.navigationTarget
import com.riders.rider.feature.delivery.domain.riderDetailsHeading
import com.riders.rider.feature.delivery.domain.riderDetailsSupport
import com.riders.rider.feature.delivery.domain.senderDialUri
import com.riders.rider.feature.delivery.domain.senderInitials
import com.riders.rider.feature.delivery.domain.senderWhatsAppUri
import com.riders.rider.feature.delivery.domain.syncOpenDelivery
import com.riders.rider.feature.delivery.domain.toActiveDelivery
import com.riders.rider.feature.home.homeShift
import com.riders.rider.feature.offers.domain.AcceptKeys
import com.riders.rider.feature.offers.domain.AcceptedDelivery
import com.riders.rider.feature.offers.domain.MemoryAcceptKeyStore
import com.riders.rider.feature.offers.domain.OfferAcceptance
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderDeliveryTest {
    @Test
    fun senderContactUsesAnAvatarNameAndTheSameCallLinks() {
        assertEquals("NM", senderInitials("Nyasha Moyo"))
        assertEquals("N", senderInitials("Nyasha"))
        assertEquals("S", senderInitials(" "))
        assertEquals("tel:+263771000001", senderDialUri("+263771000001"))
        assertEquals("whatsapp://send?phone=263771000001", senderWhatsAppUri("+263771000001"))
        assertNull(senderDialUri("0771000001"))
        assertNull(senderWhatsAppUri("0771000001"))
    }

    @Test
    fun detailsHeadingFollowsTheDeliveryStage() {
        assertEquals("Ready for collection", riderDetailsHeading("RIDER_ASSIGNED"))
        assertEquals("Collect the parcel from the sender.", riderDetailsSupport("RIDER_ASSIGNED"))
        assertEquals("Ready for collection", riderDetailsHeading("COLLECTING"))
        assertEquals("Parcel collected", riderDetailsHeading("COLLECTED"))
        assertEquals("The parcel has been collected.", riderDetailsSupport("COLLECTED"))
        assertEquals("On the way", riderDetailsHeading("OUT_FOR_DELIVERY"))
        assertEquals("Take the parcel to the drop-off.", riderDetailsSupport("OUT_FOR_DELIVERY"))
        assertEquals("Ready for drop-off", riderDetailsHeading("ARRIVED_AT_DROPOFF"))
        assertEquals("Delivered", riderDetailsHeading("DELIVERED"))
        assertEquals("This delivery is complete.", riderDetailsSupport("DELIVERED"))
    }

    @Test
    fun acceptIgnoresASecondTapWhileTheFirstIsRunning() = runTest {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var calls = 0
        val acceptance = OfferAcceptance(AcceptKeys(MemoryAcceptKeyStore()) { "key-1" }) { _, _ ->
            calls += 1
            started.complete(Unit)
            release.await()
            ApiResult.Ok(accepted())
        }
        val first = async { acceptance.accept("assignment-1") }
        started.await()
        val second = acceptance.accept("assignment-1")
        release.complete(Unit)
        assertNull(second)
        assertTrue(first.await() is ApiResult.Ok)
        assertEquals(1, calls)
    }

    @Test
    fun unresolvedAcceptKeepsTheSameIdempotencyKey() = runTest {
        val store = MemoryAcceptKeyStore()
        var sent: String? = null
        val timedOut = OfferAcceptance(AcceptKeys(store) { "key-1" }) { _, key ->
            sent = key
            ApiResult.Err(ApiError.Timeout)
        }
        assertTrue(timedOut.accept("assignment-1") is ApiResult.Err)
        assertEquals("key-1", sent)
        assertEquals("key-1", store.read("assignment-1"))

        val retried = OfferAcceptance(AcceptKeys(store) { "key-2" }) { _, key ->
            sent = key
            ApiResult.Ok(accepted())
        }
        assertTrue(retried.accept("assignment-1") is ApiResult.Ok)
        assertEquals("key-1", sent)
        assertNull(store.read("assignment-1"))
    }

    @Test
    fun resolvedAcceptFailureAllowsANewKey() = runTest {
        val store = MemoryAcceptKeyStore()
        var sent: String? = null
        OfferAcceptance(AcceptKeys(store) { "key-1" }) { _, key ->
            sent = key
            ApiResult.Err(ApiError.Conflict("This offer has expired"))
        }.accept("assignment-1")
        OfferAcceptance(AcceptKeys(store) { "key-2" }) { _, key ->
            sent = key
            ApiResult.Err(ApiError.Conflict("This offer is no longer available"))
        }.accept("assignment-1")
        assertEquals("key-2", sent)
        assertNull(store.read("assignment-1"))
    }

    @Test
    fun acceptedDeliverySurvivesOfferCacheReplacement() {
        val offer = offer()
        val stored = offer.toActiveDelivery("delivery-1", "assignment-1", "ASSIGNED")
        val replaced = listOf(
            offer.copy(
                assignmentId = "assignment-2",
                deliveryId = "delivery-2",
                pickup = offer.pickup.copy(address = "Somewhere else"),
            ),
        )
        val loaded = loadedDelivery(stored, replaced, "delivery-1")
        assertEquals("12 Samora Machel Avenue", loaded?.pickupAddress)
        assertEquals("9 Nelson Mandela Avenue", loaded?.dropoffAddress)
        assertEquals("Documents", loaded?.parcelDescription)
        assertFalse(loaded?.pickupAddress?.contains(offer.pickup.contactPhone) == true)
        assertFalse(loaded?.dropoffAddress?.contains(offer.dropoff.contactPhone) == true)
        assertNull(replaced.find { it.deliveryId == "delivery-1" })
    }

    @Test
    fun acceptedDeliveryKeepsUrgentOrFlexible() {
        val stored = offer().copy(serviceClass = "EXPRESS").toActiveDelivery("delivery-1", "assignment-1", "RIDER_ASSIGNED")
        assertEquals("EXPRESS", stored.serviceClass)
        assertEquals("12 Samora Machel Ave", deliveryCardAddress("12 Samora Machel Avenue, Harare, Zimbabwe"))
        assertEquals("9 Nelson Mandela Ave", deliveryCardAddress("9 Nelson Mandela Avenue"))
        assertEquals("Mufakose", destinationSuburb("66 Mungongoma Road, Mufakose, Harare, Zimbabwe"))
        assertEquals("Avondale", destinationSuburb("Avondale, Harare"))
        assertEquals("Budiriro", destinationSuburb("Budiriro"))
        assertEquals("#VERY1", shortDeliveryReference("delivery-1"))
        assertEquals("USD 12.50", deliveryPriceLabel("12.50"))
        assertEquals("19 Oct 2026 • 12:00", deliveryWhenLabel("2026-10-19T12:00:00.000Z", java.time.ZoneOffset.UTC))
    }

    @Test
    fun busyWithoutALocalAssignmentRequiresRecovery() {
        val shift = homeShift("BUSY", canAcceptDeliveries = true, active = null)
        assertFalse(shift.showGoOnline)
        assertFalse(shift.showGoOffline)
        assertFalse(shift.showOffers)
        assertFalse(shift.showActiveDelivery)
        assertTrue(shift.recoveryRequired)
        assertEquals(
            "You are marked as busy, but there is no active delivery to resume. You cannot go online.",
            shift.recoveryMessage,
        )
        val checking = homeShift("BUSY", canAcceptDeliveries = true, active = null, recovering = true)
        assertFalse(checking.showGoOnline)
        assertFalse(checking.recoveryRequired)
        assertTrue(checking.recovering)
        assertNull(checking.recoveryMessage)
    }

    @Test
    fun recoveryAfterRestartUsesTheServerDelivery() = runTest {
        val store = MemoryDeliverySnapshot(delivery(status = "ASSIGNED"))
        val restarted = coordinator(store) { AssignmentLookup.Found(delivery(status = "IN_TRANSIT")) }
        val result = restarted.reconcile()
        assertEquals("IN_TRANSIT", result.visible?.status)
        assertEquals("IN_TRANSIT", store.value?.status)
        assertEquals("12 Samora Machel Avenue", store.value?.pickupAddress)
        assertFalse(result.offline)
        assertFalse(result.clearStored)
    }

    @Test
    fun busyWithoutASnapshotRestoresTheServerAssignment() = runTest {
        val store = MemoryDeliverySnapshot(null)
        var accepts = 0
        val result = coordinator(store) {
            accepts += 0
            AssignmentLookup.Found(delivery(status = "ASSIGNED"))
        }.reconcile()
        assertEquals("delivery-1", result.visible?.deliveryId)
        assertEquals("ASSIGNED", store.value?.status)
        assertEquals(0, accepts)
        val shift = homeShift("BUSY", canAcceptDeliveries = true, active = result.visible)
        assertTrue(shift.showActiveDelivery)
        assertTrue(shift.showOffers)
        assertFalse(shift.recoveryRequired)
        assertFalse(shift.showGoOnline)
        assertTrue(shift.showGoOffline)
    }

    @Test
    fun lostAcceptResponseIsRestoredWithoutAnotherAccept() = runTest {
        val store = MemoryDeliverySnapshot(null)
        var accepts = 0
        val result = coordinator(store) { AssignmentLookup.Found(delivery(status = "ASSIGNED")) }.reconcile()
        assertEquals("assignment-1", result.persist?.assignmentId)
        assertEquals("9 Nelson Mandela Avenue", store.value?.dropoffAddress)
        assertEquals(0, accepts)
    }

    @Test
    fun staleLocalStatusIsReplacedByTheServer() = runTest {
        val store = MemoryDeliverySnapshot(delivery(status = "ASSIGNED"))
        val result = coordinator(store) { AssignmentLookup.Found(delivery(status = "PICKED_UP")) }.reconcile()
        assertEquals("PICKED_UP", result.visible?.status)
        assertEquals("PICKED_UP", store.value?.status)
    }

    @Test
    fun confirmedEmptyAssignmentClearsTheLocalSnapshot() = runTest {
        val store = MemoryDeliverySnapshot(delivery(status = "ARRIVED_AT_PICKUP"))
        val result = coordinator(store) { AssignmentLookup.None }.reconcile()
        assertNull(result.visible)
        assertTrue(result.clearStored)
        assertNull(store.value)
        assertFalse(result.offline)
        val shift = homeShift("BUSY", canAcceptDeliveries = false, active = null)
        assertTrue(shift.recoveryRequired)
        assertFalse(shift.showGoOnline)
        assertFalse(shift.showActiveDelivery)
    }

    @Test
    fun networkFailureKeepsTheLocalSnapshot() = runTest {
        val store = MemoryDeliverySnapshot(delivery(status = "IN_TRANSIT"))
        val result = coordinator(store) { AssignmentLookup.Unavailable(ApiError.Network) }.reconcile()
        assertTrue(result.offline)
        assertFalse(result.clearStored)
        assertEquals("IN_TRANSIT", store.value?.status)
        assertEquals("IN_TRANSIT", result.visible?.status)
        val shift = homeShift("BUSY", canAcceptDeliveries = false, active = result.visible, recoveryFailed = true)
        assertTrue(shift.showActiveDelivery)
        assertTrue(shift.recoveryFailed)
        assertFalse(shift.showGoOnline)
        val missing = homeShift("BUSY", canAcceptDeliveries = false, active = null, recoveryFailed = true)
        assertFalse(missing.showGoOnline)
        assertFalse(missing.recoveryRequired)
        assertEquals(
            "Your current delivery could not be loaded. Check your connection and try again.",
            missing.recoveryMessage,
        )
    }

    @Test
    fun aSecondProgressTapIsIgnoredWhileTheFirstIsRunning() {
        val gate = DeliveryActionGate()
        assertTrue(gate.tryStart())
        assertFalse(gate.tryStart())
        gate.finish()
        assertTrue(gate.tryStart())
    }

    @Test
    fun aServerRefreshReplacesAStaleLocalStatusWithoutStoringContacts() {
        val stored = delivery(status = "ASSIGNED")
        val server = stored.copy(status = "PICKED_UP", parcelSize = "SMALL")
        val contacts = DeliveryContacts(
            pickupName = "Nyasha",
            pickupPhone = "+263771111111",
            pickupLatitude = "-17.82",
            pickupLongitude = "31.05",
            dropoffName = "Tendai",
            dropoffPhone = "+263772222222",
            dropoffLatitude = "-17.80",
            dropoffLongitude = "31.04",
        )
        val sync = syncOpenDelivery("delivery-1", stored, AssignmentLookup.Found(server, contacts))
        assertEquals(DeliverySyncKind.Replace, sync.kind)
        assertEquals("PICKED_UP", sync.snapshot?.status)
        assertEquals("+263771111111", sync.contacts?.pickupPhone)
        val saved = Json.encodeToString(ActiveDelivery.serializer(), sync.snapshot!!)
        assertFalse(saved.contains("contactPhone"))
        assertFalse(saved.contains("latitude"))
        assertFalse(saved.contains("+263"))
        val pickup = mapPointForStatus("ASSIGNED", contacts)
        assertEquals("-17.82", pickup?.latitude)
        assertNull(mapPointForStatus("IN_TRANSIT", contacts.copy(dropoffLatitude = null, dropoffLongitude = null)))
        val missing = syncOpenDelivery("delivery-1", stored, AssignmentLookup.None)
        assertEquals(DeliverySyncKind.Leave, missing.kind)
        val lost = syncOpenDelivery("delivery-1", stored, AssignmentLookup.Unavailable(ApiError.Network))
        assertEquals(DeliverySyncKind.Keep, lost.kind)
        assertEquals("ASSIGNED", lost.snapshot?.status)
        assertNull(lost.contacts)
        assertEquals("Network request failed. Check your connection and try again.", lost.error)
    }

    @Test
    fun navigationUsesCoordinatesThenTheAddress() {
        val contacts = DeliveryContacts(
            pickupName = "Nyasha",
            pickupPhone = "+263771111111",
            pickupLatitude = "-17.82",
            pickupLongitude = "31.05",
            dropoffName = "Tendai",
            dropoffPhone = "+263772222222",
        )
        val coordinates = navigationTarget("ASSIGNED", contacts, "Sam Levy's Village", "Near the gate", "Avondale", null)
        assertEquals("geo:-17.82,31.05?q=-17.82,31.05", coordinates?.uri)
        val address = navigationTarget("IN_TRANSIT", contacts, "Sam Levy's Village", null, "Avondale Shopping Centre", "By the bank")
        assertEquals("geo:0,0?q=Avondale%20Shopping%20Centre%2C%20By%20the%20bank", address?.uri)
        assertNull(navigationTarget("IN_TRANSIT", null, "", null, "  ", null))
        assertEquals("No maps application is available.", MAPS_UNAVAILABLE)
    }

    private fun coordinator(
        store: MemoryDeliverySnapshot,
        lookup: suspend () -> AssignmentLookup,
    ): DeliveryRecoveryCoordinator {
        return DeliveryRecoveryCoordinator(
            read = { store.value },
            write = { store.value = it },
            clear = { store.value = null },
            lookup = lookup,
        )
    }

    private fun delivery(status: String): ActiveDelivery {
        return ActiveDelivery(
            deliveryId = "delivery-1",
            assignmentId = "assignment-1",
            status = status,
            parcelDescription = "Documents",
            pickupAddress = "12 Samora Machel Avenue",
            dropoffAddress = "9 Nelson Mandela Avenue",
        )
    }

    private fun accepted() = AcceptedDelivery("assignment-1", "delivery-1", "ASSIGNED", "BUSY")

    private class MemoryDeliverySnapshot(var value: ActiveDelivery?)

private fun offer(): OfferResponse {
        return OfferResponse(
            assignmentId = "assignment-1",
            deliveryId = "delivery-1",
            expiresAt = "soon",
            offeredPrice = "3.00",
            currency = "USD",
            payer = "SENDER",
            paymentMethod = "CASH",
            parcel = ParcelResponse("Documents", "SMALL", null),
            pickup = StopResponse(
                address = "12 Samora Machel Avenue",
                contactName = "Pickup Person",
                contactPhone = "+263771111111",
            ),
            dropoff = StopResponse(
                address = "9 Nelson Mandela Avenue",
                contactName = "Recipient Person",
                contactPhone = "+263772222222",
            ),
        )
    }
}
