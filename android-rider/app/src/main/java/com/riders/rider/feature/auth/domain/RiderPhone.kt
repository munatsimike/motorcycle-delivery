package com.riders.rider.feature.auth.domain

private val ZimbabweMobile = Regex("^\\+2637\\d{8}$")
private val DutchMobile = Regex("^\\+316\\d{8}$")

fun looksLikeDutchTestNumber(input: String): Boolean {
    val head = input.trim().replace(Regex("[\\s().-]"), "")
    return head.startsWith("+31") || head.startsWith("0031") || head.startsWith("316") || Regex("^0?6\\d{0,8}$").matches(head)
}

fun riderPhoneEntry(local: String, allowDutchTestNumbers: Boolean = false): String {
    val trimmed = local.trim()
    if (trimmed.isEmpty()) {
        return trimmed
    }
    val head = trimmed.replace(Regex("[\\s().-]"), "")
    if (allowDutchTestNumbers && looksLikeDutchTestNumber(head)) {
        return trimmed
    }
    val alreadyQualified = head.startsWith("+") || head.startsWith("00") || head.startsWith("263") || head.startsWith("0")
    return if (alreadyQualified) trimmed else "+263$head"
}

fun normalizeRiderPhone(input: String, allowDutchTestNumbers: Boolean = false): String {
    val compact = input.trim().replace(Regex("[\\s().-]"), "")
    if (compact.isEmpty()) {
        throw IllegalArgumentException("Enter a valid Zimbabwe mobile number")
    }
    val digits = if (compact.startsWith("+")) compact.drop(1) else compact
    if (!digits.all { it.isDigit() }) {
        throw IllegalArgumentException("Enter a valid Zimbabwe mobile number")
    }
    if (allowDutchTestNumbers) {
        dutchTestE164(digits)?.let { return it }
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

private fun dutchTestE164(digits: String): String? {
    val international = when {
        digits.startsWith("00316") && digits.length == 13 -> "+316${digits.drop(5)}"
        Regex("^316\\d{8}$").matches(digits) -> "+$digits"
        Regex("^3106\\d{8}$").matches(digits) -> "+316${digits.drop(4)}"
        else -> null
    }
    if (international != null && DutchMobile.matches(international)) {
        return international
    }
    val national = when {
        Regex("^06\\d{8}$").matches(digits) -> "+316${digits.drop(2)}"
        Regex("^6\\d{8}$").matches(digits) -> "+31$digits"
        else -> null
    }
    return national?.takeIf { DutchMobile.matches(it) }
}

// TODO: Remove this debug-only name once Railway runs this registration backend.
// The deployed API still requires fullName for a new rider. This backend ignores
// the value when the phone already belongs to a customer, so it cannot overwrite
// that customer's name. Release builds must not register a rider under a fabricated name.
const val DEBUG_REGISTRATION_FULL_NAME = "Tonderai Moyo"

fun registrationFullName(debugBuild: Boolean): String? {
    return if (debugBuild) DEBUG_REGISTRATION_FULL_NAME else null
}

fun normalizeRiderName(input: String): String {
    val name = input.trim().replace(Regex("\\s+"), " ")
    if (name.isEmpty() || name.length > 200 || name.any { it.code < 32 }) {
        throw IllegalArgumentException("Full name is required")
    }
    return name
}

fun normalizeRiderAddress(input: String): String {
    val address = input.trim().replace(Regex("\\s+"), " ")
    if (address.isEmpty() || address.length > 500 || address.any { it.code < 32 }) {
        throw IllegalArgumentException("Address is required")
    }
    return address
}
