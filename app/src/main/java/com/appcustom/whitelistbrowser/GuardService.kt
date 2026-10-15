package com.appcustom.whitelistbrowser

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.accessibilityservice.AccessibilityService
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The screen cover: a plain full-screen panel over a blocked app, or over one of THIS app's own Settings pages
 * where the protection could be switched off — its App info (Force stop / Uninstall), its accessibility detail,
 * and the device-admin "deactivate" page. The panel names this browser and says who manages it; a Back button
 * sends the phone Home.
 *
 * Which page it's on is worked out GENERALLY, from this app's own name in the on-screen text together with the
 * Settings screen's class name. The class names used below are the plain Android ones (and Samsung's equivalents),
 * not one brand's private screens — "installedappdetails", "deviceadminadd" and so on appear across phones. It only
 * ever looks at *which* app or settings screen is open, never at what's typed or shown.
 *
 * Two things keep it steady rather than flickering: the cover is never rebuilt while it's already up for the same
 * reason, and a page that briefly reads as "not ours" (which happens constantly while a Settings screen is drawing,
 * as the active window bounces between panels) does NOT take the cover down straight away — it's only removed once
 * the screen has settled on something that clearly isn't ours. It's part of a supervised, parental-control setup,
 * always visible for what it is; the admin can switch it off.
 */
class GuardService : AccessibilityService() {
    companion object {
        @Volatile var running = false
            private set
        @Volatile private var instance: GuardService? = null
        fun dismissCover() { instance?.let { svc -> svc.main.post { svc.hideAll() } } }

        // Class-name fragments of OUR app's own detail pages. Plain Android names; "deviceadminadd" also matches
        // Samsung's "secdeviceadminadd". Only used together with our app's name being on the screen, so another
        // app's App info or device-admin page is never covered.
        private val DETAIL_CLASS = listOf("installedappdetails", "deviceadminadd")
        // Words that appear on OUR detail / confirm pages, not on a plain list — the second way to recognise one.
        private val DETAIL_WORDS = listOf(
            "force stop", "uninstall", "deactivate", "disable this device admin", "turn off",
            "clear storage", "clear data", "clear cache")
        private const val DESC_PHRASE = "covers blocked apps"     // our accessibility-service description
        private const val RESTRICTED = "restricted setting"
        private const val SETUP_GRACE_MS = 8000L
        private const val HIDE_DELAY_MS = 450L
    }

    private var wm: WindowManager? = null
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private var connectedAt = 0L

    private var cover: View? = null
    private var coveringFor: String? = null
    private var pendingHide = false

    override fun onServiceConnected() {
        running = true
        instance = this
        connectedAt = android.os.SystemClock.uptimeMillis()
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        AppLog.ready(applicationContext)
        AppLog.i("Cover", "Screen cover is on")
        runCatching { Requests.checkInSoon(applicationContext) }
        Thread { runCatching { BrowserGuard.report(applicationContext) }.logged("Cover", "First browser check") }.start()
    }

