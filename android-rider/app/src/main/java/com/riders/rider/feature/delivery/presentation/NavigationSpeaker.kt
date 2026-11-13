package com.riders.rider.feature.delivery.presentation

import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Speaks one navigation line at a time and follows the device volume. */
class NavigationSpeaker(context: Context) {
    private val appContext = context.applicationContext
    private var engine: TextToSpeech? = null
    private var ready = false
    private var closed = false

    fun start() {
        if (closed || engine != null) {
            return
        }
        engine = TextToSpeech(appContext) { status ->
            val current = engine ?: return@TextToSpeech
            if (closed || status != TextToSpeech.SUCCESS || !applyLanguage(current)) {
                ready = false
                return@TextToSpeech
            }
            current.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            ready = true
        }
    }

    fun speak(text: String): Boolean {
        if (closed || !ready || text.isBlank()) {
            return false
        }
        val result = engine?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "navigation") ?: return false
        return result != TextToSpeech.ERROR
    }

    fun stop() {
        engine?.stop()
    }

    fun release() {
        closed = true
        ready = false
        engine?.stop()
        engine?.shutdown()
        engine = null
    }

    private fun applyLanguage(current: TextToSpeech): Boolean {
        val preferred = current.setLanguage(Locale.getDefault())
        if (preferred != TextToSpeech.LANG_MISSING_DATA && preferred != TextToSpeech.LANG_NOT_SUPPORTED) {
            return true
        }
        val english = current.setLanguage(Locale.ENGLISH)
        return english != TextToSpeech.LANG_MISSING_DATA && english != TextToSpeech.LANG_NOT_SUPPORTED
    }
}
