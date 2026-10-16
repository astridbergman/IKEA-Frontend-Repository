
"use strict";

// ============================================================
// 1. CONFIGURATION
// ============================================================

const API_URL = "http://localhost:8000/baseInfo";
const API_BASE_URL = "http://localhost:8000";
const GEOJSON_URL = "/data/china-provinces.geojson";

// GeoJSON names mapped to the English names used by the API.
const DISPLAY_REGION_NAMES = {
  neimenggu: "Inner Mongolia",
  xizang: "Tibet"
};

// Normalized aliases used when matching GeoJSON names to API names.
// Keys and values must use the normalizeName() format.
const REGION_ALIASES = {
  xizang: "tibet",
  tibetanautonomousregion: "tibet",
  neimenggu: "innermongolia"
};

// ============================================================
// 2. MAP INITIALIZATION
// ============================================================

const map = L.map("map", {
  zoomControl: true,
  scrollWheelZoom: true
});

const searchInput = document.getElementById("regionSearch");
const regionList = document.getElementById("regionList");
const regionInfo = document.getElementById("regionInfo");

// Check that the essential HTML elements exist.
if (!searchInput || !regionList || !regionInfo) {
  throw new Error(
    "Missing map HTML elements. Check regionSearch, regionList, and regionInfo."
  );
}

const BASE_STYLE = {
  color: "#64748b",
  weight: 1,
  fillColor: "#d1d5db",
  fillOpacity: 0.85
};

const SELECTED_STYLE = {
  color: "#111827",
  weight: 3,
  fillOpacity: 1
};

let regions = [];
let scoresByRegion = new Map();
let geoJsonLayer = null;
let selectedLayer = null;

let minScore = 0;
let maxScore = 100;

// Used to prevent an earlier source request from replacing
// the data for a more recently selected region.
let sourceRequestId = 0;

// ============================================================
// 3. REGION NAME HELPERS
// ============================================================

function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function canonicalName(name) {
  const normalized = normalizeName(name);
  return REGION_ALIASES[normalized] ?? normalized;
}

function getDisplayRegionName(name) {
  if (!name) return "Unknown region";

  const trimmedName = String(name).trim();
  const normalized = normalizeName(trimmedName);

  return DISPLAY_REGION_NAMES[normalized] ?? trimmedName;
}

// Some GeoJSON files nest the actual properties under "province".
function propertiesOf(feature) {
  const properties = feature?.properties ?? {};
  return properties.province ?? properties;
}

function regionId(feature) {
  const properties = propertiesOf(feature);

  return String(
    properties.id ??
    properties.adcode ??
    properties.code ??
    regionName(feature)
  );
}

function regionName(feature) {
  const properties = propertiesOf(feature);

  return String(
    properties.name_en ??
    properties.name ??
    properties.NAME ??
    properties.region ??
    ""
  );
}

// ============================================================
// 4. SCORE COLORING
// ============================================================

