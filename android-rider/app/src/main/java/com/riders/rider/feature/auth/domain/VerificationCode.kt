package com.riders.rider.feature.auth.domain

// The backend accepts 4 to 10 digits for SMS and WhatsApp checks.
// Twilio Verify's code length lives on the Verify service, not in this app.
private val VERIFICATION_CODE = Regex("^\\d{4,10}$")

const val VERIFICATION_CODE_MAX_LENGTH = 10

fun isVerificationCode(code: String): Boolean = VERIFICATION_CODE.matches(code)
