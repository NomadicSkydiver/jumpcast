const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const DZ = {
  "Skydive Midwest": { icao: "KDET", lat: 42.409, lon: -83.009, elevation_ft: 626 },
  "Skydive Chicago": { icao: "KARR", lat: 41.771, lon: -88.475, elevation_ft: 712 },
  "Skydive Sebastian": { icao: "X26", lat: 27.814, lon: -80.495, elevation_ft: 23 }
};

async function json(url) {
  const r = await fetch(url, { headers: { "User-Agent": "JumpCast/0.2 contact@example.com" }});
  if (!r.ok) throw new Error(`Upstream ${r.status}`);
  return r.json();
}

app.get("/api/dropzones", (req,res) => res.json(DZ));

app.get("/api/weather", async (req,res) => {
  const name = req.query.dz || "Skydive Midwest";
  const dz = DZ[name] || DZ["Skydive Midwest"];

  const vars = [
    "temperature_2m","precipitation_probability","precipitation",
    "cloud_cover","visibility","wind_speed_10m","wind_direction_10m",
    "wind_gusts_10m","wind_speed_80m","wind_direction_80m",
    "wind_speed_100m","wind_direction_100m",
    "wind_speed_900hPa","wind_direction_900hPa",
    "wind_speed_700hPa","wind_direction_700hPa"
  ].join(",");

  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${dz.lat}&longitude=${dz.lon}` +
    `&hourly=${vars}&temperature_unit=fahrenheit&wind_speed_unit=kn` +
    `&timezone=auto&forecast_days=3`;

  const metarUrl =
    `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(dz.icao)}` +
    `&format=json&hours=2`;

  try {
    const [forecast, metar] = await Promise.all([
      json(weatherUrl),
      json(metarUrl).catch(() => [])
    ]);

    res.json({
      source: {
        forecast: "Open-Meteo",
        aviation: "NOAA Aviation Weather Center",
        retrieved_at: new Date().toISOString()
      },
      dropzone: { name, ...dz },
      forecast,
      metar
    });
  } catch (e) {
    res.status(502).json({ error: "Weather provider unavailable", detail: e.message });
  }
});

app.get(/.*/, (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`JumpCast running on http://localhost:${PORT}`));
