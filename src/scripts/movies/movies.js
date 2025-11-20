// scripts/movies.js
import { Store } from "@tauri-apps/plugin-store"
import videojs from "video.js"

const isTauri =
    typeof window !== "undefined" && !!window.__TAURI__

/** @type {{host:string,port:string,user:string,pass:string}} */
let creds = { host: "", port: "", user: "", pass: "" }

let store = null
if (isTauri) {
    store = await Store.load(".xtream.creds.json")
}

const getCookie = (name) => {
    try {
        const match = document.cookie.match(
            new RegExp(
                "(?:^|; )" +
                name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") +
                "=([^;]*)"
            )
        )
        return match ? decodeURIComponent(match[1]) : ""
    } catch {
        return ""
    }
}

async function loadCreds() {
    if (isTauri && store) {
        return {
            host: (await store.get("host")) || "",
            port: (await store.get("port")) || "",
            user: (await store.get("user")) || "",
            pass: (await store.get("pass")) || "",
        }
    }
    return {
        host:
            localStorage.getItem("xt_host") ||
            getCookie("xt_host") ||
            "",
        port:
            localStorage.getItem("xt_port") ||
            getCookie("xt_port") ||
            "",
        user:
            localStorage.getItem("xt_user") ||
            getCookie("xt_user") ||
            "",
        pass:
            localStorage.getItem("xt_pass") ||
            getCookie("xt_pass") ||
            "",
    }
}

const fmtBase = (host, port) => {
    const base = /^https?:\/\//i.test(host) ? host : `http://${host}`
    return port && !/:\d+$/.test(base)
        ? `${base.replace(/\/+$/, "")}:${port}`
        : base.replace(/\/+$/, "")
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
// Utils
// ----------------------------
const normalize = (s) =>
    (s || "")
        .toString()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[|_\-()[\].,:/\\]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()

const debounce = (fn, ms = 180) => {
    let t
    return (...args) => {
        clearTimeout(t)
        t = setTimeout(() => fn(...args), ms)
    }
}

// ----------------------------
// UI refs
// ----------------------------
const listEl = document.getElementById("movie-list")
const spacer = document.getElementById("movie-spacer")
const viewport = document.getElementById("movie-viewport")
const listStatus = document.getElementById("movie-list-status")

const categoryListEl = document.getElementById("movie-category-list")
const categoryListStatus = document.getElementById(
    "movie-category-list-status"
)
const categorySearchEl =
    document.getElementById("movie-category-search")

const searchEl = document.getElementById("movie-search")
const clearSearchBtn =
    document.getElementById("movie-clear-search")

const currentEl = document.getElementById("movie-current")
const metaEl = document.getElementById("movie-meta")
const plotEl = document.getElementById("movie-plot")

const f = document.getElementById("xtream-login")
const saveBtn = document.getElementById("saveBtn")

// avoid spacer null errors if page not present
if (spacer) spacer.style.height = "0px"

// ----------------------------
// State
// ----------------------------
/** @type {Array<{id:number,name:string,category?:string,logo?:string|null,year?:string,rating?:string,duration?:string,plot?:string,norm:string}>} */
let all = []
let filtered = []

/** @type {Map<string,string> | null} */
let categoryMap = null

let activeCat = ""
try {
    activeCat = localStorage.getItem("xt_vod_active_cat") || ""
} catch { }

const hiddenCats = new Set()

// Virtual list config
const ROW_H = 70
const OVERSCAN = 8

let renderScheduled = false

// ----------------------------
// Category helpers
// ----------------------------
async function ensureVodCategoryMap() {
    if (categoryMap) return categoryMap
    const url = buildApiUrl("get_vod_categories")
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
            .map((c) => [
                String(c.category_id),
                String(c.category_name || "").trim(),
            ])
    )
    return categoryMap
}

