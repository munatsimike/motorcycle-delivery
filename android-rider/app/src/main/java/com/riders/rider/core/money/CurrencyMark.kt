package com.riders.rider.core.money

fun currencyMark(currency: String): String {
    return if (currency.equals("USD", ignoreCase = true)) "$" else currency.trim()
}

fun moneyLabel(currency: String, amount: String): String {
    val mark = currencyMark(currency)
    val gap = if (mark == "$") "" else " "
    val trimmed = amount.trim()
    if (trimmed.startsWith("-")) {
        return "−$mark$gap${trimmed.removePrefix("-")}"
    }
    return "$mark$gap$trimmed"
}
