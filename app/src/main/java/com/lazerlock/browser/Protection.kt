package com.lazerlock.browser

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/**
 * One master "Protection" switch for a supervised phone, and the health behind it.
 *
 * Protection is an INTENTION ("this phone is meant to be locked to LazerLock"), separate from the MEANS that
 * honour it (the screen cover, uninstall protection, unrestricted battery, …). Raising protection is free — anyone
 * can turn it on and grant the means through Android's own screens. Lowering it clears the intention, which needs the
 * admin's approval (sent as a request, like any other locked setting).
 *
 * The app can never grant or revoke the Android permissions itself — only Android can, through its screens — so if
 * one is stripped (the phone sleeps the app, a permission is auto-revoked) the intention stays on but a means goes
 * missing: that is the "Action needed" state. The app can't silently re-grant it, but it reports it so the admin is
 * told, and prompts to put it back.
 */
object Protection {
    private const val PREFS = "protection"
    private const val WANT = "want"
    private const val OFF_SEEN = "offProcessed"        // the admin turn-off (its timestamp) we've already applied to the local switch
    private const val OFF_CLEANED = "offCleaned"       // the admin turn-off we've already handed Android permissions back for
    private const val LISTS_OFF_SEEN = "listsOffProcessed"
    private const val SLIP = "slipAlerted"   // we've already sent the owner a "protection slipped" alert for this lapse
    private const val WAS_ACTIVE = "wasActive" // protection has been fully in place at least once (so a drop is a real lapse, not first-time setup)

    /**
     * The phone's own switch. Turning it ON here is always free — including right after the admin turned protection off
     * (turning OFF is the only thing that needs the admin). The admin turning protection off arrives as a new
     * protect.offAt timestamp; we clear the local switch ONCE for each new value (so the phone shows off), and from
     * then on the phone's own pref governs again, so the parent can freely turn it back on. Just a pref read otherwise
     * (no call back into BrowserGuard), so it's safe to use from effective().
     */
    fun wantLocal(ctx: Context): Boolean {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val offAt = runCatching { Whitelist.state.protect?.offAt ?: 0L }.getOrDefault(0L)
        if (offAt > 0L && p.getLong(OFF_SEEN, 0L) != offAt) p.edit().putBoolean(WANT, false).putLong(OFF_SEEN, offAt).apply()
        return p.getBoolean(WANT, false)
    }

    /**
     * Whether protection is meant to be on. The admin imposing a mode (cover/owner) from the dashboard forces it on.
     * Otherwise the phone's own switch decides — which has already picked up any admin turn-off via [wantLocal]. This
     * is also what [BrowserGuard.effective] enforces, so the status shown and the protection actually in force agree.
     */
    fun intended(ctx: Context): Boolean {
        val admin = runCatching { Whitelist.state.protect }.getOrNull()
        if (admin != null && (admin.mode == "cover" || admin.mode == "owner")) return true
        return wantLocal(ctx)
    }

    fun setWanted(ctx: Context, want: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(WANT, want).apply()
        runCatching { Requests.checkInSoon(ctx) }       // tell the admin page its protection changed
    }

    /**
     * When the admin approves a turn-off, also hand the Android permissions back: turn our own screen cover
     * (accessibility) off and remove ourselves as device admin, so the phone returns to normal. Done once per
     * turn-off. (The unrestricted-battery exemption can't be revoked by any app — it's left, which is harmless.)
     * Safe to call often; does a little work, so call it off the main thread.
     */
    fun applyTurnOff(ctx: Context) {
        val offAt = runCatching { Whitelist.state.protect?.offAt ?: 0L }.getOrDefault(0L)
        if (offAt <= 0L) return
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (p.getLong(OFF_CLEANED, 0L) == offAt) return   // already handed back for this turn-off (but a NEW one re-arms)
        p.edit().putLong(OFF_CLEANED, offAt).apply()
        runCatching { DeviceOwner.removeAdmin(ctx) }.logged("Protection", "Handing device admin back on turn-off")
        runCatching { GuardService.turnOffSelf() }.logged("Protection", "Handing the screen cover back on turn-off")
        AppLog.i("Protection", "Protection turned off by the admin — handed accessibility & device admin back")
    }

    // ── the stronger, optional "cover the whole Settings lists" layer ────────────────────────────────────────────
    // Covers the entire Accessibility "Installed apps" list and the Device-admin apps list (not just this app's own
    // screens). Turned on freely on the phone or from the dashboard; turned off (on the phone) only via a request,
    // whose approval arrives as a new coverListsOffAt timestamp and clears the local switch once.
    private const val COVER_LISTS = "coverListsLocal"
    fun coverListsLocal(ctx: Context): Boolean {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val offAt = runCatching { Whitelist.state.protect?.coverListsOffAt ?: 0L }.getOrDefault(0L)
        if (offAt > 0L && p.getLong(LISTS_OFF_SEEN, 0L) != offAt) p.edit().putBoolean(COVER_LISTS, false).putLong(LISTS_OFF_SEEN, offAt).apply()
        return p.getBoolean(COVER_LISTS, false)
    }
    /** The admin set the whole-lists cover ON from the dashboard: it then can't be turned off on the phone. */
    fun coverListsForced(ctx: Context): Boolean = runCatching { Whitelist.state.protect?.coverLists == true }.getOrDefault(false)
    /** Whether the whole-lists cover is MEANT to be on (admin set it, or turned on locally) — what the toggle shows. */
    fun coverListsWanted(ctx: Context): Boolean = coverListsForced(ctx) || coverListsLocal(ctx)
    /** The toggle can't be changed on the phone (the admin forced it on from the dashboard). */
    fun coverListsLocked(ctx: Context): Boolean = coverListsForced(ctx)
    fun setCoverListsLocal(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(COVER_LISTS, on).apply()
        runCatching { Requests.checkInSoon(ctx) }
    }

