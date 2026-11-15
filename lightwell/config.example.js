// Lightwell settings. Edit this file yourself; never paste keys into chat or commit them to a public repo.
window.LIGHTWELL_CONFIG = {
  // Photoreal 3D view (Google Photorealistic 3D Tiles). Use ONE of these:
  //  - a Google Maps Platform key with the Map Tiles API enabled, or
  //  - a Cesium ion access token (ion serves the same Google tiles).
  // Leave both empty to use the built-in 3D view of the OpenStreetMap buildings.
  // The Google key also plays Google Aerial View flyovers of the CoStar towers (enable the Aerial View API) and the
  // in-app Street View (Maps JavaScript API). Its Google Cloud project needs billing turned on.
  GOOGLE_MAPS_API_KEY: "",
  CESIUM_ION_TOKEN: "",

  // In-app street photos from Mapillary (free). Client Token from mapillary.com/dashboard/developers,
  // starts with "MLY|". Used first by the Street View button; Google is the fallback.
  MAPILLARY_TOKEN: "",

  // Matterport Showcase SDK key: the "SDK key" on the CoStar Discord card "Matterport GraphQL + SDK" (allowed domain:
  // localhost). Not used today: the 3D tour is a plain embed and needs no key (adding the key to the tour made
  // Matterport wait for an SDK connection the page never makes). Kept for a future feature that drives the tour.
  MATTERPORT_SDK_KEY: "",

  // CoStar photos on the building card (links in the CoStar data kit). Off by default: CoStar's image server refused
  // them from our network (HTTP 403). Set to true if they load for you.
  COSTAR_PHOTOS: false,

  // Agent backend (backend/app.py). This is also the default when config.js is missing.
  // If it isn't running, the app uses its built-in offline agent. Set to "" to always use the offline agent.
  BACKEND_URL: "http://localhost:8000",
};
