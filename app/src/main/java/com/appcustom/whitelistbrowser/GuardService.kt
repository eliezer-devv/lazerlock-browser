package com.appcustom.whitelistbrowser

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
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
 * The screen cover. Two shapes:
 *
 *  • A full-screen panel, used for a blocked app and for one of THIS app's own Settings detail pages (its App info,
 *    its accessibility detail, the device-admin "deactivate" page). It names this browser, says who manages it, and
 *    its Back button sends the phone Home.
 *  • A small "row cover" placed over just this app's own entry in a LIST (the device-admin list, the accessibility
 *    list, the apps list). It blocks that one row — the on/off toggle that would switch the protection off — while
 *    leaving the rest of the Settings screen usable. If someone still reaches the detail page behind it, that page
 *    gets the full-screen cover.
 *
 * Everything is decided GENERALLY, from this app's own name appearing in the on-screen text and from where that text
 * sits on screen — the same on every phone — rather than from brand-specific Settings screen class names. It only
 * ever looks at *which* app or settings screen is open and *where our own row is*, never at what's typed or shown.
 * It's part of a supervised, parental-control setup, always visible for what it is; the admin can switch it off.
 */
class GuardService : AccessibilityService() {
    companion object {
        @Volatile var running = false
            private set
        @Volatile private var instance: GuardService? = null
        /** Our own app came to the front: make sure no cover is left showing. */
        fun dismissCover() { instance?.let { svc -> svc.main.post { svc.hideAll() } } }

        // A Settings page is one of OUR detail pages (→ full-screen cover) when our name is on it AND it shows one of
        // these "acting on an app" words, the restricted-settings dialog, or a master on/off switch bar. These are
        // plain English words and generic AOSP view-ids — not brand screen classes — so this works across phones.
        private val DETAIL_WORDS = listOf(
            "force stop", "uninstall", "deactivate", "disable", "turn off", "clear storage", "clear data", "clear cache")
        private val SWITCHBAR_IDS = listOf("switch_bar", "settings_switch_bar", "master_switch", "masterswitch")
        private const val APPINFO_ID = "installed_app_detail"
        private const val RESTRICTED = "restricted setting"
        private const val SETUP_GRACE_MS = 8000L
        private const val MAX_ROWS = 4
    }

    private var wm: WindowManager? = null
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private var connectedAt = 0L

