package com.lazerlock.browser

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
        /** Turn our own accessibility service off (handing the permission back) — used when protection is switched off. */
        fun turnOffSelf() { instance?.let { svc -> svc.main.post { runCatching { svc.hideAll(); if (Build.VERSION.SDK_INT >= 24) svc.disableSelf() }.logged("Cover", "Turning the screen cover off") } } }

        // ── Languages ────────────────────────────────────────────────────────────────────────────────────────────
        // Language-INDEPENDENT (works whatever the phone's language is set to): our App info and Device-admin pages are
        // matched by Android CLASS names (installedappdetails / deviceadminadd); "is this our app?" is matched by our
        // app NAME (R.string.app_name), which is the same in every language and follows the name automatically if it's
        // ever changed; and our Accessibility page is matched by our OWN description string (DESC_PHRASE), which Android
        // shows verbatim. So the three critical screens are covered in any language.
        // Language-DEPENDENT (reads the system's own words): the text markers below and the whole-list titles. These are
        // English only — to add a language, capture a cover log on a phone set to it and add the exact words it shows.
        private val DETAIL_CLASS = listOf("installedappdetails", "deviceadminadd")
        private val DEVICE_ADMIN = listOf("device admin")
        // The "Device admin apps" LIST (by its screen title + the Up button), for the optional whole-list cover.
        private val ADMIN_LIST = listOf("device admin apps navigate up", "device admin navigate up")
        // The same two list screens, matched on the WINDOW TITLE instead — a clean, early signal (the probe log
        // confirmed Samsung has no unique class or resource-id for these lists, so the title is the best handle).
        private val ADMIN_LIST_TITLE = listOf("device admin apps", "device admin")
        private val ACCESS_LIST_TITLE = listOf("installed apps")
        private val DETAIL_WORDS = listOf(
            "force stop", "uninstall", "deactivate", "disable", "turn off", "clear storage", "clear data", "clear cache")
        private const val DESC_PHRASE = "covers blocked apps" // our accessibility-service description (our own string)
        // The Accessibility "Installed apps" LIST (its title): by default we cover only our own service page, not the list.
        private val ACCESS_LIST_WORDS = listOf("installed apps navigate up")
        private val RESTRICTED = listOf("restricted setting")
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
    private var lastBlockedDiag = ""

    // The phone's home/launcher packages. The Google app's search bar and Discover feed live on the home screen, so if
    // "the Google app" is blocked we must NOT cover the home screen itself — only the real app.
    private val homePkgs by lazy {
        runCatching {
            packageManager.queryIntentActivities(android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_HOME), 0)
                .map { it.activityInfo.packageName }.toSet()
        }.getOrDefault(emptySet())
    }
    private fun onHomeScreen(): Boolean = runCatching {
        val root = rootInActiveWindow?.packageName?.toString()
        root != null && (homePkgs.contains(root) || root.contains("launcher"))
    }.getOrDefault(false)

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
                // On the home screen, a "blocked" package is usually the Google bar/feed that's part of home — don't cover it.
                if (onHomeScreen()) { if (stateChanged) hideAll(); return }
                // One diagnostic line per new blocked screen (so a log shows what the cover saw, e.g. the Google case).
                val key = "$pkg|$cls"
                if (key != lastBlockedDiag) { lastBlockedDiag = key; AppLog.i("CoverDiag", "blocked app pkg=$pkg cls=$cls root=${runCatching { rootInActiveWindow?.packageName }.getOrNull()}") }
                showFull(blockedTitle(pkg), "Websites open in LazerLock on this phone. You can ask to use this app.", "blocked:$pkg")
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
        if (isGuarded(cls, s.text, s.us, s.titles)) { showSettingCover(); return }
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
        if (!s.ourCover && isGuarded(cls, s.text, s.us, s.titles)) showSettingCover()
    }

    private fun diag(cls: String, s: Scan) {
        if (cls != lastDiagCls) {
            lastDiagCls = cls
            AppLog.i("CoverDiag", "settings cls=$cls | us=${s.us} | txt=${s.text.take(150)}")
            // Deeper, one-shot probe for a language-INDEPENDENT handle on list screens whose event-class is the
            // generic SubSettings. Logs each window's root class + title, every distinct node class, and any non-empty
            // view resource-id. If the device-admin LIST carries a specific class/id anywhere in its tree, it shows up
            // here; if it doesn't (all generic + empty ids), that confirms text is the only handle for it.
            runCatching { probe() }.logged("CoverDiag", "Probing the settings screen")
        }
    }

    /** One-shot deep diagnostic (see diag). Never used for detection — only written to the log so a screen that has no
     *  unique event-class can be inspected for a specific root class, window title, child class, or resource-id. */
    private fun probe() {
        val classes = LinkedHashSet<String>()
        val ids = LinkedHashSet<String>()
        val roots = StringBuilder()
        val wins = runCatching { windows }.getOrNull()
        val rootsList = if (!wins.isNullOrEmpty()) wins.mapNotNull { w -> w.root?.let { it to w.title?.toString() } }
            else listOfNotNull(rootInActiveWindow?.let { it to null })
        for ((root, title) in rootsList) {
            if (root.packageName?.toString() == packageName) continue
            roots.append('[').append(root.className ?: "?").append(title?.let { " \"$it\"" } ?: "").append("] ")
            val q = ArrayDeque<AccessibilityNodeInfo>(); q.add(root)
            var seen = 0
            while (q.isNotEmpty() && seen < 1500 && classes.size < 60) {
                val n = q.removeFirst(); seen++
                n.className?.toString()?.let { classes.add(it) }
                n.viewIdResourceName?.let { if (it.isNotBlank()) ids.add(it) }
                for (i in 0 until n.childCount) n.getChild(i)?.let { q.add(it) }
            }
        }
        AppLog.i("CoverDiag", "  probe roots=${roots.trim()} | ids=${if (ids.isEmpty()) "(none)" else ids.joinToString(",").take(400)}")
        AppLog.i("CoverDiag", "  probe classes=${classes.joinToString(",").take(700)}")
    }

    private fun blockedTitle(pkg: String): String {
        val label = runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault("This app")
        return "$label is blocked on this phone"
    }

    private val ourName by lazy { runCatching { getString(R.string.app_name) }.getOrDefault("LazerLock").lowercase() }
    private val ourPkgLower by lazy { packageName.lowercase() }
    private fun isSettingsPkg(pkg: String): Boolean = pkg.contains("settings")
    private fun isForegroundSettings(): Boolean = runCatching { rootInActiveWindow?.packageName?.toString()?.contains("settings") == true }.getOrDefault(false)

    /** The stronger, optional protection (admin → Block other browsers): also cover the whole Accessibility and
     *  Device-admin LIST screens, not only our own pages. Off by default. */
    private fun coverLists(): Boolean = runCatching { BrowserGuard.coverLists(applicationContext) }.getOrDefault(false)

    /**
     * DEFAULT (always): our own device-admin page (by class — robust even when its text reads empty, and in any
     * language), our App info page, and our own Accessibility service page — but NOT the whole "Installed apps" or
     * "Device admin apps" lists. OPTIONAL (coverLists on): also cover those two whole list screens.
     */
    private fun isGuarded(cls: String, text: String, us: Boolean, titles: String = ""): Boolean {
        // The device-admin screen (its "deactivate?" page), by class — but ONLY once we're actually a device admin.
        // Before it's granted this is the "activate?" screen, and covering it would stop the person ever turning it on
        // (you can't grant device admin if the overlay is already on top of that screen). So cover it only to protect
        // it from being switched OFF, never to block switching it on.
        val adminActive = runCatching { DeviceOwner.isAdminActive(applicationContext) }.getOrDefault(false)
        // While NOT yet a device admin, the device-admin screen is the "Activate?" screen (by class OR its wording):
        // never cover it, or the overlay would sit on top of it and you could never grant device admin. Once active,
        // it's the "Deactivate?" screen, which we DO cover.
        if (!adminActive && (cls.contains("deviceadminadd") || DEVICE_ADMIN.any { text.contains(it) })) return false
        if (cls.contains("deviceadminadd")) return true
        // Optional: the whole list screens. Matched first on the clean WINDOW TITLE ("Device admin apps" / "Installed
        // apps") — a tidier, earlier signal than the full text — and the accessibility list also by our OWN description
        // (us + DESC_PHRASE, language-independent). Falls back to the old full-text phrases if a device gives no title.
        // (The device-admin TOGGLE page itself is always covered by class above, in any language.)
        if (coverLists() && (
                ADMIN_LIST_TITLE.any { titles.contains(it) } ||
                ACCESS_LIST_TITLE.any { titles.contains(it) } ||
                (us && text.contains(DESC_PHRASE)) ||
                ACCESS_LIST_WORDS.any { text.contains(it) } ||
                ADMIN_LIST.any { text.contains(it) })) return true
        if (!us) return false
        if (cls.contains("installedappdetails")) return true            // our App info page (by class)
        if (ACCESS_LIST_WORDS.any { text.contains(it) } || ACCESS_LIST_TITLE.any { titles.contains(it) }) return false // default: cover our Accessibility page, not the whole list
        if (DEVICE_ADMIN.any { text.contains(it) }) return true         // our device-admin managed page (by text)
        if (DETAIL_WORDS.any { text.contains(it) }) return true         // Force stop / Uninstall / Deactivate / …
        if (RESTRICTED.any { text.contains(it) }) return true           // the "restricted setting" dialog
        if (text.contains(DESC_PHRASE)) return true                     // our accessibility-service page (its description)
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
        showFull("This setting is locked", "It's set by whoever manages LazerLock on this phone.", "setting")
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
                    if (!s.ourCover && isGuarded(cls, s.text, s.us, s.titles)) showSettingCover()
                }.logged("Cover", "Re-checking the settings screen")
            }, delay)
        }
    }

    private class Scan(val text: String, val us: Boolean, val ourCover: Boolean, val titles: String = "")

    /** The visible text of ALL on-screen windows at once (our own cover excluded), lowercased and bounded. Reading
     *  every window rather than just the "active" one is what stops the flicker: on this phone a screen like the
     *  device-admin page is split across two windows and the active one bounces between them, one of which reads
     *  empty — aggregating them means the full text is always seen. `ourCover` is true only when nothing but our own
     *  cover is up. Only to recognise our own protection screens; never read or kept beyond this check. */
    private fun scanSettings(): Scan {
        val sb = StringBuilder()
        val titles = StringBuilder()
        var sawOther = false
        var sawOwn = false
        val wins = runCatching { windows }.getOrNull()
        if (!wins.isNullOrEmpty()) {
            for (w in wins) {
                val root = w.root ?: continue
                if (root.packageName?.toString() == packageName) { sawOwn = true; continue }
                sawOther = true
                // The window's own title is the clean per-screen label ("Device admin apps", "Installed apps") —
                // far tidier than the full flattened text, which is polluted with the status bar. Used only to
                // recognise the optional whole-list screens. Still the system's own (localised) words.
                w.title?.let { if (it.isNotBlank()) titles.append(it).append(" | ") }
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
        return Scan(text, text.contains(ourName) || text.contains(ourPkgLower), sawOwn && !sawOther, titles.toString().lowercase())
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
        Ui.applyTheme(ctx)                       // follow the app's current palette, so the cover re-colours with the theme
        val panel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Ui.PAGE)
            val pad = (resources.displayMetrics.density * 28).toInt(); setPadding(pad, pad, pad, pad)
            addView(TextView(ctx).apply {
                text = title; textSize = 23f; setTypeface(typeface, android.graphics.Typeface.BOLD); gravity = Gravity.CENTER
                setTextColor(Ui.INK)
            })
            addView(TextView(ctx).apply {
                text = sub; textSize = 15f; gravity = Gravity.CENTER
                setTextColor(Ui.MUTED)
                val m = (resources.displayMetrics.density * 12).toInt(); setPadding(0, m, 0, m * 2)
            })
            addView(TextView(ctx).apply {
                text = "  Back  "; textSize = 16f; setTypeface(typeface, android.graphics.Typeface.BOLD)
                gravity = Gravity.CENTER; setTextColor(Color.WHITE)
                val h = (resources.displayMetrics.density * 50).toInt(); val padx = (resources.displayMetrics.density * 26).toInt()
                minHeight = h; setPadding(padx, 0, padx, 0)
                background = Ui.rounded(Ui.ACCENT, resources.displayMetrics.density * 25)
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
}
