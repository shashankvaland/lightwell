// In-app Google Street View. Clicking "Street View" zooms the camera down to the tower, then opens a real
// Street View panorama inside the page, already facing the tower. Drag to look around, scroll to zoom,
// click the arrows to walk. Needs GOOGLE_MAPS_API_KEY in config.js with the Maps JavaScript API enabled.
(function () {
  const LW = window.LW, $ = id => document.getElementById(id);
  const sv = LW.streetView = { pano: null, tower: null };

  let loading = null;
  function loadMaps(key) {
    if (window.google && google.maps && google.maps.StreetViewPanorama) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      window.__lwMapsReady = () => resolve();
      // Google calls this if the key is rejected (wrong key, API not enabled, referrer not allowed, no billing)
      window.gm_authFailure = () => fail('Google rejected the Maps key. Check that the Maps JavaScript API is enabled for it, ' +
        'billing is on, and http://localhost:8765/* is in its allowed websites.');
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&v=weekly&libraries=geometry&callback=__lwMapsReady';
      s.async = true; s.onerror = () => reject(new Error('Could not reach Google Maps. Check your internet connection.'));
      document.head.appendChild(s);
    });
    return loading;
  }

  function msg(html) { $('svMsg').innerHTML = html; $('svMsg').style.display = 'flex'; $('svFace').style.display = 'none'; }
  function fail(text) {
    msg(`<b>Street View isn't available</b><span>${text}</span><button id="svTo3d">Use 3D street level instead</button>`);
    $('svTo3d').onclick = async () => { const b = sv.tower; close(); if (!LW.view.canStreet) await LW.switchView('g3d'); if (LW.view.canStreet && b) LW.view.street(b); };
  }
  function close() { $('svBox').classList.remove('open'); setTimeout(() => { if (!$('svBox').classList.contains('open')) $('svBox').style.display = 'none'; }, 250); }
  $('svClose').onclick = close;
  addEventListener('keydown', e => { if (e.key === 'Escape' && $('svBox').style.display === 'flex') close(); });

  // Turn the panorama to face the tower and tilt up toward its middle floors.
  function face(from, b) {
    const to = new google.maps.LatLng(b.center[1], b.center[0]);
    const heading = google.maps.geometry.spherical.computeHeading(from, to);
    const dist = Math.max(15, google.maps.geometry.spherical.computeDistanceBetween(from, to));
    const pitch = Math.min(40, Math.atan2(b.heightM * 0.35, dist) * 180 / Math.PI);
    sv.pano.setPov({ heading, pitch });
    sv.pano.setZoom(0.6);   // a little wider than default, so the whole tower fits
    $('svDist').textContent = `Panorama ${Math.round(dist)} m from the tower`;
  }

  // ---------------- Mapillary ----------------
  const MLY = 'https://unpkg.com/mapillary-js@4.1.2/dist/';
  let mlyLoading = null;
  function loadMapillary() {
    if (window.mapillary) return Promise.resolve();
    if (mlyLoading) return mlyLoading;
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = MLY + 'mapillary.css'; document.head.appendChild(css);
    return (mlyLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = MLY + 'mapillary.js';
      s.onload = res; s.onerror = () => rej(new Error('Could not load the Mapillary viewer.')); document.head.appendChild(s); }));
  }
  const toRad = d => d * Math.PI / 180;
  function bearingDist(lon1, lat1, lon2, lat2) {   // degrees clockwise from north, metres
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    const d = Math.hypot((lon2 - lon1) * 111320 * Math.cos(toRad(lat1)), (lat2 - lat1) * 110540);
    return [(Math.atan2(y, x) * 180 / Math.PI + 360) % 360, d];
  }
  const angDiff = (a, c) => Math.abs(((a - c + 540) % 360) - 180);
  function hideMly() { $('mly').style.display = 'none'; $('pano').style.display = ''; }

  // Pick the best Mapillary photo near the tower: a 360° panorama close by, or a normal photo that already faces it.
  async function findMapillary(b, token) {
    const [lon, lat] = b.center, r = 0.0013;   // ~140 m box (the API caps boxes at 0.01°)
    const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}` +
      `&bbox=${(lon - r).toFixed(6)},${(lat - r).toFixed(6)},${(lon + r).toFixed(6)},${(lat + r).toFixed(6)}` +
      `&fields=id,computed_geometry,geometry,computed_compass_angle,compass_angle,is_pano,captured_at&limit=500`;
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) throw new Error('Mapillary rejected the token. Copy the Client Token (starts with MLY|), not the Client ID or Secret.');
    if (!res.ok) throw new Error('Mapillary returned an error (' + res.status + ').');
    const rows = (await res.json()).data || [];
    let best = null;
    for (const im of rows) {
      const g = (im.computed_geometry || im.geometry); if (!g) continue;
      const [ilon, ilat] = g.coordinates, [toTower, dist] = bearingDist(ilon, ilat, lon, lat);
      if (dist < 12) continue;                                    // standing inside the footprint: useless view
      const cam = im.computed_compass_angle ?? im.compass_angle;
      let score;
      if (im.is_pano) score = dist;
      else if (cam != null && angDiff(cam, toTower) < 45) score = dist + 25 + angDiff(cam, toTower);
      else continue;
      score += Math.min(60, (Date.now() - (im.captured_at || 0)) / (365 * 864e5) * 6);   // prefer recent photos
      if (!best || score < best.score) best = { ...im, score, dist, toTower };
    }
    return { best, count: rows.length };
  }

  async function openMapillary(b, token) {
    msg('<span>Finding the nearest Mapillary street photo…</span>');
    let found;
    try { found = await findMapillary(b, token); } catch (e) { return e.message; }
    if (sv.tower !== b) return true;
    if (!found.best) return found.count ? 'Mapillary has photos near this tower, but none that look toward it.'
      : 'Mapillary has no street photos within about 140 m of this tower.';
    try { await loadMapillary(); } catch (e) { return e.message; }
    $('svMsg').style.display = 'none'; $('pano').style.display = 'none'; $('mly').style.display = '';
    const im = found.best;
    // a fresh viewer per tower: moveTo() fails while a previous viewer is still loading
    if (sv.mly) { try { sv.mly.remove(); } catch (e) { /* already gone */ } }
    sv.mly = new mapillary.Viewer({ accessToken: token, container: 'mly', imageId: im.id });
    sv.provider = 'mapillary';
    const when = im.captured_at ? new Date(im.captured_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '';
    $('svDist').textContent = `Mapillary ${im.is_pano ? '360° panorama' : 'photo'} · ${Math.round(im.dist)} m from the tower${when ? ' · ' + when : ''}`;
    const faceIt = async () => {   // turn toward the tower: calibrate the view's bearing, then shift horizontally
      if (!sv.mly) return;
      try {
        await sv.mly.setCenter([0.5, 0.55]); const now = await sv.mly.getBearing();
        const delta = ((found.best.toTower - now + 540) % 360) - 180;
        if (im.is_pano) await sv.mly.setCenter([(0.5 + delta / 360 + 1) % 1, 0.45]);
      } catch (e) { /* viewer not ready yet; the default view is close */ }
    };
    sv.mly.on('image', function once() { sv.mly.off('image', once); setTimeout(faceIt, 300); });
    setTimeout(faceIt, 1200);
    $('svFace').style.display = ''; $('svFace').onclick = faceIt;
    return true;
  }

  sv.open = async function (b) {
    sv.tower = b;
    $('plateBox').style.display = 'none';
    // 1. the "zoom in" moment: fly the current 3D / map camera down to the tower first
    LW.view.stopOrbit && LW.view.stopOrbit(); LW.view.fly(b);
    $('svTitle').textContent = `Street View · ${b.label}`; $('svDist').textContent = '';
    $('svMsg').style.display = 'none';
    await new Promise(r => setTimeout(r, 900));
    $('svBox').style.display = 'flex'; requestAnimationFrame(() => $('svBox').classList.add('open'));

    const cfg = window.LIGHTWELL_CONFIG || {};
    // 1st choice: Mapillary (free). 2nd: Google Street View (needs a billed key). Last: the 3D street level.
    if (cfg.MAPILLARY_TOKEN) {
      const r = await openMapillary(b, cfg.MAPILLARY_TOKEN);
      if (r === true || sv.tower !== b) return;
      if (!cfg.GOOGLE_MAPS_API_KEY) return fail(r);
    }
    const key = cfg.GOOGLE_MAPS_API_KEY;
    if (!key) return fail('Add a free Mapillary token (MAPILLARY_TOKEN) or a Google Maps key (GOOGLE_MAPS_API_KEY) ' +
      'to <code>lightwell/config.js</code> to see real street photos here.');
    hideMly();
    msg('<span>Finding the nearest street photo…</span>');
    try { await loadMaps(key); } catch (e) { return fail(e.message); }

    // 2. find the closest outdoor panorama within 150 m of the tower
    const service = new google.maps.StreetViewService();
    let data;
    try {
      ({ data } = await service.getPanorama({ location: { lat: b.center[1], lng: b.center[0] }, radius: 150, source: 'outdoor', preference: 'nearest' }));
    } catch (e) { return fail('Google has no outdoor Street View within 150 m of this tower.'); }
    if (sv.tower !== b) return;   // the user picked another tower meanwhile
    $('svMsg').style.display = 'none';

    // 3. show it inside the page, facing the tower
    if (!sv.pano) {
      sv.pano = new google.maps.StreetViewPanorama($('pano'), {
        pano: data.location.pano, addressControl: false, fullscreenControl: true, motionTracking: false,
        motionTrackingControl: false, enableCloseButton: false, showRoadLabels: true, zoomControl: true,
      });
    } else sv.pano.setPano(data.location.pano);
    face(data.location.latLng, b);
    $('svFace').style.display = ''; $('svFace').onclick = () => face(sv.pano.getPosition(), b);
  };
})();
