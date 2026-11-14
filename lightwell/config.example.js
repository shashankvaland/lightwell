// Lightwell settings. Edit this file yourself; never paste keys into chat or commit them to a public repo.
window.LIGHTWELL_CONFIG = {
  // Photoreal 3D view (Google Photorealistic 3D Tiles). Use ONE of these:
  //  - a Google Maps Platform key with the Map Tiles API enabled, or
  //  - a Cesium ion access token (ion serves the same Google tiles).
  // Leave both empty to use the built-in 3D view of the OpenStreetMap buildings.
  GOOGLE_MAPS_API_KEY: "",
  CESIUM_ION_TOKEN: "",

  // In-app street photos from Mapillary (free). Client Token from mapillary.com/dashboard/developers,
  // starts with "MLY|". Used first by the Street View button; Google is the fallback.
  MAPILLARY_TOKEN: "",

  // Agent backend (backend/app.py). This is also the default when config.js is missing.
  // If it isn't running, the app uses its built-in offline agent. Set to "" to always use the offline agent.
  BACKEND_URL: "http://localhost:8000",
};
