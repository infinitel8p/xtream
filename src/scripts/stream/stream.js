// scripts/stream.js
import { Store } from "@tauri-apps/plugin-store"
import videojs from "video.js"

const isTauri = typeof window !== "undefined" && !!window.__TAURI__

// Single in-memory source of truth for credentials
/** @type {{host:string,port:string,user:string,pass:string}} */
let creds = { host: "", port: "", user: "", pass: "" }

/** Tauri store instance (only when running under Tauri). */
let store = null
if (isTauri) {
  // You can change the filename; it lives in the app data dir.
  store = await Store.load(".xtream.creds.json")
}

const getCookie = (name) => {
  try {
    const match = document.cookie.match(
      new RegExp(
        "(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"
      )
    )
    return match ? decodeURIComponent(match[1]) : ""
  } catch {
    return ""
  }
}

// ----------------------------
// Creds & URL builders
// ----------------------------
async function loadCreds() {
  if (isTauri && store) {
    return {
      host: (await store.get("host")) || "",
      port: (await store.get("port")) || "",
      user: (await store.get("user")) || "",
      pass: (await store.get("pass")) || "",
    }
  }
  // Web fallback
  return {
    host: localStorage.getItem("xt_host") || getCookie("xt_host") || "",
    port: localStorage.getItem("xt_port") || getCookie("xt_port") || "",
    user: localStorage.getItem("xt_user") || getCookie("xt_user") || "",
    pass: localStorage.getItem("xt_pass") || getCookie("xt_pass") || "",
  }
}

const fmtBase = (host, port) => {
  const base = /^https?:\/\//i.test(host) ? host : `http://${host}`
  return port && !/:\d+$/.test(base)
    ? `${base.replace(/\/+$/, "")}:${port}`
    : base.replace(/\/+$/, "")
}

function buildDirectM3U8(id) {
  const { host, port, user, pass } = creds
  return (
    fmtBase(host, port) +
    "/live/" +
    encodeURIComponent(user) +
    "/" +
    encodeURIComponent(pass) +
    "/" +
    encodeURIComponent(id) +
    ".m3u8"
  )
}
const safeHttpUrl = (u) => {
  try {
    const x = new URL(u, location.href)
    return /^https?:$/.test(x.protocol) ? x.href : ""
  } catch {
    return ""
  }
}

function buildApiUrl(action, params = {}) {
  const { host, port, user, pass } = creds
  const baseHost = /^https?:\/\//i.test(host) ? host : `http://${host}`
  const url = new URL(
    "/player_api.php",
    baseHost.replace(/\/+$/, "") +
      (port && !/:\d+$/.test(baseHost) ? `:${port}` : "")
  )
  url.search = new URLSearchParams({
    username: user,
    password: pass,
    action,
    ...params,
  }).toString()
  return url.toString()
}

// ----------------------------
// M3U support
// ----------------------------
let directUrlById = new Map() // id -> direct HLS/stream URL
let usingM3U = false

function isLikelyM3USource(host, user, pass) {
  // Treat as M3U when host is an absolute http(s) URL ending with .m3u/.m3u8
  // and no Xtream credentials are supplied.
  try {
    const url = new URL(host)
    const ext = (url.pathname || "").toLowerCase()
    const isM3U = ext.endsWith(".m3u") || ext.endsWith(".m3u8")
    return /^https?:$/.test(url.protocol) && isM3U && !user && !pass
  } catch {
    return false
  }
}

// tiny EXTINF parser (enough for iptv-org style)
function parseM3U(text) {
  /** @type {Array<{ id:number, name:string, category?:string, logo?:string|null, url:string }>} */
  const out = []
  const lines = text.split(/\r?\n/)
  let pending = null

  const readAttr = (s, key) =>
    s.match(new RegExp(`${key}="([^"]*)"`, "i"))?.[1] || ""

  let idSeq = 1
  for (const line of lines) {
    if (line.startsWith("#EXTINF")) {
      const name = line.split(",").pop()?.trim() || `Channel ${idSeq}`
      const logo = readAttr(line, "tvg-logo")
      const group = readAttr(line, "group-title") || "Uncategorized"
      pending = { name, logo, category: group }
    } else if (pending && line && !line.startsWith("#")) {
      const url = safeHttpUrl(line.trim())
      if (url) {
        out.push({
          id: idSeq++,
          name: pending.name,
          category: pending.category,
          logo: pending.logo || null,
          norm: normalize(`${pending.name} ${pending.category}`),
          url,
        })
      }
      pending = null
    }
  }
  return out
}

