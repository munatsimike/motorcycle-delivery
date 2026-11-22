package com.riders.rider.feature.delivery.presentation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.JointType
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.RoundCap
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.riders.rider.BuildConfig
import com.riders.rider.R
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.STREET_LEVEL_ZOOM
import com.riders.rider.feature.delivery.domain.approachSummary
import com.riders.rider.feature.delivery.domain.collectionCameraFrame
import com.riders.rider.feature.delivery.domain.collectionMarkerPaddingPx
import com.riders.rider.feature.delivery.domain.parseGeoPoint

private val routeGreen = Color(0xFF169B62)
private val routeBlue = Color(0xFF1A73E8)
private val sideClearance = 40.dp
private val pinClearance = 48.dp
private val boundsAir = 12.dp
/** Shows about 8% more ground than a tight fit, at every distance. */
private const val FRAME_LOOSEN = 0.08
/** Circular back control: 12.dp under the status bar, 44.dp tall, plus an 8.dp gap. */
private val mapChromeClearance = 64.dp

@Composable
fun CollectionMap(
    assignmentId: String,
    pickupLatitude: String?,
    pickupLongitude: String?,
    sheetOverlap: Dp,
    modifier: Modifier = Modifier,
    model: CollectionMapModel = hiltViewModel(),
) {
    val pickup = remember(pickupLatitude, pickupLongitude) { parseGeoPoint(pickupLatitude, pickupLongitude) }
    val rider by model.rider.collectAsStateWithLifecycle()
    val route by model.route.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val density = LocalDensity.current
    val mapStyles = remember(context) { RiderMapStyles.load(context) }
    var mapTheme by remember { mutableStateOf(RiderMapTheme.ClassicLight) }
    LaunchedEffect(Unit) {
        RiderMapThemeStore.write(context, RiderMapTheme.ClassicLight)
    }
    val mapStyle = mapStyles.optionsFor(mapTheme)
    var pickupIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    var riderIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
    val initial = pickup ?: rider?.let { GeoPoint(it.latitude, it.longitude) }
    val camera = rememberCameraPositionState {
        if (initial != null) {
            position = CameraPosition.fromLatLngZoom(initial.toLatLng(), 14f)
        }
    }
    var mapLoaded by remember { mutableStateOf(false) }
    var mapWidth by remember { mutableStateOf(0) }
    var mapHeight by remember { mutableStateOf(0) }
    var userMoved by remember(assignmentId) { mutableStateOf(false) }
    var framedWithRider by remember(assignmentId, pickup) { mutableStateOf(false) }
    var framedRoute by remember(assignmentId, pickup) { mutableStateOf(false) }
    var recenter by remember { mutableStateOf(0) }
    val riderPoint = rider?.let { GeoPoint(it.latitude, it.longitude) }
    val riderReady = riderPoint != null
    val riderGate = riderReady || framedWithRider
    val routeReady = route.line.size > 1
    val routeGate = routeReady || framedRoute
    val statusTop = with(density) { WindowInsets.statusBars.getTop(this).toDp() }
    val approachLabel = approachSummary(route.metres, route.seconds)
    val topClearance = statusTop + mapChromeClearance + pinClearance
    val mapHeightDp = with(density) { mapHeight.toDp() }
    val paddingBudget = if (mapHeightDp > 96.dp) (mapHeightDp - 96.dp) / 2 else 0.dp
    val topPadding = if (mapHeightDp > 96.dp) topClearance.coerceAtMost(paddingBudget) else 0.dp
    val bottomPadding = if (mapHeightDp > 96.dp) (sheetOverlap + sideClearance).coerceAtMost(paddingBudget) else 0.dp
    val boundsPadding = collectionMarkerPaddingPx(boundsAir.value, density.density)
    val stroke = with(density) { 5.dp.toPx() }

    DisposableEffect(assignmentId, pickup) {
        if (assignmentId.isNotBlank() && pickup != null) {
            model.activate(CollectionTarget(assignmentId, pickup))
        }
        onDispose { model.deactivate() }
    }

    LaunchedEffect(assignmentId, pickup, riderGate, routeGate, mapLoaded, mapWidth, mapHeight, recenter, sheetOverlap) {
        if (!mapLoaded || userMoved || mapWidth <= 0 || mapHeight <= 0) {
            return@LaunchedEffect
        }
        if (riderReady) {
            framedWithRider = true
        }
        if (routeReady) {
            framedRoute = true
        }
        val frame = collectionCameraFrame(
            riderPoint,
            pickup,
            if (routeReady) route.line else emptyList(),
        ) ?: return@LaunchedEffect
        val update = if (frame.streetLevel) {
            CameraUpdateFactory.newLatLngZoom(frame.center.toLatLng(), loosenedStreetZoom())
        } else {
            CameraUpdateFactory.newLatLngBounds(loosenedBounds(frame.points), boundsPadding)
        }
        runCatching { camera.animate(update, 450) }
    }

    Box(modifier) {
        if (initial != null) {
            GoogleMap(
                modifier = Modifier
                    .fillMaxSize()
                    .onSizeChanged {
                        mapWidth = it.width
                        mapHeight = it.height
                    },
                cameraPositionState = camera,
                contentPadding = PaddingValues(
                    start = sideClearance,
                    top = topPadding,
                    end = sideClearance,
                    bottom = bottomPadding,
                ),
                properties = MapProperties(isMyLocationEnabled = false, mapStyleOptions = mapStyle),
                uiSettings = MapUiSettings(
                    zoomControlsEnabled = false,
                    compassEnabled = false,
                    myLocationButtonEnabled = false,
                    mapToolbarEnabled = false,
                    rotationGesturesEnabled = false,
                    tiltGesturesEnabled = false,
                ),
                onMapLoaded = {
                    mapLoaded = true
                    if (pickupIcon == null) {
                        pickupIcon = markerBitmap(context, R.drawable.ic_filled_pickup_marker, routeGreen.toArgb(), 38f, circled = false)
                        riderIcon = riderMotorcycleBitmap(context)
                    }
                },
            ) {
                if (route.line.size > 1) {
                    Polyline(
                        points = route.line.map { it.toLatLng() },
                        color = routeBlue,
                        width = stroke,
                        jointType = JointType.ROUND,
                        startCap = RoundCap(),
                        endCap = RoundCap(),
                        zIndex = 0f,
                    )
                }
                if (pickup != null && pickupIcon != null) {
                    Marker(
                        state = remember(pickup) { MarkerState(pickup.toLatLng()) },
                        icon = pickupIcon,
                        anchor = androidx.compose.ui.geometry.Offset(0.5f, 0.92f),
                        zIndex = 1f,
                    )
                }
                if (rider != null && riderIcon != null) {
                    val position = LatLng(rider!!.latitude, rider!!.longitude)
                    val state = remember { MarkerState(position) }
                    LaunchedEffect(position) { state.position = position }
                    Marker(
                        state = state,
                        icon = riderIcon,
                        anchor = androidx.compose.ui.geometry.Offset(0.5f, 0.5f),
                        zIndex = 2f,
                    )
                }
            }
        }
        val mapNotice = approachLabel ?: if (pickup != null && rider == null) "Location unavailable" else null
        if (mapNotice != null) {
            Text(
                mapNotice,
                style = RidersType.captionStrong,
                color = if (approachLabel != null) RidersColors.text else RidersColors.textSecondary,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(top = RidersSpacing.lg)
                    .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                    .clip(CircleShape)
                    .background(Color.White)
                    .padding(horizontal = RidersSpacing.lg, vertical = RidersSpacing.sm),
            )
        }
        if (BuildConfig.DEBUG) {
            Row(
                Modifier
                    .align(Alignment.BottomStart)
                    .padding(start = RidersSpacing.md, bottom = sheetOverlap + RidersSpacing.md)
                    .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                    .clip(CircleShape)
                    .background(Color.White)
                    .padding(RidersSpacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RiderMapTheme.entries.forEach { option ->
                    val selected = option == mapTheme
                    Text(
                        if (option == RiderMapTheme.MinimalLight) "Minimal" else "Classic",
                        style = RidersType.small,
                        color = if (selected) Color.White else RidersColors.textSecondary,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (selected) RidersColors.primary else Color.Transparent)
                            .clickable(role = Role.Button) {
                                mapTheme = option
                                RiderMapThemeStore.write(context, option)
                            }
                            .padding(horizontal = RidersSpacing.sm, vertical = RidersSpacing.xs),
                    )
                }
            }
        }
        Icon(
            painter = painterResource(R.drawable.ic_recenter),
            contentDescription = "Recenter map",
            tint = RidersColors.text,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = RidersSpacing.md, bottom = sheetOverlap + RidersSpacing.md)
                .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .size(44.dp)
                .clip(CircleShape)
                .background(Color.White)
                .clickable(role = Role.Button) {
                    userMoved = false
                    recenter += 1
                }
                .padding(10.dp),
        )
    }

    LaunchedEffect(camera.isMoving, camera.cameraMoveStartedReason) {
        if (camera.isMoving && camera.cameraMoveStartedReason == com.google.maps.android.compose.CameraMoveStartedReason.GESTURE) {
            userMoved = true
        }
    }
}

