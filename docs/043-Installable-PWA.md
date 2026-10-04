---
type: task
status: in-progress
---

# Installable PWA

Let users add tetanus to a phone home screen and open it as a standalone app. No
offline support, no service worker, no push.

## Approach

Hand-rolled web app manifest plus head tags. No `@vite-pwa/nuxt`: its value is the
service worker, which we don't want (a caching SW risks serving stale disk health).
Chrome has not required a service worker for installability since 2023; iOS never has.

## Scope

1. **Manifest route** `server/routes/manifest.webmanifest.ts`, built from `APP_NAME`
   (`shared/app.ts` must stay the only place the name appears, so no static
   `public/manifest.webmanifest`). `Content-Type: application/manifest+json`.
   - `name`, `short_name`: `APP_NAME`
   - `id: "/"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`
   - `background_color`, `theme_color`: stone 950 `#0c0a09` (matches
     `apple-touch-icon.png` background, per [008](008-Branding-and-colour.md))
   - `icons`: 192 and 512 `any`, 512 `maskable`
2. **Icons** in `public/`, rendered with `rsvg-convert` from the mark as in
   [009](009-Apply-tetanus-theme-and-mark.md) (light strokes on `#0c0a09`):
   `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (mark inside the central 80%
   safe zone, full-bleed background). Check maskable with maskable.app.
3. **Head** in `nuxt.config.ts` `app.head`:
   - `link rel="manifest" href="/manifest.webmanifest"`
   - `meta name="theme-color"` twice with `media="(prefers-color-scheme: light|dark)"`
     (stone 50 / stone 950) so the status bar follows the colour mode
   - `meta name="apple-mobile-web-app-title"` = `APP_NAME`
   - `meta name="apple-mobile-web-app-status-bar-style" content="default"`
   - `apple-touch-icon` already present
4. **Route test** `test/api/manifest.e2e.test.ts`: 200, content type, `name` equals
   `APP_NAME`, every icon path resolves.
5. **README**: one short section on installing (Android: Chrome menu → Install app;
   iOS: Share → Add to Home Screen) and the HTTPS caveat below.

## Constraints and gotchas

- **HTTPS required** for Android/desktop Chrome install prompt (localhost excepted).
  Plain-HTTP LAN installs fall back to a bookmark-style shortcut on Android. iOS
  add-to-home-screen works over HTTP. Document, don't work around.
- **Reverse proxy with auth** (users may put basic auth/SSO in front): manifest is
  fetched without credentials by default. Add `crossorigin="use-credentials"` to the
  manifest link so it still loads.
- **Standalone has no browser chrome**: no back button, no URL bar, no pull-to-refresh
  on iOS. Check every page is reachable from in-app nav on a phone-width viewport and
  that SSE keeps data live without a manual reload.
- **Cloudflare demo** ([034](034-Cloudflare-Workers-demo.md)): the Nitro route must
  build for the Workers target too; confirm with `pnpm build:demo`.
- No `viewport-fit=cover` / safe-area insets: keep default status bar so content never
  sits under the notch.

## Done when

- `pnpm lint:ci`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm build:demo` green.
- Chrome DevTools → Application → Manifest shows no installability errors.
- Installed on an Android phone and an iPhone: correct name, icon (incl. maskable crop),
  opens standalone, status bar colour matches mode.

## Questions

- Name on home screen: lowercase `tetanus` as in the brand, or capitalised?
- Should `start_url` be `/` or a specific page (e.g. faults)?
- Is HTTPS on the typical deployment assumed, or worth a docs pointer (Caddy/Tailscale
  serve)?
