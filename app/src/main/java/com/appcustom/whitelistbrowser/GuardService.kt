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
 * where the protection could be switched off (its App info, its accessibility detail, the device-admin page). The
 * panel names this browser, says who manages it, and its Back button sends the phone back one screen (GLOBAL_ACTION_BACK).
 *
 * ── How this was meant to work first (before any real-phone logs) ───────────────────────────────────────────────
 * The first design was deliberately device-agnostic: find THIS app's own name in the live accessibility tree and
 * use WHERE it sits on screen. On a *list* (the device-admin list, the accessibility list, the apps list) it would
 * place a small "row cover" over just our own entry — blocking the one on/off toggle while leaving the rest of the
 * screen usable — and on one of our *detail* pages it would cover the whole screen. Nothing keyed on a particular
 * phone brand's private Settings class names.
 *
 * ── Why that didn't survive contact with a real phone ───────────────────────────────────────────────────────────
 * Tested on a Samsung Galaxy A54 (model SM-A546E, Android 16 / SDK 36, from this project's shared logs), three
 * things broke the row-cover idea:
 *   1. viewIdResourceName comes back EMPTY for every node, so any view-id-based detection is dead there.
 *   2. A Settings screen fires a storm of events as it draws, and rootInActiveWindow bounces between panels, so our
 *      name flickers in and out of the read — rebuilding covers each time made them glitch.
 *   3. The on-screen bounds of "our row" resolved to the wrong (too-large) container, so the small covers landed in
 *      the wrong place.
 * So row covers were dropped in favour of a single, steady, full-screen cover.
 *
 * ── How it works now (steady full-screen cover) ─────────────────────────────────────────────────────────────────
 * A Settings screen is recognised as one of OURS from two kinds of signal, and our own app name must be present
 * either way, so another app's pages are never covered:
 *   • CLASS-name fragments of the detail pages — plain Android ones that also match Samsung's: "installedappdetails"
 *     (App info) and "deviceadminadd" (which matches Samsung's "secdeviceadminadd").
 *   • VISIBLE-TEXT markers — "device admin" (covers the whole Samsung device-admin page, not just its toggle),
 *     the Force stop / Uninstall / Deactivate / Turn off words, the "restricted setting" dialog, and our own
 *     accessibility-service description ("covers blocked apps").
 * Two rules keep it steady rather than flickering: the cover is never rebuilt while it's already up for the same
 * reason; and it is only ever taken down on a *navigation* (a WINDOW_STATE_CHANGED to a settled screen that clearly
 * isn't ours) — never on a content/scroll event — so scrolling an App info page can't close it. Reads of our own
 * cover window are ignored, so the cover's text is never mistaken for a settings screen.
 *
 * ── Tuning for more phones later ────────────────────────────────────────────────────────────────────────────────
 * Known-good: Samsung SM-A546E / Android 16. The knobs are DETAIL_CLASS (class-name fragments) and the text markers
 * in isGuarded(). If another brand names these screens differently, add its class fragment or a text marker. The
 * CoverDiag log line prints each Settings screen's class + a slice of its text, so a new device can be tuned from a
 * shared log without a phone in hand.
 *
 * It only ever looks at WHICH app or settings screen is open, never at what's typed or shown. Part of a supervised,
 * parental-control setup, always visible for what it is; the admin can switch it off.
 */
class GuardService : AccessibilityService() {
    companion object {
        @Volatile var running = false
            private set
        @Volatile private var instance: GuardService? = null
        fun dismissCover() { instance?.let { svc -> svc.main.post { svc.hideAll() } } }

        // Class-name fragments of OUR app's own detail pages (plain Android; "deviceadminadd" also matches Samsung's
        // "secdeviceadminadd"). Only used together with our name on screen, so another app's page is never covered.
        private val DETAIL_CLASS = listOf("installedappdetails", "deviceadminadd")
        // Visible-text markers of a page we must cover (checked only when our own name is also on screen).
        private const val DEVICE_ADMIN = "device admin"       // our app's device-admin detail page says this (with our name)
        // The "Device admin apps" LIST itself (by its screen title), covered up front — before the toggle is tapped —
        // so a fast tap can't beat the cover. Matched by the title + "navigate up", so a mere link to it (e.g. on the
        // Security page, titled otherwise) isn't covered.
        private val ADMIN_LIST = listOf("device admin apps navigate up", "device admin navigate up")
        private val DETAIL_WORDS = listOf(
            "force stop", "uninstall", "deactivate", "disable", "turn off",
            "clear storage", "clear data", "clear cache")
        private const val DESC_PHRASE = "covers blocked apps" // our accessibility-service description
        // The Accessibility "Installed apps" LIST (its title). Our name and description show in that list, which would
        // otherwise cover the whole list; we cover only our own service page (opened from it), not the list itself.
        private const val ACCESS_LIST = "installed apps navigate up"
        private const val RESTRICTED = "restricted setting"
        private const val SETUP_GRACE_MS = 8000L
        private const val HIDE_DELAY_MS = 500L
        private const val BACK_HOME_MS = 1800L   // Back tapped but still on a locked screen within this → go Home
    }

    private var wm: WindowManager? = null
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private var connectedAt = 0L

    private var cover: View? = null
    private var coveringFor: String? = null
    private var pendingHide = false
    private var backPressedAt = 0L               // when our cover's Back was last tapped (for the Home fallback)

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
                if (stateChanged) onSettingsStateChange(cls)
                else onSettingsContentChange(cls)
                return
            }
            if (stateChanged) hideAll()                       // any other app in front
        }.logged("Cover", "Checking the open app")
    }

    /** A new Settings screen opened (navigation): show if it's ours, otherwise start the short delay before hiding
     *  — and re-check a few times as it finishes drawing. This is the ONLY place a settings cover is taken down. */
    private fun onSettingsStateChange(cls: String) {
        lastContentCheck = android.os.SystemClock.uptimeMillis()
        val s = scanSettings()
        diag(cls, s)
        if (s.ourCover) return                                // only our own cover is up → leave it
        if (isGuarded(cls, s.text, s.us)) { showSettingCover(); return }
        // Not ours. Only start the cancellable hide on a real, SETTLED read — a blank read just means the screen is
        // still drawing (or a sibling window came back empty), which must never take the cover down. The re-checks
        // below cancel the hide the moment the screen turns out to be one of ours.
        if (s.text.isNotBlank() && coveringFor == "setting") scheduleHide()
        scheduleGuardChecks(cls)
    }

    /** The current Settings screen changed or scrolled: only ever (re)assert the cover, NEVER take it down — so
     *  scrolling an App info page can't close it. */
    private fun onSettingsContentChange(cls: String) {
        if (android.os.SystemClock.uptimeMillis() - lastContentCheck < 120L) return
        lastContentCheck = android.os.SystemClock.uptimeMillis()
        val s = scanSettings()
        diag(cls, s)
        if (!s.ourCover && isGuarded(cls, s.text, s.us)) showSettingCover()
    }

    private fun diag(cls: String, s: Scan) {
        if (cls != lastDiagCls) { lastDiagCls = cls; AppLog.i("CoverDiag", "settings cls=$cls | us=${s.us} | txt=${s.text.take(150)}") }
    }

    private fun blockedTitle(pkg: String): String {
        val label = runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault("This app")
        return "$label is blocked on this phone"
    }

    private val ourName by lazy { runCatching { getString(R.string.app_name) }.getOrDefault("Whitelist Browser").lowercase() }
    private val ourPkgLower by lazy { packageName.lowercase() }
    private fun isSettingsPkg(pkg: String): Boolean = pkg.contains("settings")
    private fun isForegroundSettings(): Boolean = runCatching { rootInActiveWindow?.packageName?.toString()?.contains("settings") == true }.getOrDefault(false)

    private fun isGuarded(cls: String, text: String, us: Boolean): Boolean {
        // The Device admin apps LIST (by its own title) is covered even before our row/name is read, so the toggle is
        // under the cover from the moment the screen opens — not only once someone taps it.
        if (ADMIN_LIST.any { text.contains(it) }) return true
        if (!us) return false
        if (DETAIL_CLASS.any { cls.contains(it) }) return true          // our App info / device-admin page (by class)
        if (text.contains(DEVICE_ADMIN)) return true                    // the whole device-admin page (by text)
        if (text.contains(ACCESS_LIST)) return false                    // the Accessibility "Installed apps" LIST: leave it, cover only our own page
        if (DETAIL_WORDS.any { text.contains(it) }) return true         // Force stop / Uninstall / Deactivate / …
        if (text.contains(RESTRICTED)) return true                      // the "restricted setting" dialog
        if (text.contains(DESC_PHRASE)) return true                     // our accessibility-service detail page
        return false
    }

    private fun showSettingCover() {
        // Back was just tapped but we're still on a locked screen (e.g. App info opened straight from a long-press,
        // with nothing to go back to): go to the home screen instead of covering it again and looping forever.
        if (backPressedAt != 0L && android.os.SystemClock.uptimeMillis() - backPressedAt < BACK_HOME_MS) {
            backPressedAt = 0L
            hideAll()
            performGlobalAction(GLOBAL_ACTION_HOME)
            return
        }
        showFull("This setting is locked", "It's set by whoever manages Whitelist Browser on this phone.", "setting")
    }

    private var guardGen = 0
    private fun scheduleGuardChecks(cls: String) {
        val gen = ++guardGen
        for (delay in longArrayOf(80L, 200L, 450L, 800L)) {
            main.postDelayed({
                if (gen != guardGen) return@postDelayed
                runCatching {
                    if (!BrowserGuard.coverOn(applicationContext) || !isForegroundSettings()) return@runCatching
                    val s = scanSettings()
                    if (!s.ourCover && isGuarded(cls, s.text, s.us)) showSettingCover()
                }.logged("Cover", "Re-checking the settings screen")
            }, delay)
        }
    }

    private class Scan(val text: String, val us: Boolean, val ourCover: Boolean)

    /** The visible text of ALL on-screen windows at once (our own cover excluded), lowercased and bounded. Reading
     *  every window rather than just the "active" one is what stops the flicker: on this phone a screen like the
     *  device-admin page is split across two windows and the active one bounces between them, one of which reads
     *  empty — aggregating them means the full text is always seen. `ourCover` is true only when nothing but our own
     *  cover is up. Only to recognise our own protection screens; never read or kept beyond this check. */
    private fun scanSettings(): Scan {
        val sb = StringBuilder()
        var sawOther = false
        var sawOwn = false
        val wins = runCatching { windows }.getOrNull()
        if (!wins.isNullOrEmpty()) {
            for (w in wins) {
                val root = w.root ?: continue
                if (root.packageName?.toString() == packageName) { sawOwn = true; continue }
                sawOther = true
                collect(root, sb)
                if (sb.length >= 8000) break
            }
        } else {
            val root = rootInActiveWindow ?: return Scan("", false, false)
            if (root.packageName?.toString() == packageName) return Scan("", false, true)
            sawOther = true
            collect(root, sb)
        }
        val text = sb.toString().lowercase()
        return Scan(text, text.contains(ourName) || text.contains(ourPkgLower), sawOwn && !sawOther)
    }

    private fun collect(root: AccessibilityNodeInfo, sb: StringBuilder) {
        val q = ArrayDeque<AccessibilityNodeInfo>(); q.add(root)
        var seen = 0
        while (q.isNotEmpty() && seen < 1500 && sb.length < 8000) {
            val n = q.removeFirst(); seen++
            n.text?.let { if (it.isNotBlank()) sb.append(it).append(' ') }
            n.contentDescription?.let { if (it.isNotBlank()) sb.append(it).append(' ') }
            for (i in 0 until n.childCount) n.getChild(i)?.let { q.add(it) }
        }
    }

    // ---- cover management (one full-screen panel; steady, never rebuilt while it's up for the same reason) ----

    private fun showFull(title: String, sub: String, forWhat: String) {
        pendingHide = false
        if (coveringFor == forWhat && cover != null) return
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
                // Back goes back one screen (the previous page), like the phone's own Back. If there's nothing to go
                // back to and we stay on the locked screen, showSettingCover sends the phone Home instead of looping.
                setOnClickListener { backPressedAt = android.os.SystemClock.uptimeMillis(); hideAll(); performGlobalAction(GLOBAL_ACTION_BACK) }
            })
        }
        val type = if (Build.VERSION.SDK_INT >= 22) WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ERROR
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, type, 0, PixelFormat.OPAQUE)
        runCatching { wm?.addView(panel, lp); cover = panel; coveringFor = forWhat }.logged("Cover", "Showing the cover")
    }

    /** Start the short, cancellable delay before taking a settings cover down — a guarded read in the meantime
     *  (which calls showFull) cancels it, so a brief "not ours" read never makes the cover blink. */
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
