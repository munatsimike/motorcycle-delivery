# Local development OTP

Customer and rider registration and sign-in still use the same screens and the same WhatsApp verification endpoints. On a local development machine, a mock provider can create the one-time code instead of calling WhatsApp. The production WhatsApp provider is unchanged and does not print codes.

The mock is off unless both of these are set in `backend/.env`:

```
NODE_ENV=development
DEV_OTP_ENABLED=true
```

Leave `WHATSAPP_VERIFICATION_ENABLED=false` while the mock is on. The API refuses to start if the mock flag is true in production, staging, Railway, another hosted platform, or together with WhatsApp verification. The code is not included in an API response.

No database migration is required. The process keeps a hash of the code in memory. Restarting the backend invalidates codes that have not been used.

## Start the backend

From `backend`:

```
npm run start:dev
```

`npm run start:dev` loads `backend/.env` before the providers are chosen. Restart it after changing the flag. The terminal that is already running the API does not pick up the new value until that restart.

## Read the code

Send a code from the customer or rider sign-in or registration screen. The backend terminal prints a block like this:

```
[riders-dev-otp] LOCAL DEVELOPMENT OTP. This code was not sent on WhatsApp.
[riders-dev-otp] Phone: +263771234567
[riders-dev-otp] Code: 042817
[riders-dev-otp] Expires: 2026-10-24T18:05:00.000Z
```

Type that code into the existing verification screen. A code expires five minutes after it is issued, works once, and is replaced when a resend is allowed. The next send for the same number waits 60 seconds. Five wrong entries lock that code. A number can request five codes an hour, and one network address can request twenty.

## Android apps

Point either debug app at this local API. Release builds stay on the HTTPS `API_BASE_URL` and do not use this mock.

Leave the development address as loopback, `http://127.0.0.1:3000`. On a phone, forward that port before opening the app:

```
adb reverse tcp:3000 tcp:3000
```

Also forward Metro when the customer development client loads from this computer:

```
adb reverse tcp:8081 tcp:8081
```

An Android emulator rewrites that loopback address to `http://10.0.2.2:3000`. A phone that cannot use `adb reverse` can set a private LAN address instead: `DEBUG_API_BASE_URL` in `android-rider/local.properties` for the rider debug build, or `EXPO_PUBLIC_API_BASE_URL` in `customer-app/.env` for the customer app. Do not commit either value. Cleartext HTTP is allowed on the rider debug build only.

Customer app: keep `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000` in `customer-app/.env`, then start Metro from `customer-app`. The development client reads that value when Metro starts.

Rider app: install the debug variant. With no `DEBUG_API_BASE_URL`, a phone uses `http://127.0.0.1:3000` and an emulator uses `http://10.0.2.2:3000`. Open the existing sign-in screen and enter the code from the backend terminal.

After the code is accepted, the apps keep the rotating refresh session and restore it on the next launch. Logout and logout-all are unchanged. Admin email and password sign-in does not use this provider.