private fun GeoPoint.toLatLng(): LatLng = LatLng(latitude, longitude)

private fun loosenedStreetZoom(): Float {
    val levels = Math.log(1.0 + FRAME_LOOSEN) / Math.log(2.0)
    return STREET_LEVEL_ZOOM - levels.toFloat()
}

/** Grows the fitted area evenly around its center so the camera zooms out without sliding. */
private fun loosenedBounds(points: List<GeoPoint>): LatLngBounds {
    val bounds = LatLngBounds.builder().apply {
        points.forEach { include(it.toLatLng()) }
    }.build()
    val latitudePad = (bounds.northeast.latitude - bounds.southwest.latitude) * FRAME_LOOSEN / 2.0
    val longitudePad = (bounds.northeast.longitude - bounds.southwest.longitude) * FRAME_LOOSEN / 2.0
    return LatLngBounds(
        LatLng(bounds.southwest.latitude - latitudePad, bounds.southwest.longitude - longitudePad),
        LatLng(bounds.northeast.latitude + latitudePad, bounds.northeast.longitude + longitudePad),
    )
}

private fun markerBitmap(
    context: android.content.Context,
    drawableId: Int,
    tint: Int,
    sizeDp: Float,
    circled: Boolean,
): BitmapDescriptor? {
    val drawable = ContextCompat.getDrawable(context, drawableId)?.mutate() ?: return null
    val size = (sizeDp * context.resources.displayMetrics.density).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    if (circled) {
        canvas.drawCircle(
            size / 2f,
            size / 2f,
            size / 2f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE },
        )
    }
    if (drawableId != R.drawable.ic_filled_pickup_marker) drawable.setTint(tint)
    val inset = if (circled) size / 5 else 0
    drawable.setBounds(inset, inset, size - inset, size - inset)
    drawable.draw(canvas)
    return runCatching { BitmapDescriptorFactory.fromBitmap(bitmap) }.getOrNull()
}

/** Green motorcycle with a yellow delivery box, drawn locally without external images. */
internal fun riderMotorcycleBitmap(context: android.content.Context): BitmapDescriptor {
    val source = android.graphics.BitmapFactory.decodeResource(context.resources, R.drawable.rider_motorcycle_yellow_box)
    val size = (64f * context.resources.displayMetrics.density).toInt().coerceAtLeast(1)
    val scaled = Bitmap.createScaledBitmap(source, size, size, true)
    return BitmapDescriptorFactory.fromBitmap(scaled)
}
