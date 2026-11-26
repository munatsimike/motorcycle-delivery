package com.riders.rider.feature.profile.presentation

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.riders.rider.R
import com.riders.rider.core.design.RiderTransition
import com.riders.rider.core.design.RidersButtonTone
import com.riders.rider.core.design.rememberRidersMotion
import com.riders.rider.core.design.AppearanceMode
import com.riders.rider.core.design.AppearanceViewModel
import com.riders.rider.core.design.LocalAppDark
import com.riders.rider.core.design.RidersBottomSheet
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersDialog
import com.riders.rider.core.design.RidersDialogActions
import com.riders.rider.core.design.RidersDialogBody
import com.riders.rider.core.design.RidersDialogTextButton
import com.riders.rider.core.design.RidersDialogTitle
import com.riders.rider.core.design.RidersDialogTone
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersTransientNotice
import com.riders.rider.core.design.RidersLoadingState
import com.riders.rider.core.design.RidersPullRefresh
import com.riders.rider.core.design.RidersRadius
import com.riders.rider.core.design.RidersPrimaryButton
import com.riders.rider.core.design.RidersSecondaryButton
import com.riders.rider.core.design.RidersTextField
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.auth.presentation.AddressSearchViewModel
import com.riders.rider.feature.auth.presentation.RegistrationAddressField
import com.riders.rider.feature.onboarding.domain.MotorcycleDetails
import com.riders.rider.feature.onboarding.domain.RiderOnboarding
import com.riders.rider.feature.onboarding.domain.approvalStatusTitle
import com.riders.rider.feature.onboarding.domain.motorcycleStatusTitle
import com.riders.rider.core.io.readAtMost
import com.riders.rider.feature.profile.domain.PROFILE_PHOTO_MAX_BYTES
import com.riders.rider.feature.profile.domain.ProfilePhotoPhase
import com.riders.rider.feature.profile.domain.ProfilePhotoState
import com.riders.rider.feature.profile.domain.canStartProfilePhotoAction
import com.riders.rider.feature.profile.domain.displayedProfilePhoto
import com.riders.rider.navigation.deliveryBackEnter
import com.riders.rider.navigation.deliveryBackExit
import com.riders.rider.navigation.deliveryForwardEnter
import com.riders.rider.navigation.deliveryForwardExit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Shortest sheet that fills the screen under the status bar and the mint gap. */
internal fun profileSheetFloor(viewportHeight: Int, statusTop: Int, topGap: Int): Int {
    return (viewportHeight - statusTop - topGap).coerceAtLeast(0)
}

/** Scroll only when the sheet content, insets, and gap are taller than the viewport. */
internal fun profileNeedsScroll(
    viewportHeight: Int,
    statusTop: Int,
    topGap: Int,
    contentHeight: Int,
    bottomPadding: Int = 0,
): Boolean {
    val sheet = maxOf(profileSheetFloor(viewportHeight, statusTop, topGap), contentHeight)
    return statusTop + topGap + sheet + bottomPadding > viewportHeight
}

private val PendingReview = Color(0xFFB86E00)
private val PendingReviewFill = Color(0xFFFFF4E5)

