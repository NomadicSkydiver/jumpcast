(() => {
  const style = document.createElement("style");
  style.textContent = `
    .profile-title {
      font-size: 25px;
      font-weight: 800;
      line-height: 1.2;
      margin-top: 4px;
    }

    .profile-location {
      color: #9fb1c8;
      font-size: 14px;
      margin: 6px 0 15px;
    }

    .profile-grid {
      margin-top: 8px;
    }

    .profile-grid .metric-value {
      font-size: 14px;
      overflow-wrap: anywhere;
    }
  `;
  document.head.appendChild(style);

  const card = document.createElement("section");
  card.className = "card";
  card.id = "dzProfileCard";

  const nearbyCard =
    document.querySelector("#nearbyButton")?.closest(".card");

  if (nearbyCard) {
    nearbyCard.insertAdjacentElement("afterend", card);
  } else {
    document.querySelector(".app")?.appendChild(card);
  }

  const dzSelect = document.getElementById("dz");

  async function updateProfile() {
    const id = dzSelect?.value;

    if (!id) {
      card.innerHTML = `
        <h2>Drop Zone Profile</h2>
        <p class="muted">
          Select a drop zone to view its profile.
        </p>
      `;
      return;
    }

    try {
      const response = await fetch(
        "/api/dropzones?profile=1&ts=" + Date.now(),
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const data = await response.json();

      const dz = (data.dropzones || []).find(
        item => String(item.id) === String(id)
      );

      if (!dz) {
        card.innerHTML = `
          <h2>Drop Zone Profile</h2>
          <p class="muted">
            Profile information is unavailable.
          </p>
        `;
        return;
      }

      const location = [
        dz.city,
        dz.state,
        dz.country
      ].filter(Boolean).join(", ");

      const elevation =
        Number.isFinite(Number(dz.elevation_ft))
          ? Math.round(Number(dz.elevation_ft)).toLocaleString() + " ft MSL"
          : "Not listed";

      card.innerHTML = `
        <h2>Drop Zone Profile</h2>

        <div class="profile-title">
          ${dz.name || "Drop Zone"}
        </div>

        <div class="profile-location">
          ${location || "Location unavailable"}
        </div>

        <div class="weather-grid profile-grid">

          <div class="metric">
            <div class="metric-title">Airport</div>
            <div class="metric-value">
              ${dz.airport || "Not listed"}
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">ICAO</div>
            <div class="metric-value">
              ${dz.icao || "Not listed"}
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">Elevation</div>
            <div class="metric-value">
              ${elevation}
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">Coordinates</div>
            <div class="metric-value">
              ${
                Number.isFinite(Number(dz.lat))
                  ? Number(dz.lat).toFixed(5)
                  : "—"
              },
              ${
                Number.isFinite(Number(dz.lon))
                  ? Number(dz.lon).toFixed(5)
                  : "—"
              }
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">Phone</div>
            <div class="metric-value">
              ${dz.phone || "Not listed"}
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">Email</div>
            <div class="metric-value">
              ${dz.email || "Not listed"}
            </div>
          </div>

        </div>

        <div class="source">
          Information from the current JumpCast
          USPA-affiliated drop-zone directory.
        </div>
      `;
    } catch (error) {
      console.error("Drop Zone Profile error:", error);

      card.innerHTML = `
        <h2>Drop Zone Profile</h2>
        <p class="muted">
          Profile information is temporarily unavailable.
        </p>
      `;
    }
  }

  if (dzSelect) {
    dzSelect.addEventListener("change", updateProfile);

    setInterval(() => {
      updateProfile();
    }, 3000);
  }

  updateProfile();
})();
