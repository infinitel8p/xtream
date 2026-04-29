# Security Policy

Thanks for taking the time to report a potential security issue. Please **do not** open a public issue or pull request for vulnerabilities; report privately first so we can ship a fix before details are public.

## Supported versions

Only the **latest released version** is supported. Older versions don't receive security fixes. The Windows desktop build self-updates (signed with minisign, served from GitHub Releases). For other distributions, update via the respective store:

| Platform | How to update |
| --- | --- |
| Windows (Microsoft Store) | Microsoft Store auto-updates |
| Windows (sideload NSIS) | In-app auto-updater |
| Android phone / tablet | Google Play |
| Android TV | Google Play (or sideload the latest APK) |
| Web build | Whoever hosts it; rebuild from `main` |

## Reporting a vulnerability

**Preferred:** open a private advisory at <https://github.com/infinitel8p/xtream/security/advisories/new>.

**Fallback:** email <admin@infinitel8p.com> with `xtream security` in the subject line.

Please include:

- A description of the issue and its impact.
- Reproduction steps or a proof-of-concept.
- The app version, platform, and OS version where you observed it.
- Whether you've disclosed this anywhere else (CVE, other vendors, etc.).

## Disclosure timeline

- **Acknowledgement:** within 7 days.
- **Triage and severity assessment:** within 14 days.
- **Fix and release:** target 90 days from first contact for non-trivial issues, faster for critical ones.
- **Public disclosure:** coordinated with you. We'll credit you in the advisory unless you ask otherwise.

## Scope

**In scope:**

- The Tauri host (`src-tauri/`), frontend (`src/`), and shipped capabilities allowlist.
- The auto-updater (`tauri-plugin-updater` + `latest.json` flow).
- How the app stores and reads credentials and preferences (`@tauri-apps/plugin-store` + localStorage / cookies fallback).
- Signed release artifacts (NSIS, MSIX, APK, AAB).
- The build / release pipeline in `.github/workflows/`.

**Out of scope:**

- Third-party IPTV providers (Xtream Codes servers, M3U hosts, EPG sources). The app is a client; the security of *their* infrastructure is not something we can fix here.
- User-supplied stream content. Streams are decoded by the OS / browser media stack via Video.js; codec-level vulnerabilities should be reported upstream.
- Issues that require a pre-compromised device (e.g. arbitrary code execution by an attacker who already has filesystem access).
- Self-XSS or social-engineering attacks that require the user to paste attacker-supplied JavaScript into DevTools.
- Reports generated solely by automated scanners with no demonstrated exploit path.
