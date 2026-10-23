plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    // Firebase (push notifications) is optional: the plugin is only applied by :app when google-services.json exists.
    id("com.google.gms.google-services") version "4.4.2" apply false
}
