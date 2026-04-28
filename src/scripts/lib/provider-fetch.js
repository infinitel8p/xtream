import { getUserAgent } from "@/scripts/lib/app-settings.js"

const isTauri =
  typeof window !== "undefined" &&
  (!!window.__TAURI_INTERNALS__ || !!window.__TAURI__)

let tauriFetchPromise = null
async function getTauriFetch() {
  if (!isTauri) return null
  if (!tauriFetchPromise) {
    tauriFetchPromise = import("@tauri-apps/plugin-http")
      .then((m) => m.fetch)
      .catch(() => null)
  }
  return tauriFetchPromise
}

export async function providerFetch(url, init = {}) {
  const ua = getUserAgent()
  const tauriFetch = await getTauriFetch()
  if (tauriFetch) {
    const headers = new Headers(init.headers || {})
    if (ua) headers.set("User-Agent", ua)
    return tauriFetch(url, { ...init, headers })
  }
  return fetch(url, init)
}
