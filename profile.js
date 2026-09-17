(() => {
  function addStyles() {
    if (document.getElementById("jumpcast-profile-styles")) return;

    const style = document.createElement("style");
    style.id = "jumpcast-profile-styles";

    style.textContent = `
      .jumpcast-profile-title {
        font-size: 25px;
        font-weight: 800;
        line-height: 1.2;
        margin-top: 4px;
      }

      .jumpcast-profile-location {
        color: #9fb1c8;
        font-size: 14px;
        margin: 6px 0 15px;
      }

      .jumpcast-profile-grid {
        margin-top: 8px;
      }

      .jumpcast-profile-grid .metric-value {
        font-size: 14px;
        overflow-wrap: anywhere;
      }

      .jumpcast-profile-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 16px;
      }

      .jumpcast-profile-action {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 10px 12px;
        border: 1px solid #29405f;
        border-radius: 12px;
        background: #0b1729;
        color: #ffffff;
        text-decoration: none;
        font-weight: 700;
        font-size: 14px;
        box-sizing: border-box;
      }

      .jumpcast-profile-action:hover {
        border-color: #4f6f98;
      }

      @media (max-width: 430px) {
        .jumpcast-profile-actions {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function findCommunityCard() {
    const headings = Array.from(
      document.querySelectorAll("h2")
    );

    const heading = headings.find(
      h =>
        h.textContent.trim().toLowerCase() ===
        "community reports"
    );

    return heading ? heading.closest(".card") : null;
  }

  function createCard() {
    let card =
      document.getElementById("dzProfileCard");

    if (card) return card;

    card = document.createElement("section");
    card.className = "card";
    card.id = "dzProfileCard";

    card.innerHTML = `
      <h2>Drop Zone Profile</h2>
      <p class="muted">
        Select a drop zone to view its profile.
      </p>
    `;

    const communityCard = findCommunityCard();

    if (communityCard && communityCard.parentNode) {
      communityCard.parentNode.insertBefore(
        card,
        communityCard
      );
    } else {
      const app =
        document.querySelector(".app");

      if (app) {
        app.appendChild(card);
      }
    }

    return card;
  }

  async function updateProfile() {
    const card = createCard();

    if (!card) return;

    const select =
      document.getElementById("dz");

    if (!select || !select.value) {
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
        "/api/dropzones?profile=1&ts=" +
        Date.now(),
        {
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw new Error(
          "HTTP " + response.status
        );
      }

      const data =
        await response.json();

      const dz =
        (data.dropzones || []).find(
          item =>
            String(item.id) ===
            String(select.value)
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
      ]
        .filter(Boolean)
        .join(", ");

      const elevationNumber =
        Number(dz.elevation_ft);

      const elevation =
        Number.isFinite(elevationNumber) &&
        elevationNumber > 0
          ? Math.round(
              elevationNumber
            ).toLocaleString() +
            " ft MSL"
          : "Not listed";

      const latitude =
        Number.isFinite(Number(dz.lat))
          ? Number(dz.lat).toFixed(5)
          : null;

      const longitude =
        Number.isFinite(Number(dz.lon))
          ? Number(dz.lon).toFixed(5)
          : null;

      const phone =
        String(dz.phone || "").trim();

      const email =
        String(dz.email || "").trim();

      const hasCoordinates =
        latitude !== null &&
        longitude !== null;

      const mapsUrl = hasCoordinates
        ? "https://www.google.com/maps/search/?api=1&query=" +
          encodeURIComponent(
            latitude + "," + longitude
          )
        : "";

      const phoneUrl = phone
        ? "tel:" + phone.replace(/[^\d+]/g, "")
        : "";

      const emailUrl = email
        ? "mailto:" + email
        : "";

      card.innerHTML = `
        <h2>Drop Zone Profile</h2>

        <div class="jumpcast-profile-title">
          ${dz.name || "Drop Zone"}
        </div>

        <div class="jumpcast-profile-location">
          ${location || "Location unavailable"}
        </div>

        <div class="weather-grid jumpcast-profile-grid">

          <div class="metric">
            <div class="metric-title">
              Airport
            </div>
            <div class="metric-value">
              ${dz.airport || "Not listed"}
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">
              ICAO
            </div>
            <div class="metric-value">
              ${dz.icao || "Not listed"}
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">
              Elevation
            </div>
            <div class="metric-value">
              ${elevation}
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">
              Coordinates
            </div>
            <div class="metric-value">
              ${
                hasCoordinates
                  ? latitude + ", " + longitude
                  : "Not listed"
              }
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">
              Phone
            </div>
            <div class="metric-value">
              ${phone || "Not listed"}
            </div>
          </div>

          <div class="metric">
            <div class="metric-title">
              Email
            </div>
            <div class="metric-value">
              ${email || "Not listed"}
            </div>
          </div>

        </div>

        <div class="jumpcast-profile-actions">

          ${
            mapsUrl
              ? `
                <a
                  class="jumpcast-profile-action"
                  href="${mapsUrl}"
                  target="_blank"
                  rel="noopener"
                >
                  📍 Get Directions
                </a>
              `
              : ""
          }

          ${
            phoneUrl
              ? `
                <a
                  class="jumpcast-profile-action"
                  href="${phoneUrl}"
                >
                  📞 Call DZ
                </a>
              `
              : ""
          }

          ${
            emailUrl
              ? `
                <a
                  class="jumpcast-profile-action"
                  href="${emailUrl}"
                >
                  ✉️ Email DZ
                </a>
              `
              : ""
          }

          ${
            hasCoordinates
              ? `
                <a
                  class="jumpcast-profile-action"
                  href="${mapsUrl}"
                  target="_blank"
                  rel="noopener"
                >
                  🗺️ Open Map
                </a>
              `
              : ""
          }

        </div>

        <div class="source">
          Information from the current
          JumpCast USPA-affiliated directory.
        </div>
      `;

    } catch (error) {
      console.error(
        "Drop Zone Profile error:",
        error
      );

      card.innerHTML = `
        <h2>Drop Zone Profile</h2>
        <p class="muted">
          Profile information is temporarily
          unavailable.
        </p>
      `;
    }
  }

  function start() {
    addStyles();
    createCard();
    updateProfile();

    const select =
      document.getElementById("dz");

    if (select) {
      select.addEventListener(
        "change",
        () => {
          setTimeout(
            updateProfile,
            100
          );
        }
      );
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start
    );
  } else {
    start();
  }
})();