    // The covers currently on screen: at most one full-screen panel, plus any number of small row covers.
    private var fullCover: View? = null
    private var coveringFor: String? = null
    private val rowCovers = ArrayList<View>()
    private var lastRects: List<Rect> = emptyList()

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
        // Our own windows: never react to the cover's own window events. Only take the cover down when our real
        // screen opens.
        if (pkg == packageName) {
            if (stateChanged && (cls.contains("mainactivity") || cls.contains("adminactivity"))) hideAll()
            return
        }
        runCatching {
            if (!BrowserGuard.coverOn(applicationContext)) { if (stateChanged) hideAll(); return }
            // A blocked app in front: full-screen cover, straight away.
            if (BrowserGuard.blocked(applicationContext, pkg)) {
                showFull(blockedTitle(pkg), "Websites open in Whitelist Browser on this phone. You can ask to use this app.", "blocked:$pkg")
                return
            }
            if (isSettingsPkg(pkg)) {
                // A short grace right after the cover is switched on, so whoever set it up can read the confirmation
                // and leave the screen.
                if (android.os.SystemClock.uptimeMillis() - connectedAt <= SETUP_GRACE_MS) { if (stateChanged) hideAll(); return }
                if (contentChanged && android.os.SystemClock.uptimeMillis() - lastContentCheck < 120L) return
                lastContentCheck = android.os.SystemClock.uptimeMillis()
                applySettingsGuard(cls)
                // A settings screen often isn't fully drawn the instant it opens, and lists reflow as you scroll, so
                // re-check a few times after a screen change.
                if (stateChanged) scheduleGuardChecks(cls)
                return
            }
            if (stateChanged) hideAll()                 // any other app in front
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

    /**
     * Look at the Settings screen in front and cover the right thing:
     *   • if it's one of OUR detail pages (our name + an action word / switch bar / restricted dialog) → full cover;
     *   • else if our own name appears as a row in a list → cover just that row (the toggle), leave the rest;
     *   • else nothing of ours is here → no cover.
     */
    private fun applySettingsGuard(cls: String) {
        val scan = runCatching { scanSettings() }.logged("Cover", "Reading the settings screen").getOrNull() ?: return
        if (cls != lastDiagCls) {   // one diagnostic line per screen, to confirm behaviour from shared logs
            lastDiagCls = cls
            AppLog.i("CoverDiag", "settings cls=$cls | us=${scan.usPresent} rows=${scan.rows.size} | ids=${scan.ids.take(160)}")
        }
        if (!scan.usPresent) { hideAll(); return }
        val detail = DETAIL_WORDS.any { scan.text.contains(it) } || scan.text.contains(RESTRICTED) ||
            scan.ids.contains(APPINFO_ID) || SWITCHBAR_IDS.any { scan.ids.contains(it) }
        when {
            detail -> showFull("This setting is locked", "It's set by whoever manages Whitelist Browser on this phone.", "setting")
            scan.rows.isNotEmpty() -> showRows(scan.rows)
            else -> hideAll()
        }
    }

    private var guardGen = 0
    private fun scheduleGuardChecks(cls: String) {
        val gen = ++guardGen
        for (delay in longArrayOf(0L, 70L, 180L, 400L, 750L)) {
            main.postDelayed({
                if (gen != guardGen) return@postDelayed
                runCatching {
                    if (BrowserGuard.coverOn(applicationContext) && isForegroundSettings()) applySettingsGuard(cls)
                }.logged("Cover", "Re-checking the settings screen")
            }, delay)
        }
    }

    /** What a single read of the Settings screen tells us: all its text and view-ids (lowercased), whether our own
     *  name is anywhere on it, and the on-screen rectangles of our own row(s). */
    private class Scan(val text: String, val ids: String, val usPresent: Boolean, val rows: List<Rect>)

    private fun scanSettings(): Scan {
        val root = rootInActiveWindow ?: return Scan("", "", false, emptyList())
        val text = StringBuilder(); val ids = StringBuilder(); val rows = ArrayList<Rect>()
        val queue = ArrayDeque<AccessibilityNodeInfo>(); queue.add(root)
        var seen = 0
        while (queue.isNotEmpty() && seen < 900) {
            val n = queue.removeFirst(); seen++
            val t = ((n.text?.toString() ?: "") + " " + (n.contentDescription?.toString() ?: "")).lowercase()
            if (t.isNotBlank()) text.append(t).append(' ')
            n.viewIdResourceName?.let { ids.append(it.lowercase()).append(' ') }
            if (t.contains(ourName)) rowBounds(n)?.let { if (it.width() > 0 && it.height() > 0) rows.add(it) }
            for (i in 0 until n.childCount) n.getChild(i)?.let { queue.add(it) }
        }
        val us = text.contains(ourName) || ids.contains(ourPkgLower)
        return Scan(text.toString(), ids.toString(), us, dedupeRects(rows))
    }

    /** The bounds of the list ROW a text node sits in: the nearest clickable ancestor, else the node itself. */
    private fun rowBounds(node: AccessibilityNodeInfo): Rect? {
        var n: AccessibilityNodeInfo? = node
        var hops = 0
        var row: AccessibilityNodeInfo = node
        while (n != null && hops < 5) { if (n.isClickable) { row = n; break }; n = n.parent; hops++ }
        val r = Rect(); row.getBoundsInScreen(r); return r
    }

    /** Keep the outer row rectangles, drop the smaller text rectangles nested inside them. */
    private fun dedupeRects(rects: List<Rect>): List<Rect> {
        val out = ArrayList<Rect>()
        for (r in rects.sortedByDescending { it.width() * it.height() }) {
            if (out.none { it.contains(r.centerX(), r.centerY()) }) out.add(r)
            if (out.size >= MAX_ROWS) break
        }
        return out
    }

    // ---- cover management ----

    private val overlayType get() = if (Build.VERSION.SDK_INT >= 22) WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ERROR

    private fun showFull(title: String, sub: String, forWhat: String) {
        clearRows()
        if (coveringFor == forWhat && fullCover != null) return
        removeFull()
        val ctx = this
        val panel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(if (isDark()) Color.parseColor("#1F2B2C") else Color.parseColor("#F5F3EE"))
            val pad = (resources.displayMetrics.density * 28).toInt()
            setPadding(pad, pad, pad, pad)
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
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            overlayType, 0, PixelFormat.OPAQUE)       // focusable and opaque: swallows everything behind it
        runCatching { wm?.addView(panel, lp); fullCover = panel; coveringFor = forWhat }.logged("Cover", "Showing the full cover")
    }

    private fun showRows(rects: List<Rect>) {
        removeFull()
        if (rects == lastRects && rowCovers.isNotEmpty()) return     // unchanged → leave them in place (no flicker)
        clearRows()
        for (r in rects) addRowCover(r)
        lastRects = rects
        coveringFor = "rows"
    }

    private fun addRowCover(r: Rect) {
        val ctx = this
        val tile = TextView(ctx).apply {
            text = "🔒 Locked by Whitelist Browser"
            setTextColor(Color.WHITE); textSize = 13f; gravity = Gravity.CENTER
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            setBackgroundColor(Color.parseColor("#1F5F55"))
            val px = (resources.displayMetrics.density * 10).toInt(); setPadding(px, 0, px, 0)
            setOnClickListener { /* swallow taps on our row */ }
        }
        val lp = WindowManager.LayoutParams(
            r.width(), r.height(), r.left, r.top, overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.OPAQUE).apply { gravity = Gravity.TOP or Gravity.START }
        runCatching { wm?.addView(tile, lp); rowCovers.add(tile) }.logged("Cover", "Showing a row cover")
    }

    private fun removeFull() {
        fullCover?.let { c -> runCatching { wm?.removeView(c) }.logged("Cover", "Removing the full cover") }
        fullCover = null
    }

    private fun clearRows() {
        rowCovers.forEach { c -> runCatching { wm?.removeView(c) }.logged("Cover", "Removing a row cover") }
        rowCovers.clear(); lastRects = emptyList()
    }

    private fun hideAll() { removeFull(); clearRows(); coveringFor = null }

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
