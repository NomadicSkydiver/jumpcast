const express = require("express");
const path = require("path");
const VERIFIED_LOCATIONS = require("./verified-locations");
const app = express();
const PORT = process.env.PORT || 3000;

const weatherCache = new Map();
const WEATHER_CACHE_MS = 15 * 60 * 1000;
const DROPZONE_CACHE_MS = 24 * 60 * 60 * 1000;
const USPA_TIMEOUT_MS = 12000;

const PRESSURE_LEVELS = [
  1000,925,850,775,700,625,550,500,450
];
const FALLBACK_DZ = {
  "fallback-midwest": {
    id:"fallback-midwest",
    name:"Skydive Midwest",
    icao:"KC89",
    lat:42.70312,
    lon:-87.95587,
    elevation_ft:null,
    city:"Sturtevant",
    state:"WI",
    country:"US",
    airport:"Sylvania Airport (C89)"
  },
  "fallback-chicago": {
    id:"fallback-chicago",
    name:"Skydive Chicago",
    icao:"K8N2",
    lat:41.3997778,
    lon:-88.7939167,
    elevation_ft:null,
    city:"Ottawa",
    state:"IL",
    country:"US",
    airport:"Skydive Chicago Airport (8N2)"
  },
  "fallback-sebastian": {
    id:"fallback-sebastian",
    name:"Skydive Sebastian",
    icao:"KX26",
    lat:27.8132347,
    lon:-80.4955841,
    elevation_ft:23,
    city:"Sebastian",
    state:"FL",
    country:"US",
    airport:"Sebastian Municipal Airport (X26)"
  }
};

let DZ = {...FALLBACK_DZ};
let dropzoneDirectoryTimestamp = 0;
let refreshPromise = null;

const SKIP_USPA_IDS = new Set([
  "260335","238840","261413","206689","196509",
  "100490","193132","354757","377901","363265",
  "301805","100677"
]);

const STATE_ABBREVIATIONS = {
  Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",
  California:"CA",Colorado:"CO",Connecticut:"CT",Delaware:"DE",
  Florida:"FL",Georgia:"GA",Hawaii:"HI",Idaho:"ID",
  Illinois:"IL",Indiana:"IN",Iowa:"IA",Kansas:"KS",
  Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",
  Massachusetts:"MA",Michigan:"MI",Minnesota:"MN",Mississippi:"MS",
  Missouri:"MO",Montana:"MT",Nebraska:"NE",Nevada:"NV",
  "New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
  "New York":"NY","North Carolina":"NC","North Dakota":"ND",
  Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA",
  "Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",
  Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",
  Virginia:"VA",Washington:"WA","West Virginia":"WV",
  Wisconsin:"WI",Wyoming:"WY"
};

function normalizeState(state,country){
  const value=String(state||"").trim();
  if(!value)return "";
  if(country!=="US")return value;
  return STATE_ABBREVIATIONS[value] ||
    (/^[a-z]{2}$/i.test(value)?value.toUpperCase():value);
}

function deriveIcao(airportName,country){
  const text=String(airportName||"");
  const four=text.match(/\(([A-Z0-9]{4})\)/i);
  if(four)return four[1].toUpperCase();

  const three=text.match(/\(([A-Z0-9]{3})\)/i);
  if(!three)return null;

  const code=three[1].toUpperCase();
  if(country==="US")return `K${code}`;
  if(country==="Canada")return `C${code}`;
  return null;
}

function normalizeUspaDropzone(raw){
  const country=String(raw.PhysicalCountry||"").trim();

  if(!["US","Canada","Mexico"].includes(country))return null;
  if(SKIP_USPA_IDS.has(String(raw.Id)))return null;

  const name=String(raw.AccountName||"").trim();
const verified=VERIFIED_LOCATIONS[name] || {};

const lat=Number(
  verified.lat ?? raw.Latitude
);

const lon=Number(
  verified.lon ?? raw.Longitude
);

const physicalAddress=String(
  verified.address ||
  raw.PhysicalAddress ||
  raw.Address ||
  ""
).trim();
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!name)return null;

  const airport=String(raw.AirportName||"").trim();

  return {
    id:String(raw.Id),
    name,
physicalAddress,

    icao:deriveIcao(airport,country),
    lat,
    lon,
    elevation_ft:null,
    city:String(raw.PhysicalCity||"").trim(),
    state:normalizeState(raw.PhysicalState,country),
    country,
    airport,
    phone:String(raw.PhoneDZ||"").trim(),
    email:String(raw.Email||"").trim()
  };
}

async function fetchJson(url,options={},timeoutMs=15000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);

  try{
    const response=await fetch(url,{
      ...options,
      signal:controller.signal
    });

    if(!response.ok)throw new Error(`HTTP ${response.status}`);

    return await response.json();
  }finally{
    clearTimeout(timer);
  }
}

