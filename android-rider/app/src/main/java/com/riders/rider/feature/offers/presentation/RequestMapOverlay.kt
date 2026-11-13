package com.riders.rider.feature.offers.presentation

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.JointType
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
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
import com.riders.rider.core.design.RidersFailureNotice
import com.riders.rider.core.design.RidersSpacing
import com.riders.rider.core.network.OfferResponse
import com.riders.rider.feature.bids.data.BidRepository
import com.riders.rider.feature.delivery.domain.GeoPoint
import com.riders.rider.feature.delivery.domain.STREET_LEVEL_ZOOM
import com.riders.rider.feature.delivery.domain.collectionCameraFrame
import com.riders.rider.feature.delivery.domain.collectionMarkerPaddingPx
import com.riders.rider.feature.delivery.domain.parseGeoPoint
import com.riders.rider.feature.delivery.presentation.RiderMapStyles
import com.riders.rider.feature.delivery.presentation.RiderMapThemeStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch

private val pickupGreen = Color(0xFF169B62)
private val dropoffBlue = Color(0xFF1A73E8)
private const val FRAME_LOOSEN = 0.08

@HiltViewModel
class RequestRouteModel @Inject constructor(
    private val bids: BidRepository,
) : ViewModel() {
    var line by mutableStateOf<List<GeoPoint>>(emptyList())
        private set
    private var requested: String? = null

    fun load(deliveryId: String) {
        if (requested == deliveryId) {
            return
        }
        requested = deliveryId
        line = emptyList()
        viewModelScope.launch {
            val road = bids.requestRoad(deliveryId)
            if (requested == deliveryId) {
                line = road
            }
        }
    }
}

@Composable
fun RequestMapOverlay(
    offer: OfferResponse,
    nowMillis: Long,
    accepting: Boolean,
    submittingBid: Boolean,
    statusLabel: String?,
    sentAmount: String?,
    bidsOpen: Boolean,
    error: String?,
    onAccept: () -> Unit,
    onBid: () -> Unit,
    onSubmitBid: (String) -> Unit,
    onInterest: () -> Unit,
    onClose: () -> Unit,
    routes: RequestRouteModel = hiltViewModel(),
) {
    val pickup = remember(offer.deliveryId, offer.pickup.latitude, offer.pickup.longitude) {
        parseGeoPoint(offer.pickup.latitude, offer.pickup.longitude)
    }
    val dropoff = remember(offer.deliveryId, offer.dropoff.latitude, offer.dropoff.longitude) {
        parseGeoPoint(offer.dropoff.latitude, offer.dropoff.longitude)
    }
    LaunchedEffect(offer.deliveryId) { routes.load(offer.deliveryId) }
    val density = LocalDensity.current
    var sheetHeight by remember { mutableStateOf(0.dp) }
    var recenter by remember { mutableIntStateOf(0) }
    val cardShape = RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp)
    Box(Modifier.fillMaxSize()) {
        RequestRouteMap(
            deliveryId = offer.deliveryId,
            pickup = pickup,
            dropoff = dropoff,
            line = routes.line,
            modifier = Modifier.fillMaxSize(),
            sheetOverlap = sheetHeight,
            recenter = recenter,
        )
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .padding(
                    top = with(density) { WindowInsets.statusBars.getTop(this).toDp() } + RidersSpacing.md,
                    end = RidersSpacing.lg,
                )
                .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .size(44.dp)
                .clip(CircleShape)
                .background(RidersColors.sheet)
                .clickable(role = Role.Button, onClick = onClose),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_close),
                contentDescription = "Close request",
                tint = RidersColors.text,
                modifier = Modifier.size(20.dp),
            )
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .onSizeChanged { sheetHeight = with(density) { it.height.toDp() } }
                .shadow(12.dp, cardShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .clip(cardShape)
                .background(RidersColors.background)
                .padding(RidersSpacing.lg),
        ) {
            OfferRequestCard(
                offer = offer,
                nowMillis = nowMillis,
                accepting = accepting,
                submittingBid = submittingBid,
                statusLabel = statusLabel,
                sentAmount = sentAmount,
                bidsOpen = bidsOpen,
                onAccept = onAccept,
                onBid = onBid,
                onSubmitBid = onSubmitBid,
                onInterest = onInterest,
            )
            if (!error.isNullOrBlank()) {
                RidersFailureNotice(message = error)
            }
        }
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .padding(end = RidersSpacing.lg, bottom = sheetHeight + RidersSpacing.md)
                .shadow(8.dp, CircleShape, ambientColor = RidersColors.shadow, spotColor = RidersColors.shadow)
                .size(44.dp)
                .clip(CircleShape)
                .background(RidersColors.sheet)
                .clickable(role = Role.Button) { recenter += 1 },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_recenter),
                contentDescription = "Center map",
                tint = RidersColors.text,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

