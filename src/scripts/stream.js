// scripts/stream.js
import { Store } from '@tauri-apps/plugin-store'

const isTauri = typeof window !== 'undefined' && !!window.__TAURI__

// Single in-memory source of truth for credentials
/** @type {{host:string,port:string,user:string,pass:string}} */
let creds = { host: '', port: '', user: '', pass: '' }

/** Tauri store instance (only when running under Tauri). */
let store = null
if (isTauri) {
	// You can change the filename; it lives in the app data dir.
	store = await Store.load('.xtream.creds.json')
}

let httpFetch
// try {
//   ({ fetch: httpFetch } = await import('@tauri-apps/plugin-http'))
// } catch {}

async function xfetch(url, opts = {}) {
	if (httpFetch) {
		const r = await httpFetch(url, {
			method: opts.method ?? 'GET',
			responseType: 1, // Text
		})
		return new Response(r.data, { status: r.status, headers: r.headers })
	}
	return fetch(url, opts) // desktop/web fallback
}

// ----------------------------
// Cookie helpers
// ----------------------------
const setCookie = (name, value, days = 365) => {
	try {
		const d = new Date()
		d.setTime(d.getTime() + days * 864e5)
		document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/`
	} catch { }
}
const getCookie = (name) => {
	try {
		const m = document.cookie.match(
			new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')
    )
	return m ? decodeURIComponent(m[1]) : ''
	} catch {
		return ''
	}
}

// ----------------------------
// Creds & URL builders
// ----------------------------
async function loadCreds() {
	if (isTauri && store) {
		return {
			host: (await store.get('host')) || '',
			port: (await store.get('port')) || '',
			user: (await store.get('user')) || '',
			pass: (await store.get('pass')) || '',
		}
	}
	// Web fallback
	return {
		host: localStorage.getItem('xt_host') || getCookie('xt_host') || '',
		port: localStorage.getItem('xt_port') || getCookie('xt_port') || '',
		user: localStorage.getItem('xt_user') || getCookie('xt_user') || '',
		pass: localStorage.getItem('xt_pass') || getCookie('xt_pass') || '',
	}
}

async function saveCreds(next) {
	creds = { ...creds, ...next }
	categoryMap = null
	if (isTauri && store) {
		await store.set('host', creds.host || '')
		await store.set('port', creds.port || '')
		await store.set('user', creds.user || '')
		await store.set('pass', creds.pass || '')
		await store.save()
	}
	try {
		setCookie('xt_host', creds.host || '')
		setCookie('xt_port', creds.port || '')
		setCookie('xt_user', creds.user || '')
		setCookie('xt_pass', creds.pass || '')
		localStorage.setItem('xt_host', creds.host || '')
		localStorage.setItem('xt_port', creds.port || '')
		localStorage.setItem('xt_user', creds.user || '')
		localStorage.setItem('xt_pass', creds.pass || '')
	} catch { }
}

const fmtBase = (host, port) => {
	const base = /^https?:\/\//i.test(host) ? host : `http://${host}`
	return port && !/:\d+$/.test(base)
		? `${base.replace(/\/+$/, '')}:${port}`
		: base.replace(/\/+$/, '')
}
function buildDirectM3U8(id) {
	const { host, port, user, pass } = creds
	return (
		fmtBase(host, port) +
		'/live/' +
		encodeURIComponent(user) +
		'/' +
		encodeURIComponent(pass) +
		'/' +
		encodeURIComponent(id) +
		'.m3u8'
	)
}
const safeHttpUrl = (u) => {
	try {
		const x = new URL(u, location.href)
		return /^https?:$/.test(x.protocol) ? x.href : ''
	} catch {
		return ''
	}
}

function buildApiUrl(action, params = {}) {
	const { host, port, user, pass } = creds
	const baseHost = /^https?:\/\//i.test(host) ? host : `http://${host}`
	const url = new URL(
		'/player_api.php',
		baseHost.replace(/\/+$/, '') + (port && !/:\d+$/.test(baseHost) ? `:${port}` : '')
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
// UI refs
// ----------------------------
const listEl = document.getElementById('list')
const spacer = document.getElementById('spacer')
const viewport = document.getElementById('viewport')
const listStatus = document.getElementById('list-status')

// Custom category dropdown bits
const catTrigger = document.getElementById('cat-trigger')
const catTriggerLabel = document.getElementById('cat-trigger-label')
const catTriggerIcon = document.getElementById('cat-trigger-icon')
const catPopover = document.getElementById('cat-popover')
const catListEl = document.getElementById('cat-list')
const clearCatBtn = document.getElementById('clear-cat')

let activeCat = ''
try {
	activeCat = localStorage.getItem('xt_active_cat') || ''
} catch { }

// initial disabled until categories load
catTrigger?.classList.add('opacity-60', 'cursor-wait')
clearCatBtn?.classList.add('opacity-60', 'cursor-not-allowed')
clearCatBtn?.setAttribute('disabled', '')

const searchEl = document.getElementById('search')
const currentEl = document.getElementById('current')
const f = document.getElementById('xtream-login')
const saveBtn = document.getElementById('saveBtn')
const fetchBtn = document.getElementById('fetchBtn')
const epgList = document.getElementById('epg-list')
const $ = (id) => document.getElementById(id)
const hostEl = $('host')
const portEl = $('port')
const userEl = $('user')
const passEl = $('pass')

// Prefill form
creds = await loadCreds()
hostEl.value = creds.host
portEl.value = creds.port
userEl.value = creds.user
passEl.value = creds.pass

saveBtn.addEventListener('click', async (e) => {
	e.preventDefault()
	console.log('Saving creds…')
	await saveCreds({
		host: hostEl.value.trim(),
		port: portEl.value.trim(),
		user: userEl.value.trim(),
		pass: passEl.value.trim(),
	})
	listStatus.textContent = 'Saved. Click “Load Channels”.'
})
	;['host', 'port', 'user', 'pass'].forEach((id) => {
		$(id).addEventListener('keydown', (e) => {
			if (e.key === 'Enter') e.preventDefault()
		})
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

// Virtual list config
const ROW_H = 50
const OVERSCAN = 8
spacer.style.height = '0px'

let renderScheduled = false

function mountVirtualList(items) {
	filtered = items || []
	spacer.style.height = `${filtered.length * ROW_H}px`
	renderVirtual()
}

function renderVirtual() {
	const scrollTop = listEl.scrollTop
	const height = listEl.clientHeight

	const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
	const endIdx = Math.min(filtered.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN)

	// recycle: clear and rebuild the visible slice
	viewport.innerHTML = ''
	viewport.style.transform = 'translateY(' + startIdx * ROW_H + 'px)'

	for (let i = startIdx; i < endIdx; i++) {
		const ch = filtered[i]
		const row = document.createElement('button')
		row.type = 'button'
		row.style.height = ROW_H + 'px'
		row.className =
			'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-white/5'
		row.onclick = () => play(ch.id, ch.name)
		row.title = ch.name || ''

		// logo
		const logo = document.createElement('div')
		logo.className =
			'h-7 w-7 shrink-0 rounded-md bg-gray-200 dark:bg-gray-700 overflow-hidden ring-1 ring-inset ring-black/5 dark:ring-white/10'
		if (ch.logo) {
			const img = document.createElement('img')
			img.src = safeHttpUrl(ch.logo)
			img.loading = 'lazy'
			img.referrerPolicy = 'no-referrer'
			img.className = 'h-full w-full object-contain'
			img.onerror = () => {
				img.remove()
			}
			logo.appendChild(img)
		}
		row.appendChild(logo)

		// texts
		const wrap = document.createElement('div')
		wrap.className = 'min-w-0 flex-1'
		const nameEl = document.createElement('div')
		nameEl.className = 'truncate text-sm font-medium'
		nameEl.textContent = ch.name || 'Stream ' + ch.id
		const metaEl = document.createElement('div')
		metaEl.className = 'truncate text-[0.55rem] text-gray-500 dark:text-gray-400'
		metaEl.textContent = ch.category ?? ''
		wrap.appendChild(nameEl)
		wrap.appendChild(metaEl)
		row.appendChild(wrap)

		viewport.appendChild(row)
	}
}

listEl.addEventListener('scroll', () => {
	if (!renderScheduled) {
		renderScheduled = true
		requestAnimationFrame(() => {
			renderScheduled = false
			renderVirtual()
		})
	}
})

const debounce = (fn, ms = 180) => {
	let t
	return (...args) => {
		clearTimeout(t)
		t = setTimeout(() => fn(...args), ms)
	}
}
const normalize = (s) =>
	(s || '')
		.toString()
		.normalize('NFKD') // split accents
		.replace(/[\u0300-\u036f]/g, '') // remove accent marks
		.toLowerCase()
		.replace(/[|_\-()[\].,:/\\]+/g, ' ') // treat separators as spaces
		.replace(/\s+/g, ' ') // collapse spaces
		.trim()

const applyFilter = () => {
	const qnorm = normalize(searchEl.value || '')
	const tokens = qnorm.length ? qnorm.split(' ') : []

	const out = all.filter((ch) => {
		if (activeCat && (ch.category || '') !== activeCat) return false
		// hide by category chip
		const cat = (ch.category || '').toString()
		if (cat && hiddenCats.has(cat)) return false

		if (!tokens.length) return true // no query = everything visible

		// every token must be present somewhere in name/category
		const hay = ch.norm // precomputed normalized string
		return tokens.every((t) => hay.includes(t))
	})

	listStatus.textContent = `${out.length.toLocaleString()} of ${all.length.toLocaleString()} channels`
	mountVirtualList(out)
}

searchEl.addEventListener('input', debounce(applyFilter, 160))

async function ensureCategoryMap() {
	if (categoryMap) return categoryMap
	const url = buildApiUrl('get_live_categories')
	const r = await xfetch(url)
	const data = await r.json().catch(() => [])

	const arr = Array.isArray(data) ? data : (Array.isArray(data?.categories) ? data.categories : [])
	categoryMap = new Map(
		arr
			.filter((c) => c && c.category_id != null)
			.map((c) => [String(c.category_id), String(c.category_name || '').trim()])
	)
	return categoryMap
}

function computeCategoryCounts(items) {
	const map = new Map()
	for (const ch of items) {
		const k = (ch.category || '').trim() || 'Uncategorized'
		map.set(k, (map.get(k) || 0) + 1)
	}
	return map
}

function renderCategoryPicker(items) {
	if (!catListEl) return
	const counts = computeCategoryCounts(items)
	const names = Array.from(counts.keys()).sort((a, b) =>
		a.localeCompare(b, 'en', { sensitivity: 'base' })
	)

	// Build items
	const frag = document.createDocumentFragment()

	// "All" option
	const addRow = (val, label, count = null) => {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.setAttribute('role', 'option')
		btn.dataset.val = val
		btn.className = [
			'w-full px-3 py-2 text-sm flex items-center justify-between',
			'hover:bg-white/10 focus:bg-white/10 outline-none',
			'text-white',
		].join(' ')
		const left = document.createElement('span')
		left.className = 'truncate'
		left.textContent = label
		const right = document.createElement('span')
		right.className = 'ml-3 shrink-0 text-xs text-gray-400'
		right.textContent = count != null ? String(count) : ''
		btn.appendChild(left)
		btn.appendChild(right)
		btn.addEventListener('click', () => {
			setActiveCat(val)
			closeCatPopover()
			// reflect selection visually
			highlightActiveInList()
		})
		frag.appendChild(btn)
	}

	addRow('', 'All categories')

	for (const name of names) addRow(name, name, counts.get(name))

	catListEl.innerHTML = ''
	catListEl.appendChild(frag)

	// enable controls now
	catTrigger?.classList.remove('opacity-60', 'cursor-wait')
	clearCatBtn?.classList.remove('opacity-60', 'cursor-not-allowed')
	clearCatBtn?.removeAttribute('disabled')

	// set/restore current label
	setActiveCat(activeCat)

	// local highlight
	function highlightActiveInList() {
		;[...catListEl.querySelectorAll('button[role="option"]')].forEach((el) => {
			const selected = (el.dataset.val || '') === activeCat
			el.classList.toggle('bg-white/10', selected)
		})
	}
	highlightActiveInList()
}

function setActiveCat(next) {
	activeCat = next || ''
	try {
		if (activeCat) localStorage.setItem('xt_active_cat', activeCat)
		else localStorage.removeItem('xt_active_cat')
	} catch { }
	if (catTriggerLabel) catTriggerLabel.textContent = activeCat || 'All categories'
	applyFilter()
}

function openCatPopover() {
	if (!catPopover) return
	catPopover.classList.remove('hidden')
	catTriggerIcon?.classList.add('rotate-180')
}

function closeCatPopover() {
	if (!catPopover) return
	catPopover.classList.add('hidden')
	catTriggerIcon?.classList.remove('rotate-180')
}

function toggleCatPopover() {
	if (!catPopover) return
	const open = !catPopover.classList.contains('hidden')
	open ? closeCatPopover() : openCatPopover()
}

// global (outside) click to close
document.addEventListener('click', (e) => {
	if (!catPopover || !catTrigger) return
	const t = e.target
	if (!catPopover.contains(t) && !catTrigger.contains(t)) closeCatPopover()
})
// toggle on trigger
catTrigger?.addEventListener('click', () => {
	// ignore when disabled during load
	if (catTrigger.classList.contains('cursor-wait')) return
	toggleCatPopover()
})
// clear button
clearCatBtn?.addEventListener('click', () => {
	setActiveCat('')
	closeCatPopover()
})

async function loadChannels() {
	creds = await loadCreds()
	listStatus.textContent = 'Loading channels…'
	spacer.style.height = '0px'
	viewport.innerHTML = ''
	try {
		const catMap = await ensureCategoryMap()
		const r = await xfetch(buildApiUrl('get_live_streams'))
		const body = await r.text()
		if (!r.ok) {
			console.error('Upstream error body:', body)
			throw new Error(`API ${r.status}: ${body}`)
		}
		const data = JSON.parse(body)
		const arr = Array.isArray(data) ? data : data?.streams || data?.results || []
		all = (arr || [])
			.map((ch) => {
				const name = String(ch.name || '')
				const ids =
					(Array.isArray(ch.category_ids) && ch.category_ids.length && ch.category_ids) ||
					(ch.category_id != null ? [ch.category_id] : [])
				let category = String(ch.category_name || '').trim()
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
					norm: normalize(name + ' ' + category),
				}
			})
			.filter((x) => x.id && x.name)
			.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))

		listStatus.textContent = `${all.length.toLocaleString()} channels`
		renderCategoryPicker(all)
		mountVirtualList(all)
	} catch (e) {
		console.error(e)
		listStatus.textContent = 'Failed to load channels. You can still play if you know a stream id.'
		mountVirtualList([]) // clears list
	}
}

fetchBtn.addEventListener('click', () => {
	loadChannels()
	const details = document.getElementById('login-details')
	if (details) details.removeAttribute('open')
})

// ----------------------------
// Player (lazy Video.js init)
// ----------------------------
let vjs = null
const ensurePlayer = () => {
	if (!vjs) {
		vjs = videojs('player', {
			liveui: true,
			fluid: true,
			preload: 'auto',
			autoplay: false,
			aspectRatio: '16:9',
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
	const src = buildDirectM3U8(streamId)

	currentEl.innerHTML = `
    <div class="flex items-center gap-2 max-w-[calc(100%-4rem)]">
      <span class="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-[10px] font-bold text-white ring-1 ring-white/10">ON</span>
      <span class="truncate w-full">Now playing: ${name}</span>
    </div>`

	const videoEl = document.getElementById('player')
	videoEl.removeAttribute('hidden')
	const player = ensurePlayer()

	player.src({ src, type: 'application/x-mpegURL' })
	player.play().catch(() => { })
	loadEPG(streamId)

	// ensure only one PiP button
	const oldBtn = document.getElementById('pip-btn')
	if (oldBtn) oldBtn.remove()

	const btn = document.createElement('button')
	btn.id = 'pip-btn'
	btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="icon icon-tabler icons-tabler-filled icon-tabler-picture-in-picture"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M19 4a3 3 0 0 1 3 3v4a1 1 0 0 1 -2 0v-4a1 1 0 0 0 -1 -1h-14a1 1 0 0 0 -1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 1 0 2h-6a3 3 0 0 1 -3 -3v-10a3 3 0 0 1 3 -3z" /><path d="M20 13a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-5a2 2 0 0 1 -2 -2v-3a2 2 0 0 1 2 -2z" /></svg>`
	btn.className = 'h-9 px-3 rounded-xl border border-white/10 bg-white/5 text-sm'
	document.getElementById('current').appendChild(btn)
	btn.addEventListener('click', async () => {
		// Prefer native PiP via our bridge
		if (window.AndroidPip?.toggle) {
			window.AndroidPip.toggle()
			return
		}
		// Fallback: web PiP (works on desktop/browser)
		const el = player.el().querySelector('video')
		if (document.pictureInPictureEnabled && !el.disablePictureInPicture) {
			try {
				if (document.pictureInPictureElement === el) {
					await document.exitPictureInPicture()
				} else {
					if (el.readyState < 2) await el.play().catch(() => { })
					await el.requestPictureInPicture()
				}
			} catch { }
		}
	})
}

// ----------------------------
// EPG (auto base64 decode if needed)
// ----------------------------
const textDecoder = new TextDecoder('utf-8')

// Heuristic: looks like base64 and decodes safely => treat as base64
function maybeB64ToUtf8(str) {
	if (!str || typeof str !== 'string') return str || ''
	const looksB64 = /^[A-Za-z0-9+/=\s]+$/.test(str) && str.replace(/\s+/g, '').length % 4 === 0
	if (!looksB64) return str

	try {
		const bin = atob(str.replace(/\s+/g, ''))
		// convert binary string to Uint8Array
		const bytes = new Uint8Array(bin.length)
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
		const utf8 = textDecoder.decode(bytes)
		if (utf8.replace(/\s/g, '').length === 0) return str
		return utf8
	} catch {
		return str
	}
}

const fmtTime = (ts) => {
	const n = Number(ts)
	if (!Number.isFinite(n)) return ''
	try {
		return new Date(n * 1000).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return ''
	}
}

async function loadEPG(streamId) {
	const { host, port, user, pass } = creds
	const url = `${fmtBase(host, port)}/player_api.php?username=${encodeURIComponent(
		user
	)}&password=${encodeURIComponent(
		pass
	)}&action=get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=10`

	epgList.innerHTML = `<div class="text-gray-500">Loading EPG…</div>`
	try {
		const r = await xfetch(url)
		if (!r.ok) throw new Error(await r.text())
		const data = await r.json()

		// Xtream variations: sometimes items live in epg_listings; sometimes root array
		const items = Array.isArray(data?.epg_listings) ? data.epg_listings : Array.isArray(data) ? data : []
		if (!items.length) {
			epgList.innerHTML = `<div class="text-gray-500">No EPG available.</div>`
			return
		}

		epgList.innerHTML = items
			.map((it) => {
				const start = fmtTime(it.start_timestamp || it.start)
				const end = fmtTime(it.stop_timestamp || it.end)

				// decode any base64-ish fields
				const titleRaw = it.title || it.title_raw || ''
				const descRaw = it.description || it.description_raw || ''

				const title = maybeB64ToUtf8(titleRaw)
				const desc = maybeB64ToUtf8(descRaw)

				return `
<div class="rounded-lg p-2 bg-gray-900/50">
  <div class="flex items-center justify-between">
    <div class="font-medium">${title}</div>
    <div class="text-xs text-gray-500">${start}–${end}</div>
  </div>
  ${desc ? `<div class="mt-1 text-xs text-gray-400 line-clamp-3">${desc}</div>` : ''}
</div>
`
			})
			.join('')
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
f.addEventListener('submit', (e) => {
	e.preventDefault()
	e.stopImmediatePropagation()
})
