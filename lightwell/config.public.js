// Public settings for the hosted site (https://fromspreadsheetstobedsheets.us). This file IS committed, so only put
// browser keys here that are LOCKED to the site's domain, never server keys (Anthropic, Matterport API, Vexcel).
//
// Photoreal 3D for visitors: a Cesium ion token (free, no card) that serves Google's photoreal city.
//   1. ion.cesium.com -> sign up -> Access Tokens -> Create token
//   2. Scopes: assets:read only. Resources: "Google Photorealistic 3D Tiles" (add it from the Asset Depot first).
//   3. Allowed URLs: https://fromspreadsheetstobedsheets.us and https://www.fromspreadsheetstobedsheets.us
//   4. Paste the token between the quotes below, commit and push. The site updates in a minute.
//
// On your own computer, lightwell/config.js (git-ignored) is loaded after this file and replaces these settings.
window.LIGHTWELL_CONFIG = {
  CESIUM_ION_TOKEN: "",
};
