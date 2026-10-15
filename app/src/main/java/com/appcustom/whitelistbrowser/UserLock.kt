package com.appcustom.whitelistbrowser

import android.app.Activity
import android.content.Context
import android.text.InputType

/**
 * An optional PIN the person using this phone can set to open Whitelist Browser. It's theirs: chosen by them, kept
 * only on this phone (as a one-way hash), and nothing to do with the admin or the admin's PIN. When one is set the
 * browser asks for it each time it comes to the front; a fingerprint/face works too, if the phone has one.
 */
object UserLock {
    private const val PREF = "userlock"

    /** Unlocked for the current time in front; cleared when the app is sent to the background (onStop). */
    @Volatile var unlocked = false

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
    fun isSet(ctx: Context): Boolean = !prefs(ctx).getString("pin", null).isNullOrEmpty()
    fun setPin(ctx: Context, pin: String) { prefs(ctx).edit().putString("pin", hash(pin)).apply(); unlocked = true }
    fun clear(ctx: Context) { prefs(ctx).edit().remove("pin").apply(); unlocked = true }
    private fun matches(ctx: Context, pin: String): Boolean = prefs(ctx).getString("pin", null) == hash(pin)

    private fun hash(s: String): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(("wlb-userlock:$s").toByteArray())
            .joinToString("") { "%02x".format(it) }

    private const val PIN_TYPE = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD

    private fun canBiometric(ctx: Context): Boolean {
        if (android.os.Build.VERSION.SDK_INT < 29) return false
        val bm = ctx.getSystemService(android.hardware.biometrics.BiometricManager::class.java) ?: return false
        @Suppress("DEPRECATION")
        return bm.canAuthenticate() == android.hardware.biometrics.BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun askBiometric(activity: Activity, done: (Boolean) -> Unit) {
        if (!canBiometric(activity) || android.os.Build.VERSION.SDK_INT < 29) { done(false); return }
        val executor = activity.mainExecutor
        var answered = false
        val once = { ok: Boolean -> if (!answered) { answered = true; done(ok) } }
        val prompt = android.hardware.biometrics.BiometricPrompt.Builder(activity)
            .setTitle("Open Whitelist Browser").setSubtitle("Use your fingerprint (or face)")
            .setNegativeButton("Use PIN", executor) { _, _ -> once(false) }.build()
        runCatching {
            prompt.authenticate(android.os.CancellationSignal(), executor, object : android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: android.hardware.biometrics.BiometricPrompt.AuthenticationResult?) { once(true) }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) { once(false) }
            })
        }.onFailure { once(false) }
    }

    /** The lock screen, shown when the browser opens and a PIN is set. [onUnlock] runs once, when unlocked. */
    fun promptUnlock(activity: Activity, onUnlock: () -> Unit) {
        if (!isSet(activity)) { unlocked = true; onUnlock(); return }
        val d = Ui.AppDialog(activity, sheet = false, cancelable = false)
        d.title("Enter PIN", "to open Whitelist Browser", R.drawable.ic_d_user)
        val field = Ui.field(activity, "PIN", type = PIN_TYPE)
        d.add(field)
        d.button("Unlock", Ui.Kind.PRIMARY) {
            if (matches(activity, field.text.toString())) { unlocked = true; it.dismiss(); onUnlock() }
            else { field.error = "Wrong PIN"; field.setText("") }
        }
        if (canBiometric(activity)) d.button("Fingerprint", Ui.Kind.SECONDARY) {
            askBiometric(activity) { ok -> if (ok) { unlocked = true; it.dismiss(); onUnlock() } }
        }
        d.show()
        if (canBiometric(activity)) askBiometric(activity) { ok -> if (ok && d.isShowing) { unlocked = true; d.dismiss(); onUnlock() } }
    }

    /** Settings → turn the PIN on, change it, or remove it. [after] refreshes the settings row. */
    fun manage(activity: Activity, after: () -> Unit) {
        if (isSet(activity)) {
            val d = Ui.AppDialog(activity, sheet = false)
            d.title("Lock with a PIN", "A PIN is set on this phone.", R.drawable.ic_d_user)
            d.button("Remove", Ui.Kind.DANGER) { clear(activity); it.dismiss(); after() }
            d.button("Change", Ui.Kind.SECONDARY) { it.dismiss(); setFlow(activity, after) }
            d.button("Close", Ui.Kind.GHOST) { it.dismiss() }
            d.show()
        } else setFlow(activity, after)
    }

    private fun setFlow(activity: Activity, after: () -> Unit) {
        val d = Ui.AppDialog(activity, sheet = false)
        d.title("Set a PIN", "It's yours, kept only on this phone. Nothing to do with the admin.", R.drawable.ic_d_user)
        val a = Ui.field(activity, "New PIN", type = PIN_TYPE)
        val b = Ui.field(activity, "PIN again", type = PIN_TYPE)
        d.add(a); d.add(b)
        d.button("Save", Ui.Kind.PRIMARY) {
            val p = a.text.toString()
            when {
                p.length < 4 -> a.error = "At least 4 digits"
                p != b.text.toString() -> b.error = "PINs don't match"
                else -> { setPin(activity, p); it.dismiss(); after() }
            }
        }
        d.button("Cancel", Ui.Kind.GHOST) { it.dismiss() }
        d.show()
    }
}