    // ── the live means ────────────────────────────────────────────────────────────────────────────────────────────
    fun owner(ctx: Context): Boolean = runCatching { DeviceOwner.isOwner(ctx) }.getOrDefault(false)
    fun coverOn(ctx: Context): Boolean = GuardService.running
    fun adminOn(ctx: Context): Boolean = runCatching { DeviceOwner.isAdminActive(ctx) }.getOrDefault(false)
    fun browsersBlocked(ctx: Context): Boolean = runCatching { BrowserGuard.on(ctx) }.getOrDefault(false)

    /** Exempt from battery optimisation (so Android/Samsung won't sleep the app and drop the cover). */
    fun batteryUnrestricted(ctx: Context): Boolean = runCatching {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@runCatching true
        (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName)
    }.getOrDefault(false)

    /** Not set to have its permissions auto-removed when unused ("Pause app activity if unused"). API 30+ only. */
    fun autoRevokeExempt(ctx: Context): Boolean = runCatching {
        if (Build.VERSION.SDK_INT < 30) return@runCatching true
        ctx.packageManager.isAutoRevokeWhitelisted
    }.getOrDefault(true)

    enum class Status { OFF, ACTIVE, PARTIAL }

    /**
     * A protected phone is ACTIVE when every core means is in place (device owner covers them all); PARTIAL when it's
     * meant to be protected but a means has lapsed; OFF when protection isn't intended. Auto-revoke is tracked and
     * reported but doesn't by itself drop to PARTIAL (it's a hardening extra, not core).
     */
    fun status(ctx: Context): Status {
        if (!intended(ctx)) return Status.OFF
        if (owner(ctx)) return Status.ACTIVE
        val core = coverOn(ctx) && adminOn(ctx) && batteryUnrestricted(ctx)
        return if (core) Status.ACTIVE else Status.PARTIAL
    }

    /** Human-readable means that are meant to be on but aren't (for the phone screen and the report). */
    fun missing(ctx: Context): List<String> {
        if (!intended(ctx) || owner(ctx)) return emptyList()
        val out = ArrayList<String>()
        if (!coverOn(ctx)) out.add("Screen cover")
        if (!adminOn(ctx)) out.add("Uninstall protection")
        if (!batteryUnrestricted(ctx)) out.add("Always running (battery)")
        return out
    }

    /**
     * Notices when protection has slipped (meant to be on, but a means dropped) and alerts the admin side once — which
     * emails the owner and shows on admin phones. Deduped: it sends one alert per lapse, and arms again only once
     * protection is active (or off) once more. Safe to call often; does network, so call it off the main thread.
     */
    fun watchdog(ctx: Context) {
        runCatching { applyTurnOff(ctx) }   // if the admin just turned protection off, hand the permissions back
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!intended(ctx)) {                                  // off: forget it was ever active, re-arm the alert
            if (p.getBoolean(SLIP, false) || p.getBoolean(WAS_ACTIVE, false)) p.edit().putBoolean(SLIP, false).putBoolean(WAS_ACTIVE, false).apply()
            return
        }
        when (status(ctx)) {
            Status.ACTIVE -> if (!p.getBoolean(WAS_ACTIVE, false) || p.getBoolean(SLIP, false))
                p.edit().putBoolean(WAS_ACTIVE, true).putBoolean(SLIP, false).apply()   // fully in place (now, or again): arm, clear any alert
            // Only a DROP from a previously-active state is a real lapse — not first-time setup, where it's partial until granted.
            Status.PARTIAL -> if (p.getBoolean(WAS_ACTIVE, false) && !p.getBoolean(SLIP, false)) {
                p.edit().putBoolean(SLIP, true).apply()        // mark first, so a retry can't double-send
                runCatching { Requests.queueProtectionAlert(ctx, missing(ctx)); Outbox.flush(ctx) }.logged("Protection", "Alerting that protection slipped")
            }
            Status.OFF -> {}                                   // not reached (intended is true here)
        }
    }

    // ── grant intents (the app can only open Android's own screen) ───────────────────────────────────────────────
    /** The one-tap "Allow LazerLock to run in the background without limits?" system dialog. */
    fun batteryIntent(ctx: Context): Intent? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || batteryUnrestricted(ctx)) return null
        @android.annotation.SuppressLint("BatteryLife")
        val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
        return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
