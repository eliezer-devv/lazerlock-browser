package com.appcustom.whitelistbrowser

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The screen cover: when a blocked app, or a settings screen that could switch this protection off, comes to the
 * front, it's covered by a plain full-screen panel that names this browser and says who manages it. A Back button
 * sends the phone Home. The panel is a system overlay, so it also covers split-screen and pop-up windows.
 *
 * This only ever looks at *which* app or settings screen is open — never what's typed or shown. It's part of a
 * supervised, parental-control setup and is always visible for what it is; the admin can switch it off remotely.
 */
class GuardService : AccessibilityService() {
    companion object {
        @Volatile var running = false
            private set
        @Volatile private var instance: GuardService? = null
        /** Our own app came to the front: make sure no cover is left showing. */
        fun dismissCover() { instance?.let { svc -> svc.main.post { svc.hide() } } }
        // Extra words (besides our own app's name) that mark a settings screen where protection could be switched
        // off — the "restricted settings" dialog shows these without naming the app.
        private val GUARDED_WORDS = listOf("restricted setting")
        // Known Settings screen class names across phone brands (matched as substrings, lowercased): App info,
        // Accessibility (service detail), Device admin, and uninstall. A broad net; harmless extras are fine.
        private val CLASS_HINTS = listOf(
            "installedappdetails", "appinfodashboard", "applicationdetail", "appinfo",      // App info (AOSP, OEMs)
            "accessibilitydetail", "accessibilityservice", "toggleaccessibility", "accessibilitysettings",
            "deviceadminadd", "deviceadminsettings", "deviceadmin",                           // device admin
            "uninstalleruactivity", "uninstallapp")                                          // uninstall prompt
        // View resource-id fragments that mark those same screens (from the node tree).
        private val ID_HINTS = listOf("installed_app_detail", "app_info", "appinfo", "accessibilit",
            "device_admin", "deviceadmin", "uninstall", "force_stop", "restricted")
        private const val SETUP_GRACE_MS = 8000L
    }

    private var wm: WindowManager? = null
    private var cover: View? = null
    private var coveringFor: String? = null
    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    private var connectedAt = 0L

    override fun onServiceConnected() {
        running = true
        instance = this
        connectedAt = android.os.SystemClock.uptimeMillis()
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        AppLog.ready(applicationContext)
        AppLog.i("Cover", "Screen cover is on")
        runCatching { Requests.checkInSoon(applicationContext) }
        // Learn which apps are browsers now, so a blocked one is covered from the first moment (not only after the
        // next few-minute check).
        Thread { runCatching { BrowserGuard.report(applicationContext) }.logged("Cover", "First browser check") }.start()
    }

