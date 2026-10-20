package com.riders.rider.feature.auth.domain

private val ZimbabweMobile = Regex("^\\+2637\\d{8}$")

fun riderPhoneEntry(local: String): String {
    val trimmed = local.trim()
    if (trimmed.isEmpty()) {
        return trimmed
    }
    val head = trimmed.replace(Regex("[\\s().-]"), "")
    val alreadyQualified = head.startsWith("+") || head.startsWith("00") || head.startsWith("263") || head.startsWith("0")
    return if (alreadyQualified) trimmed else "+263$head"
}

fun normalizeRiderPhone(input: String): String {
    val compact = input.trim().replace(Regex("[\\s().-]"), "")
    if (compact.isEmpty()) {
        throw IllegalArgumentException("Enter a valid Zimbabwe mobile number")
    }
    val digits = if (compact.startsWith("+")) compact.drop(1) else compact
    if (!digits.all { it.isDigit() }) {
        throw IllegalArgumentException("Enter a valid Zimbabwe mobile number")
    }
    var national = digits
    if (national.startsWith("00")) {
        national = national.drop(2)
    }
    if (national.startsWith("0")) {
        national = "263${national.drop(1)}"
    } else if (national.length == 9 && national.startsWith("7")) {
        national = "263$national"
    }
    if (national.startsWith("2630")) {
        national = "263${national.drop(4)}"
    }
    val e164 = "+$national"
    if (!ZimbabweMobile.matches(e164)) {
        throw IllegalArgumentException("Enter a valid Zimbabwe mobile number")
    }
    return e164
}

fun normalizeRiderName(input: String): String {
    val name = input.trim().replace(Regex("\\s+"), " ")
    if (name.isEmpty() || name.length > 200 || name.any { it.code < 32 }) {
        throw IllegalArgumentException("Full name is required")
    }
    return name
}
