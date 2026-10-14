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
        // The App info detail page. NOTE: this page uses the SAME layout, class and view-ids for EVERY app on the
        // phone, so none of these identify *our* app on their own — they only say "this is an app-info page". The
        // guard additionally requires our app's name to be on screen before covering, so only our own App info is
        // covered, never another app's.
        private val CLASS_APPINFO = listOf(
            "installedappdetails", "appinfodashboard", "applicationsdetailsactivity", "applicationdetailsactivity")
        private const val APPINFO_ID = "installed_app_detail"
        private val APPINFO_WORDS = listOf("force stop", "uninstall", "clear storage", "clear data", "clear cache")
        // The per-service accessibility DETAIL page (the one with the big on/off toggle for one service) — never the
        // list of all installed services. Two signals set the detail page apart from the list: its fragment class,
        // and the "switch bar" (the master on/off header) that only the detail page carries. We deliberately do NOT
        // key on our description text any more: this phone shows that same text under our row in the LIST too, which
        // is exactly what was covering the whole list.
        private val CLASS_ACCESSIBILITY = listOf(
            "accessibilitydetailssettings", "toggleaccessibilityservicepreferencefragment")
        private val SWITCHBAR_IDS = listOf("switch_bar", "settings_switch_bar", "master_switch", "masterswitch")
        // The device-admin confirm / deactivate page. Same layout for every admin app, so also name-gated.
        private const val CLASS_DEVICEADMIN = "deviceadminadd"
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
    private var lastDiagCls = ""        // dedupes the per-screen diagnostic log
    private var lastCoverWhy = ""       // dedupes the "why covered" diagnostic log

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
            if (isSettingsPkg(pkg)) {
                // Settings screens aren't covered for the first few seconds after the cover is switched on, so
                // whoever set it up can read the confirmation and leave the screen.
                if (android.os.SystemClock.uptimeMillis() - connectedAt <= SETUP_GRACE_MS) { if (stateChanged) hide(); return }
                // Device-admin confirm page: the "Deactivate" button is right there, so cover the instant the window
                // opens — decided from the event's own class name, with no screen read to wait for. A beat later we
                // confirm it's really OUR device-admin page and take the cover back down if it was another app's.
                if (stateChanged && cls.contains(CLASS_DEVICEADMIN)) {
                    AppLog.i("CoverDiag", "device-admin fast-cover, cls=$cls"); showSetting(); verifyDeviceAdmin(cls); return }
                // Content events fire a lot; check at most ~8x a second.
                if (contentChanged && android.os.SystemClock.uptimeMillis() - lastContentCheck < 120L) return
                lastContentCheck = android.os.SystemClock.uptimeMillis()
                val (text, ids) = runCatching { windowTextAndIds() }.logged("Cover", "Reading the settings screen").getOrDefault("" to "")
                // DIAGNOSTIC: record what each Settings screen actually reports on this phone (class + a short slice
                // of its view-ids and text), so the accessibility list / detail and device-admin screens can be told
                // apart precisely from shared logs. Deduped by class so it logs once per screen, not on every tick.
                if (stateChanged && cls != lastDiagCls) {
                    lastDiagCls = cls
                    AppLog.i("CoverDiag", "settings cls=$cls | ids=${ids.take(240)} | txt=${text.take(180)}")
                }
                if (guardedSetting(cls, text, ids)) { showSetting(); return }
                // Not (yet) a guarded screen. A settings screen often isn't drawn the instant it opens, so instead of
                // reading once and giving up, re-check a few times over the next second so the cover appears quickly.
                if (stateChanged) {
                    // Only take an existing cover down once we've actually READ the new screen (a non-empty read) and
                    // it's clearly not ours. Hiding on an empty, still-loading read is what caused the one flash.
                    if ((text.isNotBlank() || ids.isNotBlank()) && coveringFor == "setting") hide()
                    scheduleGuardChecks(cls)
                }
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

    private fun showSetting() =
        show("This setting is locked", "It's set by whoever manages Whitelist Browser on this phone.", "setting")

    /**
     * Is the Settings screen in front one of THIS app's own pages where the protection could be switched off? Given
     * the screen already read once (text + view-ids, lowercased).
     *
     * The rule that keeps it to OUR pages only: App info, the accessibility detail page and the device-admin page
     * all use the same layout for every app, so none of them counts unless this app's own name (or package) is on
     * the screen. And the thing that tells our accessibility DETAIL page from the LIST of all services is a signal
     * only the detail page has — its master on/off "switch bar" — not our description text, which this phone also
     * prints under our row in the list.
     */
    private fun guardedSetting(eventCls: String, text: String, ids: String): Boolean {
        val hasUs = text.contains(ourName) || text.contains(ourPkgLower) || ids.contains(ourPkgLower)
        if (!hasUs) return false                                       // nothing of ours on screen → never cover

        // Returns true, and logs WHY (deduped) so shared logs show which rule covered a screen — the quickest way to
        // see why, say, the accessibility list is being covered on a given phone.
        fun hit(why: String): Boolean {
            if (why != lastCoverWhy) { lastCoverWhy = why; AppLog.i("CoverDiag", "cover: $why | cls=$eventCls") }
            return true
        }
        // Our App info page — its class, its own view-id, or its buttons (Force stop / Uninstall / Clear storage).
        if (CLASS_APPINFO.any { eventCls.contains(it) }) return hit("appinfo-class")
        if (ids.contains(APPINFO_ID)) return hit("appinfo-id")
        APPINFO_WORDS.firstOrNull { text.contains(it) }?.let { return hit("appinfo-word:$it") }
        // Our accessibility DETAIL page — by its fragment class, or by the master switch bar that the list lacks.
        if (CLASS_ACCESSIBILITY.any { eventCls.contains(it) }) return hit("acc-class")
        SWITCHBAR_IDS.firstOrNull { ids.contains(it) }?.let { return hit("switchbar:$it") }
        // Our device-admin confirm / deactivate page.
        if (eventCls.contains(CLASS_DEVICEADMIN)) return hit("devadmin-class")
        if (text.contains("deactivate") && text.contains("device admin")) return hit("devadmin-text")
        // The "allow restricted settings" dialog — shown while our app is the one being configured.
        if (text.contains("restricted setting")) return hit("restricted")
        return false
    }

    /**
     * A settings screen often isn't fully drawn the instant it opens, so instead of reading once and giving up,
     * re-check a handful of times across the next second — this is what makes the cover appear quickly. Each pass
     * only ever SHOWS the cover; taking it down is left to the next screen change (handled where the events arrive),
     * so a late-rendering guarded screen never flashes on and off. A generation counter cancels an older burst when
     * a newer screen opens.
     */
    private var guardGen = 0
    private fun scheduleGuardChecks(eventCls: String) {
        val gen = ++guardGen
        for (delay in longArrayOf(0L, 60L, 150L, 350L, 700L)) {
            main.postDelayed({
                if (gen != guardGen) return@postDelayed
                runCatching {
                    if (!BrowserGuard.coverOn(applicationContext) || !isForegroundSettings()) return@runCatching
                    val (text, ids) = windowTextAndIds()
                    if (guardedSetting(eventCls, text, ids)) showSetting()
                }.logged("Cover", "Checking the settings screen")
            }, delay)
        }
    }

    /**
     * After the device-admin page was covered on sight (by class alone, for speed), confirm a moment later that it's
     * really ours. If the read then shows it's another app's device-admin page, take the cover back down.
     */
    private fun verifyDeviceAdmin(eventCls: String) {
        val gen = ++guardGen
        main.postDelayed({
            if (gen != guardGen) return@postDelayed
            runCatching {
                if (!BrowserGuard.coverOn(applicationContext)) return@runCatching
                val (text, ids) = windowTextAndIds()
                if ((text.isNotBlank() || ids.isNotBlank()) && !guardedSetting(eventCls, text, ids) && coveringFor == "setting") hide()
            }.logged("Cover", "Confirming the device-admin page")
        }, 350L)
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