// Lowest score = red, midpoint = yellow, highest score = green.
function scoreColor(score) {
  if (score == null || !Number.isFinite(score)) {
    return "#d1d5db";
  }

  const t = maxScore === minScore
    ? 0.5
    : Math.max(
        0,
        Math.min(1, (score - minScore) / (maxScore - minScore))
      );

  let r;
  let g;

  if (t <= 0.5) {
    r = 255;
    g = Math.round(510 * t);
  } else {
    r = Math.round(510 * (1 - t));
    g = 255;
  }

  const toHex = value =>
    Math.round(value).toString(16).padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}00`;
}

function getScore(feature) {
  return scoresByRegion.get(
    canonicalName(regionName(feature))
  );
}

function defaultStyle(feature) {
  return {
    ...BASE_STYLE,
    fillColor: scoreColor(getScore(feature))
  };
}

function updateSelectionStyle() {
  if (!geoJsonLayer) return;

  geoJsonLayer.eachLayer(layer => {
    const style = defaultStyle(layer.feature);

    if (layer === selectedLayer) {
      layer.setStyle({
        ...style,
        ...SELECTED_STYLE
      });
    } else {
      layer.setStyle(style);
    }
  });
}

// ============================================================
// 5. SEARCHABLE REGION LIST
// ============================================================

function renderRegionList() {
  const query = normalizeName(searchInput.value);

  regionList.replaceChildren();

  regions
    .filter(feature =>
      normalizeName(getDisplayRegionName(regionName(feature)))
        .includes(query)
    )
    .forEach(feature => {
      const name = getDisplayRegionName(regionName(feature));
      const score = getScore(feature);

      const item = document.createElement("li");

      item.dataset.id = regionId(feature);

      item.classList.toggle(
        "active",
        selectedLayer != null &&
        regionId(selectedLayer.feature) === regionId(feature)
      );

      item.textContent = score == null
        ? `${name} · No score`
        : `${name} · ${score}`;

      item.addEventListener("click", () => {
        selectRegion(feature);
      });

      regionList.appendChild(item);
    });
}

// ============================================================
// 6. REGION SELECTION AND SIDEBAR
// ============================================================

function selectRegion(feature) {
  if (!geoJsonLayer) return;

  const targetId = regionId(feature);

  const layer = geoJsonLayer.getLayers().find(candidate =>
    regionId(candidate.feature) === targetId
  );

  if (!layer) return;

  selectedLayer = layer;

  updateSelectionStyle();

  const bounds = layer.getBounds();

  if (bounds.isValid()) {
    map.fitBounds(bounds, {
      padding: [30, 30],
      maxZoom: 7
    });
  }

  renderRegionList();
  renderRegionInfo(feature);
}

function renderRegionInfo(feature) {
  const name = getDisplayRegionName(regionName(feature));
  const score = getScore(feature);

  regionInfo.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = name;
  regionInfo.appendChild(heading);

  const scoreText = document.createElement("p");
  scoreText.textContent = score == null
    ? "No score available"
    : `Score: ${score}`;

  regionInfo.appendChild(scoreText);

  if (score != null) {
    const indicator = document.createElement("p");

    indicator.style.color = scoreColor(score);
    indicator.textContent = `● Score: ${score}`;

    regionInfo.appendChild(indicator);
  }
}

function selectInitialRegion() {
  if (regions.length > 0) {
    selectRegion(regions[0]);
  }
}

// ============================================================
// 7. SOURCE MODAL ELEMENTS
// ============================================================

const modal = document.getElementById("regionModal");
const modalTitle = document.getElementById("modalTitle");
const modalSources = document.getElementById("modalSources");
const closeModal = document.getElementById("closeModal");

if (!modal || !modalTitle || !modalSources || !closeModal) {
  throw new Error(
    "Missing modal HTML elements. Check regionModal, modalTitle, modalSources, and closeModal."
  );
}

function hideRegionModal() {
  modal.hidden = true;

  // Invalidate any pending request.
  sourceRequestId++;
}

closeModal.addEventListener("click", hideRegionModal);

// Close when clicking the dark background outside the modal content.
modal.addEventListener("click", event => {
  if (event.target === modal) {
    hideRegionModal();
  }
});

// Close when Escape is pressed.
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !modal.hidden) {
    hideRegionModal();
  }
});

// ============================================================
// 8. FETCH AND DISPLAY REGION SOURCES
// ============================================================

async function openRegionModal(regionNameValue) {
  const displayName = getDisplayRegionName(regionNameValue);
  const requestId = ++sourceRequestId;

  modalTitle.textContent = displayName;
  modalSources.replaceChildren();

  const loading = document.createElement("p");
  loading.className = "modal-loading";
  loading.textContent = "Loading region information...";

  modalSources.appendChild(loading);
  modal.hidden = false;

  try {
    const params = new URLSearchParams({
      region: displayName
    });

    const response = await fetch(
      `${API_BASE_URL}/regionSources?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const sources = await response.json();

    // Ignore stale responses and responses after the modal is closed.
    if (requestId !== sourceRequestId || modal.hidden) {
      return;
    }

    modalSources.replaceChildren();

    if (!Array.isArray(sources) || sources.length === 0) {
      const message = document.createElement("p");
      message.textContent =
        "No source information is available for this region.";

      modalSources.appendChild(message);
      return;
    }

    sources.forEach(source => {
      const card = document.createElement("article");
      card.className = "source-card";

      const heading = document.createElement("h3");
      heading.textContent =
        source["type of source"] ?? "Uncategorized source";

      const score = document.createElement("p");
      score.className = "source-score";
      score.textContent =
        source.score != null
          ? `Score: ${source.score}`
          : "Score unavailable";

      const summary = document.createElement("p");
      summary.className = "source-summary";
      summary.textContent =
        source.summary || "No summary available.";

      card.append(heading, score, summary);
      modalSources.appendChild(card);
    });
  } catch (error) {
    if (requestId !== sourceRequestId || modal.hidden) {
      return;
    }

    console.error("Could not load region sources:", error);

    modalSources.replaceChildren();

    const errorMessage = document.createElement("p");
    errorMessage.className = "modal-error";
    errorMessage.textContent =
      "Could not load region information. Please try again.";

    modalSources.appendChild(errorMessage);
  }
}

