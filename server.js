
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// --------------------------------------------------
// WEATHER CACHE
// --------------------------------------------------

const weatherCache = new Map();
const CACHE_MS = 60 * 60 * 1000; // 1 hour

// --------------------------------------------------
// DROP ZONES
// --------------------------------------------------

const DZ = {
  "Skydive Midwest": {
    icao: "KDET",
    lat: 42.409,
    lon: -83.009,
    elevation_ft: 626
  },

  "Skydive Chicago": {
    icao: "KARR",
    lat: 41.771,
    lon: -88.475,
    elevation_ft: 712
  },

  "Skydive Sebastian": {
    icao: "X26",
    lat: 27.814,
    lon: -80.495,
    elevation_ft: 23
  }
};

// --------------------------------------------------
// GENERIC JSON FETCHER
// --------------------------------------------------

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "JumpCast/2.0"
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");

    throw new Error(
      `Weather provider returned HTTP ${response.status}${
        text ? `: ${text.slice(0, 200)}` : ""
      }`
    );
  }

  return response.json();
}

// --------------------------------------------------
// DROP ZONE API
// --------------------------------------------------

app.get("/api/dropzones", (req, res) => {
  res.json(DZ);
});

// --------------------------------------------------
// WEATHER API
// --------------------------------------------------

app.get("/api/weather", async (req, res) => {
  const name = req.query.dz || "Skydive Midwest";

  const dz = DZ[name] || DZ["Skydive Midwest"];

  // -----------------------------------------------
  // RETURN CACHED WEATHER IF AVAILABLE
  // -----------------------------------------------

  const cached = weatherCache.get(name);

  if (
    cached &&
    Date.now() - cached.timestamp < CACHE_MS
  ) {
    console.log(`Returning cached weather for ${name}`);

    return res.json(cached.data);
  }

  // -----------------------------------------------
  // OPEN-METEO VARIABLES
  // -----------------------------------------------

  const variables = [
    "temperature_2m",
    "precipitation_probability",
    "precipitation",
    "cloud_cover",
    "visibility",

    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",

    "wind_speed_80m",
    "wind_direction_80m",

    "wind_speed_100m",
    "wind_direction_100m",

    "wind_speed_900hPa",
    "wind_direction_900hPa",

    "wind_speed_700hPa",
    "wind_direction_700hPa",

    "geopotential_height_900hPa",
    "geopotential_height_700hPa"
  ].join(",");

  // -----------------------------------------------
  // OPEN-METEO FORECAST URL
  // -----------------------------------------------

  const weatherUrl =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(dz.lat)}` +
    `&longitude=${encodeURIComponent(dz.lon)}` +
    `&hourly=${encodeURIComponent(variables)}` +
    "&temperature_unit=fahrenheit" +
    "&wind_speed_unit=kn" +
    "&precipitation_unit=inch" +
    "&visibility_unit=km" +
    "&timezone=auto" +
    "&forecast_days=3";

  // -----------------------------------------------
  // NOAA METAR URL
  // -----------------------------------------------

  const metarUrl =
    "https://aviationweather.gov/api/data/metars" +
    `?ids=${encodeURIComponent(dz.icao)}` +
    "&format=json" +
    "&hours=2";

  try {
    console.log(`Requesting weather for ${name}`);

    // ---------------------------------------------
    // FORECAST MUST WORK
    // ---------------------------------------------

    const forecast = await getJson(weatherUrl);

    // ---------------------------------------------
    // METAR IS OPTIONAL
    // ---------------------------------------------

    let metar = [];

    try {
      metar = await getJson(metarUrl);
    } catch (metarError) {
      console.error(
        `NOAA METAR unavailable for ${name}:`,
        metarError.message
      );

      // We still return the Open-Meteo forecast.
      metar = [];
    }

    // ---------------------------------------------
    // BUILD RESPONSE
    // ---------------------------------------------

    const data = {
      source: {
        forecast: "Open-Meteo",
        aviation: "NOAA Aviation Weather Center",
        retrieved_at: new Date().toISOString()
      },

      dropzone: {
        name,
        ...dz
      },

      forecast,

      metar
    };

    // ---------------------------------------------
    // SAVE SUCCESSFUL WEATHER TO CACHE
    // ---------------------------------------------

    weatherCache.set(name, {
      timestamp: Date.now(),
      data
    });

    console.log(`Weather successfully loaded for ${name}`);

    res.json(data);

  } catch (error) {

    // ---------------------------------------------
    // IMPORTANT ERROR LOGGING
    // ---------------------------------------------

    console.error(
      "========================================"
    );

    console.error(
      "JUMPCAST WEATHER ERROR"
    );

    console.error(
      error.message
    );

    console.error(
      "URL:",
      weatherUrl
    );

    console.error(
      "========================================"
    );

    res.status(502).json({
      error: "Weather provider unavailable",
      detail: error.message
    });
  }
});

// --------------------------------------------------
// HOME PAGE
// --------------------------------------------------

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `JumpCast running on http://localhost:${PORT}`
  );
});
