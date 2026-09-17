const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const weatherCache = new Map();
const CACHE_MS = 60 * 60 * 1000;
const DROPZONE_CACHE_MS = 24 * 60 * 60 * 1000;

const PRESSURE_LEVELS = [
  1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 725,
  700, 675, 650, 625, 600, 575, 550, 525, 500, 475, 450
];

const FALLBACK_DZ = {
  "fallback-midwest": {
    id: "fallback-midwest",
    name: "Skydive Midwest",
    icao: "KC89",
    lat: 42.70312,
    lon: -87.95587,
    elevation_ft: null,
    city: "Sturtevant",
    state: "WI",
    country: "US",
    airport: "Sylvania Airport (C89)"
  },
  "fallback-chicago": {
    id: "fallback-chicago",
    name: "Skydive Chicago",
    icao: "K8N2",
    lat: 41.3997778,
    lon: -88.7939167,
    elevation_ft: null,
    city: "Ottawa",
    state: "IL",
    country: "US",
    airport: "Skydive Chicago Airport (8N2)"
  },
  "fallback-sebastian": {
    id: "fallback-sebastian",
    name: "Skydive Sebastian",
    icao: "KX26",
    lat: 27.8132347,
    lon: -80.4955841,
    elevation_ft: 23,
    city: "Sebastian",
    state: "FL",
    country: "US",
    airport: "Sebastian Municipal Airport (X26)"
  }
};

let DZ = { ...FALLBACK_DZ };
let dropzoneDirectoryTimestamp = 0;

const SKIP_USPA_IDS = new Set([
  "260335", "238840", "261413", "206689", "196509",
  "100490", "193132", "354757", "377901", "363265",
  "301805", "100677"
]);

const STATE_ABBREVIATIONS = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR",
  California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY"
};

function normalizeState(state, country) {
  if (!state) return "";
  const value = String(state).trim();
  if (country !== "US") return value;
  return STATE_ABBREVIATIONS[value] ||
    (/^[a-z]{2}$/i.test(value) ? value.toUpperCase() : value);
}

function deriveIcao(airportName, country) {
  if (!airportName) return null;

  const four = airportName.match(/\(([A-Z0-9]{4})\)/i);
  if (four) return four[1].toUpperCase();

  const three = airportName.match(/\(([A-Z0-9]{3})\)/i);
  if (!three) return null;

  const code = three[1].toUpperCase();
  if (country === "US") return `K${code}`;
  if (country === "Canada") return `C${code}`;
  return null;
}

