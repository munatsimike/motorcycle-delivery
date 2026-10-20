import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) {
        file.inputStream().use { load(it) }
    }
}

val configuredApiBaseUrl = localProperties.getProperty("API_BASE_URL")?.trim().orEmpty().trimEnd('/')

fun apiBaseUrl(release: Boolean): String {
    if (release) {
        return configuredApiBaseUrl
    }
    return configuredApiBaseUrl.ifEmpty { "http://10.0.2.2:3000" }
}

gradle.taskGraph.whenReady {
    val buildingRelease = allTasks.any { it.name.contains("Release", ignoreCase = false) }
    if (buildingRelease && !configuredApiBaseUrl.startsWith("https://")) {
        throw GradleException("The release build requires an https API_BASE_URL in local.properties.")
    }
}

android {
    namespace = "com.riders.rider"
    compileSdk {
        version = release(37) {
            minorApiLevel = 2
        }
    }

    defaultConfig {
        applicationId = "com.riders.rider"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl(false)}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl(true)}\"")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.core.ktx)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.navigation.compose)
    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation)
    ksp(libs.hilt.compiler)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.datastore)
    implementation(libs.retrofit)
    implementation(libs.serialization.json)
    implementation(libs.serialization.converter)
    implementation(libs.okhttp)
    implementation(libs.security.crypto)
    implementation(libs.biometric)
    implementation(libs.coroutines)
    implementation(libs.play.location)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.turbine)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test)
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}
