package com.riders.rider.navigation

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.riders.rider.feature.auth.presentation.OtpScreen
import com.riders.rider.feature.auth.presentation.RegisterScreen
import com.riders.rider.feature.auth.presentation.SignInScreen
import com.riders.rider.feature.auth.presentation.WelcomeScreen
import com.riders.rider.feature.delivery.presentation.DeliveryViewModel
import com.riders.rider.feature.home.HomeScreen
import com.riders.rider.feature.onboarding.presentation.OnboardingScreen
import com.riders.rider.feature.offers.domain.ReleaseReasons
import com.riders.rider.feature.offers.presentation.OffersScreen

@Composable
fun RiderNavHost(signedIn: Boolean) {
    key(signedIn) {
        RiderGraph(signedIn)
    }
}

@Composable
private fun RiderGraph(signedIn: Boolean) {
    val controller = rememberNavController()
    NavHost(
        navController = controller,
        startDestination = if (signedIn) "home" else "welcome",
    ) {
        composable("welcome") {
            WelcomeScreen(
                onSignIn = { controller.navigate("sign-in") },
                onRegister = { controller.navigate("register") },
            )
        }
        composable("sign-in") {
            SignInScreen(
                onCodeSent = { phone ->
                    controller.navigate("otp/login/${Uri.encode(phone)}")
                },
                onCreateAccount = { controller.navigate("register") },
            )
        }
        composable("register") {
            RegisterScreen(
                onCodeSent = { phone ->
                    controller.navigate("otp/registration/${Uri.encode(phone)}")
                },
                onSignIn = { controller.navigate("sign-in") },
            )
        }
        composable(
            route = "otp/{flow}/{phone}",
            arguments = listOf(
                navArgument("flow") { type = NavType.StringType },
                navArgument("phone") { type = NavType.StringType },
            ),
        ) { entry ->
            OtpScreen(
                flow = entry.arguments?.getString("flow").orEmpty(),
                phone = entry.arguments?.getString("phone").orEmpty(),
            )
        }
        composable("home") {
            HomeScreen(
                onOffers = { controller.navigate("offers") },
                onDelivery = { deliveryId -> controller.navigate("delivery/$deliveryId") },
                onSetup = { controller.navigate("onboarding") },
            )
        }
        composable("onboarding") {
            OnboardingScreen(onFinished = { controller.popBackStack() })
        }
        composable("offers") {
            OffersScreen(onAccepted = { deliveryId ->
                controller.navigate("delivery/$deliveryId") { popUpTo("home") }
            })
        }
        composable(
            route = "delivery/{deliveryId}",
            arguments = listOf(navArgument("deliveryId") { type = NavType.StringType }),
        ) { entry ->
            DeliveryScreen(
                deliveryId = entry.arguments?.getString("deliveryId").orEmpty(),
                onFinished = { controller.popBackStack("home", inclusive = false) },
            )
        }
    }
}

@Composable
private fun DeliveryScreen(
    deliveryId: String,
    onFinished: () -> Unit,
    model: DeliveryViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    LaunchedEffect(deliveryId) { model.load(deliveryId) }
    LaunchedEffect(ui.finished) { if (ui.finished) onFinished() }
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        Text("Delivery", style = MaterialTheme.typography.headlineSmall)
        Text(ui.statusLabel)
        if (ui.pickupAddress.isNotEmpty()) {
            Text("Pickup: ${ui.pickupAddress}")
        }
        if (ui.dropoffAddress.isNotEmpty()) {
            Text("Drop-off: ${ui.dropoffAddress}")
        }
        ui.nextLabel?.let { label ->
            Button(onClick = model::advance, modifier = Modifier.fillMaxWidth()) { Text(label) }
        }
        if (ui.canRelease) {
            ReleaseReasons.forEach { (reason, label) ->
                OutlinedButton(onClick = { model.release(reason) }, modifier = Modifier.fillMaxWidth()) { Text(label) }
            }
        }
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
