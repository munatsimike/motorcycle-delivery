package com.riders.rider.core.design

import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

object AppearanceState {
    val mode = mutableStateOf(AppearanceMode.SYSTEM)
    var select: (AppearanceMode) -> Unit = {}
}

@HiltViewModel
class AppearanceViewModel @Inject constructor(
    private val store: AppearanceStore,
) : ViewModel() {
    val mode = store.mode.stateIn(viewModelScope, SharingStarted.Eagerly, AppearanceMode.SYSTEM)

    fun select(mode: AppearanceMode) {
        viewModelScope.launch { store.setMode(mode) }
    }
}
