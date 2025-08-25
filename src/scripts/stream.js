//scripts/stream.js

let httpFetch;
// try {
// ({ fetch: httpFetch } = await import(
//     "@tauri-apps/plugin-http"
// ));
//     } catch { }

async function xfetch(url, opts = {}) {
	if (httpFetch) {
		const r = await httpFetch(url, {
			method: opts.method ?? "GET",
			responseType: 1,
		}); // 1 = Text
		return new Response(r.data, {
			status: r.status,
			headers: r.headers,
		});
	}
	return fetch(url, opts); // desktop/web fallback
}

// ----------------------------
// Cookie helpers
// ----------------------------
const setCookie = (name, value, days = 365) => {
	const d = new Date();
	d.setTime(d.getTime() + days * 864e5);
	document.cookie =
		name +
		"=" +
		encodeURIComponent(value) +
		"; expires=" +
		d.toUTCString() +
		"; path=/";
};
const getCookie = (name) => {
	const m = document.cookie.match(
		new RegExp(
			"(?:^|; )" +
				name.replace(/([.$?*|{ }()\[\]\\/+^])/g, "\\$1") +
				"=([^;]*)"
		)
	);
	return m ? decodeURIComponent(m[1]) : "";
};

// ----------------------------
// Creds & URL builders
// ----------------------------
const getCreds = () => ({
	host: getCookie("xt_host") || "",
	port: getCookie("xt_port") || "",
	user: getCookie("xt_user") || "",
	pass: getCookie("xt_pass") || "",
});
const saveCreds = ({ host, port, user, pass }) => {
	setCookie("xt_host", host || "");
	setCookie("xt_port", port || "");
	setCookie("xt_user", user || "");
	setCookie("xt_pass", pass || "");
	try {
		localStorage.setItem("xt_host", host || "");
		localStorage.setItem("xt_port", port || "");
		localStorage.setItem("xt_user", user || "");
		localStorage.setItem("xt_pass", pass || "");
	} catch {}
};
const fmtBase = (host, port) => {
	const base = /^https?:\/\//i.test(host) ? host : `http://${host}`;
	return port && !/:\d+$/.test(base)
		? `${base.replace(/\/+$/, "")}:${port}`
		: base.replace(/\/+$/, "");
};
function buildDirectM3U8(id) {
	const { host, port, user, pass } = getCreds();
	return (
		fmtBase(host, port) +
		"/live/" +
		encodeURIComponent(user) +
		"/" +
		encodeURIComponent(pass) +
		"/" +
		encodeURIComponent(id) +
		".m3u8"
	);
}
const safeHttpUrl = (u) => {
	try {
		const x = new URL(u, location.href);
		return /^https?:$/.test(x.protocol) ? x.href : "";
	} catch {
		return "";
	}
};

// ----------------------------
// UI refs
// ----------------------------
const listEl = document.getElementById("list");
const spacer = document.getElementById("spacer");
const viewport = document.getElementById("viewport");
const listStatus = document.getElementById("list-status");

const searchEl = document.getElementById("search");
const currentEl = document.getElementById("current");
const f = document.getElementById("xtream-login");
const saveBtn = document.getElementById("saveBtn");
const fetchBtn = document.getElementById("fetchBtn");
const epgList = document.getElementById("epg-list");
const $ = (id) => document.getElementById(id);
const hostEl = $("host");
const portEl = $("port");
const userEl = $("user");
const passEl = $("pass");

// Prefill form
const c = getCreds();
hostEl.value = c.host;
portEl.value = c.port;
userEl.value = c.user;
passEl.value = c.pass;

saveBtn.addEventListener("click", (e) => {
	e.preventDefault();
	saveCreds({
		host: $("host").value.trim(),
		port: $("port").value.trim(),
		user: $("user").value.trim(),
		pass: $("pass").value.trim(),
	});
	// non-blocking toast-ish
	listStatus.textContent = "Saved. Click “Load Channels”.";
});
["host", "port", "user", "pass"].forEach((id) => {
	$(id).addEventListener("keydown", (e) => {
		if (e.key === "Enter") e.preventDefault();
	});
});

// ----------------------------
// Channels + Virtualization
// ----------------------------
/** @type {Array < { id: number, name: string, category?: string, logo?: string | null } >} */
let all = [];
let filtered = [];

// Virtual list config
const ROW_H = 50; // px; adjust if your row is taller/shorter
const OVERSCAN = 8; // extra rows above/below
spacer.style.height = "0px";

let renderScheduled = false;