function normalizeUspaDropzone(raw) {
  const country = String(raw.PhysicalCountry || "").trim();

  if (!["US", "Canada", "Mexico"].includes(country)) return null;
  if (SKIP_USPA_IDS.has(String(raw.Id))) return null;

  const lat = Number(raw.Latitude);
  const lon = Number(raw.Longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const name = String(raw.AccountName || "").trim();
  if (!name) return null;

  const state = normalizeState(raw.PhysicalState, country);
  const airport = String(raw.AirportName || "").trim();

  return {
    id: String(raw.Id),
    name,
    icao: deriveIcao(airport, country),
    lat,
    lon,
    elevation_ft: null,
    city: String(raw.PhysicalCity || "").trim(),
    state,
    country,
    airport,
    phone: String(raw.PhoneDZ || "").trim(),
    email: String(raw.Email || "").trim()
  };
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "JumpCast/4.0" }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Weather provider returned HTTP ${response.status}` +
      (text ? `: ${text.slice(0, 200)}` : "")
    );
  }

  return response.json();
}

async function refreshDropzoneDirectory() {
  if (Date.now() - dropzoneDirectoryTimestamp < DROPZONE_CACHE_MS) {
    return;
  }

  try {
    const response = await fetch("https://uspa.org/api/DZList", {
      method: "POST",
      headers: {
        "User-Agent": "JumpCast/4.0",
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "DZName=&City=&Region=&Country=&State="
    });

    if (!response.ok) {
      throw new Error(`USPA directory returned HTTP ${response.status}`);
    }

    const rows = await response.json();
    const next = {};

    for (const row of rows) {
      const dz = normalizeUspaDropzone(row);
      if (dz) next[dz.id] = dz;
    }

    if (!Object.keys(next).length) {
      throw new Error("USPA directory returned no North American drop zones");
    }

    DZ = next;
    dropzoneDirectoryTimestamp = Date.now();

    console.log(
      `Loaded ${Object.keys(DZ).length} North American USPA-affiliated DZs`
    );
  } catch (error) {
    console.error("USPA drop zone directory unavailable:", error.message);
    if (!Object.keys(DZ).length) DZ = { ...FALLBACK_DZ };
  }
}

function windToUV(speedKt, directionDeg) {
  const radians = directionDeg * Math.PI / 180;

  return {
    u: -speedKt * Math.sin(radians),
    v: -speedKt * Math.cos(radians)
  };
}

function uvToWind(u, v) {
  const speed = Math.sqrt(u * u + v * v);

  let direction =
    Math.atan2(-u, -v) * 180 / Math.PI;

  if (direction < 0) direction += 360;

  return {
    speed_kt: speed,
    direction_deg: direction
  };
}

function windAtAltitude(
  hourly,
  index,
  targetAltitudeFt,
  groundElevationFt
) {
  const targetMeters = targetAltitudeFt * 0.3048;
  const groundMeters = groundElevationFt * 0.3048;
  const profile = [];

  for (const pressure of PRESSURE_LEVELS) {
    const height =
      hourly[`geopotential_height_${pressure}hPa`]?.[index];

    const speed =
      hourly[`wind_speed_${pressure}hPa`]?.[index];

    const direction =
      hourly[`wind_direction_${pressure}hPa`]?.[index];

    if (
      Number.isFinite(height) &&
      Number.isFinite(speed) &&
      Number.isFinite(direction) &&
      height >= groundMeters - 100
    ) {
      profile.push({
        pressure,
        height,
        speed,
        direction
      });
    }
  }

  profile.sort((a, b) => a.height - b.height);

  const surfaceSpeed =
    hourly.wind_speed_10m?.[index];

  const surfaceDirection =
    hourly.wind_direction_10m?.[index];

  if (!profile.length) {
    return {
      speed_kt: surfaceSpeed ?? null,
      direction_deg: surfaceDirection ?? null,
      method: "Surface wind fallback",
      lower_pressure_hpa: null,
      upper_pressure_hpa: null
    };
  }

  if (targetMeters <= profile[0].height) {
    return {
      speed_kt: profile[0].speed,
      direction_deg: profile[0].direction,
      method: `Lowest available pressure level (${profile[0].pressure} hPa)`,
      lower_pressure_hpa: profile[0].pressure,
      upper_pressure_hpa: profile[0].pressure
    };
  }

  if (targetMeters >= profile[profile.length - 1].height) {
    const top = profile[profile.length - 1];

    return {
      speed_kt: top.speed,
      direction_deg: top.direction,
      method: `Highest available pressure level (${top.pressure} hPa)`,
      lower_pressure_hpa: top.pressure,
      upper_pressure_hpa: top.pressure
    };
  }

  for (let i = 0; i < profile.length - 1; i++) {
    const lower = profile[i];
    const upper = profile[i + 1];

    if (
      targetMeters >= lower.height &&
      targetMeters <= upper.height
    ) {
      const range =
        upper.height - lower.height;

      const fraction =
        range === 0
          ? 0
          : (targetMeters - lower.height) / range;

      const lowerUV =
        windToUV(lower.speed, lower.direction);

      const upperUV =
        windToUV(upper.speed, upper.direction);

      const result =
        uvToWind(
          lowerUV.u +
            (upperUV.u - lowerUV.u) * fraction,
          lowerUV.v +
            (upperUV.v - lowerUV.v) * fraction
        );

      return {
        speed_kt: result.speed_kt,
        direction_deg: result.direction_deg,
        method:
          `Interpolated between ${lower.pressure} and ${upper.pressure} hPa`,
        lower_pressure_hpa: lower.pressure,
        upper_pressure_hpa: upper.pressure,
        lower_height_ft: lower.height / 0.3048,
        upper_height_ft: upper.height / 0.3048
      };
    }
  }

  return {
    speed_kt: surfaceSpeed ?? null,
    direction_deg: surfaceDirection ?? null,
    method: "Surface wind fallback",
    lower_pressure_hpa: null,
    upper_pressure_hpa: null
  };
}

function groundElevationFt(baseData) {
  if (Number.isFinite(baseData.dropzone.elevation_ft)) {
    return baseData.dropzone.elevation_ft;
  }

  const modelElevationMeters =
    Number(baseData.forecast?.elevation);

  if (Number.isFinite(modelElevationMeters)) {
    return modelElevationMeters * 3.28084;
  }

  return 0;
}

function buildJumpWindSeries(
  forecast,
  targetAltitudeFt,
  groundElevation,
  startIndex,
  count = 12
) {
  const hourly = forecast.hourly;
  const results = [];

  for (
    let i = startIndex;
    i < Math.min(startIndex + count, hourly.time.length);
    i++
  ) {
    results.push({
      time: hourly.time[i],
      ...windAtAltitude(
        hourly,
        i,
        targetAltitudeFt,
        groundElevation
      )
    });
  }

  return results;
}

function addJumpWindData(baseData, targetAltitudeFt) {
  const forecast = baseData.forecast;
  const hourly = forecast.hourly;
  const groundElevation = groundElevationFt(baseData);
  const now = new Date();

  let closestIndex = 0;
  let closestDifference = Infinity;

  hourly.time.forEach((time, index) => {
    const difference =
      Math.abs(
        new Date(time).getTime() -
        now.getTime()
      );

    if (difference < closestDifference) {
      closestDifference = difference;
      closestIndex = index;
    }
  });

  const jumpWind =
    windAtAltitude(
      hourly,
      closestIndex,
      targetAltitudeFt,
      groundElevation
    );

  const jumpWindSeries =
    buildJumpWindSeries(
      forecast,
      targetAltitudeFt,
      groundElevation,
      closestIndex,
      12
    );

  return {
    ...baseData,

    dropzone: {
      ...baseData.dropzone,
      ground_elevation_ft:
        Math.round(groundElevation)
    },

    jumpAltitude: {
      msl_ft: targetAltitudeFt,
      agl_ft: Math.max(
        0,
        targetAltitudeFt - groundElevation
      )
    },

    jumpWind,
    jumpWindSeries
  };
}

app.get("/api/dropzones", async (req, res) => {
  await refreshDropzoneDirectory();

  const list =
    Object.values(DZ).sort((a, b) => {
      const country =
        a.country.localeCompare(b.country);

      if (country !== 0) return country;

      const state =
        a.state.localeCompare(b.state);

      if (state !== 0) return state;

      return a.name.localeCompare(b.name);
    });

  res.json({
    source: "USPA Drop Zone Locator",
    coverage: [
      "United States",
      "Canada",
      "Mexico"
    ],
    updated_at:
      dropzoneDirectoryTimestamp
        ? new Date(dropzoneDirectoryTimestamp).toISOString()
        : null,
    count: list.length,
    dropzones: list
  });
});

app.get("/api/weather", async (req, res) => {
  await refreshDropzoneDirectory();

  const requested =
    String(req.query.dz || "").trim();

  const byId = DZ[requested];

  const byName =
    Object.values(DZ).find(
      (item) => item.name === requested
    );

  const dz =
    byId ||
    byName ||
    DZ["fallback-midwest"] ||
    Object.values(DZ)[0];

  let targetAltitudeFt =
    Number(req.query.alt) || 12500;

  targetAltitudeFt =
    Math.max(
      1000,
      Math.min(20000, targetAltitudeFt)
    );

  const cacheKey = dz.id;
  const cached = weatherCache.get(cacheKey);
  let baseData;

  if (
    cached &&
    Date.now() - cached.timestamp < CACHE_MS
  ) {
    baseData = cached.data;
  } else {
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
      "wind_direction_80m"
    ];

    for (const pressure of PRESSURE_LEVELS) {
      variables.push(
        `wind_speed_${pressure}hPa`,
        `wind_direction_${pressure}hPa`,
        `geopotential_height_${pressure}hPa`
      );
    }

    const weatherUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(dz.lat)}` +
      `&longitude=${encodeURIComponent(dz.lon)}` +
      `&hourly=${encodeURIComponent(variables.join(","))}` +
      "&temperature_unit=fahrenheit" +
      "&wind_speed_unit=kn" +
      "&precipitation_unit=inch" +
      "&visibility_unit=km" +
      "&timezone=auto" +
      "&forecast_days=3";

    let metar = [];

    const metarUrl = dz.icao
      ? "https://aviationweather.gov/api/data/metars" +
        `?ids=${encodeURIComponent(dz.icao)}` +
        "&format=json&hours=2"
      : null;

    try {
      const forecast =
        await getJson(weatherUrl);

      if (metarUrl) {
        try {
          metar =
            await getJson(metarUrl);
        } catch (error) {
          console.error(
            `NOAA METAR unavailable for ${dz.name}:`,
            error.message
          );
        }
      }

      baseData = {
        source: {
          forecast: "Open-Meteo",
          aviation:
            "NOAA Aviation Weather Center",
          retrieved_at:
            new Date().toISOString()
        },

        dropzone: dz,

        forecast,

        metar
      };

      weatherCache.set(cacheKey, {
        timestamp: Date.now(),
        data: baseData
      });

    } catch (error) {
      console.error(
        "JUMPCAST WEATHER ERROR:",
        error.message
      );

      return res.status(502).json({
        error:
          "Weather provider unavailable",
        detail: error.message
      });
    }
  }

  res.json(
    addJumpWindData(
      baseData,
      targetAltitudeFt
    )
  );
});

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `JumpCast running on http://localhost:${PORT}`
  );

  refreshDropzoneDirectory();
});
