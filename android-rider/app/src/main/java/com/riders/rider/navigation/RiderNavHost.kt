package com.riders.rider.navigation

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.riders.rider.feature.auth.presentation.AccountScreen
import com.riders.rider.feature.auth.presentation.OtpScreen
import com.riders.rider.feature.auth.presentation.RegisterScreen
import com.riders.rider.feature.auth.presentation.SignInScreen
import com.riders.rider.feature.auth.presentation.WelcomeScreen
import com.riders.rider.feature.delivery.presentation.DeliveryScreen
import com.riders.rider.feature.onboarding.presentation.OnboardingScreen

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
        startDestination = if (signedIn) RIDER_SHELL else "welcome",
    ) {
        composable("welcome") {
            WelcomeScreen(
                onSignIn = { controller.navigate("sign-in") },
                onRegister = { controller.navigate("register") },
            )
        }
        composable(
            route = "sign-in?notice={notice}",
            arguments = listOf(
                navArgument("notice") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { entry ->
            SignInScreen(
                notice = entry.arguments?.getString("notice").orEmpty().ifBlank { null },
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
            val phone = entry.arguments?.getString("phone").orEmpty()
            OtpScreen(
                flow = entry.arguments?.getString("flow").orEmpty(),
                phone = phone,
                onRegistrationVerified = { token, name, address, locked ->
                    val route = "account?phone=${Uri.encode(phone)}&token=${Uri.encode(token)}" +
                        "&name=${Uri.encode(name.orEmpty())}&address=${Uri.encode(address.orEmpty())}" +
                        "&locked=$locked"
                    controller.navigate(route) {
                        popUpTo("welcome")
                    }
                },
                onUseExistingLogin = {
                    controller.navigate("sign-in?notice=${Uri.encode("Sign in to your existing account")}") {
                        popUpTo("welcome")
                    }
                },
            )
        }
        composable(
            route = "account?phone={phone}&token={token}&name={name}&address={address}&locked={locked}",
            arguments = listOf(
                navArgument("phone") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("token") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("name") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("address") {
                    type = NavType.StringType
                    defaultValue = ""
                },
                navArgument("locked") {
                    type = NavType.StringType
                    defaultValue = "false"
                },
            ),
        ) {
            AccountScreen()
        }
        composable(RIDER_SHELL) { entry ->
            RiderShell(
                entry = entry,
                onDelivery = { deliveryId -> controller.navigate("delivery/$deliveryId") },
                onAccepted = { deliveryId ->
                    controller.navigate("delivery/$deliveryId") {
                        popUpTo(RIDER_SHELL)
                    }
                },
                onSetup = { controller.navigate("onboarding") },
                onLicence = { controller.navigate(profileOnboardingRoute("licence")) },
                onMotorcycles = { controller.navigate(profileOnboardingRoute("motorcycle")) },
            )
        }
        composable(
            route = "onboarding?step={step}",
            arguments = listOf(
                navArgument("step") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
        ) { entry ->
            val step = entry.arguments?.getString("step")
            OnboardingScreen(
                onFinished = {
                    controller.previousBackStackEntry?.savedStateHandle?.set("refreshProfile", true)
                    controller.popBackStack()
                },
                focused = !showsWizardChrome(step),
            )
        }
        composable(
            route = "delivery/{deliveryId}",
            arguments = listOf(navArgument("deliveryId") { type = NavType.StringType }),
        ) { entry ->
            DeliveryScreen(
                deliveryId = entry.arguments?.getString("deliveryId").orEmpty(),
                onFinished = { controller.popBackStack(RIDER_SHELL, inclusive = false) },
            )
        }
    }
}
