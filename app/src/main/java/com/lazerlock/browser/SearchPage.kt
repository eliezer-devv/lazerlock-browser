package com.lazerlock.browser

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.net.URLEncoder

/**
 * Text search (when it's on for this phone): a results page made by the app itself, at the app's own address (like
 * the home page), so nothing from the search engine's own page ever shows. Words only: no pictures, videos, sound or
 * ads. Each result is a page (several from one site is fine), with its site's little icon, where it is, its title and a
 * snippet, and whether it opens on this phone. Results on a content filter's list, or on this phone's always-blocked
 * list, are simply left out. Opening one goes through the phone's lists like any link.
 */
object SearchPage {
    const val URL = "https://${HomePage.HOST}/search/"

    fun isSearch(url: String?) = url != null && url.startsWith(URL)
    fun urlFor(q: String) = URL + "?q=" + URLEncoder.encode(q.trim(), "UTF-8")

    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")

    /** "bbc.co.uk › bitesize › guides" (the address, readably: at most three steps of its path). */
    fun breadcrumb(url: String): String {
        val u = Uri.parse(url)
        val host = (u.host ?: "").lowercase().removePrefix("www.")
        val steps = u.pathSegments.orEmpty().filter { it.isNotBlank() }.take(3).map { it.take(40) }
        return (listOf(host) + steps).joinToString(" › ")
    }

    /** Called on the WebView's own thread for loading (not the main thread): searching here is fine. */
    fun respond(ctx: Context, uri: Uri): WebResourceResponse {
        val q = uri.getQueryParameter("q").orEmpty().trim().take(200)
        val pages = (uri.getQueryParameter("p")?.toIntOrNull() ?: 0).coerceIn(0, MAX_PAGES)
        val s = Whitelist.state
        val body = StringBuilder()
        body.append(SearchBar.form(q, q.isEmpty()))     // the one shared search box (same as the home page)
        when {
            !Whitelist.searchOn() && s.search -> body.append("<p class=\"note\">Search is off during ${esc(Timers.activeNow().firstOrNull { it.search == "off" }?.name ?: "a timer")}.</p>")
            !Whitelist.searchOn() -> body.append("<p class=\"note\">Search isn't turned on for this phone. You can ask for it: ⋮ → Ask for search.</p>")
            q.isEmpty() -> body.append("<p class=\"note\">Type what you're looking for.</p>")
            else -> try {
                val got = Discovery.searchPages(q, pages)                        // current page (may throw Challenge)
                val shown = ArrayList<String>()
                for (r in got) {
                    if (Whitelist.hiddenFromSearch(r.url)) continue              // filtered or always blocked: not shown
                    val opens = Whitelist.isAllowed(r.url)
                    if (s.searchApprovedOnly && !opens) continue
                    shown += result(r, opens, null)
                }
                // As many pages as there are results: we peek one page ahead to know if a next page exists, and carry
                // the furthest page found (n=) so the numbers don't vanish when you step back to an earlier page.
                val carried = (uri.getQueryParameter("n")?.toIntOrNull() ?: 0).coerceIn(0, MAX_PAGES)
                val nextHas = when {
                    pages < carried -> true                                       // already found a later page before
                    pages < MAX_PAGES && got.isNotEmpty() ->                       // at the frontier: peek one ahead
                        runCatching { Discovery.searchPages(q, pages + 1).isNotEmpty() }.getOrDefault(false)
                    else -> false
                }
                val lastPage = maxOf(carried, pages, if (nextHas) pages + 1 else pages)   // highest page index known
                if (shown.isEmpty()) body.append("<p class=\"note\">${if (pages == 0) "No results. Try other words." else "No more results."}</p>")
                else shown.forEach { body.append(it) }
                if (shown.isNotEmpty() && (pages > 0 || nextHas)) {
                    body.append("<nav class=\"pager\" aria-label=\"Pages\">")
                    if (pages > 0) body.append(pageLink(q, pages - 1, lastPage, "‹", false))
                    for (i in 0..lastPage) body.append(pageLink(q, i, lastPage, (i + 1).toString(), i == pages))
                    if (pages < lastPage) body.append(pageLink(q, pages + 1, lastPage, "›", false))
                    body.append("</nav>")
                }
                AppLog.i("Search", "Searched (${shown.size} results shown, page ${pages + 1}${if (nextHas) "+" else ""})")
            } catch (e: Discovery.Challenge) {
                body.append("<div class=\"note\"><p>DuckDuckGo wants to check that a person is searching (there have been many searches).</p>")
                    .append("<a class=\"btn\" href=\"wlb://search-check?u=${esc(URLEncoder.encode(e.url, "UTF-8"))}\">Answer the check</a></div>")
            } catch (e: Exception) {
                body.append("<div class=\"note\"><p>Couldn't search right now. Check the internet connection.</p>")
                    .append("<a class=\"btn\" href=\"${esc(urlFor(q))}\">Try again</a></div>")
            }
        }
        val html = PAGE.replace("{{title}}", esc(if (q.isEmpty()) "Search" else q)).replace("{{body}}", body.toString())
            .replaceFirst("<html lang=\"en\">", "<html lang=\"en\" data-theme=\"${if (Ui.dark) "dark" else "light"}\">")
            .replaceFirst("</head>", "<style>:root,:root[data-theme=\"dark\"]{--bg:${Ui.hex(Ui.PAGE)};--ink:${Ui.hex(Ui.INK)};" +
                "--muted:${Ui.hex(Ui.MUTED)};--tile:${Ui.hex(Ui.CARD)};--edge:${Ui.hex(Ui.LINE)};--accent:${Ui.hex(Ui.ACCENT)};" +
                "--accent-text:${Ui.hex(Ui.ACCENT_TEXT)};--soft:${Ui.hex(Ui.SOFT)}}" + SearchBar.CSS + "</style></head>")
        return WebResourceResponse("text/html", "utf-8", 200, "OK", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(html.toByteArray()))
    }