function resetDirectMap() {
  directUrlById = new Map()
}

function indexDirectUrls(items) {
  resetDirectMap()
  for (const ch of items) {
    if (ch.url) directUrlById.set(ch.id, ch.url)
  }
}

function hasDirectUrl(id) {
  return directUrlById.has(id)
}

function getDirectUrl(id) {
  return directUrlById.get(id) || ""
}

// ----------------------------
// UI refs
// ----------------------------
const listEl = document.getElementById("list")
const viewport = document.getElementById("viewport")
const listStatus = document.getElementById("list-status")

// Custom category dropdown bits
const categoryListEl = document.getElementById("category-list")
const categoryListStatus = document.getElementById("category-list-status")
const categorySearchEl = document.getElementById("category-search");


let activeCat = ""
try {
  activeCat = localStorage.getItem("xt_active_cat") || ""
} catch {}

const searchEl = document.getElementById("search")
const currentEl = document.getElementById("current")
const f = document.getElementById("xtream-login")
const saveBtn = document.getElementById("saveBtn")
const epgList = document.getElementById("epg-list")
const $ = (id) => document.getElementById(id)

;["host", "port", "user", "pass"].forEach((id) => {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault()
  })
})

saveBtn.addEventListener("click", () => {
  loadChannels()
  const details = document.getElementById("login-details")
  if (details) details.removeAttribute("open")
})

// ----------------------------
// Channels + Virtualization
// ----------------------------
/** @type {Array<{ id: number, name: string, category?: string, logo?: string | null }>} */
let all = []
let filtered = []

/** @type {Map<string,string> | null} */
let categoryMap = null

const hiddenCats = new Set()

function mountList(items) {
  filtered = items || []

  viewport.innerHTML = ""

  for (const ch of filtered) {
    const row = document.createElement("button")
    row.type = "button"
    row.className =
      "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-white/5"
    row.onclick = () => play(ch.id, ch.name)
    row.title = ch.name || ""

    const logo = document.createElement("div")
    logo.className =
      "h-7 w-7 shrink-0 rounded-md bg-gray-200 dark:bg-gray-700 overflow-hidden ring-1 ring-inset ring-black/5 dark:ring-white/10"
    if (ch.logo) {
      const img = document.createElement("img")
      img.src = safeHttpUrl(ch.logo)
      img.loading = "lazy"
      img.referrerPolicy = "no-referrer"
      img.className = "h-full w-full object-contain"
      img.onerror = () => img.remove()
      logo.appendChild(img)
    }
    row.appendChild(logo)

    const wrap = document.createElement("div")
    wrap.className = "min-w-0 flex-1"
    wrap.innerHTML = `
      <div class="truncate text-sm font-medium">${ch.name}</div>
      <div class="truncate text-[0.55rem] text-gray-500 dark:text-gray-400">
        #${ch.id} - ${ch.category ?? ""}
      </div>
    `
    row.appendChild(wrap)

    viewport.appendChild(row)
  }
}

const debounce = (fn, ms = 180) => {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
const normalize = (s) =>
  (s || "")
    .toString()
    .normalize("NFKD") // split accents
    .replace(/[\u0300-\u036f]/g, "") // remove accent marks
    .toLowerCase()
    .replace(/[|_\-()[\].,:/\\]+/g, " ") // treat separators as spaces
    .replace(/\s+/g, " ") // collapse spaces
    .trim()

const applyFilter = () => {
  const qnorm = normalize(searchEl.value || "")
  const tokens = qnorm.length ? qnorm.split(" ") : []

  const out = all.filter((ch) => {
    if (activeCat && (ch.category || "") !== activeCat) return false
    // hide by category chip
    const cat = (ch.category || "").toString()
    if (cat && hiddenCats.has(cat)) return false

    if (!tokens.length) return true // no query = everything visible

    // every token must be present somewhere in name/category
    const hay = ch.norm // precomputed normalized string
    return tokens.every((t) => hay.includes(t))
  })

  listStatus.textContent = `${out.length.toLocaleString()} of ${all.length.toLocaleString()} channels`
  mountList(out)
}

searchEl.addEventListener("input", debounce(applyFilter, 160))

async function ensureCategoryMap() {
  if (categoryMap) return categoryMap
  const url = buildApiUrl("get_live_categories")
  const r = await fetch(url)
  const data = await r.json().catch(() => [])

  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data?.categories)
    ? data.categories
    : []
  categoryMap = new Map(
    arr
      .filter((c) => c && c.category_id != null)
      .map((c) => [String(c.category_id), String(c.category_name || "").trim()])
  )
  return categoryMap
}