function mountVirtualList(items) {
	filtered = items || [];
	spacer.style.height = `${filtered.length * ROW_H}px`;
	renderVirtual();
}

function renderVirtual() {
	const scrollTop = listEl.scrollTop;
	const height = listEl.clientHeight;

	const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
	const endIdx = Math.min(
		filtered.length,
		Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN
	);

	// recycle: clear and rebuild the visible slice
	viewport.innerHTML = "";
	viewport.style.transform = "translateY(" + startIdx * ROW_H + "px)";

	for (let i = startIdx; i < endIdx; i++) {
		const ch = filtered[i];
		const row = document.createElement("button");
		row.type = "button";
		row.style.height = ROW_H + "px";
		row.className =
			"group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800";
		row.onclick = () => play(ch.id, ch.name);
		row.title = ch.name || "";

		// logo
		const logo = document.createElement("div");
		logo.className =
			"h-7 w-7 shrink-0 rounded-md bg-gray-200 dark:bg-gray-700 overflow-hidden ring-1 ring-inset ring-black/5 dark:ring-white/10";
		if (ch.logo) {
			const img = document.createElement("img");
			img.src = safeHttpUrl(ch.logo);
			img.loading = "lazy";
			img.referrerPolicy = "no-referrer";
			img.className = "h-full w-full object-contain";
			img.onerror = () => {
				img.remove();
			};
			logo.appendChild(img);
		}
		row.appendChild(logo);

		// texts
		const wrap = document.createElement("div");
		wrap.className = "min-w-0 flex-1";
		const nameEl = document.createElement("div");
		nameEl.className = "truncate text-sm font-medium";
        nameEl.textContent = ch.name || "Stream " + ch.id;
        console.log(ch)
		const metaEl = document.createElement("div");
		metaEl.className = "truncate text-xs text-gray-500 dark:text-gray-400";
		metaEl.textContent = ch.category ?? "";
		wrap.appendChild(nameEl);
		wrap.appendChild(metaEl);
		row.appendChild(wrap);

		viewport.appendChild(row);
	}
}

listEl.addEventListener("scroll", () => {
	if (!renderScheduled) {
		renderScheduled = true;
		requestAnimationFrame(() => {
			renderScheduled = false;
			renderVirtual();
		});
	}
});

const debounce = (fn, ms = 180) => {
	let t;
	return (...args) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...args), ms);
	};
};
const normalize = (s) =>
    (s || "")
        .toString()
        .normalize("NFKD")                    // split accents
        .replace(/[\u0300-\u036f]/g, "")     // remove accent marks
        .toLowerCase()
        .replace(/[|_\-()[\].,:/\\]+/g, " ") // treat separators as spaces
        .replace(/\s+/g, " ")                // collapse spaces
        .trim();

const applyFilter = () => {
    const qnorm = normalize(searchEl.value || "");
    const tokens = qnorm.length ? qnorm.split(" ") : [];

    const out = all.filter((ch) => {
        // hide by category chip
        const cat = (ch.category || "").toString();
        if (cat && hiddenCats.has(cat)) return false;

        if (!tokens.length) return true; // no query = everything visible

        // every token must be present somewhere in name/category
        const hay = ch.norm; // precomputed normalized string
        return tokens.every((t) => hay.includes(t));
    });

    listStatus.textContent = `${out.length.toLocaleString()} of ${all.length.toLocaleString()} channels`;
    mountVirtualList(out);
};


searchEl.addEventListener("input", debounce(applyFilter, 160));

function buildTarget(host, port, user, pass) {
	// Ensure scheme
	const baseHost = /^https?:\/\//i.test(host) ? host : `http://${host}`;
	// Put the API path here
	const apiUrl = new URL(
		"/player_api.php",
		baseHost.replace(/\/+$/, "") +
			(port && !/:\d+$/.test(baseHost) ? `:${port}` : "")
	);
	apiUrl.search = new URLSearchParams({
		username: user,
		password: pass,
		action: "get_live_streams",
	}).toString();
	return apiUrl.toString();
}

