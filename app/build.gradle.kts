plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Push notifications (Firebase Cloud Messaging) are OPTIONAL. The google-services plugin only runs if you've added
// google-services.json (from the Firebase console) — placed in app/ or in app/src/browser/ and app/src/admin/. Without
// it the app still builds and works, just without instant push (it falls back to the background check). See FCM-SETUP.md.
val hasGoogleServices = file("google-services.json").exists() ||
    file("src/browser/google-services.json").exists() || file("src/admin/google-services.json").exists()
if (hasGoogleServices) apply(plugin = "com.google.gms.google-services")

// Each GitHub Actions build gets a higher number, which the in-app updater compares.
val buildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

android {
    namespace = "com.lazerlock.browser"
    compileSdk = 34

    defaultConfig {
        // The app's unique name on Android (not shown to users). Changing it makes it a different app:
        // phones can't update across it.
        applicationId = "com.lazerlock.browser"
        minSdk = 24
        targetSdk = 34
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"

        // Key that lets the app create request issues (GitHub secret REQUESTS_TOKEN). Stored reversed.
        val requestsToken = (System.getenv("REQUESTS_TOKEN") ?: "").trim().reversed()
        buildConfigField("String", "REQUESTS_TOKEN_REV", "\"$requestsToken\"")
        // The request key's public half (request-key.pem, published by the private repository): requests are
        // sealed with it, so only GitHub's automation can read them. Not secret: it can only lock, not unlock.
        val requestKey = rootProject.file("request-key.pem").takeIf { it.exists() }?.readText()
            ?.lines()?.filter { it.isNotBlank() && !it.startsWith("-----") }?.joinToString("")?.trim() ?: ""
        buildConfigField("String", "REQUEST_KEY", "\"$requestKey\"")
    }

    // The release key comes from GitHub secrets (see the "Create signing key" workflow).
    signingConfigs {
        create("release") {
            val ks = System.getenv("KEYSTORE_FILE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    // Two apps from the same code: the browser (for the phones), and LazerLock Admin (just the admin page, for the
    // people who manage it). Different app IDs, so a phone can have both. Each updates itself from its own release.
    flavorDimensions += "app"
    productFlavors {
        create("browser") {
            dimension = "app"
            buildConfigField("Boolean", "ADMIN_APP", "false")
        }
        create("admin") {
            dimension = "app"
            applicationId = "com.lazerlock.admin"   // its own id (not a suffix), so it installs beside the browser
            buildConfigField("Boolean", "ADMIN_APP", "true")
        }
    }

    buildFeatures { buildConfig = true }

    // Don't let style warnings stop the build.
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // Google's WebView additions: lets AdGuard's scripts run before a page's own scripts (as AdGuard does).
    implementation("androidx.webkit:webkit:1.11.0")
    // Translating pages on the phone (Google ML Kit): the page's text never leaves the phone.
    implementation("com.google.mlkit:translate:17.0.3")
    implementation("com.google.mlkit:language-id:17.0.6")
    // Firebase Cloud Messaging for instant push. Inert unless google-services.json is present (see above); the app
    // feature-detects Firebase at runtime (Fcm.available) and falls back to the background check when it isn't set up.
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-messaging")
}
