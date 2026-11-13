package com.riders.rider.feature.delivery.domain

import kotlin.math.roundToInt

data class VoiceCue(
    val id: String,
    val text: String?,
)

/**
 * The next announcement for this position. A null [VoiceCue.text] means the
 * moment was already spoken or repeats the previous line, and should be recorded
 * without speaking. A null result means this moment was already recorded.
 */
fun navigationVoiceCue(
    cue: GuidanceCue,
    spoken: Set<String>,
    lastSpoken: String?,
): VoiceCue? {
    val id = voiceCueId(cue)
    if (id in spoken) {
        return null
    }
    val text = voiceLine(cue, id)
    if (text.isBlank() || text == lastSpoken) {
        return VoiceCue(id, null)
    }
    return VoiceCue(id, text)
}

fun guidanceRouteKey(path: List<GeoPoint>, steps: List<RouteManeuver>): String {
    val first = path.firstOrNull()
    val last = path.lastOrNull()
    val maneuvers = steps.joinToString("|") { "${it.type}:${it.street.orEmpty()}:${it.fromIndex}:${it.toIndex}" }
    return "${path.size}:${first?.latitude}:${first?.longitude}:${last?.latitude}:${last?.longitude}:$maneuvers"
}

private fun voiceCueId(cue: GuidanceCue): String {
    return when (voiceBand(cue)) {
        "arrival" -> "arrival"
        "near" -> "step:${cue.stepIndex}:near"
        "approach" -> "step:${cue.stepIndex}:approach"
        else -> "step:${cue.stepIndex}:start"
    }
}

private fun voiceBand(cue: GuidanceCue): String {
    return when {
        cue.remainingMetres <= 25.0 -> "arrival"
        cue.metresToManeuver <= 65.0 -> "near"
        cue.metresToManeuver <= 220.0 -> "approach"
        else -> "start"
    }
}

private fun voiceLine(cue: GuidanceCue, id: String): String {
    if (id == "arrival") {
        return "You have arrived at your destination."
    }
    val phrase = maneuverSpeech(cue) ?: return ""
    val distance = spokenDistance(cue.metresToManeuver)
    return when {
        id.endsWith(":start") && isContinue(cue) -> "Continue straight for $distance."
        id.endsWith(":start") -> "${phrase.replaceFirstChar { it.uppercase() }} in $distance."
        else -> "In $distance, $phrase."
    }
}

private fun isContinue(cue: GuidanceCue): Boolean {
    return cue.type.isBlank() || cue.type == "None" || cue.type == "Straight" || cue.type == "Continue"
}

private fun maneuverSpeech(cue: GuidanceCue): String? {
    val street = cue.street?.trim()?.takeIf { it.isNotEmpty() }
    val given = cue.instruction.trim().trimEnd('.')
    if (given.isNotEmpty()) {
        return given.replaceFirstChar { it.lowercase() }
    }
    val action = when (cue.type) {
        "Left" -> "turn left"
        "SlightLeft" -> "bear left"
        "SharpLeft" -> "turn sharp left"
        "Right" -> "turn right"
        "SlightRight" -> "bear right"
        "SharpRight" -> "turn sharp right"
        "TurnAround", "UTurn" -> "make a U-turn"
        "Roundabout", "ExitRoundabout" -> "enter the roundabout"
        "RampLeft", "ExitLeft" -> "take the exit on the left"
        "RampRight", "ExitRight" -> "take the exit on the right"
        "MergeLeft", "StayLeft" -> "keep left"
        "MergeRight", "StayRight" -> "keep right"
        "Straight", "Continue", "None", "" -> "continue straight"
        else -> return null
    }
    if (action == "continue straight") {
        return if (street != null) "continue straight on $street" else "continue straight"
    }
    return if (street != null) "$action onto $street" else action
}

private fun spokenDistance(metres: Double): String {
    val value = metres.coerceAtLeast(0.0)
    if (value < 1000.0) {
        val rounded = ((value / 10.0).roundToInt() * 10).coerceAtLeast(10)
        return "$rounded metres"
    }
    val tenths = (value / 100.0).roundToInt().coerceAtLeast(10)
    return "${tenths / 10}.${tenths % 10} kilometres"
}