async function loadChannels() {
	listStatus.textContent = "Loading channels…";
	spacer.style.height = "0px";
	viewport.innerHTML = "";
	try {
		const target = buildTarget(
			host.value,
			port.value,
			user.value,
			pass.value
		);
		const r = await xfetch(target);
		const body = await r.text();
		if (!r.ok) {
			console.error("Upstream error body:", body);
			throw new Error(`API ${r.status}: ${body}`);
		}
		const data = JSON.parse(body);
		const arr = Array.isArray(data)
			? data
			: data?.streams || data?.results || [];
        all = (arr || [])
            .map((ch) => {
                const name = String(ch.name || "");
                const category = ch.category_name || "";
                return {
                    id: Number(ch.stream_id),
                    name,
                    category,
                    logo: ch.stream_icon || null,
                    norm: normalize(name + " " + category),
                };
            })
            .filter((x) => x.id && x.name)
            .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

		listStatus.textContent = `${all.length.toLocaleString()} channels`;
        mountVirtualList(all);
	} catch (e) {
		console.error(e);
		listStatus.textContent =
			"Failed to load channels (likely CORS). You can still play if you know a stream id.";
        mountVirtualList([]); // clears list
	}
}
fetchBtn.addEventListener("click", loadChannels);

// ----------------------------
// Player (lazy Video.js init)
// ----------------------------
let vjs = null;
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
		});
	}
	return vjs;
};

function play(streamId, name) {
	const src = buildDirectM3U8(streamId);
    currentEl.innerHTML = `<div class="flex items-center gap-2 max-w-full">
        <span
            class="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-[10px] font-bold text-white ring-1 ring-white/10"
        >ON</span
        >
        <span class="truncate w-full">Now playing: ${name}</span>
    </div>`;

	const player = ensurePlayer();
	player.src({ src, type: "application/x-mpegURL" });
	player.play().catch(() => {});
	loadEPG(streamId);
}

// ----------------------------
// EPG (auto base64 decode if needed)
// ----------------------------
const textDecoder = new TextDecoder("utf-8");

// Heuristic: looks like base64 and decodes safely => treat as base64
function maybeB64ToUtf8(str) {
	if (!str || typeof str !== "string") return str || "";
	// quick check: only base64 alphabet + padding and length multiple of 4
	const looksB64 =
		/^[A-Za-z0-9+/=\s]+$/.test(str) &&
		str.replace(/\s+/g, "").length % 4 === 0;
	if (!looksB64) return str;

	try {
		const bin = atob(str.replace(/\s+/g, ""));
		// convert binary string to Uint8Array
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		const utf8 = textDecoder.decode(bytes);
		// sanity check: decoded text should contain printable chars
		if (utf8.replace(/\s/g, "").length === 0) return str;
		return utf8;
	} catch {
		return str;
	}
}

const fmtTime = (ts) => {
	const n = Number(ts);
	if (!Number.isFinite(n)) return "";
	try {
		return new Date(n * 1000).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return "";
	}
};

async function loadEPG(streamId) {
	const { host, port, user, pass } = getCreds();
	const url = `${fmtBase(
		host,
		port
	)}/player_api.php?username=${encodeURIComponent(
		user
	)}&password=${encodeURIComponent(
		pass
	)}&action=get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=10`;

	epgList.innerHTML = `<div class="text-gray-500">Loading EPG…</div>`;
	try {
		const r = await xfetch(url);
		if (!r.ok) throw new Error(await r.text());
		const data = await r.json();

		// Xtream variations: sometimes items live in epg_listings; sometimes root array
		const items = Array.isArray(data?.epg_listings)
			? data.epg_listings
			: Array.isArray(data)
			? data
			: [];
		if (!items.length) {
			epgList.innerHTML = `<div class="text-gray-500">No EPG available.</div>`;
			return;
		}

		epgList.innerHTML = items
			.map((it) => {
				const start = fmtTime(it.start_timestamp || it.start);
				const end = fmtTime(it.stop_timestamp || it.end);

				// decode any base64-ish fields
				const titleRaw = it.title || it.title_raw || "";
				const descRaw = it.description || it.description_raw || "";

				const title = maybeB64ToUtf8(titleRaw);
				const desc = maybeB64ToUtf8(descRaw);

				return `
<div class="rounded-lg bg-gray-50 p-2 dark:bg-gray-900/50">
<div class="flex items-center justify-between">
    <div class="font-medium">${title}</div>
    <div class="text-xs text-gray-500">${start}–${end}</div>
</div>
${
	desc
		? `<div class="mt-1 text-xs text-gray-600 dark:text-gray-400 line-clamp-3">${desc}</div>`
		: ""
}
</div>
`;
			})
			.join("");
	} catch (e) {
		console.error(e);
		epgList.innerHTML = `<div class="text-red-600">Failed to load EPG (CORS or panel error).</div>`;
	}
}

// Auto-load if creds present
if (c.host && c.user && c.pass) loadChannels();

// Prevent form submit reloads
f.addEventListener("submit", (e) => {
	e.preventDefault();
	e.stopImmediatePropagation();
});