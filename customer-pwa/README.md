# Riders customer PWA

Customer-facing Progressive Web App for Riders Delivery. It will share accounts, marketplace, and the NestJS backend with the React Native `customer-app`. Delivery riders continue to use the Kotlin Android app.

This folder is **setup only**. Booking, bidding, tracking, guest authorization, and sign-in are placeholders.

## Installation and local startup

From this directory, using npm (same as `admin-app` and `customer-app`):

```bash
npm install
npm run dev
```

The Vite dev server listens on [http://localhost:5174](http://localhost:5174). Leave `VITE_API_BASE_URL` empty to use same-origin paths; Vite proxies `/auth` to `http://127.0.0.1:3000`.

The service worker is **disabled in `npm run dev`**. Use a production build and preview to exercise PWA install and updates.

## Environment configuration

Copy `.env.example` to `.env` when the API or Maps key should differ from the defaults:

```
VITE_API_BASE_URL=
VITE_GOOGLE_MAPS_BROWSER_KEY=
```

- `VITE_API_BASE_URL` has no trailing slash. Leave it empty to call `/auth` and `/customers` on the current origin.
- `VITE_GOOGLE_MAPS_BROWSER_KEY` is the browser Maps key. Restrict it to the production HTTPS origin. Leave it empty to show the map-unavailable state.
- Do not put server API keys, OTP secrets, or other credentials in frontend env vars.

## Project structure

```
src/app          Routing and the signed-in shell
src/pages        One file per route
src/components   Brand, buttons, inputs, page, loading, empty, error, notices
src/api          Typed fetch client (no endpoints wired yet)
src/config       VITE_API_BASE_URL
src/styles       Riders color, type, and spacing tokens
public           Favicon and app icon copied from customer-app
```

## Available routes

| Path | Screen |
| --- | --- |
| `/` | Welcome |
| `/sign-in` | Sign in (placeholder) |
| `/create-account` | Create account (placeholder) |
| `/book` | Book a delivery (placeholder) |
| `/deliveries` | My deliveries (placeholder) |
| `/deliveries/:id` | Delivery details (placeholder) |
| `/profile` | Profile (placeholder) |
| anything else | Not found |

Welcome actions: **Continue as guest** → `/book`, **Create account** → `/create-account`, **Sign in** → `/sign-in`. None of these simulate authentication or create deliveries.

## Scripts

```bash
npm run dev          # Vite development server
npm run build        # typecheck + production build
npm run preview      # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
```

## Placeholders

- Sign in, create account, guest access, booking, bidding, tracking, and profile data.
- No token storage, mock login, or guest workarounds.
- No API methods beyond the generic `apiRequest` helper.

## PWA behaviour

- **Development:** no service worker (`devOptions.enabled: false`).
- **Production / preview:** `vite-plugin-pwa` precaches the static app shell (`js`, `css`, `html`, images, fonts). There is no Workbox `runtimeCaching` for API traffic. Navigation fallback is `index.html` except `/auth/`, `/admin/`, and `/customers/`.
- Updates use `registerType: 'prompt'`. A banner offers **Refresh**; the page does not reload on its own.
- An offline banner appears when the browser reports `navigator.onLine === false`. Bookings are not queued.

### Icons

`public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, and `public/apple-touch-icon.png` are generated from `public/icon.png`.

### Hosting

The intended production domain is not configured in this repository. Before a public release:

- Serve the site over **HTTPS**. Installation and the service worker do not work on plain HTTP.
- Send unknown app paths, including `/book` and `/deliveries/:id`, to `index.html`. The service worker does this only after it is installed.
- Keep `/auth` and `/customers` on the API. Either reverse-proxy those paths to the NestJS server, or set `VITE_API_BASE_URL` to an origin that the backend allows with CORS. The API currently allows only `ADMIN_WEB_ORIGIN`.
- Leave `VITE_API_BASE_URL` empty when the proxy makes the API same-origin.
- Restrict `VITE_GOOGLE_MAPS_BROWSER_KEY` to the production HTTPS origin before building.
- Do not put secrets in the static build. The Maps browser key is visible in the JavaScript bundle and must be referrer-restricted.

## Stack

React 19, TypeScript, Vite 7, React Router 7, `vite-plugin-pwa`. No extra state-management library. Tokens match `customer-app` (`#169B62` primary, `#17211D` text, 56px primary buttons).