function computeCategoryCounts(items) {
  const map = new Map()
  for (const ch of items) {
    const k = (ch.category || "").trim() || "Uncategorized"
    map.set(k, (map.get(k) || 0) + 1)
  }
  return map
}

function renderCategoryPicker(items) {
  if (!categoryListEl) return
  const counts = computeCategoryCounts(items)
  const names = Array.from(counts.keys()).sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  )

  // Build items
  const frag = document.createDocumentFragment()

  // "All" option
  const addRow = (val, label, count = null) => {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.setAttribute("role", "option")
    btn.dataset.val = val
    btn.className = [
      "w-full py-2 px-2 text-sm flex items-center justify-between",
      "hover:bg-white/10 focus:bg-white/10 outline-none",
      "text-white",
    ].join(" ")
    const left = document.createElement("span")
    left.className = "truncate"
    left.textContent = label
    const right = document.createElement("span")
    right.className = "ml-3 shrink-0 text-xs text-gray-400"
    right.textContent = count != null ? String(count) : ""
    btn.appendChild(left)
    btn.appendChild(right)
    btn.addEventListener("click", () => {
      setActiveCat(val)
      closeCatPopover()
      // reflect selection visually
      highlightActiveInList()
    })
    frag.appendChild(btn)
  }

  addRow("", "All categories")

  for (const name of names) addRow(name, name, counts.get(name))

  categoryListEl.innerHTML = ""
  categoryListStatus.textContent = `${names.length.toLocaleString()} categories`
  categoryListEl.appendChild(frag)

  // set/restore current label
  setActiveCat(activeCat)

  // local highlight
  function highlightActiveInList() {
    ;[...categoryListEl.querySelectorAll('button[role="option"]')].forEach((el) => {
      const selected = (el.dataset.val || "") === activeCat
      el.classList.toggle("bg-white/10", selected)
    })
  }
  highlightActiveInList()
}

function filterCategories() {
  const qnorm = normalize(categorySearchEl.value || "");
  const tokens = qnorm.length ? qnorm.split(" ") : [];

  const buttons = categoryListEl.querySelectorAll('button[role="option"]');
  let visibleCount = 0;
  let totalCount = 0;

  buttons.forEach(btn => {
    const isAllButton = btn.dataset.val === "";
    if (!isAllButton) totalCount++; // Count real categories (skip "All categories")

    const label = normalize(btn.dataset.val || btn.textContent || "");
    const matches =
      !tokens.length || tokens.every(t => label.includes(t));

    if (matches) {
      btn.style.display = "";
      if (!isAllButton) visibleCount++;
    } else {
      btn.style.display = "none";
    }
  });

  // Update status
  categoryListStatus.textContent =
    `${visibleCount.toLocaleString()} of ${totalCount.toLocaleString()} categories`;
}
categorySearchEl.addEventListener("input", debounce(filterCategories, 120));

function setActiveCat(next) {
  activeCat = next || ""
  try {
    if (activeCat) localStorage.setItem("xt_active_cat", activeCat)
    else localStorage.removeItem("xt_active_cat")
  } catch {}
  applyFilter()
}

