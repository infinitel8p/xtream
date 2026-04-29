import { providerFetch } from "@/scripts/lib/provider-fetch.js"
import { getDownloadDir, setDownloadDir } from "@/scripts/lib/app-settings.js"

const isTauri =
  typeof window !== "undefined" &&
  (!!window.__TAURI_INTERNALS__ || !!window.__TAURI__)

const STORAGE_KEY = "xt_downloads"
const EVT_PROGRESS = "xt:download-progress"
const EVT_LIST = "xt:downloads-changed"

const STALL_WINDOW_MS = 30_000
const STALL_CHECK_MS = 5_000

const MAX_CONCURRENT = 2

/** @type {string[]} ids waiting for an active slot */
const queuedIds = []

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeState(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {}
  document.dispatchEvent(new CustomEvent(EVT_LIST, { detail: list }))
}

function uuid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function listDownloads() {
  return readState()
}

export function isDownloadable() {
  return isTauri
}

export function sanitizeFilename(name) {
  return String(name || "download")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}

export function inferExt(url, fallback = "mp4") {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\.([a-z0-9]{2,5})$/i)
    if (m) return m[1].toLowerCase()
  } catch {}
  return fallback
}

const activeAborts = new Map()

async function pickDir() {
  const saved = getDownloadDir()
  if (saved) return saved
  const { open } = await import("@tauri-apps/plugin-dialog")
  const picked = await open({ directory: true, title: "Choose download folder" })
  if (!picked || typeof picked !== "string") return null
  setDownloadDir(picked)
  return picked
}

async function ensureDir(path) {
  const { mkdir, exists } = await import("@tauri-apps/plugin-fs")
  if (await exists(path)) return
  await mkdir(path, { recursive: true })
}

async function statSize(path) {
  try {
    const fs = await import("@tauri-apps/plugin-fs")
    if (!(await fs.exists(path))) return 0
    if (typeof fs.stat === "function") {
      const s = await fs.stat(path)
      return Number(s?.size || 0)
    }
    if (typeof fs.readFile === "function") {
      const buf = await fs.readFile(path)
      return buf?.byteLength || buf?.length || 0
    }
  } catch {}
  return 0
}

function joinPath(dir, name) {
  const sep = /\\/.test(dir) ? "\\" : "/"
  return dir.replace(/[\\/]$/, "") + sep + name
}

function updateItem(id, patch) {
  const list = readState()
  const idx = list.findIndex((d) => d.id === id)
  if (idx < 0) return
  list[idx] = { ...list[idx], ...patch }
  writeState(list)
  document.dispatchEvent(
    new CustomEvent(EVT_PROGRESS, { detail: list[idx] })
  )
}

function getItem(id) {
  return readState().find((d) => d.id === id) || null
}

async function runDownload(id) {
  const item = getItem(id)
  if (!item) return

  const controller = new AbortController()
  activeAborts.set(id, controller)

  let lastProgressAt = Date.now()
  let received = await statSize(item.path)
  let stallTimer = null

  const watchStall = () => {
    if (controller.signal.aborted) return
    if (Date.now() - lastProgressAt > STALL_WINDOW_MS) {
      controller.abort("stalled")
      return
    }
    stallTimer = setTimeout(watchStall, STALL_CHECK_MS)
  }
  stallTimer = setTimeout(watchStall, STALL_CHECK_MS)

  try {
    const fs = await import("@tauri-apps/plugin-fs")

    const headers = new Headers()
    if (received > 0) headers.set("Range", `bytes=${received}-`)

    updateItem(id, {
      status: "downloading",
      bytesDone: received,
      error: "",
    })

    const res = await providerFetch(item.url, {
      signal: controller.signal,
      headers,
    })

    // 416 = Range Not Satisfiable. If we already have everything, treat as done.
    if (res.status === 416 && received > 0) {
      updateItem(id, { status: "done", bytesDone: received, bytesTotal: received })
      return
    }
    if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    let total = 0
    if (res.status === 206) {
      const cr = res.headers.get("content-range") || ""
      const m = cr.match(/\/(\d+)\s*$/)
      if (m) total = Number(m[1])
      else total = received + Number(res.headers.get("content-length") || 0)
    } else {
      // Server didn't honor Range — restart from byte 0.
      if (received > 0) {
        await fs.writeFile(item.path, new Uint8Array(0))
        received = 0
      }
      total = Number(res.headers.get("content-length") || 0)
    }

    updateItem(id, { bytesTotal: total, bytesDone: received })

    const reader = res.body?.getReader()
    if (!reader) throw new Error("Response has no readable body.")

    let pendingFlushAt = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || !value.length) continue

      await fs.writeFile(item.path, value, { append: true })

      received += value.length
      lastProgressAt = Date.now()

      if (lastProgressAt - pendingFlushAt > 250) {
        pendingFlushAt = lastProgressAt
        updateItem(id, { bytesDone: received })
      }
    }

    updateItem(id, {
      status: "done",
      bytesDone: received,
      bytesTotal: total || received,
    })
  } catch (e) {
    const msg = String(e?.message || e || "Failed")
    const reason = controller.signal.reason
    if (reason === "stalled") {
      updateItem(id, {
        status: "stalled",
        bytesDone: received,
        error: "No data received for 30s. Tap Resume to retry.",
      })
    } else if (controller.signal.aborted) {
      updateItem(id, { status: "paused", bytesDone: received, error: "" })
    } else {
      updateItem(id, { status: "error", bytesDone: received, error: msg })
    }
  } finally {
    if (stallTimer) clearTimeout(stallTimer)
    activeAborts.delete(id)
    tryRunNext()
  }
}

