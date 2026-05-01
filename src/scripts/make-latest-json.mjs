// public/scripts/make-latest-json.mjs
import { readdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Paths inside your Tauri project
const nsisDir = path.resolve(__dirname, "../../src-tauri/target/release/bundle/nsis")
const outputFile = path.resolve(__dirname, "../../latest.json")

// Find the newest NSIS installer
const installers = readdirSync(nsisDir).filter(f => f.endsWith("-setup.exe"))
if (installers.length === 0) {
    console.error("❌ No NSIS installers found in", nsisDir)
    process.exit(1)
}

// If multiple, pick the last one alphabetically (highest version)
installers.sort()
const installerFile = installers[installers.length - 1]
const installerPath = path.join(nsisDir, installerFile)
const sigPath = installerPath + ".sig"

// Ensure sig exists
let signature
try {
    signature = readFileSync(sigPath, "utf8").trim()
} catch (e) {
    console.error("❌ Could not read signature file:", sigPath)
    process.exit(1)
}

// Extract version number. Tauri's NSIS bundle names files as
// "<productName>_<version>_x64-setup.exe". After the productName rename
// from "xtream" to "Extreme InfiniTV", the historic prefix may still appear
// for older artifacts, so accept any prefix and just pull the version.
const versionMatch = installerFile.match(/_(\d+\.\d+\.\d+)_x64-setup\.exe$/)
if (!versionMatch) {
    console.error("❌ Could not parse version from filename:", installerFile)
    process.exit(1)
}
const version = versionMatch[1]

// GitHub Releases URL-encodes spaces in artifact filenames as %20. Encode
// the filename component (but leave the URL slashes alone) so the updater
// can reach files like "Extreme InfiniTV_1.2.0_x64-setup.exe".
const downloadUrl =
    `https://github.com/infinitel8p/Extreme-InfiniTV/releases/download/v${version}/` +
    encodeURIComponent(installerFile)

// Build JSON structure
const latest = {
    version,
    notes: `Release ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
        "windows-x86_64": {
            url: downloadUrl,
            signature
        }
    }
}

// Save latest.json
writeFileSync(outputFile, JSON.stringify(latest, null, 2))
console.log("✅ latest.json written to", outputFile)
