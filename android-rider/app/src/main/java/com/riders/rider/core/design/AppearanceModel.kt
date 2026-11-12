package com.riders.rider.core.design

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class AppearanceSelection {
    var displayed: AppearanceMode = AppearanceMode.SYSTEM
        private set
    var userGeneration: Int = 0
        private set
    private var persistedGeneration = 0
    private var persisted: AppearanceMode = AppearanceMode.SYSTEM

    fun onStored(stored: AppearanceMode) {
        if (userGeneration != persistedGeneration) {
            return
        }
        persisted = stored
        displayed = stored
    }

    fun onSelect(mode: AppearanceMode) {
        userGeneration += 1
        displayed = mode
    }

    fun onPersistResult(generation: Int, mode: AppearanceMode, success: Boolean) {
        if (generation != userGeneration) {
            return
        }
        if (success) {
            persistedGeneration = generation
            persisted = mode
            displayed = mode
        } else {
            displayed = persisted
        }
    }
}

@HiltViewModel
class AppearanceViewModel @Inject constructor(
    private val store: AppearanceStore,
) : ViewModel() {
    private val selection = AppearanceSelection()
    private val gate = Any()
    private val persist = Mutex()
    private val modeState = MutableStateFlow(AppearanceMode.SYSTEM)
    val mode: StateFlow<AppearanceMode> = modeState.asStateFlow()

    init {
        viewModelScope.launch {
            store.mode.collect { stored ->
                synchronized(gate) {
                    selection.onStored(stored)
                    modeState.value = selection.displayed
                }
            }
        }
    }

    fun select(mode: AppearanceMode) {
        synchronized(gate) {
            selection.onSelect(mode)
            modeState.value = selection.displayed
        }
        viewModelScope.launch { persistLatest() }
    }

    private suspend fun persistLatest() {
        persist.withLock {
            val generation: Int
            val selected: AppearanceMode
            synchronized(gate) {
                generation = selection.userGeneration
                selected = selection.displayed
            }
            if (generation == 0) {
                return
            }
            val saved = try {
                store.setMode(selected)
                true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                false
            }
            synchronized(gate) {
                selection.onPersistResult(generation, selected, saved)
                modeState.value = selection.displayed
            }
        }
    }
}
