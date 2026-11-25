package com.riders.rider.feature.auth.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersType
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.auth.data.AddressMatch
import com.riders.rider.feature.auth.data.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class AddressSearchState(
    val suggestions: List<AddressMatch> = emptyList(),
    val searching: Boolean = false,
    val message: String? = null,
    val searched: Boolean = false,
    val query: String = "",
)

/** A dismissed list stays closed until the rider changes the address text. */
internal fun addressSearchResumes(heldQuery: String?, typed: String): Boolean {
    if (heldQuery == null) {
        return true
    }
    return typed.trim() != heldQuery
}

@HiltViewModel
class AddressSearchViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {
    private val state = MutableStateFlow(AddressSearchState())
    val ui: StateFlow<AddressSearchState> = state.asStateFlow()
    private var sessionToken = UUID.randomUUID().toString()
    private var generation = 0
    private var searchJob: Job? = null
    private var heldQuery: String? = null

    fun onTyped(text: String) {
        val query = text.trim()
        if (!addressSearchResumes(heldQuery, text)) {
            return
        }
        heldQuery = null
        val current = ++generation
        searchJob?.cancel()
        if (query.length < 3) {
            sessionToken = UUID.randomUUID().toString()
            state.value = AddressSearchState()
            return
        }
        searchJob = viewModelScope.launch {
            delay(500)
            if (current != generation) {
                return@launch
            }
            state.value = AddressSearchState(searching = true, query = query)
            val next = when (val result = auth.searchAddresses(query, sessionToken)) {
                is ApiResult.Ok -> AddressSearchState(suggestions = result.value, searched = true, query = query)
                is ApiResult.Err -> AddressSearchState(message = result.error.text(), query = query)
            }
            if (current == generation) {
                state.value = next
            }
        }
    }

    /** Hides the list and drops a response that is still on the way. The typed address stays. */
    fun dismiss(currentText: String) {
        heldQuery = currentText.trim()
        generation += 1
        searchJob?.cancel()
        state.value = AddressSearchState()
    }

    /** Leaves the editor. A late response must not open suggestions on the next visit. */
    fun abandon() {
        heldQuery = null
        generation += 1
        searchJob?.cancel()
        state.value = AddressSearchState()
    }

    fun select(match: AddressMatch, onChosen: (String) -> Unit) {
        val current = ++generation
        searchJob?.cancel()
        viewModelScope.launch {
            state.value = AddressSearchState(searching = true)
            val resolved = when (val result = auth.resolveAddress(match.placeId, sessionToken)) {
                is ApiResult.Ok -> result.value.ifBlank { match.label }
                is ApiResult.Err -> match.label
            }
            if (current != generation) {
                return@launch
            }
            sessionToken = UUID.randomUUID().toString()
            heldQuery = resolved.trim()
            state.value = AddressSearchState()
            onChosen(resolved)
        }
    }
}

@Composable
fun RegistrationAddressField(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    placeholder: String? = null,
    imeAction: ImeAction = ImeAction.Next,
    model: AddressSearchViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    RidersTextField(
        label = "Address",
        value = value,
        onValueChange = { next ->
            onValueChange(next)
            if (enabled) {
                model.onTyped(next)
            }
        },
        placeholder = placeholder,
        enabled = enabled,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Sentences,
            imeAction = imeAction,
        ),
    )
    if (!enabled) {
        return
    }
    if (ui.searching) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = RidersColors.primary,
            )
            Spacer(Modifier.width(RidersSpacing.sm))
            Text("Searching addresses", style = RidersType.caption, color = RidersColors.textSecondary)
        }
        Spacer(Modifier.height(RidersSpacing.sm))
    }
    val message = ui.message
    if (message != null) {
        Text(message, style = RidersType.caption, color = RidersColors.textSecondary)
        Spacer(Modifier.height(RidersSpacing.sm))
    }
    if (ui.searched && !ui.searching && ui.query == value.trim() && ui.suggestions.isEmpty() && ui.message == null) {
        Text(
            "No matching addresses yet. You can keep what you typed and continue.",
            style = RidersType.caption,
            color = RidersColors.textSecondary,
        )
        Spacer(Modifier.height(RidersSpacing.sm))
    }
    val visibleSuggestions = if (ui.query == value.trim()) ui.suggestions else emptyList()
    Column(verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm)) {
        visibleSuggestions.forEach { suggestion ->
            Text(
                suggestion.label,
                style = RidersType.body,
                color = RidersColors.text,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(RidersColors.primaryLight, RoundedCornerShape(RidersRadius.md))
                    .clickable { model.select(suggestion, onValueChange) }
                    .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.sm),
            )
        }
    }
    if (visibleSuggestions.isNotEmpty()) {
        Spacer(Modifier.height(RidersSpacing.xs))
        RidersSecondaryButton(
            label = "Close suggestions",
            onClick = { model.dismiss(value) },
            compact = true,
            bordered = false,
            containerColor = RidersColors.dangerSurface,
            contentColor = RidersColors.destructive,
            regular = true,
            icon = R.drawable.ic_close,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(RidersSpacing.xs))
        Text("Google Maps", style = RidersType.small, color = RidersColors.textSecondary)
        Spacer(Modifier.height(RidersSpacing.sm))
    }
}
