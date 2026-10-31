package com.riders.rider.feature.auth.domain

object DeviceReplacementNotice {
    const val MESSAGE = "Your account was signed in on another device. Please sign in again to continue."

    @Volatile
    private var pending: String? = null

    fun remember() {
        pending = MESSAGE
    }

    fun peek(): String? = pending

    fun clear() {
        pending = null
    }
}

fun signedOutStart(notice: String?): String {
    return if (notice.isNullOrBlank()) "welcome" else "sign-in"
}

fun resumedAssignmentId(assignmentIds: List<String>): String? = assignmentIds.firstOrNull()
