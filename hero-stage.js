(() => {
  "use strict";

  // Rotating image stage for the hero.
  //
  // Each slide is an <img class="hs-slide"> inside #hero-stage with:
  //   data-label   caption text
  //   data-target  CSS selector of the page content this slide points to
  //   data-arc     arc colour: copper | teal | grey
  //   --op, --lum  (inline CSS) opacity and brightness for that slide
  //
  // When a slide becomes active it
  //   - fades in (the previous one fades out, so both are briefly see-through)
  //   - lights up its target term in the text (.is-live)
  //   - fires a "hero:slide" event; geometry.js answers by drawing an arc
  //     from the stage to that target

  const stage = document.getElementById("hero-stage");
  if (!stage) return;

  // A slide marked data-motion="flow" becomes two stacked copies of the same
  // picture: a pale, washed-out one (anaemic) and the normal red one on top.
  // The red one is revealed from the right edge while the slide is showing.
  let wipeAnimatable = false;

  try {
    CSS.registerProperty({
      name: "--p",
      syntax: "<number>",
      inherits: false,
      initialValue: "1"
    });
    wipeAnimatable = true;
  } catch (e) {
    wipeAnimatable = false; // already registered, or unsupported
  }

  stage.querySelectorAll('img.hs-slide[data-motion="flow"]').forEach((img) => {
    const wrap = document.createElement("div");

    wrap.className = img.className + " hs-flow";
    wrap.setAttribute("style", img.getAttribute("style") || "");
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", img.alt || "");

    for (const [k, v] of Object.entries(img.dataset)) wrap.dataset[k] = v;

    const pale = img.cloneNode();
    const red = img.cloneNode();

    for (const el of [pale, red]) {
      el.removeAttribute("style");
      el.removeAttribute("data-label");
      el.removeAttribute("data-target");
      el.removeAttribute("data-arc");
      el.removeAttribute("data-motion");
      el.removeAttribute("data-contrast");
      el.className = "";
      el.alt = "";
      el.setAttribute("aria-hidden", "true");
    }

    pale.classList.add("hs-pale");
    red.classList.add("hs-red");

    wrap.append(pale, red);
    img.replaceWith(wrap);
  });

  const slides = [...stage.querySelectorAll(".hs-slide")];
  if (slides.length < 2) return;

  const indexEl = document.querySelector(".hc-index");
  const labelEl = document.querySelector(".hc-label");
  const ticksEl = document.querySelector(".hc-ticks");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Let the stage run past the text column to the window edge.
  const visual = document.querySelector(".hero-visual");
  const section = document.querySelector(".hero-section");

  function setBleed() {
    if (!visual || !section) return;

    if (window.innerWidth <= 1000) {
      visual.style.removeProperty("--bleed");
      return;
    }

    const gap = window.innerWidth - section.getBoundingClientRect().right;

    // run a little past the edge so the shape is cropped by the window
    visual.style.setProperty("--bleed", `${Math.max(0, gap) + 40}px`);
  }

  setBleed();
  window.addEventListener("resize", setBleed);

  // Keep the light dots on the pictures lined up with the page's dot grid.
  const DOT = 5;
  let gridQueued = false;

  function alignGrid() {
    gridQueued = false;

    const r = stage.getBoundingClientRect();
    const x = r.left + window.scrollX;
    const y = r.top + window.scrollY;

    stage.style.setProperty("--gx", `${((x % DOT) + DOT) % DOT}px`);
    stage.style.setProperty("--gy", `${((y % DOT) + DOT) % DOT}px`);
  }

  function queueGrid() {
    if (gridQueued) return;
    gridQueued = true;
    requestAnimationFrame(alignGrid);
  }

  window.addEventListener("scroll", queueGrid, { passive: true });
  window.addEventListener("resize", queueGrid);
  alignGrid();

  const HOLD_MS = 6500;     // time each slide stays active
  const FADE_MS = 1800;     // must match the CSS transition on .hs-slide

  let current = -1;
  let timer = null;
  const drifts = new Map();

  const pad = (n) => String(n).padStart(2, "0");

  // caption ticks
  const ticks = slides.map((slide, i) => {
    if (!ticksEl) return null;

    const b = document.createElement("button");
    b.type = "button";
    b.className = "hc-tick";
    b.setAttribute("aria-label", `Show ${slide.dataset.label}`);
    b.addEventListener("click", () => {
      show(i);
      schedule();
    });
    ticksEl.appendChild(b);
    return b;
  });

  // topic chips in the text jump to their slide
  document.querySelectorAll(".net-term[data-slide]").forEach((chip) => {
    chip.addEventListener("click", () => {
      show(Number(chip.dataset.slide));
      schedule();
    });
  });

  function drift(slide) {
    // slow push-in that keeps running while the slide fades out
    const old = drifts.get(slide);
    if (old) old.cancel();

    if (reduced.matches || !slide.animate) return;

    const duration = HOLD_MS + FADE_MS + 1200;

    // Slides marked data-motion="flow" drift diagonally with a slight roll,
    // pull into focus and gain contrast as they stay on screen, so the
    // picture seems to move towards you.
    if (slide.dataset.motion === "flow") {
      const [c0, c1] = (slide.dataset.contrast || "0.8,1.28")
        .split(",")
        .map(Number);

      const red = slide.querySelector(".hs-red");

      if (red) {
        const old = drifts.get(red);
        if (old) old.cancel();

        // red floods in from the right edge, easing in and out
        drifts.set(
          red,
          red.animate(
            wipeAnimatable
              ? [
                  { "--p": 0, offset: 0 },
                  { "--p": 1, offset: 0.74 },
                  { "--p": 1, offset: 1 }
                ]
              : [
                  { opacity: 0, offset: 0 },
                  { opacity: 1, offset: 0.74 },
                  { opacity: 1, offset: 1 }
                ],
            {
              duration,
              easing: "cubic-bezier(0.45, 0, 0.3, 1)",
              fill: "forwards"
            }
          )
        );
      }

      const lum = slide.style.getPropertyValue("--lum") || "1";
      const f = (blur, contrast) =>
        `brightness(${lum}) contrast(${contrast}) blur(${blur}px)`;

      drifts.set(
        slide,
        slide.animate(
          [
            { transform: "scale(1.05) translate3d(1.5%, -1%, 0) rotate(-1.2deg)", filter: f(2.6, c0), offset: 0 },
            { filter: f(0, c0 + (c1 - c0) * 0.3), offset: 0.22 },
            { transform: "scale(1.17) translate3d(-3.5%, 2.5%, 0) rotate(1.6deg)", filter: f(0, c1), offset: 1 }
          ],
          { duration, easing: "linear", fill: "forwards" }
        )
      );

      return;
    }

    drifts.set(
      slide,
      slide.animate(
        [
          { transform: "scale(1.03) translate3d(0, 0, 0)" },
          { transform: "scale(1.15) translate3d(-1.2%, 0.8%, 0)" }
        ],
        { duration, easing: "linear", fill: "forwards" }
      )
    );
  }

  function show(i) {
    if (i === current) return;

    current = i;

    slides.forEach((s, k) => s.classList.toggle("is-active", k === i));

    const slide = slides[i];

    drift(slide);

    if (indexEl) indexEl.textContent = pad(i + 1);

    if (labelEl) {
      labelEl.classList.add("is-changing");
      setTimeout(() => {
        labelEl.textContent = slide.dataset.label || "";
        labelEl.classList.remove("is-changing");
      }, 220);
    }

    ticks.forEach((t, k) => {
      if (!t) return;
      t.classList.toggle("is-active", k === i);
      // restart the progress animation on the active tick
      if (k === i) {
        t.style.animation = "none";
        void t.offsetWidth;
        t.style.animation = "";
      }
    });

    const target = slide.dataset.target
      ? document.querySelector(slide.dataset.target)
      : null;

    document
      .querySelectorAll(".net-term.is-live")
      .forEach((el) => el.classList.remove("is-live"));

    if (target && target.classList.contains("net-term")) {
      target.classList.add("is-live");
    }

    window.dispatchEvent(
      new CustomEvent("hero:slide", {
        detail: {
          target,
          life: HOLD_MS / 1000,
          color: slide.dataset.arc || "copper"
        }
      })
    );
  }

  function schedule() {
    clearTimeout(timer);

    if (reduced.matches || document.hidden) return;

    timer = setTimeout(() => {
      show((current + 1) % slides.length);
      schedule();
    }, HOLD_MS);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else schedule();
  });

  show(0);
  schedule();
})();