function computeCategoryCounts(items) {
    const map = new Map()
    for (const m of items) {
        const k = (m.category || "").trim() || "Uncategorized"
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

    const frag = document.createDocumentFragment()

    const addRow = (val, label, count = null) => {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.setAttribute("role", "option")
        btn.dataset.val = val
        btn.className = [
            "w-full px-3 py-2 text-sm flex items-center justify-between",
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
            highlightActiveInList()
        })
        frag.appendChild(btn)
    }

    addRow("", "All categories")

    for (const name of names)
        addRow(name, name, counts.get(name))

    categoryListEl.innerHTML = ""
    categoryListEl.appendChild(frag)

    categoryListStatus.textContent = `${names.length.toLocaleString()} categories`

    function highlightActiveInList() {
        ;[
            ...categoryListEl.querySelectorAll('button[role="option"]'),
        ].forEach((el) => {
            const selected = (el.dataset.val || "") === activeCat
            el.classList.toggle("bg-white/10", selected)
        })
    }

    highlightActiveInList()
}

function filterCategories() {
    const qnorm = normalize(categorySearchEl.value || "")
    const tokens = qnorm.length ? qnorm.split(" ") : []

    const buttons = categoryListEl.querySelectorAll(
        'button[role="option"]'
    )
    let visibleCount = 0
    let totalCount = 0

    buttons.forEach((btn) => {
        const isAll = btn.dataset.val === ""
        if (!isAll) totalCount++

        const label = normalize(
            btn.dataset.val || btn.textContent || ""
        )
        const matches =
            !tokens.length || tokens.every((t) => label.includes(t))

        if (matches) {
            btn.style.display = ""
            if (!isAll) visibleCount++
        } else {
            btn.style.display = "none"
        }
    })

    categoryListStatus.textContent = `${visibleCount.toLocaleString()} of ${totalCount.toLocaleString()} categories`
}

if (categorySearchEl) {
    categorySearchEl.addEventListener(
        "input",
        debounce(filterCategories, 120)
    )
}

function setActiveCat(next) {
    activeCat = next || ""
    try {
        if (activeCat)
            localStorage.setItem("xt_vod_active_cat", activeCat)
        else localStorage.removeItem("xt_vod_active_cat")
    } catch { }
    applyFilter()
}

// ----------------------------
// Virtual list
// ----------------------------
function mountVirtualList(items) {
    if (!spacer || !viewport || !listEl) return
    filtered = items || []
    spacer.style.height = `${filtered.length * ROW_H}px`
    renderVirtual()
}

function renderVirtual() {
    if (!listEl || !viewport) return
    const scrollTop = listEl.scrollTop
    const height = listEl.clientHeight

    const startIdx = Math.max(
        0,
        Math.floor(scrollTop / ROW_H) - OVERSCAN
    )
    const endIdx = Math.min(
        filtered.length,
        Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN
    )

    viewport.innerHTML = ""
    viewport.style.transform =
        "translateY(" + startIdx * ROW_H + "px)"

    for (let i = startIdx; i < endIdx; i++) {
        const m = filtered[i]
        const row = document.createElement("button")
        row.type = "button"
        row.style.height = ROW_H + "px"
        row.className =
            "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-white/5"
        row.onclick = () => playMovie(m.id, m.name)
        row.title = m.name || ""

        // poster
        const poster = document.createElement("div")
        poster.className =
            "h-10 w-7 shrink-0 rounded-md bg-gray-200 dark:bg-gray-700 overflow-hidden ring-1 ring-inset ring-black/5 dark:ring-white/10"
        if (m.logo) {
            const img = document.createElement("img")
            img.src = m.logo
            img.loading = "lazy"
            img.referrerPolicy = "no-referrer"
            img.className = "h-full w-full object-cover"
            img.onerror = () => img.remove()
            poster.appendChild(img)
        }
        row.appendChild(poster)

        // texts
        const wrap = document.createElement("div")
        wrap.className = "min-w-0 flex-1"
        const nameEl = document.createElement("div")
        nameEl.className = "truncate text-sm font-medium"
        nameEl.textContent = m.name || "Movie " + m.id
        const metaEl = document.createElement("div")
        metaEl.className =
            "truncate text-[0.55rem] text-gray-500 dark:text-gray-400"
        const parts = []
        if (m.year) parts.push(m.year)
        if (m.duration) parts.push(m.duration)
        if (m.category) parts.push(m.category)
        metaEl.textContent = parts.join(" • ")
        wrap.appendChild(nameEl)
        wrap.appendChild(metaEl)
        row.appendChild(wrap)

        viewport.appendChild(row)
    }
}