    private fun result(r: Discovery.Page, opens: Boolean, id: String?): String {
        val letter = esc(r.domain.take(1).uppercase())
        val icon = "https://www.google.com/s2/favicons?sz=64&domain=" + URLEncoder.encode(r.domain, "UTF-8")
        return "<article class=\"r\"${if (id != null) " id=\"$id\"" else ""}>" +
            "<div class=\"where\"><span class=\"fav\" data-l=\"$letter\"><img alt=\"\" loading=\"lazy\" src=\"${esc(icon)}\" onerror=\"this.parentNode.textContent=this.parentNode.dataset.l\"></span>" +
            "<span class=\"crumb\">${esc(breadcrumb(r.url))}</span></div>" +
            "<a class=\"t\" href=\"${esc(r.url)}\">${esc(r.title)}</a>" +
            (if (r.snippet.isNotBlank()) "<p class=\"s\">${esc(r.snippet)}</p>" else "") +
            "<span class=\"tag ${if (opens) "ok" else "ask"}\">${if (opens) "Opens on this phone" else "Ask to open this page"}</span></article>"
    }

    /** A numbered page link (or the ‹ / › arrows) for the search results foot. [known] is carried as n= so the page
     * numbers already found stay visible when you step back to an earlier page. */
    private fun pageLink(q: String, p: Int, known: Int, label: String, current: Boolean): String {
        val href = "/search/?q=${esc(URLEncoder.encode(q, "UTF-8"))}" + (if (p > 0) "&amp;p=$p" else "") + (if (known > 0) "&amp;n=$known" else "")
        return "<a class=\"pg${if (current) " on" else ""}\"${if (current) " aria-current=\"page\"" else ""} href=\"$href\">$label</a>"
    }

    /** A safety ceiling on how many result pages to page through (words-only results rarely approach this). */
    private const val MAX_PAGES = 25

    private val PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<style>
  @font-face { font-family: 'Figtree'; src: url('/home/fonts/Figtree.ttf') format('truetype'); font-weight: 300 900; font-display: swap; }
  :root { --bg: #F4F7FD; --ink: #121A3A; --muted: #5B6680; --tile: #FFFFFF; --edge: #E3E8F4; --accent: #3B5BFF; --accent-text: #3B5BFF; --soft: #E7ECFF; }
  :root[data-theme="dark"] { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.4 Figtree, system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
  main { max-width: 40rem; margin: 0 auto; padding: .9rem 1rem 3rem; display: flex; flex-direction: column; gap: .7rem; }
  /* The search box (.search) styles come from SearchBar.CSS, injected at serve time — the same box as the home page. */
  .pageline { text-align: center; color: var(--muted); font-size: .82rem; font-weight: 600; margin: .1rem 0 .3rem; }
  .pager { display: flex; justify-content: center; align-items: center; gap: .4rem; margin: .5rem 0 .2rem; flex-wrap: wrap; }
  .pager .pg { min-width: 40px; height: 40px; padding: 0 .55rem; border-radius: 11px; border: 1px solid var(--edge); background: var(--tile); color: var(--muted); font-weight: 600; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
  .pager .pg.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .r { background: var(--tile); border: 1px solid var(--edge); border-radius: 14px; padding: .75rem .9rem; display: flex; flex-direction: column; gap: .3rem; scroll-margin-top: .8rem; }
  .where { display: flex; align-items: center; gap: .5rem; min-width: 0; }
  .fav { flex: none; width: 22px; height: 22px; border-radius: 6px; background: var(--soft); color: var(--accent-text); display: grid; place-items: center; font-size: 12px; font-weight: 700; overflow: hidden; }
  .fav img { width: 18px; height: 18px; }
  .crumb { font-size: .8rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  a.t { color: var(--accent-text); font-size: 1.05rem; font-weight: 600; line-height: 1.3; text-decoration: none; overflow-wrap: anywhere; }
  a.t:active { text-decoration: underline; }
  .s { margin: 0; font-size: .88rem; line-height: 1.45; overflow-wrap: anywhere; }
  .tag { align-self: flex-start; font-size: .72rem; font-weight: 700; border-radius: 8px; padding: 2px 8px; }
  .tag.ok { background: var(--soft); color: var(--accent-text); }
  .tag.ask { background: var(--edge); color: var(--muted); }
  .more { align-self: center; color: var(--accent-text); font-weight: 700; min-height: 48px; display: flex; align-items: center; padding: 0 1rem; text-decoration: none; }
  .note { color: var(--muted); text-align: center; padding: 1.5rem .5rem; margin: 0; }
  .note p { margin: 0 0 1rem; }
  .btn { display: inline-flex; align-items: center; min-height: 46px; padding: 0 1.2rem; border-radius: 999px; background: var(--accent); color: #fff; font-weight: 700; text-decoration: none; }
</style>
</head>
<body><main>{{body}}</main></body>
</html>"""
}
