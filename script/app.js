const API_URL = "http://localhost:8000/baseInfo";
const GEOJSON_URL = "/data/china-provinces.geojson";

const map = L.map("map", {
  zoomControl: true,
  scrollWheelZoom: true
});

const searchInput = document.getElementById("regionSearch");
const regionList = document.getElementById("regionList");
const regionInfo = document.getElementById("regionInfo");

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
let geoJsonLayer;
let selectedLayer = null;
let currentRequest = null;
let minScore = 0;
let maxScore = 100;

// Normalize names for matching API data to GeoJSON.
function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Add aliases here if the API and GeoJSON use different names.
const REGION_ALIASES = {
  "xizang": "tibet",
  "tibetanautonomousregion": "tibet",
  "inner mongolia": "inner mongolia"
};

function canonicalName(name) {
  const normalized = normalizeName(name);
  return REGION_ALIASES[normalized] ?? normalized;
}

function propertiesOf(feature) {
  const p = feature.properties ?? {};
  return p.province ?? p;
}

function regionId(feature) {
  const p = propertiesOf(feature);
  return String(p.id ?? p.adcode ?? p.code ?? "");
}

function regionName(feature) {
  const p = propertiesOf(feature);
  return String(p.name_en ?? p.name ?? "");
}

// Red -> yellow -> green.
// The lowest score is red, the midpoint is yellow,
// and the highest score is green.
function scoreColor(score) {
  if (score == null || !Number.isFinite(score)) {
    return "#d1d5db";
  }

  let t = maxScore === minScore
    ? 0.5
    : (score - minScore) / (maxScore - minScore);

  t = Math.max(0, Math.min(1, t));

  let r, g, b = 0;

  if (t <= 0.5) {
    // Red to yellow.
    r = 255;
    g = Math.round(510 * t);
  } else {
    // Yellow to green.
    r = Math.round(510 * (1 - t));
    g = 255;
  }

  const hex = value =>
    Math.round(value).toString(16).padStart(2, "0");

  return `#${hex(r)}${hex(g)}${hex(b)}`;
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
    layer.setStyle(
      layer === selectedLayer
        ? {
            ...defaultStyle(layer.feature),
            ...SELECTED_STYLE
          }
        : defaultStyle(layer.feature)
    );
  });
}

function renderRegionList() {
  const query = normalizeName(searchInput.value);

  regionList.replaceChildren();

  regions
    .filter(feature =>
      normalizeName(regionName(feature)).includes(query)
    )
    .forEach(feature => {
      const name = regionName(feature);
      const score = getScore(feature);
      const item = document.createElement("li");

      item.dataset.id = regionId(feature);
      item.classList.toggle(
        "active",
        selectedLayer &&
        regionId(selectedLayer.feature) === regionId(feature)
      );

      item.textContent =
        score == null
          ? `${name} · No score`
          : `${name} · ${score}`;

      item.addEventListener("click", () => {
        selectRegion(feature);
      });

      regionList.appendChild(item);
    });
}

function selectRegion(feature) {
  const layer = geoJsonLayer.getLayers().find(
    candidate =>
      regionId(candidate.feature) === regionId(feature)
  );

  if (!layer) return;

  selectedLayer = layer;
  updateSelectionStyle();

  map.fitBounds(layer.getBounds(), {
    padding: [30, 30],
    maxZoom: 7
  });

  renderRegionList();
  renderRegionInfo(feature);
}

function renderRegionInfo(feature) {
  const name = regionName(feature);
  const score = getScore(feature);

  regionInfo.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = name;
  regionInfo.appendChild(heading);

  const scoreText = document.createElement("p");
  scoreText.textContent =
    score == null
      ? "No score available"
      : `Score: ${score}`;

  regionInfo.appendChild(scoreText);

  if (score != null) {
    const indicator = document.createElement("div");
    indicator.textContent =
      scoreColor(score) === "#d1d5db"
        ? ""
        : "● ";

    indicator.style.color = scoreColor(score);
    indicator.append(
      document.createTextNode(
        scoreColor(score) === "#d1d5db"
          ? "Score unavailable"
          : "Score indicator"
      )
    );

    regionInfo.appendChild(indicator);
  }
}

function selectInitialRegion() {
  if (regions.length > 0) {
    selectRegion(regions[0]);
  }
}

async function initialiseMap() {
  regionInfo.textContent = "Loading map and scores...";

  try {
    // Load the boundaries and all scores in parallel.
    const [geoResponse, scoreResponse] = await Promise.all([
      fetch(GEOJSON_URL),
      fetch(API_URL)
    ]);

    if (!geoResponse.ok) {
      throw new Error("Failed to load GeoJSON");
    }

    if (!scoreResponse.ok) {
      throw new Error("Failed to load region scores");
    }

    const geojson = await geoResponse.json();
    const scoreData = await scoreResponse.json();

    // Build a lookup table for fast name-based matching.
    scoresByRegion = new Map();

    for (const item of scoreData) {
      if (
        typeof item.region !== "string" ||
        typeof item.score !== "number" ||
        !Number.isFinite(item.score)
      ) {
        console.warn("Invalid score record:", item);
        continue;
      }

      scoresByRegion.set(
        canonicalName(item.region),
        item.score
      );
    }

    const scores = [...scoresByRegion.values()];

    if (scores.length > 0) {
      minScore = Math.min(...scores);
      maxScore = Math.max(...scores);
    }

    regions = geojson.features ?? [];

    geoJsonLayer = L.geoJSON(geojson, {
      style: defaultStyle,

      onEachFeature(feature, layer) {
        const name = regionName(feature);
        const score = getScore(feature);

        layer.bindTooltip(
          score == null
            ? `${name}: No score`
            : `${name}: ${score}`
        );

        layer.on("click", () => {
          selectRegion(feature);
        });
      }
    }).addTo(map);

    map.fitBounds(geoJsonLayer.getBounds(), {
      padding: [20, 20]
    });

    renderRegionList();
    selectInitialRegion();

    // Report unmatched API regions for debugging.
    const geoNames = new Set(
      regions.map(feature =>
        canonicalName(regionName(feature))
      )
    );

    const unmatched = scoreData.filter(item =>
      !geoNames.has(canonicalName(item.region))
    );

    if (unmatched.length) {
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
    console.error(error);
    regionInfo.textContent =
      "Unable to load the map or scores. Check the API, GeoJSON, and CORS settings.";
  }
}

searchInput.addEventListener("input", renderRegionList);

initialiseMap();