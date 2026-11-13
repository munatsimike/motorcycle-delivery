package com.riders.rider

import com.riders.rider.feature.delivery.domain.DeliveryListSort
import com.riders.rider.feature.delivery.domain.sortDeliveries
import org.junit.Assert.assertEquals
import org.junit.Test

class RiderDeliverySortTest {
    private data class Item(
        val id: String,
        val date: String?,
        val distanceMeters: Int?,
        val price: String?,
    )

    private val items = listOf(
        Item("far-new", "2026-10-18T12:00:00Z", 5_000, "4.00"),
        Item("near-old", "2026-10-16T12:00:00Z", 800, "9.00"),
        Item("unknown", "2026-10-17T12:00:00Z", null, null),
    )

    @Test
    fun dateSortsNewestOrOldest() {
        assertEquals(listOf("far-new", "unknown", "near-old"), sorted(DeliveryListSort.Newest))
        assertEquals(listOf("near-old", "unknown", "far-new"), sorted(DeliveryListSort.Oldest))
    }

    @Test
    fun distanceSortsShortestOrLongest() {
        assertEquals(listOf("near-old", "far-new", "unknown"), sorted(DeliveryListSort.Shortest))
        assertEquals(listOf("far-new", "near-old", "unknown"), sorted(DeliveryListSort.Longest))
    }

    @Test
    fun priceSortsHighestOrLowest() {
        assertEquals(listOf("near-old", "far-new", "unknown"), sorted(DeliveryListSort.Highest))
        assertEquals(listOf("far-new", "near-old", "unknown"), sorted(DeliveryListSort.Lowest))
    }

    private fun sorted(sort: DeliveryListSort): List<String> {
        return sortDeliveries(items, sort, Item::date, Item::distanceMeters, Item::price, Item::id).map { it.id }
    }
}
