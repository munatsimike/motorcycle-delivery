package com.riders.rider.feature.delivery.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.JointType
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.RoundCap
import com.google.maps.android.compose.CameraMoveStartedReason
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.NAVIGATION_ZOOM
import com.riders.rider.feature.delivery.domain.formatArrival
import com.riders.rider.feature.delivery.domain.formatMetres
import com.riders.rider.feature.delivery.domain.metresBetween
import com.riders.rider.feature.delivery.domain.routeProgress
import com.riders.rider.feature.offers.presentation.locationDrawableMarker

@Composable
fun TurnByTurnScreen(
    destination: GeoPoint,
    dropoff: Boolean,
    onExit: () -> Unit,
    model: TurnByTurnModel,
) {
    val rider by model.rider.collectAsStateWithLifecycle()
    val bearing by model.bearing.collectAsStateWithLifecycle()
    val road by model.road.collectAsStateWithLifecycle()
    val routeFailed by model.routeFailed.collectAsStateWithLifecycle()
    val following by model.following.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val motorcycle = remember(context) { riderMotorcycleImage(context) }
    var motorcycleIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    var destinationIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    val mapStyles = remember(context) { RiderMapStyles.load(context) }
    val mapTheme = RiderMapThemeStore.read(context)
    val camera = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(
            LatLng(destination.latitude, destination.longitude),
            15f,
        )
    }
    val riderMarker = remember { MarkerState(LatLng(destination.latitude, destination.longitude)) }
    val destinationMarker = remember(destination.latitude, destination.longitude) {
        MarkerState(LatLng(destination.latitude, destination.longitude))
    }
    val guided = road
    val cue = rider?.let { fix ->
        guided?.let { route ->
            routeProgress(
                GeoPoint(fix.latitude, fix.longitude),
                route.path,
                route.steps,
                route.seconds,
            )
        }
    }
    var lastCamera by remember { mutableStateOf<Pair<GeoPoint, Float>?>(null) }
    var wasFollowing by remember { mutableStateOf(false) }
    val stroke = with(LocalDensity.current) { 5.dp.toPx() }

    LaunchedEffect(camera.isMoving) {
        if (camera.isMoving && camera.cameraMoveStartedReason == CameraMoveStartedReason.GESTURE) {
            model.stopFollowing()
        }
    }
    LaunchedEffect(rider?.latitude, rider?.longitude, bearing, following) {
        val fix = rider
        if (fix == null || !following) {
            wasFollowing = false
            return@LaunchedEffect
        }
        val resumed = !wasFollowing
        wasFollowing = true
        val heading = bearing ?: 0f
        val next = GeoPoint(fix.latitude, fix.longitude)
        val previous = lastCamera
        if (!resumed && previous != null) {
            val turned = kotlin.math.abs(((heading - previous.second + 540f) % 360f) - 180f)
            if (metresBetween(previous.first, next) < 6.0 && turned < 8f) {
                return@LaunchedEffect
            }
        }
        lastCamera = next to heading
        runCatching {
            camera.animate(
                CameraUpdateFactory.newCameraPosition(
                    CameraPosition.Builder()
                        .target(LatLng(next.latitude, next.longitude))
                        .zoom(NAVIGATION_ZOOM)
                        .bearing(heading)
                        .tilt(0f)
                        .build(),
                ),
                600,
            )
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(RidersColors.canvas)) {
        val topPad = (maxHeight * 0.36f).coerceAtLeast(188.dp)
        val bottomPad = maxHeight * 0.10f
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = camera,
            contentPadding = PaddingValues(top = topPad, bottom = bottomPad),
            properties = MapProperties(
                isMyLocationEnabled = false,
                mapStyleOptions = mapStyles.optionsFor(mapTheme),
            ),
            uiSettings = MapUiSettings(
                zoomControlsEnabled = false,
                compassEnabled = false,
                myLocationButtonEnabled = false,
                mapToolbarEnabled = false,
                rotationGesturesEnabled = true,
                scrollGesturesEnabled = true,
                zoomGesturesEnabled = true,
                tiltGesturesEnabled = false,
            ),
            onMapLoaded = {
                if (motorcycleIcon == null) {
                    motorcycleIcon = BitmapDescriptorFactory.fromBitmap(motorcycle)
                }
                if (destinationIcon == null) {
                    destinationIcon = locationDrawableMarker(
                        context,
                        if (dropoff) R.drawable.ic_solid_dropoff_location else R.drawable.ic_solid_pickup_location,
                    )
                }
            },
        ) {
            val path = guided?.path.orEmpty()
            if (path.size > 1) {
                Polyline(
                    points = path.map { LatLng(it.latitude, it.longitude) },
                    color = dropoffPinColor,
                    width = stroke,
                    jointType = JointType.ROUND,
                    startCap = RoundCap(),
                    endCap = RoundCap(),
                    geodesic = true,
                    zIndex = 1f,
                )
            }
            destinationIcon?.let { icon ->
                Marker(
                    state = destinationMarker,
                    icon = icon,
                    anchor = Offset(0.5f, 1f),
                    zIndex = 2f,
                )
            }
            val fix = rider
            val icon = motorcycleIcon
            if (fix != null && icon != null) {
                riderMarker.position = LatLng(fix.latitude, fix.longitude)
                Marker(
                    state = riderMarker,
                    icon = icon,
                    anchor = Offset(0.5f, 0.5f),
                    rotation = bearing ?: 0f,
                    flat = true,
                    zIndex = 3f,
                )
            }
        }

        Column(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.md),
            verticalArrangement = Arrangement.spacedBy(RidersSpacing.md),
        ) {
            Box(
                Modifier
                    .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(Color.White)
                    .clickable(role = Role.Button, onClick = onExit),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_chevron_left),
                    contentDescription = "Back",
                    tint = RidersColors.text,
                    modifier = Modifier.size(22.dp),
                )
            }
            GuidanceCard(
                instruction = cue?.instruction.orEmpty(),
                type = cue?.type.orEmpty(),
                street = cue?.street,
                metresToManeuver = cue?.metresToManeuver,
                remainingMetres = cue?.remainingMetres,
                arrival = formatArrival(cue?.remainingSeconds),
                loading = guided == null && !routeFailed,
                unavailable = rider != null && guided != null && cue?.instruction.isNullOrBlank(),
                waitingForGps = rider == null,
                failed = routeFailed,
                hasRoute = guided != null,
            )
        }

        if (!following) {
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .navigationBarsPadding()
                    .padding(end = RidersSpacing.lg, bottom = RidersSpacing.xl)
                    .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(Color.White)
                    .clickable(role = Role.Button, onClick = model::follow),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_recenter),
                    contentDescription = "Recenter",
                    tint = RidersColors.text,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }
}