if (listEl) {
    listEl.addEventListener("scroll", () => {
        if (!renderScheduled) {
            renderScheduled = true
            requestAnimationFrame(() => {
                renderScheduled = false
                renderVirtual()
            })
        }
    })
}

// ----------------------------
// Search
// ----------------------------
function applyFilter() {
    if (!listStatus) return
    const qnorm = normalize(searchEl?.value || "")
    const tokens = qnorm.length ? qnorm.split(" ") : []

    const out = all.filter((m) => {
        if (activeCat && (m.category || "") !== activeCat) return false

        const cat = (m.category || "").toString()
        if (cat && hiddenCats.has(cat)) return false

        if (!tokens.length) return true

        const hay = m.norm
        return tokens.every((t) => hay.includes(t))
    })

    listStatus.textContent = `${out.length.toLocaleString()} of ${all.length.toLocaleString()} movies`
    mountVirtualList(out)
}

if (searchEl) {
    searchEl.addEventListener(
        "input",
        debounce(() => {
            applyFilter()
            if (clearSearchBtn) {
                clearSearchBtn.classList.toggle(
                    "hidden",
                    !searchEl.value
                )
            }
        }, 160)
    )
}

if (clearSearchBtn && searchEl) {
    clearSearchBtn.addEventListener("click", () => {
        searchEl.value = ""
        clearSearchBtn.classList.add("hidden")
        applyFilter()
    })
}

// ----------------------------
// Load movies
// ----------------------------
async function loadMovies() {
    creds = await loadCreds()
    if (!listStatus) return
    listStatus.textContent = "Loading movies…"
    if (spacer) spacer.style.height = "0px"
    if (viewport) viewport.innerHTML = ""

    if (!creds.host || !creds.user || !creds.pass) {
        listStatus.textContent =
            "Enter Xtream credentials and click “Save”."
        return
    }

    try {
        const catMap = await ensureVodCategoryMap()
        const r = await fetch(buildApiUrl("get_vod_streams"))
        const body = await r.text()
        if (!r.ok) {
            console.error("Upstream error body:", body)
            throw new Error(`API ${r.status}: ${body}`)
        }
        const data = JSON.parse(body)
        const arr = Array.isArray(data)
            ? data
            : data?.movies || data?.results || []

        all = (arr || [])
            .map((m) => {
                const name = String(m.name || m.title || "")
                const id = Number(m.stream_id || m.id)
                const logo = m.stream_icon || m.cover || null
                const year =
                    String(m.year || m.releaseDate || "").trim() || ""
                const rating =
                    m.rating || m.rating_5based || m.vote_average || ""
                const duration =
                    m.duration || m.runtime || m.duration_secs || ""

                const categoryId =
                    (Array.isArray(m.category_ids) &&
                        m.category_ids.length &&
                        m.category_ids[0]) ||
                    m.category_id
                let category = String(m.category_name || "").trim()
                if (!category && categoryId != null && catMap?.size) {
                    const n = catMap.get(String(categoryId))
                    if (n) category = n
                }

                const catForNorm = category || ""
                return {
                    id,
                    name,
                    logo: logo || null,
                    year,
                    rating: rating ? String(rating) : "",
                    duration: duration ? String(duration) : "",
                    category,
                    plot: "", // filled on info load
                    norm: normalize(name + " " + catForNorm + " " + year),
                }
            })
            .filter((m) => m.id && m.name)
            .sort((a, b) =>
                a.name.localeCompare(b.name, "en", {
                    sensitivity: "base",
                })
            )

        listStatus.textContent = `${all.length.toLocaleString()} movies`
        renderCategoryPicker(all)
        applyFilter()
    } catch (e) {
        console.error(e)
        listStatus.innerHTML =
            "<p>Failed to load movies. Check your Xtream credentials.<br/><br/>We do not provide any content ourselves.</p>"
        mountVirtualList([])
    }
}

// ----------------------------
// Player + VOD info
// ----------------------------
let vjs = null

