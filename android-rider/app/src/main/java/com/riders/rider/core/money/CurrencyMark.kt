package com.riders.rider.core.money

fun currencyMark(currency: String): String {
    return when (currency.trim().uppercase()) {
        "USD" -> "US$"
        "ZWG" -> "ZiG"
        else -> currency.trim()
    }
}

fun moneyLabel(currency: String, amount: String): String {
    val mark = currencyMark(currency)
    val gap = if (mark == "US$") "" else " "
    val trimmed = amount.trim()
    if (trimmed.startsWith("-")) {
        return "−$mark$gap${trimmed.removePrefix("-")}"
    }
    return "$mark$gap$trimmed"
}
