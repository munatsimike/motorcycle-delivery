package com.riders.rider.feature.delivery.domain

import java.math.BigDecimal
import java.time.Instant

enum class DeliveryListSort {
    Newest,
    Oldest,
    Shortest,
    Longest,
    Highest,
    Lowest,
}

fun <T> sortDeliveries(
    items: List<T>,
    sort: DeliveryListSort,
    date: (T) -> String?,
    distanceMeters: (T) -> Int?,
    price: (T) -> String?,
    tie: (T) -> String,
): List<T> {
    return items.sortedWith { left, right ->
        val primary = when (sort) {
            DeliveryListSort.Shortest -> compareMissingLast(distanceMeters(left), distanceMeters(right), ascending = true)
            DeliveryListSort.Longest -> compareMissingLast(distanceMeters(left), distanceMeters(right), ascending = false)
            DeliveryListSort.Highest -> compareMissingLast(money(price(left)), money(price(right)), ascending = false)
            DeliveryListSort.Lowest -> compareMissingLast(money(price(left)), money(price(right)), ascending = true)
            DeliveryListSort.Newest -> compareMissingLast(instant(date(left)), instant(date(right)), ascending = false)
            DeliveryListSort.Oldest -> compareMissingLast(instant(date(left)), instant(date(right)), ascending = true)
        }
        if (primary != 0) {
            return@sortedWith primary
        }
        val byDate = compareMissingLast(instant(date(left)), instant(date(right)), ascending = false)
        if (byDate != 0) {
            return@sortedWith byDate
        }
        tie(left).compareTo(tie(right))
    }
}

private fun money(value: String?): BigDecimal? {
    val text = value?.trim().orEmpty()
    if (!text.matches(Regex("""\d{1,10}\.\d{2}"""))) {
        return null
    }
    return text.toBigDecimalOrNull()
}

private fun instant(value: String?): Long? {
    val text = value?.trim().orEmpty()
    if (text.isEmpty()) {
        return null
    }
    return runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
}

private fun <T : Comparable<T>> compareMissingLast(left: T?, right: T?, ascending: Boolean): Int {
    if (left == null && right == null) {
        return 0
    }
    if (left == null) {
        return 1
    }
    if (right == null) {
        return -1
    }
    val compared = left.compareTo(right)
    return if (ascending) compared else -compared
}
