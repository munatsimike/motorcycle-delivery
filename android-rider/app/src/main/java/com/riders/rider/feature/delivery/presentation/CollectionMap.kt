package com.riders.rider.feature.delivery.presentation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
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
import androidx.compose.ui.geometry.Offset
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
import com.riders.rider.core.design.LocalAppDark
import com.riders.rider.core.design.RidersColors
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.design.RidersType
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.withMinimumCameraSpan
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
    val mapStyle = mapStyles.optionsFor(mapTheme, LocalAppDark.current)
    var pickupIcon by remember { mutableStateOf<BitmapDescriptor?>(null) }
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
    val riderMarker = remember(approachLabel, mapLoaded) {
        if (mapLoaded) riderMarkerIcon(context, approachLabel) else null
    }
    val topClearance = statusTop + mapChromeClearance + pinClearance
    val mapHeightDp = with(density) { mapHeight.toDp() }
    val paddingBudget = if (mapHeightDp > 96.dp) (mapHeightDp - 96.dp) / 2 else 0.dp
    val topPadding = if (mapHeightDp > 96.dp) topClearance.coerceAtMost(paddingBudget) else 0.dp
    val bottomPadding = if (mapHeightDp > 96.dp) (sheetOverlap + sideClearance).coerceAtMost(paddingBudget) else 0.dp
    val boundsPadding = collectionMarkerPaddingPx(boundsAir.value, density.density)
    val stroke = with(density) { 4.dp.toPx() }

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
        val update = CameraUpdateFactory.newLatLngBounds(
            loosenedBounds(withMinimumCameraSpan(frame.points)),
            boundsPadding,
        )
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
                if (rider != null && riderMarker != null) {
                    val position = LatLng(rider!!.latitude, rider!!.longitude)
                    val state = remember { MarkerState(position) }
                    LaunchedEffect(position) { state.position = position }
                    Marker(
                        state = state,
                        icon = riderMarker.icon,
                        anchor = riderMarker.anchor,
                        zIndex = 2f,
                    )
                }
            }
        }
        if (pickup != null && rider == null) {
            Text(
                "Location unavailable",
                style = RidersType.captionStrong,
                color = RidersColors.textSecondary,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(top = RidersSpacing.lg)
                    .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                    .clip(CircleShape)
                    .background(RidersColors.sheet)
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
                    .background(RidersColors.sheet)
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
                .background(RidersColors.sheet)
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

/** Motorcycle marker. A distance label sits in a white pill 8dp above the image, anchored at the bike center. */
internal data class RiderMarkerIcon(val icon: BitmapDescriptor, val anchor: Offset)

internal fun riderMarkerIcon(context: android.content.Context, label: String?): RiderMarkerIcon {
    if (label.isNullOrBlank()) {
        return RiderMarkerIcon(riderMotorcycleBitmap(context), Offset(0.5f, 0.5f))
    }
    val density = context.resources.displayMetrics.density
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF17211D.toInt()
        textSize = 14f * density
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }
    val padH = 12f * density
    val padV = 6f * density
    val textWidth = textPaint.measureText(label)
    val textHeight = textPaint.fontMetrics.run { descent - ascent }
    val badgeWidth = textWidth + padH * 2f
    val badgeHeight = textHeight + padV * 2f
    val gap = 8f * density
    val bike = (64f * density).toInt().coerceAtLeast(1)
    val shadow = 3f * density
    val width = maxOf(badgeWidth + shadow * 2f, bike.toFloat()).toInt().coerceAtLeast(1)
    val bikeTop = badgeHeight + gap
    val height = (bikeTop + bike).toInt().coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val badgeLeft = (width - badgeWidth) / 2f
    val radius = badgeHeight / 2f
    canvas.drawRoundRect(
        badgeLeft,
        shadow,
        badgeLeft + badgeWidth,
        shadow + badgeHeight,
        radius,
        radius,
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x3317211D },
    )
    canvas.drawRoundRect(
        badgeLeft,
        0f,
        badgeLeft + badgeWidth,
        badgeHeight,
        radius,
        radius,
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE },
    )
    canvas.drawText(
        label,
        badgeLeft + padH,
        padV - textPaint.fontMetrics.ascent,
        textPaint,
    )
    val source = android.graphics.BitmapFactory.decodeResource(context.resources, R.drawable.rider_motorcycle_yellow_box)
    val scaled = Bitmap.createScaledBitmap(source, bike, bike, true)
    canvas.drawBitmap(scaled, (width - bike) / 2f, bikeTop, null)
    val anchorY = (bikeTop + bike / 2f) / height.toFloat()
    return RiderMarkerIcon(BitmapDescriptorFactory.fromBitmap(bitmap), Offset(0.5f, anchorY.coerceIn(0f, 1f)))
}

/** Green motorcycle with a yellow delivery box, drawn locally without external images. */
internal fun riderMotorcycleImage(context: android.content.Context): Bitmap {
    val source = android.graphics.BitmapFactory.decodeResource(context.resources, R.drawable.rider_motorcycle_yellow_box)
    val size = (64f * context.resources.displayMetrics.density).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(source, size, size, true)
}

internal fun riderMotorcycleBitmap(context: android.content.Context): BitmapDescriptor {
    return BitmapDescriptorFactory.fromBitmap(riderMotorcycleImage(context))
}
