// scripts/version.js
import { getVersion, getName } from '@tauri-apps/api/app'

export async function injectVersion() {
    try {
        const version = await getVersion()
        const name = await getName()
        document.getElementById('app-version').textContent = `${name} v${version}`
    } catch (e) {
        console.error('Could not get app version:', e)
    }
}
