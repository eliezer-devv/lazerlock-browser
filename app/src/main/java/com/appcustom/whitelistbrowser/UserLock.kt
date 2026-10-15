package com.appcustom.whitelistbrowser

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * An optional PIN the person using this phone can set to open Whitelist Browser. It's theirs: chosen by them, kept
 * only on this phone (as a one-way hash), and nothing to do with the admin or the admin's PIN. When one is set the
 * browser asks for it each time it comes to the front; a fingerprint/face works too, if the phone has one.
 *
 * The PIN is entered on a proper keypad (dots that fill as you type, a 1–9/0 grid, and a ⌫), not a plain text field.
 * Changing or removing a PIN asks for the current one first.
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

    // ----- the keypad -----

    /** The dots-and-grid PIN pad. [onChange] fires on every key, so a caller can clear an error message. */
    private class PinPad(private val ctx: Context) {
        private val sb = StringBuilder()
        val value: String get() = sb.toString()
        var onChange: (() -> Unit)? = null
        private val dots = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val view: LinearLayout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(dots, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { bottomMargin = Ui.dp(ctx, 18); topMargin = Ui.dp(ctx, 2) })
            // 1–9, then blank / 0 / ⌫.
            val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫")
            var row: LinearLayout? = null
            keys.forEachIndexed { i, k ->
                if (i % 3 == 0) {
                    row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
                    addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                }
                row!!.addView(key(k), LinearLayout.LayoutParams(Ui.dp(ctx, 66), Ui.dp(ctx, 66))
                    .apply { marginStart = Ui.dp(ctx, 7); marginEnd = Ui.dp(ctx, 7); topMargin = Ui.dp(ctx, 7); bottomMargin = Ui.dp(ctx, 7) })
            }
            renderDots()
        }

        private fun key(label: String): Button = Button(ctx).apply {
            text = if (label == "⌫") "⌫" else label
            isAllCaps = false
            textSize = if (label == "⌫") 22f else 20f
            minWidth = 0; minHeight = 0
            setPadding(0, 0, 0, 0)
            stateListAnimator = null
            if (label.isEmpty()) {
                background = null; isEnabled = false
            } else {
                setTextColor(Ui.INK)
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                background = Ui.rounded(Ui.CARD, Ui.dp(ctx, 33).toFloat(), Ui.OUTLINE, Ui.dp(ctx, 1))
                setOnClickListener {
                    if (label == "⌫") { if (sb.isNotEmpty()) sb.deleteCharAt(sb.length - 1) }
                    else if (sb.length < 12) sb.append(label)
                    renderDots(); onChange?.invoke()
                }
            }
        }

        private fun renderDots() {
            dots.removeAllViews()
            val n = maxOf(4, sb.length)
            for (i in 0 until n) dots.addView(View(ctx).apply {
                background = Ui.rounded(if (i < sb.length) Ui.ACCENT else Ui.OUTLINE, Ui.dp(ctx, 7).toFloat())
            }, LinearLayout.LayoutParams(Ui.dp(ctx, 13), Ui.dp(ctx, 13)).apply { marginStart = Ui.dp(ctx, 7); marginEnd = Ui.dp(ctx, 7) })
        }

        fun clear() { sb.setLength(0); renderDots() }
    }

    private fun errLine(ctx: Context): TextView = Ui.text(ctx, "", 13f, Ui.RED_INK, "bold").apply {
        gravity = Gravity.CENTER; visibility = View.GONE
    }

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
            .setTitle("Open Whitelist Browser").setSubtitle("Use your fingerprint (or face)")
            .setNegativeButton("Use PIN", executor) { _, _ -> once(false) }.build()
        runCatching {
            prompt.authenticate(android.os.CancellationSignal(), executor, object : android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: android.hardware.biometrics.BiometricPrompt.AuthenticationResult?) { once(true) }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) { once(false) }
            })
        }.onFailure { once(false) }
    }

    // ----- the screens -----

    /** The lock screen, shown when the browser opens and a PIN is set. [onUnlock] runs once, when unlocked. */
    fun promptUnlock(activity: Activity, onUnlock: () -> Unit) {
        if (!isSet(activity)) { unlocked = true; onUnlock(); return }
        val d = Ui.AppDialog(activity, sheet = false, cancelable = false)
        d.title("Enter PIN", "to open Whitelist Browser", R.drawable.ic_d_pin)
        val pad = PinPad(activity)
        val err = errLine(activity)
        d.add(pad.view); d.add(err, 2)
        pad.onChange = { err.visibility = View.GONE }
        d.button("Unlock", Ui.Kind.PRIMARY) {
            if (matches(activity, pad.value)) { unlocked = true; it.dismiss(); onUnlock() }
            else { err.text = "Wrong PIN"; err.visibility = View.VISIBLE; pad.clear() }
        }
        if (canBiometric(activity)) d.button("Fingerprint", Ui.Kind.SECONDARY) {
            askBiometric(activity) { ok -> if (ok) { unlocked = true; it.dismiss(); onUnlock() } }
        }
        d.show()
        if (canBiometric(activity)) askBiometric(activity) { ok -> if (ok && d.isShowing) { unlocked = true; d.dismiss(); onUnlock() } }
    }

    /** Settings → turn the PIN on, change it, or remove it. [after] refreshes the settings row. */
    fun manage(activity: Activity, after: () -> Unit) {
        if (!isSet(activity)) { setFlow(activity, after); return }
        // Changing or removing asks for the current PIN first.
        verifyThen(activity, "Enter current PIN", "to change or remove it") {
            val d = Ui.AppDialog(activity, sheet = false)
            d.title("Lock with a PIN", "A PIN is set on this phone.", R.drawable.ic_d_pin)
            d.button("Remove", Ui.Kind.DANGER) { clear(activity); it.dismiss(); after() }
            d.button("Change", Ui.Kind.SECONDARY) { it.dismiss(); setFlow(activity, after) }
            d.button("Close", Ui.Kind.GHOST) { it.dismiss() }
            d.show()
        }
    }

    /** Ask for the current PIN on the keypad; [onOk] runs only once it's right. */
    private fun verifyThen(activity: Activity, title: String, sub: String, onOk: () -> Unit) {
        padEntry(activity, title, sub, "Continue") { entered ->
            if (matches(activity, entered)) { onOk(); null } else "Wrong PIN"
        }
    }

    /** Set a new PIN (or change it): typed twice on the keypad. */
    private fun setFlow(activity: Activity, after: () -> Unit) {
        padEntry(activity, "Set a PIN", "It's yours, kept only on this phone. Nothing to do with the admin.", "Next") { first ->
            if (first.length < 4) "At least 4 digits"
            else {
                padEntry(activity, "PIN again", "Type it once more", "Save") { second ->
                    if (second != first) "PINs don't match" else { setPin(activity, first); after(); null }
                }
                null
            }
        }
    }

    /**
     * A keypad dialog. [onValue] is given the entered PIN when the main button is tapped; it returns an error message
     * to show (and the pad is cleared to try again), or null when it's handled (and the dialog closes).
     */
    private fun padEntry(activity: Activity, title: String, sub: String, okLabel: String, onValue: (String) -> String?) {
        val d = Ui.AppDialog(activity, sheet = false)
        d.title(title, sub, R.drawable.ic_d_pin)
        val pad = PinPad(activity)
        val err = errLine(activity)
        d.add(pad.view); d.add(err, 2)
        pad.onChange = { err.visibility = View.GONE }
        d.button(okLabel, Ui.Kind.PRIMARY) {
            val msg = onValue(pad.value)
            if (msg == null) it.dismiss() else { err.text = msg; err.visibility = View.VISIBLE; pad.clear() }
        }
        d.button("Cancel", Ui.Kind.GHOST) { it.dismiss() }
        d.show()
    }
}