async function refreshDropzoneDirectory(){
  if(Date.now()-dropzoneDirectoryTimestamp<DROPZONE_CACHE_MS){
    return DZ;
  }

  if(refreshPromise)return refreshPromise;

  refreshPromise=(async()=>{
    try{
      const rows=await fetchJson(
        "https://uspa.org/api/DZList",
        {
          method:"POST",
          headers:{
            "User-Agent":"JumpCast/5.0",
            "Accept":"application/json",
            "Content-Type":"application/x-www-form-urlencoded"
          },
          body:"DZName=&City=&Region=&Country=&State="
        },
        USPA_TIMEOUT_MS
      );

      if(!Array.isArray(rows)){
        throw new Error("USPA returned an unexpected response");
      }

      const next={};

      for(const row of rows){
        const dz=normalizeUspaDropzone(row);
        if(dz)next[dz.id]=dz;
      }

      if(!Object.keys(next).length){
        throw new Error("USPA returned no North American locations");
      }

      DZ=next;
      dropzoneDirectoryTimestamp=Date.now();

      console.log(
        `Loaded ${Object.keys(DZ).length} North American USPA-affiliated DZs`
      );
    }catch(error){
      console.error(
        "USPA directory unavailable:",
        error.message
      );
      console.log(
        "JumpCast will continue using its fallback directory."
      );
    }finally{
      refreshPromise=null;
    }

    return DZ;
  })();

  return refreshPromise;
}

function sortedDropzones(){
  return Object.values(DZ).sort((a,b)=>{
    const country=a.country.localeCompare(b.country);
    if(country)return country;

    const state=a.state.localeCompare(b.state);
    if(state)return state;

    return a.name.localeCompare(b.name);
  });
}

function windToUV(speedKt,directionDeg){
  const radians=Number(directionDeg)*Math.PI/180;

  return {
    u:-Number(speedKt)*Math.sin(radians),
    v:-Number(speedKt)*Math.cos(radians)
  };
}

function uvToWind(u,v){
  const speed=Math.sqrt(u*u+v*v);

  let direction=Math.atan2(-u,-v)*180/Math.PI;

  if(direction<0)direction+=360;

  return {
    speed_kt:speed,
    direction_deg:direction
  };
}

function windAtAltitude(
  hourly,
  index,
  targetAltitudeFt,
  groundElevationFt
){
  const targetMeters=targetAltitudeFt*0.3048;
  const groundMeters=groundElevationFt*0.3048;
  const profile=[];

  for(const pressure of PRESSURE_LEVELS){
    const height=
      hourly[`geopotential_height_${pressure}hPa`]?.[index];

    const speed=
      hourly[`wind_speed_${pressure}hPa`]?.[index];

    const direction=
      hourly[`wind_direction_${pressure}hPa`]?.[index];

    if(
      Number.isFinite(height)&&
      Number.isFinite(speed)&&
      Number.isFinite(direction)&&
      height>=groundMeters-100
    ){
      profile.push({
        pressure,
        height,
        speed,
        direction
      });
    }
  }

  profile.sort((a,b)=>a.height-b.height);

  const surfaceSpeed=
    hourly.wind_speed_10m?.[index];

  const surfaceDirection=
    hourly.wind_direction_10m?.[index];

  if(!profile.length){
    return {
      speed_kt:surfaceSpeed??null,
      direction_deg:surfaceDirection??null,
      method:"Surface wind fallback",
      lower_pressure_hpa:null,
      upper_pressure_hpa:null
    };
  }

  if(targetMeters<=profile[0].height){
    const p=profile[0];

    return {
      speed_kt:p.speed,
      direction_deg:p.direction,
      method:`Lowest available pressure level (${p.pressure} hPa)`,
      lower_pressure_hpa:p.pressure,
      upper_pressure_hpa:p.pressure
    };
  }

  if(targetMeters>=profile[profile.length-1].height){
    const p=profile[profile.length-1];

    return {
      speed_kt:p.speed,
      direction_deg:p.direction,
      method:`Highest available pressure level (${p.pressure} hPa)`,
      lower_pressure_hpa:p.pressure,
      upper_pressure_hpa:p.pressure
    };
  }

  for(let i=0;i<profile.length-1;i++){
    const lower=profile[i];
    const upper=profile[i+1];

    if(
      targetMeters>=lower.height&&
      targetMeters<=upper.height
    ){
      const range=upper.height-lower.height;

      const fraction=range===0
        ?0
        :(targetMeters-lower.height)/range;

      const lowerUV=
        windToUV(lower.speed,lower.direction);

      const upperUV=
        windToUV(upper.speed,upper.direction);

      const result=uvToWind(
        lowerUV.u+(upperUV.u-lowerUV.u)*fraction,
        lowerUV.v+(upperUV.v-lowerUV.v)*fraction
      );

      return {
        speed_kt:result.speed_kt,
        direction_deg:result.direction_deg,
        method:
          `Interpolated between ${lower.pressure} and ${upper.pressure} hPa`,
        lower_pressure_hpa:lower.pressure,
        upper_pressure_hpa:upper.pressure,
        lower_height_ft:lower.height/0.3048,
        upper_height_ft:upper.height/0.3048
      };
    }
  }

  return {
    speed_kt:surfaceSpeed??null,
    direction_deg:surfaceDirection??null,
    method:"Surface wind fallback",
    lower_pressure_hpa:null,
    upper_pressure_hpa:null
  };
}