@Composable
fun ProfileScreen(
    onMotorcycles: () -> Unit,
    model: ProfileViewModel = hiltViewModel(),
) {
    val appearance: AppearanceViewModel = hiltViewModel(viewModelStoreOwner = LocalContext.current.findActivity())
    val appearanceMode by appearance.mode.collectAsStateWithLifecycle()
    val ui by model.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(PickVisualMedia()) { uri ->
        if (uri == null) {
            return@rememberLauncherForActivityResult
        }
        scope.launch {
            val bytes = withContext(Dispatchers.IO) {
                try {
                    context.contentResolver.openInputStream(uri)?.use { stream ->
                        readAtMost(stream, PROFILE_PHOTO_MAX_BYTES + 1)
                    }
                } catch (_: SecurityException) {
                    null
                } catch (_: java.io.IOException) {
                    null
                }
            }
            if (bytes == null) {
                model.reportPhoto("Choose a profile photo")
            } else {
                model.uploadPhoto(bytes)
            }
        }
    }
    DisposableEffect(Unit) {
        model.onProfileVisible()
        onDispose { model.onProfileHidden() }
    }
    LaunchedEffect(Unit) { model.refresh(force = false) }
    var confirmRemove by rememberSaveable { mutableStateOf(false) }
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    var editingAddress by rememberSaveable { mutableStateOf(false) }
    val board = ui.board
    val hasProfile = board.fullName.isNotBlank() || board.onboarding != null
    val displayedPhoto = displayedProfilePhoto(ui.photo, ui.photoBitmap, ui.photoPreview)
    val addressMotion = rememberRidersMotion().millis(RiderTransition.DeliveryForward)
    AnimatedContent(
        targetState = editingAddress,
        modifier = Modifier.fillMaxSize(),
        transitionSpec = {
            val opening = targetState
            ContentTransform(
                targetContentEnter = if (opening) deliveryForwardEnter(addressMotion) else deliveryBackEnter(addressMotion),
                initialContentExit = if (opening) deliveryForwardExit(addressMotion) else deliveryBackExit(addressMotion),
                sizeTransform = null,
            )
        },
        label = "profile-address",
    ) { editing ->
    if (editing) {
        AddressEditor(
            initial = board.address,
            saving = ui.savingAddress,
            error = ui.addressError,
            onCancel = {
                model.clearAddressError()
                editingAddress = false
            },
            onSave = { model.saveAddress(it) { editingAddress = false } },
        )
    } else RidersPullRefresh(
        refreshing = ui.refreshing,
        onRefresh = { model.refresh(force = true) },
        modifier = Modifier
            .fillMaxSize()
            .background(RidersColors.canvas),
    ) {
        val sheetShape = RoundedCornerShape(topStart = RidersRadius.xl, topEnd = RidersRadius.xl)
        val avatarSize = 80.dp
        val avatarOverlap = avatarSize / 2
        val mapGap = 24.dp
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val density = LocalDensity.current
            val sheetMinHeight = with(density) {
                profileSheetFloor(
                    viewportHeight = maxHeight.roundToPx(),
                    statusTop = WindowInsets.statusBars.getTop(this),
                    topGap = mapGap.roundToPx(),
                ).toDp()
            }
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0f to RidersColors.mintStart.copy(alpha = 0.72f),
                            0.62f to RidersColors.mintMid.copy(alpha = 0.35f),
                            1f to RidersColors.mintEnd.copy(alpha = 0.55f),
                        ),
                    ),
            )
            Column(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .verticalScroll(rememberScrollState()),
            ) {
                Spacer(Modifier.height(mapGap))
                Box(Modifier.fillMaxWidth()) {
            val profilePageState = !hasProfile && ((ui.loading || !board.loaded) || board.error != null)
            Column(
                Modifier
                    .fillMaxWidth()
                    .then(if (profilePageState) Modifier.height(sheetMinHeight) else Modifier.heightIn(min = sheetMinHeight))
                    .padding(top = avatarOverlap)
                    .clip(sheetShape)
                    .background(RidersColors.background)
                    .padding(top = avatarOverlap, bottom = RidersSpacing.lg),
            ) {
            ProfileHeader(
                name = board.fullName,
                onboarding = board.onboarding,
                photoState = ui.photo,
            )
            if (hasProfile) {
                DetailsCard(
                    phone = board.phone,
                    address = board.address,
                    onboarding = board.onboarding,
                    motorcycles = board.motorcycles,
                    appearance = appearanceMode,
                    onAppearance = appearance::select,
                    onMotorcycles = onMotorcycles,
                    onEditAddress = { editingAddress = true },
                    modifier = Modifier.padding(horizontal = RidersSpacing.lg),
                )
            }
            if (!hasProfile && (ui.loading || !board.loaded)) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(horizontal = RidersSpacing.lg),
                    contentAlignment = Alignment.Center,
                ) {
                    RidersLoadingState("Loading your profile")
                }
            } else if (!hasProfile && board.error != null) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(horizontal = RidersSpacing.lg),
                    contentAlignment = Alignment.Center,
                ) {
                    RidersFailureNotice(
                        message = board.error.orEmpty(),
                        title = "Profile unavailable",
                        onRetry = { model.refresh(force = true) },
                    )
                }
            } else {
            Column(
                Modifier
                    .padding(horizontal = RidersSpacing.lg)
                    .padding(top = if (hasProfile) RidersSpacing.lg else RidersSpacing.xl),
                verticalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
            ) {
                if (board.error != null) {
                    RidersTransientNotice(board.error, passive = true)
                }
                ui.photo.error?.let { message ->
                    if (message in setOf(
                            "Choose a profile photo", "Profile photo is too large",
                            "Profile photo must be a JPEG, PNG, or WebP file",
                        )) {
                        Text(message, style = RidersType.caption, color = RidersColors.error,
                            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                    } else {
                        RidersTransientNotice(message)
                    }
                    if (ui.photo.retry != null) {
                        RidersSecondaryButton(
                            label = "Try again",
                            onClick = model::retryPhoto,
                            bordered = false,
                            containerColor = RidersColors.background,
                            icon = R.drawable.ic_refresh,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                RidersSecondaryButton(
                    label = "Log out",
                    onClick = { confirmLogout = true },
                    enabled = !ui.signingOut,
                    loading = ui.signingOut,
                    loadingLabel = "Logging out",
                    tone = RidersButtonTone.Danger,
                    bordered = false,
                    containerColor = RidersColors.dangerSurface,
                    contentColor = RidersColors.destructive,
                    icon = R.drawable.ic_logout_outline,
                    regular = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            }
                    }
                    ProfileAvatarOverlap(
                        name = board.fullName,
                        photo = displayedPhoto,
                        photoState = ui.photo,
                        onChangePhoto = { picker.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly)) },
                        onRemovePhoto = { confirmRemove = true },
                        modifier = Modifier.align(Alignment.TopCenter),
                    )
                }
            }
        }
    }
    }
    if (confirmLogout) {
        RidersDialog(visible = true, onDismiss = { confirmLogout = false }) {
            RidersDialogTitle("Log out?")
            RidersDialogBody("You will stop receiving requests on this phone.")
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(RidersSpacing.lg),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RidersDialogTextButton(
                    label = "Cancel",
                    tone = RidersDialogTone.Neutral,
                    onClick = { confirmLogout = false },
                    modifier = Modifier.weight(1f),
                )
                RidersSecondaryButton(
                    label = "Log out",
                    onClick = {
                        confirmLogout = false
                        model.logout()
                    },
                    bordered = false,
                    compact = true,
                    containerColor = Color(0xFFB42318),
                    contentColor = RidersColors.textInverse,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
    if (confirmRemove && ui.photo.hasStoredPhoto && canStartProfilePhotoAction(ui.photo)) {
        RidersDialog(visible = true, onDismiss = { confirmRemove = false }) {
            RidersDialogTitle("Remove profile photo?")
            RidersDialogBody("Customers will see your initials instead.")
            RidersDialogActions {
                RidersDialogTextButton(
                    label = "Keep photo",
                    tone = RidersDialogTone.Neutral,
                    onClick = { confirmRemove = false },
                )
                RidersDialogTextButton(
                    label = "Remove photo",
                    tone = RidersDialogTone.Danger,
                    onClick = {
                        confirmRemove = false
                        model.removePhoto()
                    },
                )
            }
        }
    }
}

@Composable
private fun ProfileAvatarOverlap(
    name: String,
    photo: Bitmap?,
    photoState: ProfilePhotoState,
    onChangePhoto: () -> Unit,
    onRemovePhoto: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.size(80.dp)) {
        ProfileAvatar(
            name = name,
            photo = photo,
            busy = !canStartProfilePhotoAction(photoState),
            removing = photoState.phase == ProfilePhotoPhase.Removing,
            onChangePhoto = onChangePhoto,
        )
        if (photoState.hasStoredPhoto && canStartProfilePhotoAction(photoState)) {
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = 8.dp, y = 8.dp)
                    .size(32.dp)
                    .shadow(elevation = 3.dp, shape = CircleShape)
                    .clip(CircleShape)
                    .background(RidersColors.sheet)
                    .clickable(role = Role.Button, onClick = onRemovePhoto)
                    .semantics { contentDescription = "Remove photo" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_trash_can_outline),
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = RidersColors.error,
                )
            }
        }
    }
}

