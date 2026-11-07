(() => {
  "use strict";

  // Two layers
  //  1. #geometry-canvas  – constellations, page-tall, sits BEHIND the content
  //  2. #geometry-links   – viewport-sized overlay ABOVE the content. Arcs
  //     draw themselves between elements marked with data-net-anchor,
  //     hold, then fade. They follow the elements as you scroll.
  //
  // data-net-anchor values
  //   "edge"   arc meets the rim of the element (portrait, big image)
  //   "left"   arc ends in a dot just left of the element (headings)
  //   "center" arc ends at the middle (default)

  const networkCanvas = document.getElementById("geometry-canvas");
  const arcCanvas = document.getElementById("geometry-links");

  if (!networkCanvas || !arcCanvas) return;

  const network = networkCanvas.getContext("2d");
  const arcContext = arcCanvas.getContext("2d");

  if (!network || !arcContext) return;

  const container = networkCanvas.parentElement;

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  const TAU = Math.PI * 2;

  const COLORS = {
    copper: [128, 169, 157],
    teal: [92, 147, 135],
    grey: [113, 109, 103]
  };

  const LIGHT = [246, 238, 226]; // network colour over the dark pictures

  const CONFIG = {
    // constellations (background layer)
    constellationCount: 13,
    nodesPerConstellation: [3, 4],
    nodeRadius: [1.1, 2.3],
    connectionAlpha: 0.18,
    nodeAlpha: 0.36,
    connectionWidth: 0.55,
    driftAmplitude: 13,
    morphSpeed: 0.30,

    // anchored arcs (overlay layer)
    anchorSelector: "[data-net-anchor]",
    arcMax: 4,
    arcMaxMobile: 3,
    arcEvery: [0.7, 2.0],      // seconds between new arcs
    arcLife: [6, 9],           // seconds
    arcPeak: [0.12, 0.22],     // peak opacity
    arcBow: [0.14, 0.42],      // bend, as a fraction of chord length
    arcWidth: 0.8,
    arcMinDistance: 180        // don't link anchors closer than this (px)
  };

  const rand = (min, max) =>
    min + Math.random() * (max - min);

  const pick = (list) =>
    list[(Math.random() * list.length) | 0];

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  const ease = (t) => t * t * (3 - 2 * t);

  const rgba = (color, alpha) =>
    `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

  // network (page-sized) dimensions
  let width = 0;
  let height = 0;

  // arc overlay (viewport-sized) dimensions
  let viewW = 0;
  let viewH = 0;

  let constellations = [];
  let stageField = [];
  let orbits = [];
  let anchorHosts = []; // elements carrying data-net-anchor
  let anchorEls = [];   // the element each arc really attaches to
  let pendingDirected = null;
  let arcs = [];
  let nextArc = 0.8;
  let animationId = null;
  let lastTime = 0;

  function setupCanvas(canvas, context, w, h, setStyle) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    if (setStyle) {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    const rect = container.getBoundingClientRect();

    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);

    const view = arcCanvas.getBoundingClientRect();
    viewW = Math.max(1, view.width);
    viewH = Math.max(1, view.height);

    setupCanvas(networkCanvas, network, width, height, true);
    setupCanvas(arcCanvas, arcContext, viewW, viewH, false);

    buildConstellations();
    buildOrbits();
    collectAnchors();
  }

  // ------------------------------------------------------------
  // Constellations
  // ------------------------------------------------------------

  function buildConstellations() {
    const count = Math.max(
      8,
      Math.min(
        20,
        Math.round(
          CONFIG.constellationCount *
          (width / 1500) *
          Math.sqrt(height / 950)
        )
      )
    );

    constellations = makeConstellations(count, width, height, 1);

    // A denser field that lives over the hero images. It is built in
    // a 1000 x 1000 box and scaled onto the stage every frame.
    stageField = makeConstellations(11, 1000, 1000, 1.5);
  }

  // ---- shapes that change into other shapes ----------------------
  // Every constellation owns six nodes. Over time they glide between
  // different templates (triangle, diamond, pentagon, hexagon, star, zigzag,
  // arc, tree, kite, bowtie); the edges that don't belong to the next
  // template fade out while new ones fade in.
  var P6 = function (n, r0, off) { var o = []; for (var i = 0; i < n; i++) { var a = off + i / n * Math.PI * 2; o.push([Math.cos(a) * r0, Math.sin(a) * r0]); } return o; };
  var ARCP = []; for (var ai = 0; ai < 5; ai++) { var aa = Math.PI * (1.15 - 1.3 * ai / 4); ARCP.push([Math.cos(aa), -Math.sin(aa) * 0.8 + 0.25]); }
  var TPLS = [
    { p: [[0,-1],[.87,.5],[-.87,.5],[.43,-.25],[0,.5],[-.43,-.25]], e: [[0,1],[1,2],[2,0]] },
    { p: [[0,-1],[1,0],[0,1],[-1,0],[0,0],[.3,-.3]], e: [[0,1],[1,2],[2,3],[3,0],[0,2]] },
    { p: P6(5, 1, -Math.PI / 2).concat([[0, 0]]), e: [[0,1],[1,2],[2,3],[3,4],[4,0]] },
    { p: P6(6, 1, 0), e: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[0,3]] },
    { p: [[0,0]].concat(P6(5, 1, -Math.PI / 2)), e: [[0,1],[0,2],[0,3],[0,4],[0,5]] },
    { p: [[-1,-.35],[-.6,.35],[-.2,-.35],[.2,.35],[.6,-.35],[1,.35]], e: [[0,1],[1,2],[2,3],[3,4],[4,5]] },
    { p: ARCP.concat([[0, .5]]), e: [[0,1],[1,2],[2,3],[3,4],[5,2]] },
    { p: [[0,-1],[-.6,-.1],[.6,-.1],[-1,.8],[-.2,.8],[.9,.8]], e: [[0,1],[0,2],[1,3],[1,4],[2,5]] },
    { p: [[0,-1.1],[.8,-.1],[0,1],[-.8,-.1],[0,-.1],[.3,.4]], e: [[0,1],[1,2],[2,3],[3,0],[0,2]] },
    { p: [[-1,-.6],[-1,.6],[0,0],[1,-.6],[1,.6],[0,0]], e: [[0,1],[1,2],[2,0],[2,3],[3,4],[4,2]] }
  ];
  TPLS.forEach(function (t) {
    t.used = [0, 0, 0, 0, 0, 0]; t.set = {};
    t.e.forEach(function (e) { t.used[e[0]] = 1; t.used[e[1]] = 1; t.set[Math.min(e[0], e[1]) * 6 + Math.max(e[0], e[1])] = 1; });
  });
  function shapeSeq(rnd) {
    var seq = [], last = -1;
    for (var i = 0; i < 10; i++) { var k; do { k = Math.floor(rnd() * TPLS.length); } while (k === last); seq.push(k); last = k; }
    return seq;
  }
  var smooth3 = function (x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
  // returns {pos:[{x,y}], nw:[0..1], edges:[{a,b,w}]} for constellation c at time
  function morphState(c, time) {
    var ph = (time + c.off) / c.period, idx = Math.floor(ph), f = ph - idx;
    var s = smooth3((f - 0.45) / 0.55);
    var A = TPLS[c.seq[idx % c.seq.length]], B = TPLS[c.seq[(idx + 1) % c.seq.length]];
    var cr = Math.cos(c.rot + time * 0.02), sr = Math.sin(c.rot + time * 0.02);
    var pos = [], nw = [], edges = [], i, j;
    for (i = 0; i < 6; i++) {
      var x = (A.p[i][0] + (B.p[i][0] - A.p[i][0]) * s) * c.sx * c.spread;
      var y = (A.p[i][1] + (B.p[i][1] - A.p[i][1]) * s) * c.sy * c.spread;
      pos.push({ x: c.cx + x * cr - y * sr, y: c.cy + x * sr + y * cr });
      nw.push(A.used[i] + (B.used[i] - A.used[i]) * s);
    }
    for (i = 0; i < 6; i++) for (j = i + 1; j < 6; j++) {
      var k = i * 6 + j, wa = A.set[k] ? 1 : 0, wb = B.set[k] ? 1 : 0, w = wa + (wb - wa) * s;
      if (w > 0.01) edges.push({ a: i, b: j, w: w, bow: c.bows[k], ph: c.phs[k] });
    }
    return { pos: pos, nw: nw, edges: edges };
  }
  function makeMorph(c, rnd, cx, cy, spread) {
    c.cx = cx; c.cy = cy; c.spread = spread * (0.8 + rnd() * 0.35);
    c.rot = rnd() * Math.PI * 2; c.sx = 0.8 + rnd() * 0.5; c.sy = 0.8 + rnd() * 0.5;
    c.seq = shapeSeq(rnd); c.period = 11 + rnd() * 7; c.off = rnd() * 200;
    c.bows = []; c.phs = [];
    for (var k = 0; k < 36; k++) { c.bows.push((0.08 + rnd() * 0.2) * (rnd() < 0.5 ? -1 : 1)); c.phs.push(rnd() * Math.PI * 2); }
    return c;
  }

  function makeConstellations(count, width, height, spreadScale) {
    const list = [];

    for (let i = 0; i < count; i++) {
      const cxp = rand(0, width);
      const cyp = rand(0, height);
      const spread = rand(40, 105) * spreadScale * 0.8;

      const nodes = [];

      for (let j = 0; j < 6; j++) {
        nodes.push({
          x: cxp,
          y: cyp,
          phaseX: rand(0, TAU),
          phaseY: rand(0, TAU),
          speed: rand(0.65, 1.3),
          radius: rand(...CONFIG.nodeRadius),
          color:
            Math.random() < 0.43
              ? COLORS.copper
              : Math.random() < 0.32
                ? COLORS.teal
                : COLORS.grey
        });
      }

      const c = makeMorph({ nodes }, Math.random, cxp, cyp, spread);
      c.ec = Array.from({ length: 36 }, () => {
        const q = Math.random();
        return q < 0.42 ? COLORS.copper : q < 0.62 ? COLORS.teal : COLORS.grey;
      });
      list.push(c);
    }

    return list;
  }

  function nodePosition(node, time) {
    const speed = CONFIG.morphSpeed * node.speed;

    return {
      x:
        node.x +
        Math.sin(time * speed + node.phaseX) *
          CONFIG.driftAmplitude,

      y:
        node.y +
        Math.cos(time * speed * 0.83 + node.phaseY) *
          CONFIG.driftAmplitude
    };
  }

  function drawConstellations(time) {
    network.clearRect(0, 0, width, height);

    network.lineCap = "round";

    for (const constellation of constellations) {
      const st = morphState(constellation, time);

      const positions = constellation.nodes.map((node, i) => {
        const d = nodePosition(node, time);
        return { x: st.pos[i].x + d.x - node.x, y: st.pos[i].y + d.y - node.y };
      });

      for (const edge of st.edges) {
        const a = positions[edge.a];
        const b = positions[edge.b];

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);

        if (distance < 1) continue;

        const changingBow =
          edge.bow * distance * (0.65 + 0.55 * Math.sin(time * 0.42 + edge.ph));

        network.beginPath();
        network.moveTo(a.x, a.y);
        network.quadraticCurveTo(
          (a.x + b.x) / 2 + (-dy / distance) * changingBow,
          (a.y + b.y) / 2 + (dx / distance) * changingBow,
          b.x,
          b.y
        );

        network.lineWidth = CONFIG.connectionWidth;
        network.strokeStyle = rgba(
          constellation.ec[edge.a * 6 + edge.b],
          CONFIG.connectionAlpha * edge.w
        );
        network.stroke();
      }

      constellation.nodes.forEach((node, i) => {
        const p = positions[i];
        const w = st.nw[i];

        if (w < 0.03) return;

        const pulse = 0.85 + 0.15 * Math.sin(time * 0.75 + node.phaseX);

        network.beginPath();
        network.arc(p.x, p.y, node.radius, 0, TAU);
        network.fillStyle = rgba(node.color, CONFIG.nodeAlpha * pulse * w);
        network.fill();
      });
    }
  }

  // ------------------------------------------------------------
  // Anchored arcs
  // ------------------------------------------------------------

  function collectAnchors() {
    // Quarto puts the attribute on a heading AND its <section>;
    // keep one anchor per heading.
    anchorHosts = [...document.querySelectorAll(CONFIG.anchorSelector)].filter(
      (host) =>
        !(
          host.matches("h1, h2, h3, h4") &&
          host.parentElement &&
          host.parentElement.matches("section[data-net-anchor]")
        )
    );

    // Quarto moves attributes from a heading onto its <section>,
    // so a section anchors to its heading.
    anchorEls = anchorHosts.map((host) =>
      host.matches("section")
        ? host.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4") || host
        : host
    );
  }

  // Live positions, re-read every frame so arcs follow scrolling.
  function readAnchors() {
    return anchorEls.map((el, i) => {
      const host = anchorHosts[i];
      const mode = host.dataset.netAnchor || "center";

      const r = el.getBoundingClientRect();

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      const visible =
        r.width > 0 &&
        r.bottom > 0 &&
        r.top < viewH &&
        r.right > 0 &&
        r.left < viewW;

      const p = {
        mode,
        cx,
        cy,
        rx: Math.max(1, (r.width / 2) * (parseFloat(host.dataset.netInset) || 0.94)),
        ry: Math.max(1, (r.height / 2) * (parseFloat(host.dataset.netInset) || 0.94)),
        x: cx,
        y: cy,
        visible,
        ambientOff: host.dataset.netAmbient === "off"
      };

      if (mode === "left") {
        const fontSize =
          parseFloat(getComputedStyle(el).fontSize) || 16;

        p.x = Math.max(6, r.left - 16);
        p.y = r.top + fontSize * 0.62;
        p.cx = p.x;
        p.cy = p.y;
      }

      return p;
    });
  }

  // Where an arc meets an anchor. For "edge" anchors the arc lands
  // on the rim, on the side facing the other end.
  function endpoint(p, toward) {
    if (p.mode !== "edge") return { x: p.x, y: p.y };

    const dx = toward.cx - p.cx;
    const dy = toward.cy - p.cy;

    const k =
      1 /
      Math.sqrt(
        (dx / p.rx) * (dx / p.rx) +
        (dy / p.ry) * (dy / p.ry) || 1
      );

    return { x: p.cx + dx * k, y: p.cy + dy * k };
  }

  function arcLimit() {
    return viewW < 700 ? CONFIG.arcMaxMobile : CONFIG.arcMax;
  }

  function spawnArc(points) {
    const visible = [];

    points.forEach((p, i) => {
      if (p.visible && !p.ambientOff) visible.push(i);
    });

    if (visible.length < 2) return;

    // a few attempts to find a pair that is far enough apart
    // and not already linked
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = pick(visible);
      const b = pick(visible);

      if (a === b) continue;

      const d = Math.hypot(
        points[a].cx - points[b].cx,
        points[a].cy - points[b].cy
      );

      if (d < CONFIG.arcMinDistance) continue;

      if (
        arcs.some(
          (arc) =>
            (arc.a === a && arc.b === b) ||
            (arc.a === b && arc.b === a)
        )
      ) continue;

      const roll = Math.random();

      arcs.push({
        a,
        b,
        age: 0,
        life: rand(...CONFIG.arcLife),
        peak: rand(...CONFIG.arcPeak),
        bow: rand(...CONFIG.arcBow) * (Math.random() < 0.5 ? -1 : 1),
        // 1 = single bow (C shape), negative = S shape
        wiggle: Math.random() < 0.35 ? -0.7 : 1,
        color: roll < 0.45 ? COLORS.copper : roll < 0.75 ? COLORS.teal : COLORS.grey,
        pulseAt: Math.random()
      });

      return;
    }
  }

  // An arc from the image stage to the content the active slide points at.
  function spawnDirected(detail) {
    const stageIdx = anchorHosts.findIndex((h) =>
      h.classList.contains("hero-stage-wrap")
    );

    const t = detail && detail.target;

    // exact match only (a section can contain the target, so don't use contains)
    const targetIdx = t ? anchorHosts.indexOf(t) : -1;

    if (stageIdx < 0 || targetIdx < 0) return;

    // the previous directed arc fades out as the new one is drawn
    for (const arc of arcs) {
      if (arc.directed) arc.age = Math.max(arc.age, arc.life * 0.72);
    }

    arcs.push({
      a: stageIdx,
      b: targetIdx,
      age: 0,
      life: (detail.life || 6.5) * 1.1,
      peak: 0.34,
      bow: (Math.random() < 0.5 ? -1 : 1) * rand(0.16, 0.3),
      wiggle: 1,
      color: COLORS[detail.color] || COLORS.copper,
      pulseAt: 0,
      directed: true,
      width: 0.9
    });
  }

  function bezier(t, p0, p1, p2, p3) {
    const u = 1 - t;

    return (
      u * u * u * p0 +
      3 * u * u * t * p1 +
      3 * u * t * t * p2 +
      t * t * t * p3
    );
  }

  function drawArcs(dt) {

    if (!anchorEls.length) return;

    const points = readAnchors();

    if (pendingDirected) {
      spawnDirected(pendingDirected);
      pendingDirected = null;
    }

    nextArc -= dt;

    if (nextArc <= 0) {
      if (arcs.length < arcLimit()) spawnArc(points);
      nextArc = rand(...CONFIG.arcEvery);
    }

    arcContext.lineCap = "round";

    for (let k = arcs.length - 1; k >= 0; k--) {
      const arc = arcs[k];

      arc.age += dt;

      const pa = points[arc.a];
      const pb = points[arc.b];

      if (arc.age >= arc.life || !pa || !pb) {
        arcs.splice(k, 1);
        continue;
      }

      const u = arc.age / arc.life;

      // draws itself along the path, holds, then fades
      const grow = ease(clamp01(u / 0.4));
      const fade = u < 0.72 ? 1 : 1 - (u - 0.72) / 0.28;

      // dim if one end has scrolled off screen
      const dim = pa.visible && pb.visible ? 1 : 0.22;

      const alpha = arc.peak * fade * dim;

      if (alpha < 0.004 || grow <= 0) continue;

      const A = endpoint(pa, pb);
      const B = endpoint(pb, pa);

      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const d = Math.hypot(dx, dy) || 1;

      const nx = -dy / d;
      const ny = dx / d;

      const c1x = A.x + dx * 0.33 + nx * arc.bow * d;
      const c1y = A.y + dy * 0.33 + ny * arc.bow * d;
      const c2x = A.x + dx * 0.66 + nx * arc.bow * arc.wiggle * d;
      const c2y = A.y + dy * 0.66 + ny * arc.bow * arc.wiggle * d;

      const steps = 60;

      arcContext.lineWidth = arc.width || CONFIG.arcWidth;
      arcContext.strokeStyle = rgba(arc.color, alpha);
      arcContext.beginPath();

      for (let s = 0; s <= steps; s++) {
        const t = (s / steps) * grow;
        const x = bezier(t, A.x, c1x, c2x, B.x);
        const y = bezier(t, A.y, c1y, c2y, B.y);

        if (s === 0) arcContext.moveTo(x, y);
        else arcContext.lineTo(x, y);
      }

      arcContext.stroke();

      // dot where it starts, and one riding the growing tip
      const dotColor = rgba(arc.color, Math.min(0.7, alpha * 2));

      arcContext.fillStyle = dotColor;

      arcContext.beginPath();
      arcContext.arc(A.x, A.y, 1.7, 0, TAU);
      arcContext.fill();

      arcContext.beginPath();
      arcContext.arc(
        bezier(grow, A.x, c1x, c2x, B.x),
        bezier(grow, A.y, c1y, c2y, B.y),
        2,
        0,
        TAU
      );
      arcContext.fill();

      // small pulse travelling along a finished arc
      if (grow >= 1) {
        const t = (arc.pulseAt + arc.age * 0.2) % 1;

        arcContext.fillStyle = rgba(
          arc.color,
          Math.min(0.85, alpha * 2.6)
        );

        arcContext.beginPath();
        arcContext.arc(
          bezier(t, A.x, c1x, c2x, B.x),
          bezier(t, A.y, c1y, c2y, B.y),
          2.3,
          0,
          TAU
        );
        arcContext.fill();
      }
    }
  }


  // ------------------------------------------------------------
  // Network over the hero images
  // ------------------------------------------------------------
  // The page's lines and dots carry on across the images. They are
  // drawn on the overlay (above the pictures) and are strongest where
  // the picture is strongest, so they seem to run through it.

  function stageWeight(u, v) {
    // u, v: position inside the stage, 0..1
    const h = ease(clamp01((u - 0.05) / 0.55));
    const vert = ease(clamp01(Math.min(v, 1 - v) / 0.18));
    return h * vert;
  }

  function drawStageField(time) {
    const wrap = document.querySelector(".hero-stage-wrap");
    if (!wrap) return;

    const r = wrap.getBoundingClientRect();

    if (r.width < 10 || r.bottom < 0 || r.top > viewH || r.left > viewW) return;

    const ctx = arcContext;

    ctx.lineCap = "round";

    for (const c of stageField) {
      const st = morphState(c, time);

      const pos = c.nodes.map((n, i) => {
        const p = nodePosition(n, time);
        const mx = st.pos[i].x + (p.x - n.x) * 3;
        const my = st.pos[i].y + (p.y - n.y) * 3;
        const u = mx / 1000;
        const v = my / 1000;
        return { x: r.left + u * r.width, y: r.top + v * r.height, u, v };
      });

      for (const e of st.edges) {
        const a = pos[e.a];
        const b = pos[e.b];
        const w = stageWeight((a.u + b.u) / 2, (a.v + b.v) / 2) * e.w;

        if (w < 0.02) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;

        const bow = e.bow * d * (0.65 + 0.55 * Math.sin(time * 0.42 + e.ph));

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(
          (a.x + b.x) / 2 + (-dy / d) * bow,
          (a.y + b.y) / 2 + (dx / d) * bow,
          b.x,
          b.y
        );
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = rgba(LIGHT, 0.42 * w);
        ctx.stroke();
      }

      c.nodes.forEach((n, i) => {
        const p = pos[i];
        const w = stageWeight(p.u, p.v) * st.nw[i];

        if (w < 0.02) return;

        ctx.beginPath();
        ctx.arc(p.x, p.y, n.radius * 1.15, 0, TAU);
        ctx.fillStyle = rgba(LIGHT, 0.8 * w);
        ctx.fill();
      });
    }
  }

  // A few thin rings that slowly turn around the image, each with a dot
  // riding its head.
  function buildOrbits() {
    orbits = Array.from({ length: 4 }, (_, i) => ({
      scaleX: 0.5 + i * 0.075,
      scaleY: 0.5 + i * 0.07,
      tilt: rand(-0.5, 0.5),
      start: rand(0, TAU),
      span: rand(1.0, 1.9),
      speed: (i % 2 ? -1 : 1) * rand(0.05, 0.1),
      color: i % 2 ? COLORS.teal : COLORS.copper
    }));
  }

  function drawOrbits(time) {
    const wrap = document.querySelector(".hero-stage-wrap");
    if (!wrap) return;

    const r = wrap.getBoundingClientRect();

    if (r.width < 10 || r.bottom < 0 || r.top > viewH || r.left > viewW) return;

    const ctx = arcContext;
    const cx = r.left + r.width * 0.5;
    const cy = r.top + r.height * 0.5;

    for (const o of orbits) {
      const rx = r.width * o.scaleX;
      const ry = r.height * o.scaleY;
      const a0 = o.start + time * o.speed;
      const steps = 70;

      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const ang0 = a0 + t0 * o.span;
        const ang1 = a0 + t1 * o.span;

        // thin out towards the tail, and where the ring would sit
        // over the left (empty) side of the stage
        const x0 = Math.cos(ang0);
        const sideFade = ease(clamp01((x0 + 1.1) / 1.6));
        const alpha = 0.34 * t1 * t1 * sideFade;

        if (alpha < 0.01) continue;

        const p0 = rotate(Math.cos(ang0) * rx, Math.sin(ang0) * ry, o.tilt);
        const p1 = rotate(Math.cos(ang1) * rx, Math.sin(ang1) * ry, o.tilt);

        ctx.beginPath();
        ctx.moveTo(cx + p0.x, cy + p0.y);
        ctx.lineTo(cx + p1.x, cy + p1.y);
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = rgba(o.color, alpha);
        ctx.stroke();
      }

      const head = a0 + o.span;
      const hp = rotate(Math.cos(head) * rx, Math.sin(head) * ry, o.tilt);
      const hs = ease(clamp01((Math.cos(head) + 1.1) / 1.6));

      ctx.beginPath();
      ctx.arc(cx + hp.x, cy + hp.y, 2.2, 0, TAU);
      ctx.fillStyle = rgba(o.color, 0.7 * hs);
      ctx.fill();
    }
  }

  function rotate(x, y, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  // ------------------------------------------------------------
  // Loop
  // ------------------------------------------------------------

  function draw(time, dt) {
    drawConstellations(time);
    arcContext.clearRect(0, 0, viewW, viewH);
    drawStageField(time);
    drawOrbits(time);
    drawArcs(dt);
  }

  function frame(timestamp) {
    const time = timestamp / 1000;
    const dt = Math.min(0.05, lastTime ? time - lastTime : 0.016);

    lastTime = time;

    draw(time, dt);

    if (
      !reducedMotion.matches &&
      !document.hidden
    ) {
      animationId =
        requestAnimationFrame(frame);
    } else {
      animationId = null;
    }
  }

  function stop() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function start() {
    stop();
    lastTime = 0;

    if (reducedMotion.matches) {
      drawConstellations(0);
      arcContext.clearRect(0, 0, viewW, viewH);
      return;
    }

    if (!document.hidden) {
      animationId =
        requestAnimationFrame(frame);
    }
  }

  let resizeTimeout;

  function scheduleResize() {
    clearTimeout(resizeTimeout);

    resizeTimeout = setTimeout(() => {
      resize();
      start();
    }, 150);
  }

  window.addEventListener("hero:slide", (e) => {
    pendingDirected = e.detail;
  });

  window.addEventListener("resize", scheduleResize);

  // The page gets taller or shorter as fonts and images load.
  // Keep the constellation canvas matched to it.
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();

      if (
        Math.abs(rect.width - width) > 1 ||
        Math.abs(rect.height - height) > 1
      ) {
        scheduleResize();
      }
    }).observe(container);
  }

  document.addEventListener(
    "visibilitychange",
    start
  );

  reducedMotion.addEventListener(
    "change",
    start
  );

  resize();
  start();
})();