function groundElevationFt(baseData){
  if(Number.isFinite(baseData.dropzone.elevation_ft)){
    return baseData.dropzone.elevation_ft;
  }

  const modelElevationMeters=
    Number(baseData.forecast?.elevation);

  if(Number.isFinite(modelElevationMeters)){
    return modelElevationMeters*3.28084;
  }

  return 0;
}

function addJumpWindData(baseData,targetAltitudeFt){
  const hourly = baseData.forecast.hourly;
  const groundElevation = groundElevationFt(baseData);

  // Open-Meteo returns local wall-clock timestamps because
  // the request uses timezone=auto. Treat those timestamps
  // as wall-clock values instead of converting them through
  // the server/device timezone.
  const now = new Date();

  const timeZone =
    baseData.forecast.timezone ||
    "UTC";

  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }
  ).formatToParts(now);

  const getPart = type =>
    parts.find(p => p.type === type)?.value || "00";

  const currentWallClock =
    `${getPart("year")}-${getPart("month")}-${getPart("day")}T` +
    `${getPart("hour")}:${getPart("minute")}`;

  let closestIndex = 0;
  let closestDifference = Infinity;

  hourly.time.forEach((time,index) => {
    const forecastKey =
      String(time).slice(0,16);

    const difference =
      Math.abs(
        Date.parse(`${forecastKey}:00Z`) -
        Date.parse(`${currentWallClock}:00Z`)
      );

    if(difference < closestDifference){
      closestDifference = difference;
      closestIndex = index;
    }
  });

  const jumpWind = windAtAltitude(
    hourly,
    closestIndex,
    targetAltitudeFt,
    groundElevation
  );

  const jumpWindSeries = [];

  // Start with the current forecast hour and then
  // provide the following 11 hours.
  for(
    let i = closestIndex;
    i < Math.min(
      closestIndex + 12,
      hourly.time.length
    );
    i++
  ){
    jumpWindSeries.push({
      time: hourly.time[i],
      ...windAtAltitude(
        hourly,
        i,
        targetAltitudeFt,
        groundElevation
      )
    });
  }

  return {
    ...baseData,

    dropzone:{
      ...baseData.dropzone,
      ground_elevation_ft:
        Math.round(groundElevation)
    },

    jumpAltitude:{
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
async function getWeatherForDropzone(
  dz,
  targetAltitudeFt
){
  const cacheKey=dz.id;
  const cached=weatherCache.get(cacheKey);

  if(
    cached&&
    Date.now()-cached.timestamp<WEATHER_CACHE_MS
  ){
    return addJumpWindData(
      cached.data,
      targetAltitudeFt
    );
  }

  const variables=[
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

  for(const pressure of PRESSURE_LEVELS){
    variables.push(
      `wind_speed_${pressure}hPa`,
      `wind_direction_${pressure}hPa`,
      `geopotential_height_${pressure}hPa`
    );
  }

  const weatherUrl=
    "https://api.open-meteo.com/v1/forecast"+
    `?latitude=${encodeURIComponent(dz.lat)}`+
    `&longitude=${encodeURIComponent(dz.lon)}`+
    `&hourly=${encodeURIComponent(variables.join(","))}`+
    "&temperature_unit=fahrenheit"+
    "&wind_speed_unit=kn"+
    "&precipitation_unit=inch"+
    "&visibility_unit=km"+
    "&timezone=auto"+
    "&forecast_days=3";

  let forecast;

  try{
  forecast=await fetchJson(
    weatherUrl,
    {},
    15000
  );
}catch(error){
  if(cached && cached.data){
    console.error(
      `Weather provider unavailable for ${dz.name}; using cached weather:`,
      error.message
    );

    return addJumpWindData(
      cached.data,
      targetAltitudeFt
    );
  }

  throw new Error(
    `Weather provider unavailable: ${error.message}`
  );
  }

  let metar=[];

  if(dz.icao){
    try{
      metar=await fetchJson(
        "https://aviationweather.gov/api/data/metars"+
        `?ids=${encodeURIComponent(dz.icao)}`+
        "&format=json&hours=2",
        {},
        10000
      );
    }catch(error){
      console.error(
        `NOAA METAR unavailable for ${dz.name}:`,
        error.message
      );
    }
  }

  const baseData={
    source:{
      forecast:"Open-Meteo",
      aviation:"NOAA Aviation Weather Center",
      retrieved_at:new Date().toISOString()
    },

    dropzone:dz,
    forecast,
    metar
  };

  weatherCache.set(cacheKey,{
    timestamp:Date.now(),
    data:baseData
  });

  return addJumpWindData(
    baseData,
    targetAltitudeFt
  );
}
app.get("/api/weather-test",async(req,res)=>{
  try{
    const data=await fetchJson(
      "https://api.open-meteo.com/v1/forecast?latitude=42.174165&longitude=-84.261341&hourly=temperature_2m&forecast_days=1",
      {},
      15000
    );

    res.json({
      success:true,
      data
    });
  }catch(error){
    res.status(502).json({
      success:false,
      error:error.message
    });
  }
});
app.get("/sw.js",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"sw.js")
  );
});
app.get("/file_00000000ee2881f5a3a88a27e4388551.jpg",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"file_00000000ee2881f5a3a88a27e4388551.jpg")
  );
});
app.get("/manifest.webmanifest",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"manifest.webmanifest")
  );
});

