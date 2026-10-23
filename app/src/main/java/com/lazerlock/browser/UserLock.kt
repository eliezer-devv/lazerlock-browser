package com.lazerlock.browser

import android.app.Activity
import android.content.Context

/**
 * An optional PIN the person using this phone can set to open LazerLock. It's theirs: chosen by them, kept
 * only on this phone (as a one-way hash), and nothing to do with the admin or the admin's PIN. When one is set the
 * browser asks for it each time it comes to the front; a fingerprint/face works too, if the phone has one.
 *
 * Every PIN step — opening the app, setting a PIN, changing it, removing it — uses the same full-screen keypad
 * (PinScreen), so the PIN screen looks the same everywhere in the app.
 */
object UserLock {
    private const val PREF = "userlock"

    /** Unlocked for the current time in front; cleared when the app is sent to the background (onStop). */
    @Volatile var unlocked = false

    /** Set just before opening our own admin screen, so coming back from it doesn't ask for the PIN again. */
    @Volatile var skipNextLock = false

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
    fun isSet(ctx: Context): Boolean = !prefs(ctx).getString("pin", null).isNullOrEmpty()
    fun setPin(ctx: Context, pin: String) { prefs(ctx).edit().putString("pin", hash(pin)).apply(); unlocked = true }
    fun clear(ctx: Context) { prefs(ctx).edit().remove("pin").apply(); unlocked = true }
    private fun matches(ctx: Context, pin: String): Boolean = prefs(ctx).getString("pin", null) == hash(pin)

    private fun hash(s: String): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(("wlb-userlock:$s").toByteArray())
            .joinToString("") { "%02x".format(it) }

    // ----- biometric (fingerprint / face) -----

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
            .setTitle("Open LazerLock").setSubtitle("Use your fingerprint (or face)")
            .setNegativeButton("Use PIN", executor) { _, _ -> once(false) }.build()
        runCatching {
            prompt.authenticate(android.os.CancellationSignal(), executor, object : android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: android.hardware.biometrics.BiometricPrompt.AuthenticationResult?) { once(true) }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) { once(false) }
            })
        }.onFailure { once(false) }
    }

    // ----- the screens (all the same full-screen keypad) -----

    /** The full-screen lock shown when the browser opens and a PIN is set. [onUnlock] runs once, when unlocked. */
    fun promptUnlock(activity: Activity, onUnlock: () -> Unit) {
        if (!isSet(activity)) { unlocked = true; onUnlock(); return }
        PinScreen.show(activity, "Enter PIN", "to open LazerLock", "Unlock", cancelable = false,
            biometric = if (canBiometric(activity)) { done -> askBiometric(activity, done) } else null,
            onBiometricOk = { unlocked = true; onUnlock() }) { pin, ctl ->
            if (matches(activity, pin)) { unlocked = true; ctl.close(); onUnlock() }
            else { ctl.error("Wrong PIN"); ctl.clear() }
        }
    }

    /** Settings → turn the PIN on, change it, or remove it. [after] refreshes the settings row. */
    fun manage(activity: Activity, after: () -> Unit) {
        if (!isSet(activity)) { setFlow(activity, after); return }
        // Changing or removing asks for the current PIN first (same full-screen keypad).
        PinScreen.show(activity, "Enter current PIN", "to change or remove it", "Continue", cancelable = true) { pin, ctl ->
            if (!matches(activity, pin)) { ctl.error("Wrong PIN"); ctl.clear() }
            else {
                ctl.close()
                val d = Ui.AppDialog(activity, sheet = false)
                d.title("Lock with a PIN", "A PIN is set on this phone.", R.drawable.ic_d_pin)
                d.button("Remove", Ui.Kind.DANGER) { clear(activity); it.dismiss(); after() }
                d.button("Change", Ui.Kind.SECONDARY) { it.dismiss(); setFlow(activity, after) }
                d.button("Close", Ui.Kind.GHOST) { it.dismiss() }
                d.show()
            }
        }
    }

    /** Set a new PIN (or change it): typed twice on the keypad. */
    private fun setFlow(activity: Activity, after: () -> Unit) {
        PinScreen.show(activity, "Set a PIN", "It's yours, kept only on this phone. Nothing to do with the admin.", "Next", cancelable = true) { first, ctl ->
            if (first.length < 4) { ctl.error("At least 4 digits"); ctl.clear() }
            else {
                ctl.close()
                PinScreen.show(activity, "PIN again", "Type it once more", "Save", cancelable = true) { second, ctl2 ->
                    if (second != first) { ctl2.error("PINs don't match"); ctl2.clear() }
                    else { setPin(activity, first); ctl2.close(); after() }
                }
            }
        }
    }
}
