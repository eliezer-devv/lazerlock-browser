package com.lazerlock.browser

/**
 * The one search box, shared by the home page and the search results page. Both pages pull their search bar — its
 * look AND its markup — from here, so any change (the style, the placeholder text, the icon) lands in both at once.
 *
 *  - [CSS] is injected into each page's styles by [HomePage] and [SearchPage].
 *  - [form] is the markup; the home page gets it in place of its {{searchbar}} token, the results page appends it.
 */
object SearchBar {

    /** The placeholder text. Change it here and both pages update. */
    const val PLACEHOLDER = "Search"

    // The magnifier sits on the LEFT (muted, inside the box); the arrow is the submit button on the RIGHT.
    private const val MAGNIFIER =
        "<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" aria-hidden=\"true\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-4-4\"/></svg>"
    private const val ARROW =
        "<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M5 12h14M13 6l6 6-6 6\"/></svg>"

    private fun esc(s: String) =
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")

    /** The search box markup. [value] prefills the field; [autofocus] drops the cursor in it. */
    fun form(value: String = "", autofocus: Boolean = false): String =
        "<form class=\"search\" id=\"search\" action=\"/search/\" method=\"get\" role=\"search\">" +
            MAGNIFIER +
            "<input type=\"search\" name=\"q\" value=\"${esc(value)}\" placeholder=\"$PLACEHOLDER\" aria-label=\"Search\" autocomplete=\"off\" enterkeyhint=\"search\"" +
            (if (autofocus) " autofocus" else "") + ">" +
            "<button class=\"go\" type=\"submit\" aria-label=\"Search\">$ARROW</button></form>"

    /** The one set of styles for the box (the "spotlight" look). Uses the page's palette tokens, so it follows the theme. */
    val CSS = """
  .search { display: flex; align-items: center; gap: .6rem; min-height: 58px; border-radius: 18px; background: var(--tile);
    border: 1.5px solid var(--edge); padding: 0 .5rem 0 .95rem; margin: 0; box-shadow: 0 8px 20px -10px rgba(16, 28, 29, .28);
    transition: border-color .15s, box-shadow .15s; }
  .search > svg { flex: none; color: var(--muted); }
  .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: 16px Figtree, system-ui, sans-serif; min-height: 48px; }
  .search input::placeholder { color: var(--muted); }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 10px 24px -10px color-mix(in srgb, var(--accent) 45%, transparent); }
  .search .go { flex: none; width: 44px; height: 44px; border-radius: 13px; border: 0; color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
    background: var(--accent);
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 82%, white), var(--accent));
    box-shadow: 0 6px 14px -6px color-mix(in srgb, var(--accent) 65%, transparent); }
  .search .go:active { filter: brightness(.95); }
  .search .go svg { color: #fff; }
"""
}
