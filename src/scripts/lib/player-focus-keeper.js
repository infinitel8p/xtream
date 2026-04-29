export function attachPlayerFocusKeeper(vjs) {
    if (!vjs) return () => {}
    const playerEl = vjs.el()
    let pulse = 0

    const stopPulse = () => {
        if (pulse) {
            clearInterval(pulse)
            pulse = 0
        }
    }
    const onFocusIn = () => {
        vjs.userActive(true)
        window.SpatialNavigation?.makeFocusable?.()
        stopPulse()
        pulse = window.setInterval(() => vjs.userActive(true), 1500)
    }
    const onFocusOut = (e) => {
        if (!playerEl.contains(/** @type {Node|null} */ (e.relatedTarget))) {
            stopPulse()
        }
    }
    const onFullscreenChange = () => {
        window.SpatialNavigation?.makeFocusable?.()
        vjs.userActive(true)
    }

    playerEl.addEventListener("focusin", onFocusIn)
    playerEl.addEventListener("focusout", onFocusOut)
    vjs.on("fullscreenchange", onFullscreenChange)

    return () => {
        stopPulse()
        playerEl.removeEventListener("focusin", onFocusIn)
        playerEl.removeEventListener("focusout", onFocusOut)
        try { vjs.off("fullscreenchange", onFullscreenChange) } catch {}
    }
}
