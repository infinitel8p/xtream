const MORPH_NAME = "active-poster"

function prefersReducedMotion() {
    try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    } catch {
        return false
    }
}

function findPoster(card) {
    if (!card) return null
    return card.querySelector("img") || card.querySelector(".poster-fallback") || card
}

function setAmbient(ambientEl, url) {
    if (!ambientEl) return
    if (url) {
        const safe = String(url).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        ambientEl.style.backgroundImage = `url("${safe}")`
        ambientEl.setAttribute("data-ready", "true")
    } else {
        ambientEl.removeAttribute("data-ready")
        ambientEl.style.backgroundImage = ""
    }
}

export function clearAmbient(ambientEl) {
    setAmbient(ambientEl, null)
}

/**
 * Run the poster→hero morph and open the dialog.
 *
 * @param {object} opts
 * @param {HTMLElement|null} opts.fromCard      - The clicked card / poster source.
 * @param {HTMLElement|null} opts.toHero        - The dialog hero element (#movie-detail-poster, #series-detail-poster).
 * @param {HTMLElement|null} opts.ambient       - The [data-modal-ambient] underlay inside the dialog.
 * @param {string|null}      opts.posterUrl     - URL used for the ambient background.
 * @param {() => void|Promise<void>} opts.openDialog - Callback that performs the actual dialog open + DOM mutation.
 */
export function morphIntoDetail({ fromCard, toHero, ambient, posterUrl, openDialog }) {
    setAmbient(ambient, posterUrl)

    const fromEl = findPoster(fromCard)
    const canMorph =
        typeof document.startViewTransition === "function" &&
        !prefersReducedMotion() &&
        fromEl &&
        toHero

    if (!canMorph) {
        openDialog()
        return
    }

    fromEl.style.viewTransitionName = MORPH_NAME

    const cleanup = () => {
        try { fromEl.style.viewTransitionName = "" } catch {}
        try { toHero.style.viewTransitionName = "" } catch {}
    }

    try {
        const t = document.startViewTransition(async () => {
            await openDialog()
            fromEl.style.viewTransitionName = ""
            toHero.style.viewTransitionName = MORPH_NAME
        })
        t.finished.finally(cleanup)
    } catch (e) {
        cleanup()
        openDialog()
    }
}