@Composable
private fun ProfileHeader(
    name: String,
    onboarding: RiderOnboarding?,
    photoState: ProfilePhotoState,
) {
    val status = onboarding?.approvalStatus
    val pill = if (status == null) "Rider" else approvalStatusTitle(status)
    val pendingReview = pill == "Pending review"
    val pillColor = when {
        pendingReview -> PendingReview
        pill == "Approved" -> RidersColors.textInverse
        status == "REJECTED" || status == "SUSPENDED" -> RidersColors.error
        else -> RidersColors.primaryDark
    }
    val pillFill = when {
        pendingReview -> PendingReviewFill
        pill == "Approved" -> RidersColors.primary
        else -> RidersColors.background
    }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = RidersSpacing.lg)
            .padding(top = RidersSpacing.sm, bottom = RidersSpacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
                if (photoState.phase == ProfilePhotoPhase.Uploading) {
                    Text(
                        "Uploading ${photoState.progress ?: 0}%",
                        style = RidersType.caption,
                        color = RidersColors.text,
                    )
                }
                Text(
                    name.ifBlank { "Profile" },
                    style = ProfileName,
                    color = RidersColors.text,
                    textAlign = TextAlign.Center,
                )
                Text(
                    pill,
                    style = ProfileBadge,
                    color = pillColor,
                    modifier = Modifier
                        .clip(RoundedCornerShape(RidersRadius.pill))
                        .background(pillFill)
                        .padding(horizontal = RidersSpacing.md, vertical = RidersSpacing.xs),
                )
    }
}