@Composable
private fun GuidanceCard(
    instruction: String,
    type: String,
    street: String?,
    metresToManeuver: Double?,
    remainingMetres: Double?,
    arrival: String?,
    loading: Boolean,
    unavailable: Boolean,
    waitingForGps: Boolean,
    failed: Boolean,
    hasRoute: Boolean,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(8.dp, RoundedCornerShape(16.dp), ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White)
            .padding(RidersSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(RidersSpacing.sm),
    ) {
        when {
            instruction.isNotBlank() && metresToManeuver != null -> {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(RidersSpacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        painter = painterResource(R.drawable.ic_arrow_up),
                        contentDescription = null,
                        tint = RidersColors.primary,
                        modifier = Modifier
                            .size(28.dp)
                            .graphicsLayer { rotationZ = maneuverRotation(type) },
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            instruction,
                            style = RidersType.bodyStrong,
                            color = RidersColors.text,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (!street.isNullOrBlank()) {
                            Text(
                                street,
                                style = RidersType.caption,
                                color = RidersColors.textSecondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Text(
                            "In ${formatMetres(metresToManeuver)}",
                            style = RidersType.caption,
                            color = RidersColors.text,
                        )
                    }
                }
            }
            loading -> GuidanceMessage("Loading the route")
            unavailable -> GuidanceMessage("Directions are unavailable for this route.")
            failed -> GuidanceMessage("Couldn't load the route. Check the connection.")
        }
        if (remainingMetres != null) {
            val arrivalLabel = arrival?.let { "Arrive $it" }
            Text(
                listOfNotNull(formatMetres(remainingMetres), arrivalLabel).joinToString(" · "),
                style = RidersType.captionStrong,
                color = RidersColors.text,
            )
        }
        if (waitingForGps) {
            GuidanceMessage("Waiting for a GPS fix")
        }
        if (failed && hasRoute) {
            GuidanceMessage("Couldn't update the route. The previous route is still shown.")
        }
    }
}

@Composable
private fun GuidanceMessage(message: String) {
    Text(message, style = RidersType.body, color = RidersColors.text)
}

private fun maneuverRotation(type: String): Float = when (type) {
    "Left", "ExitLeft", "StayLeft", "MergeLeft", "RampLeft" -> -90f
    "SlightLeft" -> -40f
    "SharpLeft" -> -135f
    "Right", "ExitRight", "StayRight", "MergeRight", "RampRight" -> 90f
    "SlightRight" -> 40f
    "SharpRight" -> 135f
    "TurnAround", "UTurn" -> 180f
    "Roundabout", "ExitRoundabout" -> 90f
    else -> 0f
}
