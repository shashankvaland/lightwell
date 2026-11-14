// Two interchangeable 3D views with the same interface:
//   init(), paint(b), select(b, prev), fly(b), setFlags(list), show(on)
//  - views.map : MapLibre + OpenFreeMap streets + OpenStreetMap buildings (no key needed)
//  - views.g3d : CesiumJS. With a Google key or Cesium ion token it loads Google Photorealistic 3D Tiles and
//                paints the candidate towers onto the real city; without one it shows the OSM buildings in 3D.
(function () {
  const LW = window.LW, views = LW.views = {};
  const CENTER = [-95.3665, 29.7575];
  // Daylight X-ray colour of floor f: slate (no home sees the sky) to gold (every home does); grey = no data.
  const SLATE = [58, 71, 102], GOLD = [245, 185, 66];
  LW.dayColor = (b, f) => { const d = b.plan && b.plan.day; if (!d) return '#3b4254'; if (f < 2) return '#2c3a52';
    const s = b.plan.perFloor ? d.byFloor[f - 2] / b.plan.perFloor : 0; return LW.hex(SLATE.map((v, i) => Math.round(v + (GOLD[i] - v) * s))); };

  // Tenant-move arcs: points along a raised arc from the tower being emptied to the receiving tower.
  // Heights in metres above ground; t in [0,1].
  LW.arcPoints = function (m, n) {
    const A = LW.B.find(b => b.id === m.from), C = LW.B.find(b => b.id === m.to); if (!A || !C) return [];
    const h0 = A.heightM * 0.7, h1 = C.heightM * 0.6, peak = Math.max(90, m.dist_m * 0.35), out = [];
    for (let i = 0; i <= n; i++) { const t = i / n;
      out.push({ t, lon: A.center[0] + (C.center[0] - A.center[0]) * t, lat: A.center[1] + (C.center[1] - A.center[1]) * t,
        h: h0 + (h1 - h0) * t + peak * 4 * t * (1 - t) }); }
    return out;
  };

  // ---------------- MapLibre ----------------
  views.map = {
    ready: false,
    init() {
      if (this._init) return this._init;
      this._init = new Promise((resolve) => {
        const map = this.map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/dark',
          center: CENTER, zoom: 15.2, pitch: 58, bearing: -28, antialias: true });
        map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
        map.once('style.load', () => {
          const gj = LW.geo, cand = new Set(LW.B.map(b => b.osmId));
          gj.features.forEach(f => { f.properties.cand = cand.has(f.properties.id); });
          map.getStyle().layers.filter(l => l.type === 'fill-extrusion').forEach(l => map.setLayoutProperty(l.id, 'visibility', 'none'));
          map.addSource('bld', { type: 'geojson', data: gj, promoteId: 'id' });
          map.addLayer({ id: 'bld', type: 'fill-extrusion', source: 'bld', paint: {
            'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#ffffff',
              ['to-color', ['coalesce', ['feature-state', 'color'], ['case', ['get', 'cand'], '#4a5a80', '#232c40']]]],
            'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.93 } });
          map.addSource('flags', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'flags', type: 'circle', source: 'flags', paint: { 'circle-radius': 9, 'circle-color': '#ef5d6f', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
          map.on('click', 'bld', e => { const b = LW.byOsm.get(e.features[0].properties.id); LW.onSelect(b || null, false); });
          map.on('mouseenter', 'bld', () => map.getCanvas().style.cursor = 'pointer');
          map.on('mouseleave', 'bld', () => map.getCanvas().style.cursor = '');
          this.ready = true; resolve();
        });
      });
      return this._init;
    },
    paint(b) { if (this.ready) this.map.setFeatureState({ source: 'bld', id: b.osmId }, { color: b.score == null || !LW.scored ? null : LW.hex(LW.scoreRGB(b.score)) }); },
    select(b, prev) {
      if (!this.ready) return;
      if (prev) this.map.setFeatureState({ source: 'bld', id: prev.osmId }, { sel: false });
      if (b) this.map.setFeatureState({ source: 'bld', id: b.osmId }, { sel: true });
      this._floorsSel();
      if (this.map.getSource('dayLines')) this._dayLines();
    },
    fly(b) { if (this.ready) this.map.flyTo({ center: b.center, zoom: 16.6, pitch: 62, bearing: this.map.getBearing() + 25, speed: 0.8 }); },
    overview() { if (this.ready) this.map.easeTo({ zoom: 14.8, pitch: 55, bearing: this.map.getBearing() - 20, duration: 1500 }); },
    setFlags(list) { if (this.ready) this.map.getSource('flags').setData({ type: 'FeatureCollection',
      features: list.map(b => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: b.center } })) }); },
    show(on) { document.getElementById('map').style.visibility = on ? 'visible' : 'hidden'; if (on && this.ready) this.map.resize(); },
    // tenant moves: floating gold arcs (small extruded boxes) with a white pulse running along them
    setMoves(plan) {
      if (!this.ready) return; const map = this.map;
      if (!map.getSource('moves')) {
        map.addSource('moves', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('movesGround', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'movesGround', type: 'line', source: 'movesGround', paint: { 'line-color': '#f5b942', 'line-width': 2, 'line-opacity': 0.55, 'line-dasharray': [2, 2] } });
        map.addLayer({ id: 'moves', type: 'fill-extrusion', source: 'moves', paint: { 'fill-extrusion-color': '#f5b942',
          'fill-extrusion-base': ['get', 'lo'], 'fill-extrusion-height': ['get', 'hi'], 'fill-extrusion-opacity': 0.95 } });
      }
      clearInterval(this._movesTimer);
      const feats = [], ground = [], moves = plan ? plan.moves : [];
      for (const m of moves) {
        const pts = LW.arcPoints(m, 48), r = 2.6 / 111320, rl = r / Math.cos(29.76 * Math.PI / 180);
        for (const q of pts.slice(1, -1)) feats.push({ type: 'Feature', properties: { p: q.t, lo: q.h, hi: q.h + 4 },
          geometry: { type: 'Polygon', coordinates: [[[q.lon - rl, q.lat - r], [q.lon + rl, q.lat - r], [q.lon + rl, q.lat + r], [q.lon - rl, q.lat + r], [q.lon - rl, q.lat - r]]] } });
        ground.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [pts[0], pts[pts.length - 1]].map(q => [q.lon, q.lat]) } });
      }
      map.getSource('moves').setData({ type: 'FeatureCollection', features: feats });
      map.getSource('movesGround').setData({ type: 'FeatureCollection', features: ground });
      if (!moves.length) return;
      let ph = 0;
      this._movesTimer = setInterval(() => { ph = (ph + 0.025) % 1.15;
        map.setPaintProperty('moves', 'fill-extrusion-color', ['case', ['<', ['abs', ['-', ['get', 'p'], ph]], 0.07], '#ffffff', '#f5b942']); }, 50);
    },
    // drone orbit: tilt in and keep turning the bearing around the tower until the user touches the map
    orbit(b) {
      if (!this.ready) return; this.stopOrbit();
      const map = this.map; let bearing = 0, last = 0, on = true, started = false;
      const stop = () => this.stopOrbit();
      map.once('mousedown', stop); map.once('wheel', stop); map.once('touchstart', stop);
      map.easeTo({ center: b.center, zoom: 17, pitch: 65, duration: 1200 });
      const step = t => { if (!on) return; bearing += (t - last) * 0.012; last = t; map.setBearing(bearing % 360); this._raf = requestAnimationFrame(step); };
      // start turning once the fly-in ends (or after 1.5 s at the latest)
      const begin = () => { if (!on || started) return; started = true; map.stop();
        map.jumpTo({ center: b.center, zoom: 17, pitch: 65 });   // make sure we're centred on the tower
        bearing = map.getBearing(); last = performance.now(); this._raf = requestAnimationFrame(step); };
      map.once('moveend', begin); this._t = setTimeout(begin, 1500);
      this._stopOrbit = () => { on = false; clearTimeout(this._t); cancelAnimationFrame(this._raf); };
    },
    stopOrbit() { if (this._stopOrbit) { this._stopOrbit(); this._stopOrbit = null; } },
    canStreet: false,

    // ---- empty floors: every candidate tower drawn as stacked floor slabs ----
    _floorsGeo() {
      const feats = [];
      for (const b of LW.B) {
        if (LW.srcOf(b, 'vacant') === 'MISSING') continue;   // unknown is not "fully leased": don't draw it
        const fh = b.heightM / b.floors, empty = new Set(b.vacantFloors);
        for (let f = 1; f <= b.floors; f++) feats.push({ type: 'Feature', properties: { bidx: b.idx, empty: empty.has(f),
          base: (f - 1) * fh, top: f * fh - Math.min(0.8, fh * 0.2) }, geometry: { type: 'Polygon', coordinates: [b.ring] } });
      }
      return { type: 'FeatureCollection', features: feats };
    },
    setFloors(on) {
      if (!this.ready) return; const map = this.map;
      if (on && map.getSource('floors')) map.getSource('floors').setData(this._floorsGeo());   // the tower list may have changed
      if (on && !map.getSource('floors')) {
        map.addSource('floors', { type: 'geojson', data: this._floorsGeo() });
        const paint = (sel, other) => ({ 'fill-extrusion-color': ['case', ['==', ['get', 'bidx'], -1], sel, other],
          'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'] });
        map.addLayer({ id: 'floorsLeased', type: 'fill-extrusion', source: 'floors', filter: ['!', ['get', 'empty']],
          paint: { ...paint('#9fb2d6', '#3a4766'), 'fill-extrusion-opacity': 0.35 } }, 'flags');
        map.addLayer({ id: 'floorsEmpty', type: 'fill-extrusion', source: 'floors', filter: ['get', 'empty'],
          paint: { ...paint('#fff0b8', '#f5b942'), 'fill-extrusion-opacity': 0.95 } }, 'flags');
        for (const id of ['floorsLeased', 'floorsEmpty']) {
          map.on('click', id, e => LW.onSelect(LW.B[e.features[0].properties.bidx], false));
          map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
          map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
        }
      }
      if (!map.getSource('floors')) return;
      for (const id of ['floorsLeased', 'floorsEmpty']) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      map.setFilter('bld', on ? ['!', ['get', 'cand']] : null);   // hide the solid towers while floors are shown
      this._floorsSel();
    },
    _floorsSel() {   // brighten the selected tower's floors
      if (!this.map.getLayer('floorsEmpty')) return;
      const i = LW.selected ? LW.selected.idx : -1;
      this.map.setPaintProperty('floorsEmpty', 'fill-extrusion-color', ['case', ['==', ['get', 'bidx'], i], '#fff0b8', '#f5b942']);
      this.map.setPaintProperty('floorsLeased', 'fill-extrusion-color', ['case', ['==', ['get', 'bidx'], i], '#9fb2d6', '#3a4766']);
    },

    // ---- Daylight X-ray: every candidate tower as floor slabs, coloured by how much sky its windows see ----
    _dayGeo() {
      const feats = [];
      for (const b of LW.B) {
        if (!b.plan) LW.analyze(b);
        const n = LW.eff(b, 'floors'), fh = b.heightM / n, d = b.plan.day;
        for (let f = 1; f <= n; f++) feats.push({ type: 'Feature', properties: { bidx: b.idx, f, open: d && f >= 2 ? d.byFloor[f - 2] : -1, per: b.plan.perFloor,
          c: LW.dayColor(b, f), base: (f - 1) * fh, top: f * fh - Math.min(0.8, fh * 0.2) }, geometry: { type: 'Polygon', coordinates: [b.ring] } });
      }
      return { type: 'FeatureCollection', features: feats };
    },
    setDaylight(on) {
      if (!this.ready) return; const map = this.map;
      if (on && map.getSource('day')) map.getSource('day').setData(this._dayGeo());   // the brief or the tower list may have changed
      if (on && !map.getSource('day')) {
        map.addSource('day', { type: 'geojson', data: this._dayGeo() });
        map.addLayer({ id: 'daySlabs', type: 'fill-extrusion', source: 'day', paint: { 'fill-extrusion-color': ['get', 'c'],
          'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 0.95 } }, 'flags');
        map.addSource('dayLines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'dayLines', type: 'line', source: 'dayLines', filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': '#ef5d6f', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } }, 'flags');
        map.addLayer({ id: 'dayBlk', type: 'circle', source: 'dayLines', filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': 6, 'circle-color': '#ef5d6f', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } }, 'flags');
        const pop = this._dayPop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
        map.on('click', 'daySlabs', e => LW.onSelect(LW.B[e.features[0].properties.bidx], false));
        map.on('mousemove', 'daySlabs', e => {
          const q = e.features[0].properties, b = LW.B[q.bidx]; if (!b) return;
          map.getCanvas().style.cursor = 'pointer';
          pop.setLngLat(e.lngLat).setHTML(`<b>${LW.esc(b.label)}</b> · floor ${q.f}: ` + (q.f < 2 ? 'lobby' : q.open < 0 ? 'no data' : `${q.open} of ${q.per} homes see the sky`)).addTo(map);
        });
        map.on('mouseleave', 'daySlabs', () => { map.getCanvas().style.cursor = ''; pop.remove(); });
      }
      if (!map.getSource('day')) return;
      for (const id of ['daySlabs', 'dayLines', 'dayBlk']) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      if (!on && this._dayPop) this._dayPop.remove();
      map.setFilter('bld', on ? ['!', ['get', 'cand']] : (LW.floorsOn ? ['!', ['get', 'cand']] : null));   // hide the solid towers while slabs are shown
      this._dayLines();
    },
    // red dashed lines from the selected tower to the main blocker of each dim wall
    _dayLines() {
      const src = this.map.getSource('dayLines'); if (!src) return;
      const b = LW.selected, d = LW.dayViewOn && b && b.plan && b.plan.day, feats = [];
      if (d) for (const k of Object.keys(d.walls)) {
        const blk = k !== 'court' && b.day.blk[k]; if (!blk) continue;
        feats.push({ type: 'Feature', properties: { k }, geometry: { type: 'LineString', coordinates: [b.center, blk.at] } },
          { type: 'Feature', properties: { k }, geometry: { type: 'Point', coordinates: blk.at } });
      }
      src.setData({ type: 'FeatureCollection', features: feats });
    },
  };

  // ---------------- CesiumJS (Google Photorealistic 3D Tiles) ----------------
  const CESIUM = 'https://cdn.jsdelivr.net/npm/cesium@1.124.0/Build/Cesium/';
  function loadCesium() {
    if (window.Cesium) return Promise.resolve();
    window.CESIUM_BASE_URL = CESIUM;
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = CESIUM + 'Widgets/widgets.css'; document.head.appendChild(css);
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = CESIUM + 'Cesium.js';
      s.onload = res; s.onerror = () => rej(new Error('Could not load CesiumJS from the CDN')); document.head.appendChild(s); });
  }
  views.g3d = {
    ready: false, mode: null, error: null, colors: new Map(),
    init() { if (!this._init) this._init = this._start(); return this._init; },
    async _start() {
      const cfg = window.LIGHTWELL_CONFIG || {};
      await loadCesium();
      const wantGoogle = !!(cfg.GOOGLE_MAPS_API_KEY || cfg.CESIUM_ION_TOKEN);
      if (cfg.CESIUM_ION_TOKEN) Cesium.Ion.defaultAccessToken = cfg.CESIUM_ION_TOKEN;
      if (cfg.GOOGLE_MAPS_API_KEY) Cesium.GoogleMaps.defaultApiKey = cfg.GOOGLE_MAPS_API_KEY;
      const opts = { baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
        navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false };
      if (wantGoogle) opts.globe = false;
      const v = this.viewer = new Cesium.Viewer('g3d', opts);
      v.scene.backgroundColor = Cesium.Color.fromCssColorString('#0b111d');
      if (v.scene.globe) { v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#121a2b'); v.scene.globe.showGroundAtmosphere = false; }
      this.mode = 'osm';
      if (wantGoogle) {
        try {
          const ts = await Cesium.createGooglePhotorealistic3DTileset();
          v.scene.primitives.add(ts); this.mode = 'google';
        } catch (e) {
          this.error = 'Google 3D tiles did not load (' + (e.message || e) + '). Showing OpenStreetMap buildings instead.';
          // the viewer was created without a globe; add one back so the fallback has ground
          v.scene.globe = new Cesium.Globe(Cesium.Ellipsoid.WGS84);
          v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#121a2b');
        }
      }
      // Houston ground sits ~11 m below the WGS84 ellipsoid; Google tiles use true heights, the fallback uses 0.
      this.h0 = this.mode === 'google' ? -11 : 0;
      this._buildPrimitives();
      v.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-95.3745, 29.7395, 950),
        orientation: { heading: Cesium.Math.toRadians(18), pitch: Cesium.Math.toRadians(-32), roll: 0 } });
      const h = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
      h.setInputAction(ev => {
        const p = v.scene.pick(ev.position);
        const id = p && typeof p.id === 'string' ? p.id : null;   // 'b:<idx>' tower, 'f:<idx>:<floor>' floor slab
        LW.onSelect(id && /^[bf]:/.test(id) ? LW.B[+id.split(':')[1]] : null, false);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      v.scene.postRender.addEventListener(() => this._flush());
      this.ready = true;
    },
    _poly(ring, h0, h1, color, id, vf) {
      const pts = ring.slice(0, -1).flat();
      return new Cesium.GeometryInstance({ id, geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(pts)), height: h0, extrudedHeight: h1, vertexFormat: vf }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) } });
    },
    _buildPrimitives() {
      const v = this.viewer, google = this.mode === 'google';
      if (google) {
        // Paint the real photoreal buildings: a classification volume around each candidate tower colours whatever tiles fall inside it.
        this.prim = v.scene.primitives.add(new Cesium.ClassificationPrimitive({ asynchronous: false,
          classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
          geometryInstances: LW.B.map(b => this._poly(b.ring, -80, b.heightM + 40, this._base(), 'b:' + b.idx, Cesium.VertexFormat.POSITION_ONLY)) }));
      } else {
        const vf = Cesium.PerInstanceColorAppearance.VERTEX_FORMAT, cand = new Set(LW.B.map(b => b.osmId));
        const others = LW.geo.features.filter(f => !cand.has(f.properties.id)).map(f =>
          this._poly(f.geometry.coordinates[0], 0, f.properties.height, Cesium.Color.fromCssColorString('#2a3550'), 'o:' + f.properties.id, vf));
        v.scene.primitives.add(new Cesium.Primitive({ asynchronous: false, geometryInstances: others,
          appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, flat: false }) }));
        this.prim = v.scene.primitives.add(new Cesium.Primitive({ asynchronous: false,
          geometryInstances: LW.B.map(b => this._poly(b.ring, 0, b.heightM, this._base(), 'b:' + b.idx, vf)),
          appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, flat: false }) }));
      }
      this.flags = new Cesium.CustomDataSource('flags'); v.dataSources.add(this.flags);
    },
    _base() { return this.mode === 'google' ? Cesium.Color.WHITE.withAlpha(0.12) : Cesium.Color.fromCssColorString('#4a5a80'); },
    _colorFor(b) {
      if (LW.selected === b) return Cesium.Color.WHITE.withAlpha(this.mode === 'google' ? 0.6 : 1);
      if (b.score == null || !LW.scored) return this._base();
      const c = Cesium.Color.fromCssColorString(LW.hex(LW.scoreRGB(b.score)));
      return this.mode === 'google' ? c.withAlpha(0.55) : c;
    },
    _flush() {
      if (!this.prim || !this.prim.ready || !this.colors.size) return;
      for (const [id, col] of this.colors) { const a = this.prim.getGeometryInstanceAttributes(id); if (a) a.color = Cesium.ColorGeometryInstanceAttribute.toValue(col, a.color); }
      this.colors.clear();
    },
    paint(b) { if (this.ready) { this.colors.set('b:' + b.idx, this._colorFor(b)); this.viewer.scene.requestRender(); } },
    select(b, prev) { if (prev) this.paint(prev); if (b) this.paint(b); },
    fly(b) {
      if (!this.ready) return; const h = b.heightM;
      this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(b.center[0], b.center[1], this.h0 + h / 2), Math.max(h, 120)),
        { offset: new Cesium.HeadingPitchRange(this.viewer.camera.heading, Cesium.Math.toRadians(-28), Math.max(h * 2.6, 420)), duration: 1.6 });
    },
    overview() { if (this.ready) this.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(-95.3745, 29.7395, 950),
      orientation: { heading: Cesium.Math.toRadians(18), pitch: Cesium.Math.toRadians(-32), roll: 0 }, duration: 1.5 }); },
    setFlags(list) {
      if (!this.ready) return; this.flags.entities.removeAll();
      for (const b of list) this.flags.entities.add({ position: Cesium.Cartesian3.fromDegrees(b.center[0], b.center[1], this.h0 + b.heightM + 25),
        point: { pixelSize: 14, color: Cesium.Color.fromCssColorString('#ef5d6f'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    },
    show(on) { document.getElementById('g3d').style.visibility = on ? 'visible' : 'hidden'; if (!on) this.stopOrbit(); },

    setMoves(plan) {
      if (!this.ready) return;
      (this._moveEnts || []).forEach(e => this.viewer.entities.remove(e)); this._moveEnts = [];
      for (const m of (plan ? plan.moves : [])) {
        const pts = LW.arcPoints(m, 64).map(q => Cesium.Cartesian3.fromDegrees(q.lon, q.lat, this.h0 + q.h));
        this._moveEnts.push(this.viewer.entities.add({ polyline: { positions: pts, width: 12,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: Cesium.Color.fromCssColorString('#f5b942') }) } }));
      }
      this.viewer.scene.requestRender();
    },

    // ---- empty floors ----
    // Google mode: paint only the empty floors onto the real photoreal towers (a classification slice per floor).
    // Fallback mode: stacked floor slabs, empty floors gold and leased floors faded.
    setFloors(on) {
      if (!this.ready) return;
      if (on && this.floorsPrim && this._floorsFor !== LW.B) { this.viewer.scene.primitives.remove(this.floorsPrim); this.floorsPrim = null; }
      if (on && !this.floorsPrim) {
        this._floorsFor = LW.B;
        const google = this.mode === 'google', insts = [];
        const vf = google ? Cesium.VertexFormat.POSITION_ONLY : Cesium.PerInstanceColorAppearance.VERTEX_FORMAT;
        const gold = Cesium.Color.fromCssColorString('#f5b942'), slate = Cesium.Color.fromCssColorString('#3a4766');
        for (const b of LW.B) {
          if (LW.srcOf(b, 'vacant') === 'MISSING') continue;
          const fh = b.heightM / b.floors, empty = new Set(b.vacantFloors);
          for (let f = 1; f <= b.floors; f++) {
            const isEmpty = empty.has(f); if (google && !isEmpty) continue;
            const lo = this.h0 + (f - 1) * fh, hi = this.h0 + f * fh - Math.min(0.8, fh * 0.2);
            insts.push(this._poly(b.ring, lo, hi, isEmpty ? gold.withAlpha(google ? 0.6 : 0.95) : slate.withAlpha(0.35), `f:${b.idx}:${f}`, vf));
          }
        }
        this.floorsPrim = this.viewer.scene.primitives.add(google
          ? new Cesium.ClassificationPrimitive({ asynchronous: false, classificationType: Cesium.ClassificationType.CESIUM_3D_TILE, geometryInstances: insts })
          : new Cesium.Primitive({ asynchronous: false, geometryInstances: insts, appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, flat: false }) }));
      }
      if (this.floorsPrim) this.floorsPrim.show = on;
      if (this.prim) this.prim.show = !on;
      this.viewer.scene.requestRender();
    },

    // ---- Daylight X-ray ----
    // Google mode: a classification slice per floor tints the real photoreal tower. Fallback mode: stacked floor slabs.
    // Rebuilt only when the inputs (brief, assumptions, corrections, data mode) changed since the last build.
    setDaylight(on) {
      if (!this.ready) return;
      const key = LW.inputsKey();
      if (on && this.dayPrim && this._dayKey !== key) { this.viewer.scene.primitives.remove(this.dayPrim); this.dayPrim = null; }
      if (on && !this.dayPrim) {
        this._dayKey = key;
        const google = this.mode === 'google', insts = [];
        const vf = google ? Cesium.VertexFormat.POSITION_ONLY : Cesium.PerInstanceColorAppearance.VERTEX_FORMAT;
        for (const b of LW.B) {
          if (!b.plan) LW.analyze(b);
          const n = LW.eff(b, 'floors'), fh = b.heightM / n;
          for (let f = 2; f <= n; f++) {
            const lo = this.h0 + (f - 1) * fh, hi = this.h0 + f * fh - Math.min(0.8, fh * 0.2);
            insts.push(this._poly(b.ring, lo, hi, Cesium.Color.fromCssColorString(LW.dayColor(b, f)).withAlpha(google ? 0.55 : 0.95), `f:${b.idx}:${f}`, vf));
          }
        }
        this.dayPrim = this.viewer.scene.primitives.add(google
          ? new Cesium.ClassificationPrimitive({ asynchronous: false, classificationType: Cesium.ClassificationType.CESIUM_3D_TILE, geometryInstances: insts })
          : new Cesium.Primitive({ asynchronous: false, geometryInstances: insts, appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, flat: false }) }));
      }
      if (this.dayPrim) this.dayPrim.show = on;
      if (this.prim) this.prim.show = !on && !LW.floorsOn;
      this.viewer.scene.requestRender();
    },

    // ---- camera modes ----
    _center(b, frac) { return Cesium.Cartesian3.fromDegrees(b.center[0], b.center[1], this.h0 + b.heightM * frac); },
    // drone orbit: circle the tower at a 30° downward angle until the user grabs the camera
    orbit(b) {
      if (!this.ready) return; this.stopOrbit();
      const cam = this.viewer.camera, target = this._center(b, 0.45), range = Math.max(b.heightM * 2.4, 380);
      let heading = cam.heading;
      const tick = () => { heading += 0.0035; cam.lookAt(target, new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(-30), range)); };
      this._orbitL = this.viewer.scene.preRender.addEventListener(tick);
      this._stopH = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
      for (const t of [Cesium.ScreenSpaceEventType.LEFT_DOWN, Cesium.ScreenSpaceEventType.RIGHT_DOWN, Cesium.ScreenSpaceEventType.WHEEL])
        this._stopH.setInputAction(() => this.stopOrbit(), t);
    },
    stopOrbit() {
      if (this._orbitL) { this._orbitL(); this._orbitL = null; this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); }
      if (this._stopH) { this._stopH.destroy(); this._stopH = null; }
    },
    // street level: stand on the pavement ~150 m south of the tower, eye height, looking up at it
    canStreet: true,
    street(b) {
      if (!this.ready) return; this.stopOrbit();
      const dLat = 150 / 110540, eye = Cesium.Cartesian3.fromDegrees(b.center[0], b.center[1] - dLat, this.h0 + 2);
      const look = Math.atan2(b.heightM * 0.6, 150);
      this.viewer.camera.flyTo({ destination: eye, orientation: { heading: 0, pitch: look * 0.7, roll: 0 }, duration: 2 });
    },
  };
})();
