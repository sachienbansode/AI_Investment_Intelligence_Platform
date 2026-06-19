# NIYTRI AI — Mobile app (Capacitor) build & store guide

The mobile app reuses the existing React/Vite frontend, wrapped with **Capacitor**
into native iOS + Android apps that talk to the same FastAPI backend.

## 1. Prerequisites (your machine)
- Node 18+, npm
- **iOS:** macOS + Xcode + an Apple Developer account ($99/yr)
- **Android:** Android Studio + a Google Play Developer account ($25 one-time)

## 2. One-time setup (laptop, in `frontend/`)
```
cd D:\broking-ai-bot\frontend
npm install                 # installs React + the @capacitor/* packages now in package.json
npx cap add ios             # creates the ios/ native project (macOS only)
npx cap add android         # creates the android/ native project
```
`capacitor.config.json` is already committed (appId `com.niytri.ai`, appName "NIYTRI AI", webDir `dist`).

## 3. Point the app at the live API
The web build calls the relative `/api/v1`. The native app runs from `capacitor://localhost`,
so it must call the absolute API URL. Create `frontend/.env.production` (or pass at build time):
```
VITE_API_BASE=https://dev-invest.niytri.com/api/v1
```
The backend already allows the native origins (`capacitor://localhost`, etc.) in CORS.

## 4. Build & open the native projects
```
cd D:\broking-ai-bot\frontend
npm run build:app           # vite build  +  cap copy  (pushes dist/ into the native shells)
npx cap sync                # installs native plugin deps
npx cap open ios            # opens Xcode      -> Run on simulator/device
npx cap open android        # opens Android Studio -> Run on emulator/device
```
After any frontend change: `npm run build:app` again (or `npx cap sync`).

## 5. App icons & splash
Put a 1024x1024 `icon.png` and a splash `splash.png` in `frontend/resources/`, then:
```
npm i -D @capacitor/assets
npx capacitor-assets generate
```
This generates all icon/splash sizes for both platforms.

## 6. Push notifications (optional, later)
- iOS: enable Push in Xcode (APNs key in the Apple developer portal).
- Android: add `google-services.json` (Firebase) to `android/app/`.
- The app registers the device token via `POST /api/v1/devices/register` (already built);
  sending alerts needs FCM/APNs server credentials wired into the backend.

## 7. Store submission checklist
- App name, subtitle, description, keywords
- Screenshots (6.7" + 5.5" iPhone; phone + tablet Android)
- Privacy policy URL + Apple privacy "nutrition labels" / Google Data Safety form
- Financial-app disclosures — the in-app SEBI disclaimers already cover "informational only, not advice"
- Sign the build (Xcode automatic signing / Android keystore), upload to TestFlight / Play internal testing, then submit for review.

## Notes
- Everything is one codebase: the same React app serves the website (nginx) and the apps.
- The mobile UI (bottom tab bar, safe areas, card layouts) is gated behind a mobile
  breakpoint, so the desktop web layout is unaffected.