const ensurePlayer = () => {
    if (!vjs) {
        vjs = videojs("movie-player", {
            liveui: false,
            fluid: true,
            preload: "auto",
            autoplay: false,
            aspectRatio: "16:9",
            controlBar: {
                volumePanel: { inline: false },
                pictureInPictureToggle: true,
                playbackRateMenuButton: true,
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

function fmtDuration(minsOrStr) {
    if (!minsOrStr) return ""
    const s = String(minsOrStr)
    const m = parseInt(s, 10)
    if (!isFinite(m) || m <= 0) return s
    const h = Math.floor(m / 60)
    const mm = m % 60
    if (!h) return `${mm} min`
    return `${h}h ${mm.toString().padStart(2, "0")}m`
}

function chooseMime(url) {
    if (!url) return "video/mp4"
    const lower = url.split("?")[0].toLowerCase()
    if (lower.endsWith(".m3u8")) return "application/x-mpegURL"
    if (lower.endsWith(".mpd")) return "application/dash+xml"
    if (lower.endsWith(".webm")) return "video/webm"
    return "video/mp4"
}

async function playMovie(vodId, name) {
    const videoEl = document.getElementById("movie-player")
    if (!videoEl || !currentEl) return

    currentEl.innerHTML = `
    <div class="flex items-center gap-2 max-w-[calc(100%-4rem)]">
      <span class="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-[10px] font-bold text-white ring-1 ring-white/10">ON</span>
      <span class="truncate w-full">Movie ${vodId}: ${name}</span>
    </div>
  `

    videoEl.removeAttribute("hidden")
    const player = ensurePlayer()

    // Load movie info
    try {
        const infoUrl = buildApiUrl("get_vod_info", {
            vod_id: vodId,
        })
        const r = await fetch(infoUrl)
        if (!r.ok) throw new Error(await r.text())
        const data = await r.json()

        const movieData = data?.movie_data || data?.info || data || {}
        const info = data?.info || data?.movie_data || {}

        // try stream_url first, fallback to constructed one
        let src = ""
        if (movieData.stream_url) {
            const base = fmtBase(creds.host, creds.port)
            // if it's already absolute, use as-is
            if (/^https?:\/\//i.test(movieData.stream_url)) {
                src = movieData.stream_url
            } else {
                src =
                    base.replace(/\/+$/, "") +
                    "/" +
                    movieData.stream_url.replace(/^\/+/, "")
            }
        } else {
            // /movie/username/password/{id}.mp4
            src =
                fmtBase(creds.host, creds.port) +
                "/movie/" +
                encodeURIComponent(creds.user) +
                "/" +
                encodeURIComponent(creds.pass) +
                "/" +
                encodeURIComponent(vodId) +
                ".mp4"
        }

        const mime = chooseMime(src)
        player.src({ src, type: mime })
        player.play().catch(() => { })

        const year =
            movieData.releasedate ||
            movieData.year ||
            info.year ||
            ""
        const duration =
            movieData.duration ||
            info.duration ||
            movieData.duration_secs ||
            ""
        const rating =
            movieData.rating ||
            info.rating ||
            movieData.rating_5based ||
            ""
        const genre =
            movieData.genre || info.genre || movieData.category || ""
        const plot =
            movieData.plot ||
            movieData.description ||
            info.plot ||
            info.description ||
            ""

        const humanDur = fmtDuration(duration)

        if (metaEl) {
            const bits = []
            if (year) bits.push(year)
            if (humanDur) bits.push(humanDur)
            if (genre) bits.push(genre)
            if (rating)
                bits.push(`Rating: ${String(rating).slice(0, 4)}`)
            metaEl.textContent = bits.join(" • ")
        }

        if (plotEl) {
            plotEl.textContent = plot
                ? plot
                : "No description available for this movie."
        }
    } catch (e) {
        console.error(e)
        if (plotEl) {
            plotEl.textContent =
                "Failed to load movie info or stream URL."
        }
    }
}

// ----------------------------
// Boot + form hooks
// ----------------------------
if (saveBtn) {
    saveBtn.addEventListener("click", () => {
        loadMovies()
        const details = document.getElementById("login-details")
        if (details) details.removeAttribute("open")
    })
}

if (f) {
    f.addEventListener("submit", (e) => {
        e.preventDefault()
        e.stopImmediatePropagation()
    })
}

; (async () => {
    creds = await loadCreds()
    if (creds.host && creds.user && creds.pass) {
        loadMovies()
    }
})()