async function loadChannels() {
  console.log("Loading channels...");
  creds = await loadCreds()
  categoryListStatus.textContent = "Loading categories…"
  listStatus.textContent = "Loading channels…"
  viewport.innerHTML = ""
  usingM3U = isLikelyM3USource(creds.host, creds.user, creds.pass)

  try {
    if (usingM3U) {
      console.log("Detected M3U source, loading as M3U...")
      // --- M3U MODE ---
      const r = await fetch(creds.host)
      if (!r.ok) throw new Error(`M3U ${r.status}: ${await r.text()}`)
      const text = await r.text()
      const items = parseM3U(text)

      all = items
        .filter((x) => x.url && x.name)
        .sort((a, b) =>
          a.name.localeCompare(b.name, "en", { sensitivity: "base" })
        )

      indexDirectUrls(all) // enable direct playback
      categoryMap = null // not used in M3U mode

      listStatus.textContent = `${all.length.toLocaleString()} channels (M3U)`
      renderCategoryPicker(all)
      mountList(all)
      return
    }

    // --- XTREAM MODE (original path) ---
    console.log("Detected Xtream source, loading as Xtream...");
    const catMap = await ensureCategoryMap()
    const r = await fetch(buildApiUrl("get_live_streams"))
    const body = await r.text()
    if (!r.ok) {
      console.error("Upstream error body:", body)
      throw new Error(`API ${r.status}: ${body}`)
    }
    const data = JSON.parse(body)
    const arr = Array.isArray(data)
      ? data
      : data?.streams || data?.results || []
    all = (arr || [])
      .map((ch) => {
        const name = String(ch.name || "")
        const ids =
          (Array.isArray(ch.category_ids) &&
            ch.category_ids.length &&
            ch.category_ids) ||
          (ch.category_id != null ? [ch.category_id] : [])
        let category = String(ch.category_name || "").trim()
        if (!category && ids.length && catMap && catMap.size) {
          for (const id of ids) {
            const n = catMap.get(String(id))
            if (n) {
              category = n
              break
            }
          }
        }
        return {
          id: Number(ch.stream_id),
          name,
          category,
          logo: ch.stream_icon || null,
          norm: normalize(name + " " + category),
        }
      })
      .filter((x) => x.id && x.name)
      .sort((a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" })
      )

    resetDirectMap() // ensure we're not in direct-url mode
    listStatus.textContent = `${all.length.toLocaleString()} channels`
    console.log("Loaded channels:", all.length);
    renderCategoryPicker(all)
    mountList(all)
  } catch (e) {
    console.error(e)
    listStatus.innerHTML =
      "<p>Failed to load channels. Make sure you entered a valid Xtream service <em>or</em> an accessible M3U/M3U8 URL in the Host field.<br/><br/>We do not provide any streams or content ourselves.</p>"
    mountList([]) // clears list
  }
}

// ----------------------------
// Player (lazy Video.js init)
// ----------------------------
let vjs = null
const ensurePlayer = () => {
  if (!vjs) {
    vjs = videojs("player", {
      liveui: true,
      fluid: true,
      preload: "auto",
      autoplay: false,
      aspectRatio: "16:9",
      controlBar: {
        volumePanel: { inline: false },
        pictureInPictureToggle: true,
        playbackRateMenuButton: false, // IPTV usually live
        fullscreenToggle: true,
      },
      html5: {
        vhs: {
          overrideNative: true,
          limitRenditionByPlayerDimensions: true,
          smoothQualityChange: true,
        },
      },
    })
  }
  return vjs
}

function play(streamId, name) {
  const src = hasDirectUrl(streamId)
    ? getDirectUrl(streamId)
    : buildDirectM3U8(streamId)

  currentEl.innerHTML = `
    <div class="flex items-center gap-2 max-w-[calc(100%-4rem)]">
      <span class="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-[10px] font-bold text-white ring-1 ring-white/10">ON</span>
      <span class="truncate w-full">Channel ${streamId}: ${name}</span>
    </div>`

  const videoEl = document.getElementById("player")
  videoEl.removeAttribute("hidden")
  const player = ensurePlayer()

  player.src({ src, type: "application/x-mpegURL" })
  player.play().catch(() => {})

  // EPG is only available via Xtream
  if (hasDirectUrl(streamId)) {
    epgList.innerHTML = `<div class="text-gray-500">No EPG available for M3U source.</div>`
  } else {
    loadEPG(streamId)
  }

  // ensure only one PiP button
  const oldBtn = document.getElementById("pip-btn")
  if (oldBtn) oldBtn.remove()

  const btn = document.createElement("button")
  btn.id = "pip-btn"
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class=""><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M19 4a3 3 0 0 1 3 3v4a1 1 0 0 1 -2 0v-4a1 1 0 0 0 -1 -1h-14a 1 1 0 0 0 -1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 1 0 2h-6a3 3 0 0 1 -3 -3v-10a3 3 0 0 1 3 -3z" /><path d="M20 13a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-5a2 2 0 0 1 -2 -2v-3a2 2 0 0 1 2 -2z" /></svg>`
  btn.className =
    "h-9 px-3 rounded-xl border border-white/10 bg-white/5 text-sm"
  document.getElementById("current").appendChild(btn)
  btn.addEventListener("click", async () => {
    if (window.AndroidPip?.toggle) {
      player.requestFullscreen()
      window.AndroidPip.toggle()
      return
    }
    const el = player.el().querySelector("video")
    if (document.pictureInPictureEnabled && !el.disablePictureInPicture) {
      try {
        if (document.pictureInPictureElement === el)
          await document.exitPictureInPicture()
        else {
          if (el.readyState < 2) await el.play().catch(() => {})
          await el.requestPictureInPicture()
        }
      } catch {}
    }
  })
}

// ----------------------------
// EPG (auto base64 decode if needed)
// ----------------------------
const textDecoder = new TextDecoder("utf-8")

// Heuristic: looks like base64 and decodes safely => treat as base64
function maybeB64ToUtf8(str) {
  if (!str || typeof str !== "string") return str || ""
  const looksB64 =
    /^[A-Za-z0-9+/=\s]+$/.test(str) && str.replace(/\s+/g, "").length % 4 === 0
  if (!looksB64) return str

  try {
    const bin = atob(str.replace(/\s+/g, ""))
    // convert binary string to Uint8Array
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const utf8 = textDecoder.decode(bytes)
    if (utf8.replace(/\s/g, "").length === 0) return str
    return utf8
  } catch {
    return str
  }
}

const fmtTime = (ts) => {
  const n = Number(ts)
  if (!Number.isFinite(n)) return ""
  try {
    return new Date(n * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

async function loadEPG(streamId) {
  const { host, port, user, pass } = creds
  const url = `${fmtBase(
    host,
    port
  )}/player_api.php?username=${encodeURIComponent(
    user
  )}&password=${encodeURIComponent(
    pass
  )}&action=get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=10`

  epgList.innerHTML = `<div class="text-gray-500">Loading EPG…</div>`
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(await r.text())
    const data = await r.json()

    // Xtream variations: sometimes items live in epg_listings; sometimes root array
    const items = Array.isArray(data?.epg_listings)
      ? data.epg_listings
      : Array.isArray(data)
      ? data
      : []
    if (!items.length) {
      epgList.innerHTML = `<div class="text-gray-500">No EPG available.</div>`
      return
    }

    epgList.innerHTML = items
      .map((it) => {
        const start = fmtTime(it.start_timestamp || it.start)
        const end = fmtTime(it.stop_timestamp || it.end)

        // decode any base64-ish fields
        const titleRaw = it.title || it.title_raw || ""
        const descRaw = it.description || it.description_raw || ""

        const title = maybeB64ToUtf8(titleRaw)
        const desc = maybeB64ToUtf8(descRaw)

        return `
					<div class="rounded-lg p-2 bg-gray-900/50">
						<div class="flex items-center justify-between">
							<div class="font-medium">${title}</div>
							<div class="text-xs text-gray-500">${start}–${end}</div>
						</div>
						${
              desc
                ? `<div class="mt-1 text-xs text-gray-400 line-clamp-3">${desc}</div>`
                : ""
            }
					</div>
					`
      })
      .join("")
  } catch (e) {
    console.error(e)
    epgList.innerHTML = `<div class="text-red-600">Failed to load EPG.</div>`
  }
}

// ----------------------------
// Boot: auto-load if creds present
// ----------------------------
if (creds.host && creds.user && creds.pass) loadChannels()

// Prevent form submit reloads
f.addEventListener("submit", (e) => {
  e.preventDefault()
  e.stopImmediatePropagation()
})