    private var lastContentCheck = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val stateChanged = event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        val contentChanged = event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        if (!stateChanged && !contentChanged) return
        val pkg = event.packageName?.toString() ?: return
        val cls = event.className?.toString()?.lowercase().orEmpty()
        // Our own windows: never react to the cover's own window events (that caused the flashing). Only when our
        // real screen opens do we take the cover down.
        if (pkg == packageName) {
            if (stateChanged && (cls.contains("mainactivity") || cls.contains("adminactivity"))) hide()
            return
        }
        runCatching {
            if (!BrowserGuard.coverOn(applicationContext)) { if (stateChanged) hide(); return }
            // A blocked app in front: cover it straight away.
            if (BrowserGuard.blocked(applicationContext, pkg)) { show(blockedTitle(pkg),
                "Websites open in Whitelist Browser on this phone. You can ask to use this app.", "blocked:$pkg"); return }
            // The Settings app: cover the screens that could switch this protection off (App info, Accessibility,
            // Device admin). Told apart by the visible text (our app's name, or the "restricted settings" dialog),
            // which works the same across phones, unlike screen class names.
            // Settings screens aren't covered for the first few seconds after the cover is switched on, so whoever
            // set it up can see the confirmation and leave the screen. Blocked apps are covered straight away.
            if (isSettingsPkg(pkg) && android.os.SystemClock.uptimeMillis() - connectedAt > SETUP_GRACE_MS) {
                // Content events fire a lot; check at most ~4x a second.
                if (contentChanged && android.os.SystemClock.uptimeMillis() - lastContentCheck < 250L) return
                lastContentCheck = android.os.SystemClock.uptimeMillis()
                if (guardedSetting(cls)) { show("This setting is locked",
                    "It's set by whoever manages Whitelist Browser on this phone.", "setting"); return }
                // Still loading when the screen first opened: look again a moment later.
                if (stateChanged) main.postDelayed({ runCatching {
                    if (BrowserGuard.coverOn(applicationContext) && isForegroundSettings() && guardedSetting(cls))
                        show("This setting is locked", "It's set by whoever manages Whitelist Browser on this phone.", "setting")
                }.logged("Cover", "Re-checking the settings screen") }, 150L)
                if (stateChanged) hide()                // navigated to an unrelated Settings screen
                return
            }
            if (stateChanged) hide()                    // any other app in front
        }.logged("Cover", "Checking the open app")
    }

    private fun blockedTitle(pkg: String): String {
        val label = runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault("This app")
        return "$label is blocked on this phone"
    }

    private val ourName by lazy { runCatching { getString(R.string.app_name) }.getOrDefault("Whitelist Browser").lowercase() }
    private fun isSettingsPkg(pkg: String): Boolean = pkg.contains("settings")
    private fun isForegroundSettings(): Boolean = runCatching { rootInActiveWindow?.packageName?.toString()?.contains("settings") == true }.getOrDefault(false)

    private val ourPkgLower by lazy { packageName.lowercase() }

    /**
     * Is the Settings screen in front one where this protection could be switched off? Decided from three signals,
     * any of which is enough (so what one misses, another catches):
     *   1. the screen's visible text names this app, or is the "restricted settings" dialog;
     *   2. a view's resource id marks it as App info / Accessibility / Device admin / Uninstall / Force stop;
     *   3. the window's class name matches a known Settings screen (a broad list across phone brands).
     * (1) and (2) come from one read of the screen; (3) needs no reading at all.
     */
    private fun guardedSetting(eventCls: String): Boolean {
        if (CLASS_HINTS.any { eventCls.contains(it) }) return true
        val (text, ids) = runCatching { windowTextAndIds() }.logged("Cover", "Reading the settings screen").getOrDefault("" to "")
        if (text.contains(ourName) || text.contains(ourPkgLower) || GUARDED_WORDS.any { text.contains(it) }) return true
        if (ID_HINTS.any { ids.contains(it) }) return true
        return false
    }

    /** The visible text and the view resource-ids of the active window, lowercased (bounded). Only to recognise our
     *  own protection screens; never read or kept beyond this check. */
    private fun windowTextAndIds(): Pair<String, String> {
        val root = rootInActiveWindow ?: return "" to ""
        val text = StringBuilder(); val ids = StringBuilder()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var seen = 0
        while (queue.isNotEmpty() && seen < 600 && text.length < 4000) {
            val n = queue.removeFirst(); seen++
            n.text?.let { text.append(it).append(' ') }
            n.contentDescription?.let { text.append(it).append(' ') }
            n.viewIdResourceName?.let { ids.append(it).append(' ') }
            for (i in 0 until n.childCount) n.getChild(i)?.let { queue.add(it) }
        }
        return text.toString().lowercase() to ids.toString().lowercase()
    }

    override fun onInterrupt() {}

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        running = false
        instance = null
        hide()
        AppLog.w("Cover", "Screen cover was switched off")
        runCatching { Requests.checkInSoon(applicationContext) }
        return super.onUnbind(intent)
    }

    private fun show(title: String, sub: String, forWhat: String) {
        if (coveringFor == forWhat && cover != null) return
        hide()
        val ctx = this
        val panel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(if (isDark()) Color.parseColor("#1F2B2C") else Color.parseColor("#F5F3EE"))
            val pad = (resources.displayMetrics.density * 28).toInt()
            setPadding(pad, pad, pad, pad)
            addView(TextView(ctx).apply {
                text = title; textSize = 23f; setTypeface(typeface, android.graphics.Typeface.BOLD)
                gravity = Gravity.CENTER
                setTextColor(if (isDark()) Color.parseColor("#ECF2F0") else Color.parseColor("#1C2B2D"))
            })
            addView(TextView(ctx).apply {
                text = sub; textSize = 15f; gravity = Gravity.CENTER
                setTextColor(if (isDark()) Color.parseColor("#AEBFBB") else Color.parseColor("#3E4B49"))
                val m = (resources.displayMetrics.density * 12).toInt(); setPadding(0, m, 0, m * 2)
            })
            addView(TextView(ctx).apply {
                text = "  Back  "; textSize = 16f; setTypeface(typeface, android.graphics.Typeface.BOLD)
                gravity = Gravity.CENTER
                setTextColor(Color.WHITE)
                val h = (resources.displayMetrics.density * 50).toInt()
                val padx = (resources.displayMetrics.density * 26).toInt()
                minHeight = h; setPadding(padx, 0, padx, 0)
                background = Ui.rounded(Color.parseColor("#1F5F55"), resources.displayMetrics.density * 25)
                setOnClickListener { hide(); performGlobalAction(GLOBAL_ACTION_HOME) }
            })
        }
        val type = if (Build.VERSION.SDK_INT >= 22) WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ERROR
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            type,
            0,                                  // focusable and opaque: it swallows taps on whatever is behind it
            PixelFormat.OPAQUE)
        runCatching { wm?.addView(panel, lp); cover = panel; coveringFor = forWhat }.logged("Cover", "Showing the cover")
    }

    private fun hide() {
        cover?.let { c -> runCatching { wm?.removeView(c) }.logged("Cover", "Removing the cover") }
        cover = null; coveringFor = null
    }

    private fun isDark(): Boolean =
        (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
}
