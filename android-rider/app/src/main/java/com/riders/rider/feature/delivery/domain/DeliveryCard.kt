package com.riders.rider.feature.delivery.domain

import java.time.Instant
import java.time.ZoneId
import java.util.Locale

private val cardCities = setOf(
    "harare",
    "bulawayo",
    "chitungwiza",
    "mutare",
    "epworth",
    "gweru",
    "kwekwe",
    "kadoma",
    "masvingo",
    "chinhoyi",
    "norton",
    "marondera",
    "ruwa",
    "chegutu",
    "zvishavane",
    "bindura",
    "beitbridge",
    "redcliff",
    "victoria falls",
    "hwange",
    "chiredzi",
    "kariba",
    "karoi",
    "chipinge",
    "gwanda",
    "shurugwi",
)

private val streetTypes = mapOf(
    "road" to "Rd",
    "street" to "St",
    "avenue" to "Ave",
    "close" to "Cl",
    "drive" to "Dr",
    "crescent" to "Cres",
    "lane" to "Ln",
    "court" to "Ct",
    "place" to "Pl",
    "boulevard" to "Blvd",
    "terrace" to "Ter",
)

private val streetTypePattern = Regex(
    "\\b(${streetTypes.keys.joinToString("|")})\\b",
    RegexOption.IGNORE_CASE,
)

fun deliveryCardAddress(address: String): String {
    val parts = address.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()
    if (parts.size > 1 && parts.last().equals("zimbabwe", ignoreCase = true)) {
        parts.removeAt(parts.lastIndex)
    }
    if (parts.size > 1 && cardCities.contains(parts.last().lowercase())) {
        parts.removeAt(parts.lastIndex)
    }
    return parts.joinToString(", ") { part ->
        streetTypePattern.replace(part) { match ->
            streetTypes[match.value.lowercase()] ?: match.value
        }
    }
}

fun destinationSuburb(address: String): String {
    val parts = address.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()
    if (parts.size > 1 && parts.last().equals("zimbabwe", ignoreCase = true)) {
        parts.removeAt(parts.lastIndex)
    }
    if (parts.size > 1 && cardCities.contains(parts.last().lowercase())) {
        parts.removeAt(parts.lastIndex)
    }
    return parts.lastOrNull().orEmpty()
}

private val whenMonths = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

fun shortDeliveryReference(id: String): String {
    val compact = id.replace(Regex("[^a-zA-Z0-9]"), "")
    val tail = compact.takeLast(5).uppercase(Locale.US)
    return if (tail.isNotEmpty()) "#$tail" else id
}

fun deliveryWhenLabel(createdAt: String?, zone: ZoneId = ZoneId.systemDefault()): String {
    val raw = createdAt?.trim().orEmpty()
    if (raw.isEmpty()) {
        return ""
    }
    val instant = runCatching { Instant.parse(raw) }.getOrNull() ?: return ""
    val date = instant.atZone(zone)
    val hours = date.hour.toString().padStart(2, '0')
    val minutes = date.minute.toString().padStart(2, '0')
    return "${date.dayOfMonth} ${whenMonths[date.monthValue - 1]} ${date.year} • $hours:$minutes"
}

fun deliveryPriceLabel(amount: String?): String? {
    val value = amount?.trim().orEmpty()
    if (value.isEmpty()) {
        return null
    }
    return "USD $value"
}