    private var lastContentCheck = 0L
    private var lastDiagCls = ""

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val stateChanged = event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        val contentChanged = event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        if (!stateChanged && !contentChanged) return
        val pkg = event.packageName?.toString() ?: return
        val cls = event.className?.toString()?.lowercase().orEmpty()
        if (pkg == packageName) {
            if (stateChanged && (cls.contains("mainactivity") || cls.contains("adminactivity"))) hideAll()
            return
        }
        runCatching {
            if (!BrowserGuard.coverOn(applicationContext)) { if (stateChanged) hideAll(); return }
            if (BrowserGuard.blocked(applicationContext, pkg)) {
                showFull(blockedTitle(pkg), "Websites open in Whitelist Browser on this phone. You can ask to use this app.", "blocked:$pkg")
                return
            }
            if (isSettingsPkg(pkg)) {
                if (android.os.SystemClock.uptimeMillis() - connectedAt <= SETUP_GRACE_MS) { if (stateChanged) hideAll(); return }
                if (contentChanged && android.os.SystemClock.uptimeMillis() - lastContentCheck < 120L) return
                lastContentCheck = android.os.SystemClock.uptimeMillis()
                applySettingsGuard(cls)
                if (stateChanged) scheduleGuardChecks(cls)   // re-check as the screen finishes drawing
                return
            }
            if (stateChanged) hideAll()                       // any other app in front
        }.logged("Cover", "Checking the open app")
    }

    private fun blockedTitle(pkg: String): String {
        val label = runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault("This app")
        return "$label is blocked on this phone"
    }

    private val ourName by lazy { runCatching { getString(R.string.app_name) }.getOrDefault("Whitelist Browser").lowercase() }
    private val ourPkgLower by lazy { packageName.lowercase() }
    private fun isSettingsPkg(pkg: String): Boolean = pkg.contains("settings")
    private fun isForegroundSettings(): Boolean = runCatching { rootInActiveWindow?.packageName?.toString()?.contains("settings") == true }.getOrDefault(false)

    private fun applySettingsGuard(cls: String) {
        val s = runCatching { scanSettings() }.logged("Cover", "Reading the settings screen").getOrNull() ?: return
        if (cls != lastDiagCls) { lastDiagCls = cls; AppLog.i("CoverDiag", "settings cls=$cls | us=${s.us} | txt=${s.text.take(150)}") }
        if (isGuarded(cls, s.text, s.us)) { showSettingCover(); return }
        // Not ours on this read. A blank read means the screen is still drawing — keep whatever is up. A settled
        // read that isn't ours, while we're covering a setting, starts the (cancellable) delay before uncovering.
        if (s.text.isBlank()) return
        if (coveringFor == "setting") scheduleHide()
    }

    /**
     * Is this Settings screen one of OUR pages to cover? Class-first, because this phone gives reliable class names
     * but no view-ids. Our own name must be present either way, so no other app's pages are ever covered.
     */
    private fun isGuarded(cls: String, text: String, us: Boolean): Boolean {
        if (!us) return false
        if (DETAIL_CLASS.any { cls.contains(it) }) return true                 // our App info / device-admin page
        if (DETAIL_WORDS.any { text.contains(it) }) return true                // our App info / device-admin by words
        if (text.contains(RESTRICTED)) return true                            // the "restricted setting" dialog
        if (text.contains("accessibility") && text.contains(DESC_PHRASE)) return true   // our accessibility detail
        return false
    }

    private fun showSettingCover() =
        showFull("This setting is locked", "It's set by whoever manages Whitelist Browser on this phone.", "setting")

    private var guardGen = 0
    private fun scheduleGuardChecks(cls: String) {
        val gen = ++guardGen
        for (delay in longArrayOf(0L, 80L, 200L, 450L, 800L)) {
            main.postDelayed({
                if (gen != guardGen) return@postDelayed
                runCatching {
                    if (BrowserGuard.coverOn(applicationContext) && isForegroundSettings()) applySettingsGuard(cls)
                }.logged("Cover", "Re-checking the settings screen")
            }, delay)
        }
    }

    private class Scan(val text: String, val us: Boolean)

    /** All the visible text of the active window, lowercased (bounded). Only to recognise our own protection
     *  screens; never read or kept beyond this check. */
    private fun scanSettings(): Scan {
        val root = rootInActiveWindow ?: return Scan("", false)
        val sb = StringBuilder()
        val q = ArrayDeque<AccessibilityNodeInfo>(); q.add(root)
        var seen = 0
        while (q.isNotEmpty() && seen < 900 && sb.length < 6000) {
            val n = q.removeFirst(); seen++
            n.text?.let { if (it.isNotBlank()) sb.append(it).append(' ') }
            n.contentDescription?.let { if (it.isNotBlank()) sb.append(it).append(' ') }
            for (i in 0 until n.childCount) n.getChild(i)?.let { q.add(it) }
        }
        val text = sb.toString().lowercase()
        return Scan(text, text.contains(ourName) || text.contains(ourPkgLower))
    }

    // ---- cover management (one full-screen panel; steady, never rebuilt while it's up for the same reason) ----

    private fun showFull(title: String, sub: String, forWhat: String) {
        pendingHide = false
        if (coveringFor == forWhat && cover != null) return        // already showing this exact cover → leave it
        removeCover()
        val ctx = this
        val panel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(if (isDark()) Color.parseColor("#1F2B2C") else Color.parseColor("#F5F3EE"))
            val pad = (resources.displayMetrics.density * 28).toInt(); setPadding(pad, pad, pad, pad)
            addView(TextView(ctx).apply {
                text = title; textSize = 23f; setTypeface(typeface, android.graphics.Typeface.BOLD); gravity = Gravity.CENTER
                setTextColor(if (isDark()) Color.parseColor("#ECF2F0") else Color.parseColor("#1C2B2D"))
            })
            addView(TextView(ctx).apply {
                text = sub; textSize = 15f; gravity = Gravity.CENTER
                setTextColor(if (isDark()) Color.parseColor("#AEBFBB") else Color.parseColor("#3E4B49"))
                val m = (resources.displayMetrics.density * 12).toInt(); setPadding(0, m, 0, m * 2)
            })
            addView(TextView(ctx).apply {
                text = "  Back  "; textSize = 16f; setTypeface(typeface, android.graphics.Typeface.BOLD)
                gravity = Gravity.CENTER; setTextColor(Color.WHITE)
                val h = (resources.displayMetrics.density * 50).toInt(); val padx = (resources.displayMetrics.density * 26).toInt()
                minHeight = h; setPadding(padx, 0, padx, 0)
                background = Ui.rounded(Color.parseColor("#1F5F55"), resources.displayMetrics.density * 25)
                setOnClickListener { hideAll(); performGlobalAction(GLOBAL_ACTION_HOME) }
            })
        }
        val type = if (Build.VERSION.SDK_INT >= 22) WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ERROR
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, type, 0, PixelFormat.OPAQUE)
        runCatching { wm?.addView(panel, lp); cover = panel; coveringFor = forWhat }.logged("Cover", "Showing the cover")
    }

    /** Start the short, cancellable delay before taking a settings cover down — a guarded read in the meantime
     *  (which calls showFull) cancels it, so a brief "not ours" read mid-draw never makes the cover blink. */
    private fun scheduleHide() {
        if (pendingHide) return
        pendingHide = true
        main.postDelayed({ if (pendingHide) { pendingHide = false; if (coveringFor == "setting") hideAll() } }, HIDE_DELAY_MS)
    }

    private fun removeCover() {
        cover?.let { c -> runCatching { wm?.removeView(c) }.logged("Cover", "Removing the cover") }
        cover = null; coveringFor = null
    }

    private fun hideAll() { pendingHide = false; removeCover() }

    override fun onInterrupt() {}

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        running = false
        instance = null
        hideAll()
        AppLog.w("Cover", "Screen cover was switched off")
        runCatching { Requests.checkInSoon(applicationContext) }
        return super.onUnbind(intent)
    }

    private fun isDark(): Boolean =
        (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
}
