import type { APIRoute } from "astro";
export const prerender = false;

// simple per-origin cookie jar (in-memory)
const jar = new Map<string, string>();
const getJar = (origin: string) => jar.get(origin) || "";
const setCookies = (origin: string, setCookies: string[] | null) => {
    if (!setCookies || !setCookies.length) return;
    const cur = new Map(getJar(origin).split(";").map(s => s.trim()).filter(Boolean).map(kv => kv.split("=", 2) as [string, string]));
    for (const sc of setCookies) {
        const [pair] = sc.split(";");
        const [k, v = ""] = pair.split("=", 2);
        if (k) cur.set(k.trim(), v.trim());
    }
    jar.set(origin, Array.from(cur).map(([k, v]) => `${k}=${v}`).join("; "));
};

const getSetCookies = (resp: Response): string[] | null => {
    const any = resp.headers as any;
    if (typeof any.getSetCookie === "function") return any.getSetCookie() || null;
    if (typeof any.raw === "function") return any.raw()?.["set-cookie"] || null;
    const single = resp.headers.get("set-cookie");
    return single ? [single] : null;
};

function buildHeaders(base: Headers, upstream: URL, opts: { playlistRef?: string, keepUA?: boolean } = {}) {
    const h: Record<string, string> = {};
    // forward a few from client
    for (const n of ["accept", "accept-language", "range", "cache-control"]) {
        const v = base.get(n); if (v) h[n] = v;
    }
    const ua = base.get("user-agent");
    if (opts.keepUA && ua) h["user-agent"] = ua;

    const cookie = getJar(upstream.origin);
    if (cookie) h["cookie"] = cookie;

    // referer rules: playlist → origin/ ; segments/keys → playlistRef
    const isPlaylist = upstream.pathname.toLowerCase().endsWith(".m3u8");
    h["referer"] = isPlaylist ? `${upstream.origin}/` : (opts.playlistRef || `${upstream.origin}/`);

    // be explicit (some edges care)
    h["host"] = upstream.host;
    if (!h["accept"]) h["accept"] = "*/*";
    return h;
}

function rewriteM3U8(body: string, base: URL): string {
    const rf = encodeURIComponent(base.toString());
    const prox = (u: string) => `/p?u=${encodeURIComponent(new URL(u, base).toString())}&rf=${rf}`;
    return body.split("\n").map(line => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith("#")) {
            // also rewrite key/init URIs
            if (/^#EXT-X-(KEY|MAP):/i.test(t)) {
                return line.replace(/URI="?([^",]+)"?/i, (_m, uri) => `URI="${prox(uri)}"`);
            }
            return line;
        }
        return prox(t);
    }).join("\n");
}

async function fetchFollow(url: URL, headers: Record<string, string>, opts: { playlistRef?: string, keepUA?: boolean } = {}) {
    let cur = url;
    let h = { ...headers };
    for (let i = 0; i < 6; i++) {
        const resp = await fetch(cur.toString(), { headers: h, redirect: "manual" as any });
        setCookies(cur.origin, getSetCookies(resp));

        // manual redirects so we can keep cookies + headers consistent
        if (resp.status >= 300 && resp.status < 400) {
            const loc = resp.headers.get("location");
            if (!loc) return resp;
            cur = new URL(loc, cur);
            h = buildHeaders(new Headers(h), cur, { playlistRef: opts.playlistRef, keepUA: opts.keepUA });
            continue;
        }
        return resp;
    }
    return new Response("redirect loop", { status: 508 });
}

export const GET: APIRoute = async ({ url, request }) => {
    const u = url.searchParams.get("u");
    if (!u) return new Response("missing ?u", { status: 400 });

    let upstream: URL;
    try { upstream = new URL(u); } catch { return new Response("bad url", { status: 400 }); }

    const rf = url.searchParams.get("rf") || undefined;

    try {
        const h = buildHeaders(request.headers, upstream, { playlistRef: rf, keepUA: true });
        const resp = await fetchFollow(upstream, h, { playlistRef: rf, keepUA: true });

        const ct = resp.headers.get("content-type")?.toLowerCase() || "";
        const isM3U8 = ct.includes("application/vnd.apple.mpegurl") || ct.includes("application/x-mpegurl") || upstream.pathname.toLowerCase().endsWith(".m3u8");

        if (isM3U8 && resp.ok) {
            const text = await resp.text();
            const rewritten = rewriteM3U8(text, upstream);
            return new Response(rewritten, {
                status: 200,
                headers: {
                    "content-type": "application/vnd.apple.mpegurl",
                    "cache-control": "no-store"
                }
            });
        }

        // surface upstream error text (helps debugging 40x/50x)
        if (!resp.ok && !resp.body) {
            const txt = await resp.text().catch(() => "");
            return new Response(txt || `upstream ${resp.status}`, { status: resp.status, headers: { "cache-control": "no-store" } });
        }

        // passthrough for segments/keys
        const out = new Headers();
        for (const [n, v] of resp.headers) {
            const nn = n.toLowerCase();
            if (["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "date", "server", "cache-control"].includes(nn)) out.set(n, v);
        }
        if (!out.has("cache-control")) out.set("cache-control", "no-store");
        return new Response(resp.body, { status: resp.status, headers: out });
    } catch (e: any) {
        console.error("proxy error:", e?.stack || e);
        return new Response(`proxy error: ${e?.message || e}`, { status: 502 });
    }
};
