// updater-startup.js
let isTauri = false;
try { isTauri = !!window.__TAURI__; } catch (_) { }

async function maybeRunWindowsAutoUpdate() {
    if (!isTauri) return;
    const isWindows = navigator.userAgent.includes("Windows");
    if (!isWindows) return;

    try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const { relaunch } = await import("@tauri-apps/plugin-process");

        const update = await check(); 
        if (update?.available) {
            await update.downloadAndInstall(); 
            await relaunch();
        }
    } catch (err) {
        console.error("Updater error:", err);
    }
}

maybeRunWindowsAutoUpdate();