app.get("/icon.svg",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"icon.svg")
  );
});
app.get("/profile.js",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"profile.js")
  );
});
app.get("/jumpcast_background_desktop.jpg",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"jumpcast_background_desktop.jpg")
  );
});
app.get("/jumpcast-icon-192.png",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"jumpcast-icon-192.png")
  );
});
app.get("/jumpcast-icon-192-v3.png",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"jumpcast-icon-192-v3.png")
  );
});

app.get("/jumpcast-icon-512-v3.png",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"jumpcast-icon-512-v3.png")
  );
});
app.get("/jumpcast-icon-192-maskable.png",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"jumpcast-icon-192-maskable.png")
  );
});

app.get("/jumpcast-icon-512-maskable.png",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"jumpcast-icon-512-maskable.png")
  );
});

app.get("/jumpcast-icon-512.png",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"jumpcast-icon-512.png")
  );
});
app.get("/",(req,res)=>{
  res.sendFile(
    path.join(__dirname,"index.html")
  );
});

app.get("/api/dropzones",(req,res)=>{
  // Important:
  // Never make the website wait for USPA.
  // Refresh happens in the background.
  refreshDropzoneDirectory().catch(error=>{
    console.error(
      "Background DZ refresh failed:",
      error.message
    );
  });

  const list=sortedDropzones();

  res.json({
    source:"USPA Drop Zone Locator",
    coverage:[
      "United States",
      "Canada",
      "Mexico"
    ],
    updated_at:
      dropzoneDirectoryTimestamp
        ?new Date(
            dropzoneDirectoryTimestamp
          ).toISOString()
        :null,
    count:list.length,
    dropzones:list
  });
});

app.get("/api/weather",async(req,res)=>{
  try{
    const requested=
      String(req.query.dz||"").trim();

    let dz=
      DZ[requested]||
      Object.values(DZ).find(
        item=>item.name===requested
      );

    if(!dz&&refreshPromise){
      try{
        await Promise.race([
          refreshPromise,
          new Promise(resolve=>
            setTimeout(resolve,3000)
          )
        ]);
      }catch(_){}

      dz=
        DZ[requested]||
        Object.values(DZ).find(
          item=>item.name===requested
        );
    }

    dz=
      dz||
      DZ["fallback-midwest"]||
      Object.values(DZ)[0];

    let targetAltitudeFt=
      Number(req.query.alt)||12500;

    targetAltitudeFt=Math.max(
      1000,
      Math.min(20000,targetAltitudeFt)
    );

    const result=
      await getWeatherForDropzone(
        dz,
        targetAltitudeFt
      );

    res.json(result);

  }catch(error){
    console.error(
      "JUMPCAST WEATHER ERROR:",
      error.message
    );

    res.status(502).json({
      error:"Weather provider unavailable",
      detail:error.message
    });
  }
});

app.listen(PORT,"0.0.0.0",()=>{
  console.log(
    `JumpCast running on port ${PORT}`
  );

  // Start USPA refresh without blocking startup.
  refreshDropzoneDirectory().catch(error=>{
    console.error(
      "Startup DZ refresh failed:",
      error.message
    );
  });
});