// ============================================================
// 9. LOAD GEOJSON AND OVERALL SCORES
// ============================================================

async function initialiseMap() {
  regionInfo.textContent = "Loading map and scores...";

  try {
    const [geoResponse, scoreResponse] = await Promise.all([
      fetch(GEOJSON_URL),
      fetch(API_URL)
    ]);

    if (!geoResponse.ok) {
      throw new Error(
        `Failed to load GeoJSON: HTTP ${geoResponse.status}`
      );
    }

    if (!scoreResponse.ok) {
      throw new Error(
        `Failed to load scores: HTTP ${scoreResponse.status}`
      );
    }

    const geojson = await geoResponse.json();
    const scoreData = await scoreResponse.json();

    if (!Array.isArray(scoreData)) {
      throw new Error("The /baseInfo endpoint did not return an array.");
    }

    if (!Array.isArray(geojson.features)) {
      throw new Error("The GeoJSON file has no features array.");
    }

    // Build the region score lookup.
    scoresByRegion = new Map();

    for (const item of scoreData) {
      if (
        typeof item.region !== "string" ||
        item.score == null ||
        !Number.isFinite(Number(item.score))
      ) {
        console.warn("Invalid score record:", item);
        continue;
      }

      scoresByRegion.set(
        canonicalName(item.region),
        Number(item.score)
      );
    }

    const scores = [...scoresByRegion.values()];

    if (scores.length > 0) {
      minScore = Math.min(...scores);
      maxScore = Math.max(...scores);
    }

    regions = geojson.features;

    // Create the province polygons.
    geoJsonLayer = L.geoJSON(geojson, {
      style: defaultStyle,

      onEachFeature(feature, layer) {
        const name = getDisplayRegionName(regionName(feature));
        const score = getScore(feature);

        layer.bindTooltip(
          score == null
            ? `${name}: No score`
            : `${name}: ${score}`
        );

        layer.on("click", () => {
          // Update the selected province and sidebar.
          selectRegion(feature);

          // Fetch the full source information for the popup.
          openRegionModal(name);
        });
      }
    }).addTo(map);

    const mapBounds = geoJsonLayer.getBounds();

    if (mapBounds.isValid()) {
      map.fitBounds(mapBounds, {
        padding: [20, 20]
      });
    }

    renderRegionList();
    selectInitialRegion();

    // Report API names that did not match any GeoJSON region.
    const geoNames = new Set(
      regions.map(feature =>
        canonicalName(regionName(feature))
      )
    );

    const unmatched = scoreData.filter(item =>
      !geoNames.has(canonicalName(item.region))
    );

    if (unmatched.length > 0) {
      console.warn(
        "API regions not found in GeoJSON:",
        unmatched.map(item => item.region)
      );
    }

    console.log(
      `Loaded ${scoresByRegion.size} region scores. ` +
      `Score range: ${minScore}–${maxScore}`
    );
  } catch (error) {
    console.error("Map initialization failed:", error);

    regionInfo.textContent =
      "Unable to load the map or scores. Check the browser console, API, GeoJSON path, and CORS settings.";
  }
}

// ============================================================
// 10. EVENT LISTENERS AND STARTUP
// ============================================================

searchInput.addEventListener("input", renderRegionList);

initialiseMap();