@Composable
private fun ProfileAvatar(
    name: String,
    photo: Bitmap?,
    busy: Boolean,
    removing: Boolean = false,
    onChangePhoto: () -> Unit,
) {
    Box(
        Modifier
            .size(80.dp)
            .clip(CircleShape)
            .background(Color(0xFF3D5A80))
            .semantics { contentDescription = "Change profile photo" }
            .then(
                if (busy) {
                    Modifier
                } else {
                    Modifier.clickable(role = Role.Button, onClick = onChangePhoto)
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.fillMaxSize().alpha(if (removing) 0.6f else 1f), contentAlignment = Alignment.Center) {
            if (photo != null) {
                Image(
                    bitmap = photo.asImageBitmap(),
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Text(profileInitials(name), style = RidersType.title, color = RidersColors.textInverse)
            }
        }
        if (removing) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.45f)),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    color = RidersColors.textInverse,
                    strokeWidth = 2.dp,
                )
            }
        }
    }
}

@Composable
private fun AddressEditor(
    initial: String,
    saving: Boolean,
    error: String?,
    onCancel: () -> Unit,
    onSave: (String) -> Unit,
) {
    var address by rememberSaveable { mutableStateOf(initial) }
    val search: AddressSearchViewModel = hiltViewModel()
    DisposableEffect(search) {
        onDispose { search.abandon() }
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(RidersColors.canvas)
            .statusBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.xl),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
    ) {
        Text("Address", style = RidersType.heading, color = RidersColors.text)
        RegistrationAddressField(
            value = address,
            onValueChange = { address = it },
            enabled = !saving,
            imeAction = ImeAction.Done,
            model = search,
        )
        if (error != null) {
            if (error == "Address is required") {
                Text(error, style = RidersType.caption, color = RidersColors.error)
            } else {
                RidersTransientNotice(error)
            }
        }
        RidersPrimaryButton(
            label = "Save address",
            onClick = { onSave(address) },
            enabled = !saving && address.isNotBlank(),
            loading = saving,
            loadingLabel = "Saving address",
            modifier = Modifier.fillMaxWidth(),
        )
        RidersSecondaryButton(
            label = "Cancel",
            onClick = {
                address = initial
                search.abandon()
                onCancel()
            },
            enabled = !saving,
            bordered = false,
            containerColor = Color(0xFFF1F3F4),
            contentColor = Color(0xFF374151),
            regular = true,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun DetailsCard(
    phone: String,
    address: String,
    onboarding: RiderOnboarding?,
    motorcycles: List<MotorcycleDetails>,
    appearance: AppearanceMode,
    onAppearance: (AppearanceMode) -> Unit,
    onMotorcycles: () -> Unit,
    onEditAddress: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var appearanceOpen by rememberSaveable { mutableStateOf(false) }
    val shape = RoundedCornerShape(RidersRadius.xl)
    Column(
        modifier
            .fillMaxWidth()
            .shadow(8.dp, shape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
            .clip(shape)
            .background(RidersColors.sheet)
            .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.sm),
    ) {
        InfoRow(
            icon = R.drawable.ic_profile_phone_outline,
            label = "WhatsApp number",
        ) {
            if (phone.isBlank()) {
                Text("Verified phone", style = ProfileValue, color = RidersColors.text)
            } else {
                Text(phone, style = ProfileValue, color = RidersColors.text)
            }
        }
        InfoRow(
            icon = R.drawable.ic_profile_marker_outline,
            label = "Address",
            value = address.ifBlank { "Not added" },
            onEdit = onEditAddress,
        )
        onboarding?.rejectionReason?.takeIf { it.isNotBlank() }?.let { reason ->
            Text(
                reason,
                style = RidersType.caption,
                color = RidersColors.error,
                modifier = Modifier.padding(start = 34.dp, bottom = RidersSpacing.sm),
            )
        }
        InfoRow(
            icon = R.drawable.ic_mdi_motorbike,
            label = "Motorbike",
            value = motorcycleSummary(motorcycles),
            onClick = onMotorcycles,
        )
        InfoRow(
            icon = R.drawable.ic_theme_light_dark,
            label = "Appearance",
            value = appearanceLabel(appearance),
            onClick = { appearanceOpen = true },
            sheet = true,
        )
    }
    AppearanceSheet(
        visible = appearanceOpen,
        selected = appearance,
        onSelect = onAppearance,
        onDismiss = { appearanceOpen = false },
    )
}

@Composable
private fun AppearanceSheet(
    visible: Boolean,
    selected: AppearanceMode,
    onSelect: (AppearanceMode) -> Unit,
    onDismiss: () -> Unit,
) {
    val dark = LocalAppDark.current
    val accent = if (dark) RidersColors.primary else RidersColors.primaryDark
    val highlight = if (dark) RidersColors.primaryLight else RidersColors.surface
    val navBottom = WindowInsets.navigationBars.getBottom(LocalDensity.current)
    RidersBottomSheet(visible = visible, onDismiss = onDismiss, handle = false, extendBehindNavigationBar = true) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(start = RidersSpacing.lg, top = RidersSpacing.lg, end = RidersSpacing.lg),
        ) {
            Text("Appearance", style = RidersType.heading, color = RidersColors.text)
            Spacer(Modifier.height(RidersSpacing.sm))
            AppearanceMode.entries.forEach { mode ->
                val chosen = mode == selected
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(if (chosen) highlight else Color.Transparent)
                        .clickable(role = Role.RadioButton) {
                            onSelect(mode)
                            onDismiss()
                        }
                        .semantics { this.selected = chosen }
                        .padding(vertical = RidersSpacing.sm),
                    horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        painter = painterResource(appearanceIcon(mode)),
                        contentDescription = null,
                        tint = if (chosen) accent else RidersColors.textSecondary,
                        modifier = Modifier.size(20.dp),
                    )
                    Text(
                        appearanceLabel(mode),
                        style = if (chosen) RidersType.bodyStrong else RidersType.body,
                        color = if (chosen) accent else RidersColors.text,
                        modifier = Modifier.weight(1f),
                    )
                    Box(
                        Modifier
                            .size(22.dp)
                            .clip(CircleShape)
                            .background(if (chosen) RidersColors.primary else Color.Transparent)
                            .border(1.dp, if (chosen) RidersColors.primary else RidersColors.border, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (chosen) {
                            Icon(
                                painter = painterResource(R.drawable.ic_check),
                                contentDescription = null,
                                tint = RidersColors.textInverse,
                                modifier = Modifier.size(14.dp),
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(RidersSpacing.lg + with(LocalDensity.current) { navBottom.toDp() }))
        }
    }
}

private fun appearanceIcon(mode: AppearanceMode): Int {
    return when (mode) {
        AppearanceMode.SYSTEM -> R.drawable.ic_cellphone
        AppearanceMode.LIGHT -> R.drawable.ic_weather_sunny
        AppearanceMode.DARK -> R.drawable.ic_weather_night
    }
}

private fun appearanceLabel(mode: AppearanceMode): String {
    return when (mode) {
        AppearanceMode.SYSTEM -> "System default"
        AppearanceMode.LIGHT -> "Light"
        AppearanceMode.DARK -> "Dark"
    }
}

@Composable
private fun InfoRow(
    icon: Int,
    label: String,
    value: String? = null,
    caption: String? = null,
    onClick: (() -> Unit)? = null,
    onEdit: (() -> Unit)? = null,
    sheet: Boolean = false,
    valueContent: (@Composable () -> Unit)? = null,
) {
        Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(vertical = RidersSpacing.md),
        horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = RidersColors.text,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(RidersSpacing.xs)) {
            Text(label, style = ProfileLabel, color = RidersColors.textSecondary)
            if (valueContent != null) {
                valueContent()
            } else {
                Text(value.orEmpty(), style = ProfileValue, color = RidersColors.text)
            }
            if (caption != null) {
                Text(caption, style = RidersType.caption, color = RidersColors.textSecondary)
            }
        }
        if (onEdit != null) {
            Icon(
                painter = painterResource(R.drawable.ic_pencil_outline),
                contentDescription = "Edit address",
                modifier = Modifier
                    .size(20.dp)
                    .clickable(role = Role.Button, onClick = onEdit),
                tint = RidersColors.text,
            )
        } else if (onClick != null) {
            Icon(
                painter = painterResource(if (sheet) R.drawable.ic_chevron_up else R.drawable.ic_chevron_right_outline),
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = RidersColors.text,
            )
        }
    }
}

private val ProfileName = TextStyle(fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold)
private val ProfileBadge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
private val ProfileLabel = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal)
private val ProfileValue = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal)

private fun profileInitials(name: String): String {
    val letters = name.trim().split(Regex("\\s+")).mapNotNull { word ->
        word.firstOrNull { it.isLetter() }?.uppercaseChar()?.toString()
    }
    return when {
        letters.isEmpty() -> "R"
        letters.size == 1 -> letters.first()
        else -> "${letters.first()}${letters.last()}"
    }
}

private tailrec fun Context.findActivity(): ComponentActivity = when (this) {
    is ComponentActivity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> error("Appearance is only available inside the rider activity")
}

private fun motorcycleSummary(motorcycles: List<MotorcycleDetails>): String {
    val chosen = motorcycles.firstOrNull { it.isActive } ?: motorcycles.firstOrNull() ?: return "No motorcycle yet"
    val name = listOf(chosen.make, chosen.model).filter { it.isNotBlank() }.joinToString(" ")
    val status = when {
        chosen.isActive || chosen.verificationStatus == "VERIFIED" -> null
        else -> motorcycleStatusTitle(chosen.verificationStatus)
    }
    return listOfNotNull(chosen.registrationNumber.takeIf { it.isNotBlank() }, name.takeIf { it.isNotBlank() }, status)
        .joinToString(" · ")
        .ifBlank { "Motorcycle" }
}
