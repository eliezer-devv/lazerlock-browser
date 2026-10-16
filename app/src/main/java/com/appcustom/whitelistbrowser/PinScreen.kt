package com.appcustom.whitelistbrowser

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * A full-screen PIN keypad: a lock badge, a title, dots that fill as you type, and a 1–9 / 0 / ⌫ grid. Shown in its
 * own dialog window so it always sits on top — even when it's opened from another sheet (e.g. My requests). Used for
 * opening the app (the person's own PIN) and for the My-requests approval PIN — same look in both places.
 *
 * [onPin] gets the typed PIN when the main button is tapped; use [Ctl] to show an error and clear, or close the screen.
 * [cancelable] adds a Cancel (and lets the system Back close it). [biometric], when given, adds a fingerprint button
 * and is tried once automatically; on success the screen closes and [onBiometricOk] runs.
 */
object PinScreen {
    interface Ctl { fun error(msg: String); fun clear(); fun close() }

    fun show(activity: Activity, title: String, sub: String, okLabel: String, cancelable: Boolean,
             biometric: (((Boolean) -> Unit) -> Unit)? = null, onBiometricOk: (() -> Unit)? = null,
             onCancel: (() -> Unit)? = null, onPin: (String, Ctl) -> Unit) {
        fun dp(v: Int) = Ui.dp(activity, v)
        val sb = StringBuilder()
        val dots = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        // At least four dots (the minimum PIN), filling as you type and growing past four for a longer PIN. A small
        // note under them says four is the minimum, so the steady four doesn't look like a fixed length.
        fun renderDots() {
            dots.removeAllViews()
            val n = maxOf(4, sb.length)
            for (i in 0 until n) dots.addView(View(activity).apply {
                background = Ui.rounded(if (i < sb.length) Ui.ACCENT else Ui.OUTLINE, dp(7).toFloat())
            }, LinearLayout.LayoutParams(dp(13), dp(13)).apply { marginStart = dp(7); marginEnd = dp(7) })
        }
        val err = Ui.text(activity, "", 13.5f, Ui.RED_INK, "bold").apply { gravity = Gravity.CENTER; visibility = View.INVISIBLE }

        val dialog = Dialog(activity)
        val ctl = object : Ctl {
            override fun error(msg: String) { err.text = msg; err.visibility = View.VISIBLE }
            override fun clear() { sb.setLength(0); renderDots() }
            override fun close() { runCatching { dialog.dismiss() } }
        }
        fun press(label: String) {
            if (label == "⌫") { if (sb.isNotEmpty()) sb.deleteCharAt(sb.length - 1) }
            else if (sb.length < 12) sb.append(label)
            err.visibility = View.INVISIBLE; renderDots()
        }
        fun key(label: String): Button = Button(activity).apply {
            text = label; isAllCaps = false
            textSize = if (label == "⌫") 22f else 20f
            minWidth = 0; minHeight = 0; setPadding(0, 0, 0, 0); stateListAnimator = null
            if (label.isEmpty()) { background = null; isEnabled = false }
            else {
                setTextColor(Ui.INK)
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                background = Ui.rounded(Ui.CARD, dp(33).toFloat(), Ui.OUTLINE, dp(1))
                setOnClickListener { press(label) }
            }
        }
        fun pillButton(label: String, primary: Boolean, onTap: () -> Unit): Button = Button(activity).apply {
            text = label; isAllCaps = false; typeface = Ui.boldFace; stateListAnimator = null
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 15f)
            minHeight = dp(50); minimumHeight = dp(50)
            val px = dp(22); setPadding(px, 0, px, 0)
            if (primary) { background = Ui.rounded(Ui.ACCENT, dp(25).toFloat()); setTextColor(Color.WHITE) }
            else { background = Ui.rounded(Ui.CARD, dp(25).toFloat(), Ui.OUTLINE, dp(1)); setTextColor(Ui.ACCENT_TEXT) }
            setOnClickListener { onTap() }
        }
        // The two bottom-corner keys: ⌫ (undo, bottom-left) and → (enter, bottom-right, the primary action).
        fun actionKey(label: String, primary: Boolean, onTap: () -> Unit): Button = Button(activity).apply {
            text = label; isAllCaps = false; textSize = 22f
            minWidth = 0; minHeight = 0; setPadding(0, 0, 0, 0); stateListAnimator = null
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            if (primary) { background = Ui.rounded(Ui.ACCENT, dp(33).toFloat()); setTextColor(Color.WHITE) }
            else { background = Ui.rounded(Ui.CARD, dp(33).toFloat(), Ui.OUTLINE, dp(1)); setTextColor(Ui.INK) }
            setOnClickListener { onTap() }
        }

        val col = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val m = dp(28); setPadding(m, m, m, m)
            addView(Ui.badge(activity, R.drawable.ic_d_pin, Ui.SOFT, Ui.ACCENT_TEXT, 60, 20))
            addView(Ui.text(activity, title, 20f, Ui.INK, "bold").apply { gravity = Gravity.CENTER },
                LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(12) })
            if (sub.isNotEmpty()) addView(Ui.text(activity, sub, 13.5f, Ui.MUTED).apply { gravity = Gravity.CENTER },
                LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(4) })
            addView(dots, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(20); bottomMargin = dp(4) })
            addView(Ui.text(activity, "At least 4 digits", 12f, Ui.MUTED).apply { gravity = Gravity.CENTER },
                LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(6) })
            addView(err, LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = dp(6) })
            // ⌫ (undo) sits bottom-left, → (enter) bottom-right as the primary action — no separate OK button below.
            val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "→")
            var row: LinearLayout? = null
            keys.forEachIndexed { i, k ->
                if (i % 3 == 0) { row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }; addView(row) }
                val cell = when (k) {
                    "⌫" -> actionKey("⌫", primary = false) { press("⌫") }.apply { contentDescription = "Delete" }
                    "→" -> actionKey("→", primary = true) { onPin(sb.toString(), ctl) }.apply { contentDescription = okLabel }
                    else -> key(k)
                }
                row!!.addView(cell, LinearLayout.LayoutParams(dp(66), dp(66)).apply { marginStart = dp(7); marginEnd = dp(7); topMargin = dp(7); bottomMargin = dp(7) })
            }
            if (biometric != null) addView(pillButton("Fingerprint", false) {
                biometric { ok -> if (ok) { ctl.close(); onBiometricOk?.invoke() } }
            }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(10) })
            if (cancelable) addView(Ui.text(activity, "Cancel", 15f, Ui.MUTED, "bold").apply {
                gravity = Gravity.CENTER; minHeight = dp(44)
                setOnClickListener { ctl.close(); onCancel?.invoke() }
            }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(8) })
        }
        // A scroller so the keypad still fits on short screens; fillViewport + the column's CENTER gravity centres it when there's room.
        val root = ScrollView(activity).apply { isFillViewport = true; addView(col, android.widget.FrameLayout.LayoutParams(-1, -2)) }

        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setContentView(root)
        dialog.setCancelable(cancelable)
        dialog.setCanceledOnTouchOutside(false)
        if (cancelable) dialog.setOnCancelListener { onCancel?.invoke() }
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Ui.PAGE))
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        // When it can't be cancelled, Back does nothing (no sneaking past the lock).
        if (!cancelable) dialog.setOnKeyListener { _, keyCode, _ -> keyCode == KeyEvent.KEYCODE_BACK }
        renderDots()
        runCatching { dialog.show() }
        biometric?.let { bio -> bio { ok -> if (ok) { ctl.close(); onBiometricOk?.invoke() } } }
    }
}
