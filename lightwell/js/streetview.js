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

  sv.open = async function (b) {
    sv.tower = b;
    $('plateBox').style.display = 'none';
    // 1. the "zoom in" moment: fly the current 3D / map camera down to the tower first
    LW.view.stopOrbit && LW.view.stopOrbit(); LW.view.fly(b);
    $('svTitle').textContent = `Street View · ${b.label}`; $('svDist').textContent = '';
    $('svMsg').style.display = 'none';
    await new Promise(r => setTimeout(r, 900));
    $('svBox').style.display = 'flex'; requestAnimationFrame(() => $('svBox').classList.add('open'));

    const key = (window.LIGHTWELL_CONFIG || {}).GOOGLE_MAPS_API_KEY;
    if (!key) return fail('Add a Google Maps key to <code>lightwell/config.js</code> (GOOGLE_MAPS_API_KEY) with the ' +
      '<b>Maps JavaScript API</b> enabled. Real street photos only come from Google.');
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