function tryRunNext() {
  while (activeAborts.size < MAX_CONCURRENT && queuedIds.length > 0) {
    const nextId = queuedIds.shift()
    if (!nextId) continue
    const next = getItem(nextId)
    if (!next || next.status !== "queued") continue
    runDownload(nextId)
  }
}

export async function startDownload({ url, title, ext }) {
  if (!isTauri) {
    throw new Error("Downloads are only available in the desktop build.")
  }
  const dir = await pickDir()
  if (!dir) throw new Error("No download folder chosen.")
  await ensureDir(dir)

  const filename =
    sanitizeFilename(title || "download") + "." + (ext || inferExt(url))
  const fullPath = joinPath(dir, filename)

  const id = uuid()
  const willRun = activeAborts.size < MAX_CONCURRENT
  const item = {
    id,
    url,
    title: title || filename,
    path: fullPath,
    bytesDone: 0,
    bytesTotal: 0,
    status: willRun ? "downloading" : "queued",
    startedAt: Date.now(),
    error: "",
  }
  const list = readState()
  list.unshift(item)
  writeState(list)

  if (willRun) runDownload(id)
  else queuedIds.push(id)
  return id
}

export function resumeDownload(id) {
  if (!isTauri) return
  if (activeAborts.has(id)) return
  if (queuedIds.includes(id)) return
  const item = getItem(id)
  if (!item) return
  if (item.status === "done") return
  if (activeAborts.size < MAX_CONCURRENT) {
    runDownload(id)
  } else {
    updateItem(id, { status: "queued", error: "" })
    queuedIds.push(id)
  }
}

export function pauseDownload(id) {
  const ac = activeAborts.get(id)
  if (ac) {
    ac.abort("paused")
    return
  }

  const qIdx = queuedIds.indexOf(id)
  if (qIdx >= 0) {
    queuedIds.splice(qIdx, 1)
    updateItem(id, { status: "paused", error: "" })
  }
}

export function cancelDownload(id) {
  pauseDownload(id)
}

export function removeDownload(id) {
  const ac = activeAborts.get(id)
  if (ac) ac.abort("paused")
  const qIdx = queuedIds.indexOf(id)
  if (qIdx >= 0) queuedIds.splice(qIdx, 1)
  const list = readState().filter((d) => d.id !== id)
  writeState(list)

  tryRunNext()
}

export function clearFinishedDownloads() {
  const inFlight = new Set(["downloading", "queued"])
  const list = readState().filter((d) => inFlight.has(d.status))
  writeState(list)
}

export const DOWNLOADS_LIST_EVENT = EVT_LIST
export const DOWNLOAD_PROGRESS_EVENT = EVT_PROGRESS

;(() => {
  const list = readState()
  const wasInFlight = []
  const wasQueued = []
  let dirty = false
  for (const d of list) {
    if (d.status === "downloading") {
      d.status = "paused"
      d.error = ""
      wasInFlight.push(d.id)
      dirty = true
    } else if (d.status === "queued") {
      d.status = "paused"
      d.error = ""
      wasQueued.push(d.id)
      dirty = true
    }
  }
  if (dirty) writeState(list)
  for (const id of wasInFlight) resumeDownload(id)
  for (const id of wasQueued) resumeDownload(id)
})()
