package com.riders.rider.navigation

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.riders.rider.feature.auth.presentation.OtpViewModel
import com.riders.rider.feature.auth.presentation.RegisterViewModel
import com.riders.rider.feature.auth.presentation.SignInViewModel
import com.riders.rider.feature.delivery.presentation.DeliveryViewModel
import com.riders.rider.feature.home.HomeViewModel
import com.riders.rider.feature.offers.domain.ReleaseReasons
import com.riders.rider.feature.offers.presentation.OfferViewModel

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
            SignInScreen(onCodeSent = { phone ->
                controller.navigate("otp/login/${Uri.encode(phone)}")
            })
        }
        composable("register") {
            RegisterScreen(onCodeSent = { phone ->
                controller.navigate("otp/registration/${Uri.encode(phone)}")
            })
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
            )
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
private fun WelcomeScreen(onSignIn: () -> Unit, onRegister: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Riders", style = MaterialTheme.typography.headlineLarge)
        Text("Motorcycle deliveries for riders in Zimbabwe.")
        Spacer(Modifier.height(24.dp))
        Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth()) { Text("Sign in") }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onRegister, modifier = Modifier.fillMaxWidth()) { Text("Create account") }
    }
}

@Composable
private fun SignInScreen(onCodeSent: (String) -> Unit, model: SignInViewModel = hiltViewModel()) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var phone by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(ui.completedPhone) {
        ui.completedPhone?.let(onCodeSent)
    }
    PhoneForm(
        title = "Welcome back",
        phone = phone,
        onPhone = { phone = it },
        loading = ui.loading,
        error = ui.error,
        action = "Continue",
        onSubmit = { model.submit(phone) },
    )
}

@Composable
private fun RegisterScreen(onCodeSent: (String) -> Unit, model: RegisterViewModel = hiltViewModel()) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(ui.completedPhone) {
        ui.completedPhone?.let(onCodeSent)
    }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Create your rider account", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(name, { name = it }, label = { Text("Full name") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(phone, { phone = it }, label = { Text("Mobile number") }, modifier = Modifier.fillMaxWidth())
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = { model.submit(name, phone) }, enabled = !ui.loading, modifier = Modifier.fillMaxWidth()) {
            Text(if (ui.loading) "Sending" else "Continue")
        }
    }
}

@Composable
private fun OtpScreen(flow: String, phone: String, model: OtpViewModel = hiltViewModel()) {
    val ui by model.ui.collectAsStateWithLifecycle()
    var code by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Enter the code", style = MaterialTheme.typography.headlineSmall)
        Text("If this number can sign in, we sent a code by SMS.")
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(code, { code = it }, label = { Text("Code") }, modifier = Modifier.fillMaxWidth())
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = { model.submit(flow, phone, code) }, enabled = !ui.loading, modifier = Modifier.fillMaxWidth()) {
            Text(if (ui.loading) "Checking" else "Verify")
        }
    }
}

@Composable
private fun PhoneForm(
    title: String,
    phone: String,
    onPhone: (String) -> Unit,
    loading: Boolean,
    error: String?,
    action: String,
    onSubmit: () -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text(title, style = MaterialTheme.typography.headlineSmall)
        Text("Enter a Zimbabwe mobile number.")
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(phone, onPhone, label = { Text("Mobile number") }, modifier = Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(16.dp))
        Button(onClick = onSubmit, enabled = !loading, modifier = Modifier.fillMaxWidth()) {
            Text(if (loading) "Sending" else action)
        }
    }
}

@Composable
private fun HomeScreen(
    onOffers: () -> Unit,
    onDelivery: (String) -> Unit,
    model: HomeViewModel = hiltViewModel(),
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            model.goOnline()
        }
    }
    LaunchedEffect(Unit) { model.refresh() }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Rider home", style = MaterialTheme.typography.headlineSmall)
        if (ui.loading) {
            CircularProgressIndicator()
        }
        ui.readiness?.let { readiness ->
            Text("Approval: ${readiness.approvalLabel}")
            Text("Licence: ${readiness.licenceLabel}")
            Text("Availability: ${readiness.availabilityLabel}")
            Text(readiness.message)
            if (ui.shift.showGoOffline) {
                Button(onClick = model::goOffline, modifier = Modifier.fillMaxWidth()) { Text("Go offline") }
            }
            if (ui.shift.showOffers) {
                Button(onClick = onOffers, modifier = Modifier.fillMaxWidth()) { Text("Delivery requests") }
            }
            if (ui.shift.showGoOnline) {
                Button(
                    onClick = {
                        val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                        if (allowed) {
                            model.goOnline()
                        } else {
                            permission.launch(locationPermissions())
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Go online") }
            }
        }
        ui.shift.recoveryMessage?.let { Text(it) }
        if (ui.shift.recoveryFailed) {
            OutlinedButton(onClick = model::refresh, modifier = Modifier.fillMaxWidth()) { Text("Try again") }
        }
        if (ui.shift.showActiveDelivery) {
            ui.active?.let { active ->
                Button(onClick = { onDelivery(active.deliveryId) }, modifier = Modifier.fillMaxWidth()) { Text("Active delivery") }
            }
        }
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.weight(1f))
        OutlinedButton(onClick = model::logout, modifier = Modifier.fillMaxWidth()) { Text("Log out") }
    }
}

private fun locationPermissions(): Array<String> {
    val permissions = mutableListOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        permissions += Manifest.permission.POST_NOTIFICATIONS
    }
    return permissions.toTypedArray()
}

@Composable
private fun OffersScreen(onAccepted: (String) -> Unit, model: OfferViewModel = hiltViewModel()) {
    val ui by model.ui.collectAsStateWithLifecycle()
    LaunchedEffect(ui.accepted?.deliveryId) {
        ui.accepted?.let { onAccepted(it.deliveryId) }
    }
    val selected = ui.selected
    if (selected == null) {
        LazyColumn(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text("Delivery requests", style = MaterialTheme.typography.headlineSmall) }
            if (ui.loading && ui.offers.isEmpty()) {
                item { CircularProgressIndicator() }
            }
            if (!ui.loading && ui.offers.isEmpty()) {
                item { Text("No open requests.") }
            }
            items(ui.offers, key = { it.assignmentId }) { offer ->
                Card(onClick = { model.select(offer) }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("${offer.currency} ${offer.offeredPrice}", style = MaterialTheme.typography.titleMedium)
                        Text(offer.pickup.address)
                        Text(offer.dropoff.address)
                    }
                }
            }
            ui.error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
        }
    } else {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(selected.parcel.description, style = MaterialTheme.typography.headlineSmall)
            Text("Pickup: ${selected.pickup.address}")
            Text("Drop-off: ${selected.dropoff.address}")
            Text("${selected.currency} ${selected.offeredPrice}")
            Button(
                onClick = { model.accept(selected) },
                enabled = !ui.accepting,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Accept") }
            ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            OutlinedButton(onClick = { model.select(null) }) { Text("Back") }
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
