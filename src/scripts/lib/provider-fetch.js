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
      .catch((e) => {
        console.error("[xt:net] plugin-http unavailable:", e)
        return null
      })
  }
  return tauriFetchPromise
}

async function nativeFetch(url, init, u) {
  try {
    const r = await fetch(url, init)
    console.log(`[xt:net] native ok ${r.status}`, u)
    // Capture CORS-related headers for diagnostic use
    const corsHeaders = {}
    for (const key of ["access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-methods", "access-control-allow-headers", "access-control-expose-headers"]) {
      const val = r.headers.get(key)
      if (val) corsHeaders[key] = val
    }
    if (Object.keys(corsHeaders).length) {
      Object.defineProperty(r, "_corsHeaders", { value: corsHeaders, writable: false, enumerable: false })
    }
    return r
  } catch (e) {
    if (!init?.signal?.aborted) {
      console.error("[xt:net] native fetch failed", { url: u, error: e })
    }
    throw e
  }
}

export async function providerFetch(url, init = {}) {
  const ua = getUserAgent()
  const u = String(url).slice(0, 200)

  if (!ua || !isTauri) {
    console.log(`[xt:net] native start`, u)
    return await nativeFetch(url, init, u)
  }

  const tauriFetch = await getTauriFetch()
  if (!tauriFetch) {
    console.log(`[xt:net] native start (no plugin-http)`, u)
    return await nativeFetch(url, init, u)
  }

  console.log(`[xt:net] tauri start ua=${ua}`, u)
  const headers = new Headers(init.headers || {})
  headers.set("User-Agent", ua)
  try {
    const r = await tauriFetch(url, { ...init, headers })
    console.log(`[xt:net] tauri ok ${r.status}`, u)
    return r
  } catch (e) {
    if (init?.signal?.aborted) throw e
    console.warn(
      "[xt:net] tauri fetch failed, falling back to native:",
      String(e?.message || e)
    )
    return await nativeFetch(url, init, u)
  }
}
