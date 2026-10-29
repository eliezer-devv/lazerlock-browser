package com.lazerlock.browser

import android.content.Context
import android.util.AttributeSet
import android.view.View
import android.webkit.WebView

/**
 * A WebView that can be told to keep its media playing while the app is in the background.
 *
 * Android's WebView stops a <video> element the moment its window stops being visible (the surface the video draws to
 * is handed back), so a *video's* sound dies as soon as the app is minimised — while an audio-only track, which has no
 * video surface, keeps playing. That's the "notification shows but the sound won't play" we see on YouTube Music in
 * video mode.
 *
 * While [keepPlayingInBackground] is on, the view reports its window as still visible to the WebView engine, so a
 * playing video keeps decoding and its sound carries on in the background, the way a music app does. It's switched on
 * only while something is actually playing and the app is away, and off again the moment the app returns or playback
 * stops (see MainActivity.keepMediaAwake), so it costs nothing the rest of the time.
 *
 * Both constructors are kept: (context) for the player tab built in code, and (context, attrs) for inflation from
 * activity_main.xml.
 */
class MediaWebView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : WebView(context, attrs) {

    @Volatile var keepPlayingInBackground = false

    override fun onWindowVisibilityChanged(visibility: Int) {
        // When asked to keep playing, tell the engine the window is still visible so it doesn't pause the video.
        super.onWindowVisibilityChanged(if (keepPlayingInBackground) View.VISIBLE else visibility)
    }
}
