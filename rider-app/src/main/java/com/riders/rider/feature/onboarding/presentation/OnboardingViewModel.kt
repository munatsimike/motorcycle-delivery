package com.riders.rider.feature.onboarding.presentation

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.riders.rider.core.network.ApiResult
import com.riders.rider.core.network.text
import com.riders.rider.feature.onboarding.data.VerificationRepository
import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.MotorcycleDraft
import com.riders.rider.feature.onboarding.domain.OnboardingStep
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.StoredLicence
import com.riders.rider.feature.onboarding.domain.canReplaceLicence
import com.riders.rider.feature.onboarding.domain.licenceImageIssue
import com.riders.rider.feature.onboarding.domain.licenceStatusAfterImageUpload
import com.riders.rider.feature.onboarding.domain.motorcycleIssue
import com.riders.rider.feature.onboarding.domain.nextOnboardingStep
import com.riders.rider.feature.onboarding.domain.previousOnboardingStep
import com.riders.rider.feature.onboarding.domain.retainDraft
import com.riders.rider.navigation.onboardingFocus
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class OnboardingUi(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val step: OnboardingStep = OnboardingStep.Profile,
    val fullName: String = "",
    val phone: String = "",
    val onboarding: RiderOnboarding? = null,
    val licence: StoredLicence? = null,
    val preview: ByteArray? = null,
    val motorcycles: List<MotorcycleDetails> = emptyList(),
    val draft: MotorcycleDraft = MotorcycleDraft(),
    val editingId: String? = null,
    val addingMotorcycle: Boolean = false,
    val uploading: Boolean = false,
    val uploadPercent: Int? = null,
    val savingMotorcycle: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val verification: VerificationRepository,
    savedState: SavedStateHandle,
) : ViewModel() {
    private val state = MutableStateFlow(OnboardingUi(step = onboardingFocus(savedState.get<String>("step")) ?: OnboardingStep.Profile))
    val ui: StateFlow<OnboardingUi> = state.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            val previous = state.value
            state.value = previous.copy(
                loading = previous.onboarding == null,
                refreshing = previous.onboarding != null,
                error = null,
            )
            val profile = verification.profile()
            val onboard = verification.onboarding()
            val licence = verification.licence()
            val motorcycles = verification.motorcycles()
            val loadedOnboarding = (onboard as? ApiResult.Ok)?.value ?: previous.onboarding
            val failure = firstFailure(profile, onboard, licence, motorcycles)
            state.value = previous.copy(
                loading = false,
                refreshing = false,
                fullName = (profile as? ApiResult.Ok)?.value?.fullName ?: previous.fullName,
                phone = (profile as? ApiResult.Ok)?.value?.phone ?: previous.phone,
                onboarding = loadedOnboarding,
                licence = (licence as? ApiResult.Ok)?.value ?: previous.licence,
                motorcycles = (motorcycles as? ApiResult.Ok)?.value ?: previous.motorcycles,
                draft = retainDraft(previous.draft),
                preview = previous.preview,
                error = failure?.text(),
            )
        }
    }

    fun selectLicence(bytes: ByteArray) {
        if (state.value.uploading) {
            return
        }
        val issue = licenceImageIssue(bytes)
        if (issue != null) {
            state.value = state.value.copy(error = issue)
            return
        }
        state.value = state.value.copy(preview = bytes, error = null, notice = null)
        uploadLicence()
    }

    fun permissionDenied() {
        state.value = state.value.copy(error = "Photo access was denied. Allow photos and try again.")
    }

    fun uploadLicence() {
        val current = state.value
        val bytes = current.preview ?: return
        val licenceStatus = current.onboarding?.licenceVerificationStatus
        if (licenceStatus != null && !canReplaceLicence(licenceStatus)) {
            state.value = current.copy(error = "A verified licence cannot be replaced yet")
            return
        }
        val issue = licenceImageIssue(bytes)
        if (issue != null) {
            state.value = current.copy(error = issue)
            return
        }
        viewModelScope.launch {
            state.value = state.value.copy(uploading = true, uploadPercent = 0, error = null)
            when (val result = verification.uploadLicence(bytes) { percent ->
                state.value = state.value.copy(uploadPercent = percent)
            }) {
                is ApiResult.Ok -> {
                    val kept = licenceStatusAfterImageUpload(
                        state.value.onboarding?.licenceVerificationStatus ?: "PENDING",
                    )
                    val onboard = state.value.onboarding?.copy(licenceVerificationStatus = kept)
                    state.value = state.value.copy(
                        uploading = false,
                        uploadPercent = null,
                        preview = null,
                        licence = result.value,
                        onboarding = onboard,
                        error = null,
                        notice = "Your licence has been saved.",
                    )
                }
                is ApiResult.Err -> state.value = state.value.copy(
                    uploading = false,
                    uploadPercent = null,
                    error = result.error.text(),
                )
            }
        }
    }

    fun updateDraft(draft: MotorcycleDraft) {
        state.value = state.value.copy(draft = draft, error = null)
    }

    fun beginAddMotorcycle() {
        state.value = state.value.copy(
            addingMotorcycle = true,
            editingId = null,
            draft = MotorcycleDraft(),
            error = null,
            notice = null,
        )
    }

    fun editMotorcycle(motorcycle: MotorcycleDetails) {
        state.value = state.value.copy(
            addingMotorcycle = false,
            editingId = motorcycle.id,
            draft = MotorcycleDraft(
                registrationNumber = motorcycle.registrationNumber,
                make = motorcycle.make,
                model = motorcycle.model,
                colour = motorcycle.colour,
            ),
            error = null,
            notice = null,
        )
    }

    fun cancelMotorcycleEdit() {
        state.value = state.value.copy(addingMotorcycle = false, editingId = null, draft = MotorcycleDraft(), error = null)
    }

    fun saveMotorcycle() {
        persistMotorcycle(advance = false)
    }

    private fun persistMotorcycle(advance: Boolean) {
        val current = state.value
        val issue = motorcycleIssue(current.draft)
        if (issue != null) {
            state.value = current.copy(error = issue)
            return
        }
        viewModelScope.launch {
            state.value = state.value.copy(savingMotorcycle = true, error = null)
            when (val result = verification.saveMotorcycle(current.editingId, current.draft)) {
                is ApiResult.Ok -> {
                    val saved = state.value.copy(
                        savingMotorcycle = false,
                        addingMotorcycle = false,
                        editingId = null,
                        draft = MotorcycleDraft(),
                        error = null,
                        notice = if (advance) null else "Your motorbike has been saved.",
                    )
                    val licenceReady = saved.onboarding?.licenceVerificationStatus == "VERIFIED" || saved.licence != null
                    val next = if (advance) nextOnboardingStep(OnboardingStep.Motorcycle, licenceReady, true) else null
                    state.value = if (next == null) saved else saved.copy(step = next)
                    refresh()
                }
                is ApiResult.Err -> state.value = state.value.copy(
                    savingMotorcycle = false,
                    draft = retainDraft(current.draft),
                    error = result.error.text(),
                )
            }
        }
    }

    fun selectMotorcycle(id: String) {
        viewModelScope.launch {
            state.value = state.value.copy(savingMotorcycle = true, error = null)
            when (val result = verification.selectMotorcycle(id)) {
                is ApiResult.Ok -> {
                    state.value = state.value.copy(savingMotorcycle = false)
                    refresh()
                }
                is ApiResult.Err -> state.value = state.value.copy(
                    savingMotorcycle = false,
                    error = result.error.text(),
                )
            }
        }
    }

    fun continueStep() {
        val current = state.value
        if (current.step == OnboardingStep.Motorcycle && motorcycleFormNeedsSave(current)) {
            persistMotorcycle(advance = true)
            return
        }
        val blocked = continueBlock(current)
        if (blocked != null) {
            state.value = current.copy(error = blocked)
            return
        }
        val licenceReady = current.onboarding?.licenceVerificationStatus == "VERIFIED" || current.licence != null
        val next = nextOnboardingStep(current.step, licenceReady, current.motorcycles.isNotEmpty())
        state.value = if (next == null) {
            current.copy(error = blockedStepMessage(current.step))
        } else {
            current.copy(step = next, error = null, notice = null)
        }
    }

    fun back() {
        val previous = previousOnboardingStep(state.value.step) ?: return
        state.value = state.value.copy(step = previous, error = null, notice = null)
    }

    private fun continueBlock(current: OnboardingUi): String? = when (current.step) {
        OnboardingStep.Licence -> when {
            current.licence == null && current.onboarding?.licenceVerificationStatus != "VERIFIED" -> "Upload your driving licence to continue."
            else -> null
        }
        OnboardingStep.Motorcycle -> when {
            current.motorcycles.isEmpty() && !draftStarted(current.draft) -> "Add your motorbike to continue."
            else -> null
        }
        else -> null
    }

    private fun blockedStepMessage(step: OnboardingStep): String? = when (step) {
        OnboardingStep.Licence -> "Upload your driving licence to continue."
        OnboardingStep.Motorcycle -> "Add your motorbike to continue."
        else -> null
    }
}

private fun motorcycleFormNeedsSave(current: OnboardingUi): Boolean {
    return current.editingId != null || current.addingMotorcycle || current.motorcycles.isEmpty() || draftStarted(current.draft)
}

private fun draftStarted(draft: MotorcycleDraft): Boolean {
    return listOf(draft.registrationNumber, draft.make, draft.model, draft.colour).any { it.isNotBlank() }
}

private fun firstFailure(vararg results: ApiResult<*>) = results.firstNotNullOfOrNull { result ->
    (result as? ApiResult.Err)?.error
}
