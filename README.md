# JumpCast V2 — live-weather starter

This is the next step beyond the original demo. It is a small Node/Express web app with a mobile-first interface.

## What is live
- Open-Meteo forecast data for temperature, precipitation probability, cloud cover, visibility, surface wind/gusts and model winds at selected pressure levels.
- NOAA Aviation Weather Center METAR observation through a server-side proxy.

The Aviation Weather Center provides machine-readable METAR/TAF data through its Data API. Its documentation says browser CORS is not permitted, which is why the app uses the Node server as a proxy rather than calling AWC directly from the phone/browser.

## Run it
You need Node.js 18+.

1. Extract the ZIP.
2. Open a terminal in the extracted folder.
3. Run:
   npm install
   npm start
4. On the same computer, open:
   http://localhost:3000

To test from an Android phone on the same Wi-Fi, use the computer's local network address instead of localhost, for example:
http://192.168.1.25:3000

## Important
The included drop-zone/ICAO mappings are prototype examples and must be verified before launch. The "score" is a UI prototype, not a safety recommendation.

## Production roadmap
- Verify every DZ's coordinates and nearby aviation stations.
- Add a proper DZ database and admin dashboard.
- Replace prototype score with transparent, configurable DZ-specific display logic.
- Integrate a dedicated aviation wind/temperature product for exact altitude layers.
- Add authentication, saved DZs, push alerts and subscriptions.
- Add legal/privacy/terms pages and logging/monitoring.
- Deploy server + web app to a production host.
- Package the web app as Android/iOS after the web version is stable.
