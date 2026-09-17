
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const weatherCache = new Map();
const CACHE_MS = 60 * 60 * 1000;

/*
  Pressure levels used to build an altitude-aware wind profile.
  Geopotential height tells us the actual MSL altitude of each level.
*/
const PRESSURE_LEVELS = [
  1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 725,
  700, 675, 650, 625, 600, 575, 550, 525, 500, 475, 450
];

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

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "JumpCast/3.0"
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

/*
  Convert wind speed/direction into U/V components.

  Meteorological direction means the direction the wind
  is coming FROM.
*/
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

  if (direction < 0) {
    direction += 360;
  }

  return {
    speed_kt: speed,
    direction_deg: direction
  };
}

/*
  Find wind at a specific MSL altitude.

  We interpolate between the two pressure levels
  surrounding the requested altitude.

  Vector interpolation is used instead of simply averaging
  wind speed/direction so that directions such as 350° and
  10° don't produce an incorrect 180° average.
*/
function windAtAltitude(hourly, index, targetAltitudeFt, groundElevationFt) {
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
      Number.isFinite(direction)
    ) {
      /*
        Ignore pressure surfaces below the DZ terrain.
      */
      if (height >= groundMeters - 100) {
        profile.push({
          pressure,
          height,
          speed,
          direction
        });
      }
    }
  }

  profile.sort((a, b) => a.height - b.height);

  /*
    Surface fallback.
  */
  const surfaceSpeed = hourly.wind_speed_10m?.[index];
  const surfaceDirection = hourly.wind_direction_10m?.[index];

  if (!profile.length) {
    return {
      speed_kt: surfaceSpeed ?? null,
      direction_deg: surfaceDirection ?? null,
      method: "Surface wind fallback",
      lower_pressure_hpa: null,
      upper_pressure_hpa: null
    };
  }

  /*
    If requested altitude is below the lowest pressure level,
    use the lowest available pressure level.
  */
  if (targetMeters <= profile[0].height) {
    return {
      speed_kt: profile[0].speed,
      direction_deg: profile[0].direction,
      method: `Lowest available pressure level (${profile[0].pressure} hPa)`,
      lower_pressure_hpa: profile[0].pressure,
      upper_pressure_hpa: profile[0].pressure
    };
  }

  /*
    If requested altitude is above the highest available level,
    use the highest available level.
  */
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

  /*
    Find the two pressure levels surrounding the target altitude.
  */
  for (let i = 0; i < profile.length - 1; i++) {
    const lower = profile[i];
    const upper = profile[i + 1];

    if (
      targetMeters >= lower.height &&
      targetMeters <= upper.height
    ) {
      const range = upper.height - lower.height;

      const fraction =
        range === 0
          ? 0
          : (targetMeters - lower.height) / range;

      const lowerUV =
        windToUV(lower.speed, lower.direction);

      const upperUV =
        windToUV(upper.speed, upper.direction);

      const u =
        lowerUV.u +
        (upperUV.u - lowerUV.u) * fraction;

      const v =
        lowerUV.v +
        (upperUV.v - lowerUV.v) * fraction;

      const result = uvToWind(u, v);

      return {
        speed_kt: result.speed_kt,
        direction_deg: result.direction_deg,
        method: `Interpolated between ${lower.pressure} and ${upper.pressure} hPa`,
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

function buildJumpWindSeries(
  forecast,
  targetAltitudeFt,
  groundElevationFt,
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
    const wind = windAtAltitude(
      hourly,
      i,
      targetAltitudeFt,
      groundElevationFt
    );

    results.push({
      time: hourly.time[i],
      ...wind
    });
  }

  return results;
}

function addJumpWindData(baseData, targetAltitudeFt) {
  const forecast = baseData.forecast;
  const hourly = forecast.hourly;

  const now = new Date();

  let closestIndex = 0;
  let closestDifference = Infinity;

  hourly.time.forEach((time, index) => {
    const difference =
      Math.abs(new Date(time).getTime() - now.getTime());

    if (difference < closestDifference) {
      closestDifference = difference;
      closestIndex = index;
    }
  });

  const dz = baseData.dropzone;

  const jumpWind = windAtAltitude(
    hourly,
    closestIndex,
    targetAltitudeFt,
    dz.elevation_ft
  );

  const jumpWindSeries = buildJumpWindSeries(
    forecast,
    targetAltitudeFt,
    dz.elevation_ft,
    closestIndex,
    12
  );

  return {
    ...baseData,

    jumpAltitude: {
      msl_ft: targetAltitudeFt,
      agl_ft: Math.max(
        0,
        targetAltitudeFt - dz.elevation_ft
      )
    },

    jumpWind,
    jumpWindSeries
  };
}

/*
  Drop zone list.
*/
app.get("/api/dropzones", (req, res) => {
  res.json(DZ);
});

/*
  Weather endpoint.

  Example:
  /api/weather?dz=Skydive%20Midwest&alt=12500
*/
app.get("/api/weather", async (req, res) => {
  const name = req.query.dz || "Skydive Midwest";
  const dz = DZ[name] || DZ["Skydive Midwest"];

  let targetAltitudeFt =
    Number(req.query.alt) || 12500;

  /*
    Keep the altitude inside a reasonable range.
  */
  targetAltitudeFt = Math.max(
    1000,
    Math.min(20000, targetAltitudeFt)
  );

  const cached = weatherCache.get(name);

  let baseData;

  if (
    cached &&
    Date.now() - cached.timestamp < CACHE_MS
  ) {
    console.log(`Returning cached weather for ${name}`);
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

    /*
      Add pressure-level wind and geopotential-height fields.
    */
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

    const metarUrl =
      "https://aviationweather.gov/api/data/metars" +
      `?ids=${encodeURIComponent(dz.icao)}` +
      "&format=json" +
      "&hours=2";

    try {
      console.log(`Requesting weather for ${name}`);

      const forecast = await getJson(weatherUrl);

      let metar = [];

      try {
        metar = await getJson(metarUrl);
      } catch (metarError) {
        console.error(
          `NOAA METAR unavailable for ${name}:`,
          metarError.message
        );

        metar = [];
      }

      baseData = {
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

      weatherCache.set(name, {
        timestamp: Date.now(),
        data: baseData
      });

      console.log(
        `Weather successfully loaded for ${name}`
      );
    } catch (error) {
      console.error("========================================");
      console.error("JUMPCAST WEATHER ERROR");
      console.error(error.message);
      console.error("========================================");

      return res.status(502).json({
        error: "Weather provider unavailable",
        detail: error.message
      });
    }
  }

  /*
    Calculate altitude-specific wind from the cached
    forecast without making another weather-provider request.
  */
  const result = addJumpWindData(
    baseData,
    targetAltitudeFt
  );

  res.json(result);
});

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `JumpCast running on http://localhost:${PORT}`
  );
});
