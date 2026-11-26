# CRUX security notes

CRUX is a static, offline web app with no backend, no accounts and no analytics. Everything it stores lives in this
browser on this device. This file records the rendering and Content-Security-Policy audit (1.3.1) and the limits of
the security features. Tests enforce each point; the test names are given in brackets.

## Content-Security-Policy

Set by a `<meta>` tag in `index.html` (GitHub Pages can't send headers). It is unchanged since 1.0.0
[theme.test.js: "the Content-Security-Policy is unchanged"].

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Nothing loads from anywhere else. |
| `script-src` | `'self'` | No inline script, no `eval`, no third-party scripts. `boot.js` is an ordinary file for that reason. |
| `style-src` | `'self'` | No inline `<style>` or `style=""`. Dynamic colours are set through the CSSOM (`el.style.setProperty`), which the CSP allows. |
| `img-src` | `'self' data:` | App icons; `data:` only for the favicon placeholder. |
| `font-src` | `'self'` | No web fonts are used (system font stack). |
| `connect-src` | `'self'` | The app makes no network requests of its own [release.test.js: "no network calls"]. |
| `manifest-src`, `worker-src` | `'self'` | The manifest and service worker. |
| `object-src` | `'none'` | No plugins. |
| `base-uri` | `'none'` | No `<base>` hijacking of relative URLs. |
| `form-action` | `'none'` | Forms never submit anywhere. |

A `<meta>` CSP can't set `frame-ancestors`, so `boot.js` refuses to run inside a frame (clickjacking).
The browser test records every `securitypolicyviolation` event across all flows and requires none [app.mjs].

## Rendering

- All text reaches the page as text nodes through `h()` in `js/ui.js`; there is no `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, string timers, inline handlers, `javascript:` URLs,
  `style`/`srcdoc` attributes or markup parsers anywhere in the app [release.test.js: "rendering audit"].
- Event handlers are attached with `addEventListener`, never as attributes.
- Icons are static path data in `js/icons.js`, parsed into elements; only plain shape tags and numeric/path
  attributes are allowed [icons.test.js].
- Names, notes, sources and other text you type are shown as text. The browser test saves categories, goals, bills,
  notes and income sources named like `<img src=x onerror=…>` and checks they appear literally and create no elements
  [app.mjs: "hostile names render as text"].
- Imported backups are validated completely before anything is replaced; ids must match `[A-Za-z0-9_-]`, colours must
  be `#RRGGBB`, text is trimmed to size [backup.test.js].

## Storage scope

CRUX shares the `github.io` origin with VANE. Everything CRUX stores is named `crux…`: the `crux` IndexedDB database,
`crux-…` localStorage keys and `crux-<version>` caches. The service worker only handles `/CRUX/` and only deletes its
own caches. Reset and Erase touch only CRUX's data [release.test.js; app.mjs checks VANE's data byte for byte].

## Encrypted export

- AES-256-GCM via the browser's Web Crypto API; the key comes from your passphrase through PBKDF2-SHA-256 with
  600,000 iterations and a 16-byte random salt; each file has a fresh 12-byte IV [secure.test.js].
- GCM authenticates the data: a wrong passphrase or any change to the file is refused, and nothing is imported.
- Files that claim fewer than 100,000 iterations or another cipher are refused before decryption.
- The passphrase is never stored. If it is lost, the backup can't be opened by anyone.
- Plain (unencrypted) export is still available, and is what the reset dialog offers.

## App lock

- A 4–8 digit PIN; CRUX keeps only a salted PBKDF2-SHA-256 hash (210,000 iterations) and the PIN length, in its own
  database. The PIN and its hash are never part of a backup [release.test.js].
- Locks every time CRUX opens, or after 1 or 5 minutes in the background. With "immediately", the lock covers the app
  as it goes to the background, so the app switcher's snapshot doesn't show your data.
- Wrong guesses: the first four are free, then 30 s, doubling to a 5-minute cap; the count survives a reload.
- "Forgot PIN" can only erase CRUX's data (typing ERASE to confirm). Anything else would make the lock pointless.
- **Limits.** The lock is a privacy screen, not encryption: the data on the device is stored unencrypted in the
  browser, as it always has been. Someone with the unlocked phone and the browser's developer tools, or with a backup
  of the phone, can read it. For files kept elsewhere, use Export encrypted.

## Persistent storage

CRUX asks the browser to keep its storage (`navigator.storage.persist()`) after your first expense, and Settings →
Security shows whether it is protected. Browsers may still clear site data if you ask them to, so export backups.

## Reporting

This is a personal project. Open an issue on the repository for anything security-related.
