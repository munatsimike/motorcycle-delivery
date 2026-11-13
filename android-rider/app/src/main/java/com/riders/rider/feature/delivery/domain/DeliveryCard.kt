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

/** A landmark or instruction that only repeats the address already shown on the stop. */
fun distinctStopDetail(address: String, detail: String?): String? {
    val extra = detail?.trim().orEmpty()
    if (extra.isEmpty()) {
        return null
    }
    val shown = deliveryCardAddress(address).ifBlank { address.trim() }
    val placeKey = normalizePlace(shown)
    val extraKey = normalizePlace(extra)
    if (extraKey.isEmpty() || placeKey == extraKey || placeKey.contains(extraKey) || extraKey.contains(placeKey)) {
        return null
    }
    return extra
}

private fun normalizePlace(value: String): String {
    return value.lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()
}

private val cardCountries = listOf("the netherlands", "netherlands", "nederland", "zimbabwe")

private fun withoutTrailingCountry(parts: MutableList<String>) {
    if (parts.isEmpty()) {
        return
    }
    val last = parts.last()
    var text = last.trim()
    for (country in cardCountries) {
        if (text.equals(country, ignoreCase = true)) {
            text = ""
            break
        }
        val suffix = " $country"
        if (text.endsWith(suffix, ignoreCase = true)) {
            text = text.dropLast(suffix.length).trim()
        }
    }
    if (text.isEmpty()) {
        parts.removeAt(parts.lastIndex)
        return
    }
    if (text != last) {
        parts[parts.lastIndex] = text
    }
}

fun deliveryCardAddress(address: String): String {
    val parts = address.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()
    withoutTrailingCountry(parts)
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
    withoutTrailingCountry(parts)
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
    return "\$$value"
}
