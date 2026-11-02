/*
 * Enphase panel layout card — part of the Enphase Envoy Local integration.
 *
 * Draws every solar panel where it lies on the roof (from the Enlighten array
 * layout, or grouped per phase when there is none) with live values of its
 * microinverter, a health view, a heatmap of today and a replay of the day.
 *
 *   type: custom:enphase-panel-layout-card
 *   entity: sensor.envoy_<serial>_panel_layout   # optional, found automatically
 *   mode: power | today | health | temperature | efficiency   # start view
 *   show_labels: true                              # roof surface names
 *   show_phase: true                               # L1/L2/L3 chip per panel
 *   show_toolbar: true                             # view buttons + replay
 *   title: My roof
 *   max_height: 70vh                               # limit on tall/wide screens
 *   demo: false                                    # fake sunny values (screenshots)
 */

const CARD_VERSION = "1.3.0";
const TAG = "enphase-panel-layout-card";

const PHASE_COLORS = { L1: "#8d6e63", L2: "#455a64", L3: "#9e9e9e" };
const MODES = ["power", "today", "health", "temperature", "efficiency"];

const T = {
  en: {
    producing: "producing",
    now: "now",
    today: "today",
    power: "Now",
    today_mode: "Today",
    health: "Health",
    temperature: "Temperature",
    efficiency: "Efficiency",
    replay: "Replay day",
    live: "Live",
    no_entity: "No panel layout sensor of Enphase Envoy Local found.",
    source_phases: "Grouped per phase (no layout in Enlighten)",
    dc: "DC",
    phase: "Phase",
    vs_roof: "of roof median",
    week: "7 days",
    problem: "needs attention",
    no_output: "no output",
    loading: "Loading history…",
    no_history: "No sunshine recorded yet today",
  },
  nl: {
    producing: "actief",
    now: "nu",
    today: "vandaag",
    power: "Nu",
    today_mode: "Vandaag",
    health: "Gezondheid",
    temperature: "Temperatuur",
    efficiency: "Rendement",
    replay: "Dag afspelen",
    live: "Live",
    no_entity: "Geen paneelindeling-sensor van Enphase Envoy Local gevonden.",
    source_phases: "Gegroepeerd per fase (geen plattegrond in Enlighten)",
    dc: "DC",
    phase: "Fase",
    vs_roof: "van het dakvlak",
    week: "7 dagen",
    problem: "aandacht nodig",
    no_output: "geen opbrengst",
    loading: "Geschiedenis laden…",
    no_history: "Vandaag nog geen zon vastgelegd",
  },
};

function findLayoutEntity(hass) {
  return Object.keys(hass.states).find(
    (id) =>
      id.startsWith("sensor.") &&
      Array.isArray(hass.states[id].attributes.arrays) &&
      hass.states[id].attributes.source !== undefined
  );
}

function num(hass, entityId) {
  if (!entityId) return null;
  const st = hass.states[entityId];
  if (!st) return null;
  const v = parseFloat(st.state);
  return Number.isFinite(v) ? v : null;
}

function isOn(hass, entityId) {
  return !!entityId && hass.states[entityId]?.state === "on";
}

function esc(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function clamp(v) {
  return Math.max(0, Math.min(1, v));
}

class EnphasePanelLayoutCard extends HTMLElement {
  setConfig(config) {
    this._config = {
      mode: "power",
      show_labels: true,
      show_phase: true,
      show_toolbar: true,
      ...config,
    };
    this._mode = MODES.includes(this._config.mode) ? this._config.mode : "power";
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
    this._replay = null;
  }

  static getStubConfig(hass) {
    return { entity: findLayoutEntity(hass) || "", mode: "power" };
  }

  // Visual editor (Home Assistant builds the form from this schema).
  static getConfigForm() {
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        { name: "entity", selector: { entity: { domain: "sensor", integration: "enphase_envoy_local" } } },
        {
          name: "mode",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "power", label: "Now / Nu" },
                { value: "today", label: "Today / Vandaag" },
                { value: "health", label: "Health / Gezondheid" },
                { value: "temperature", label: "Temperature / Temperatuur" },
                { value: "efficiency", label: "Efficiency / Rendement" },
              ],
            },
          },
        },
        {
          type: "grid",
          name: "",
          schema: [
            { name: "show_toolbar", selector: { boolean: {} } },
            { name: "show_labels", selector: { boolean: {} } },
            { name: "show_phase", selector: { boolean: {} } },
            { name: "max_height", selector: { text: {} } },
          ],
        },
      ],
      computeLabel: (s) =>
        ({
          title: "Title / Titel",
          entity: "Panel layout sensor / Paneelindeling-sensor",
          mode: "Start view / Startweergave",
          show_toolbar: "Buttons and replay / Knoppen en afspelen",
          show_labels: "Roof names / Dakvlaknamen",
          show_phase: "Phase badges / Fase-labels",
          max_height: "Max height / Max. hoogte (70vh)",
        })[s.name],
    };
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  disconnectedCallback() {
    this._stopPlay();
  }

  set hass(hass) {
    this._hass = hass;
    const entityId = this._config.entity || findLayoutEntity(hass);
    const layout = entityId ? hass.states[entityId] : undefined;
    if (!layout) {
      this._renderMessage(this._t("no_entity"));
      return;
    }
    const key = JSON.stringify(layout.attributes.arrays);
    if (!this._built || key !== this._layoutKey) {
      this._layoutKey = key;
      this._build(layout);
    }
    if (!this._replay) this._update();
  }

  _t(key) {
    const lang = (this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2);
    return (T[lang] || T.en)[key] || T.en[key] || key;
  }

  _renderMessage(text) {
    this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px">${esc(text)}</div></ha-card>`;
    this._built = false;
  }

  /* ------------------------------------------------------------ building */

  _build(layout) {
    const arrays = layout.attributes.arrays || [];
    const modules = arrays.flatMap((a, ai) =>
      a.modules.map((m) => ({ ...m, label: a.label, arrayIndex: ai }))
    );
    if (!modules.length) {
      this._renderMessage(this._t("no_entity"));
      return;
    }
    const pad = 4;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of modules) {
      minX = Math.min(minX, m.x - m.w / 2);
      maxX = Math.max(maxX, m.x + m.w / 2);
      minY = Math.min(minY, m.y - m.h / 2);
      maxY = Math.max(maxY, m.y + m.h / 2);
    }
    const labelSpace = this._config.show_labels ? 34 : 0;
    const tops = arrays.map((a) => Math.min(...a.modules.map((m) => m.y - m.h / 2)));
    minY -= labelSpace;
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    const pct = (v, total) => `${(v / total) * 100}%`;

    const labelHtml = this._config.show_labels
      ? arrays
          .map((a, i) => {
            const left = Math.min(...a.modules.map((m) => m.x - m.w / 2));
            const right = Math.max(...a.modules.map((m) => m.x + m.w / 2));
            // Arrays that touch the one above them form one roof: label only the top one.
            const blocked = modules.some(
              (o) =>
                o.arrayIndex !== i &&
                o.y + o.h / 2 > tops[i] - labelSpace &&
                o.y + o.h / 2 <= tops[i] + 1 &&
                o.x + o.w / 2 > left &&
                o.x - o.w / 2 < right
            );
            return a.label && !blocked
              ? `<div class="label" style="left:${pct(left - minX + pad, width)};top:${pct(tops[i] - labelSpace - minY + pad + 6, height)}">${esc(a.label)}</div>`
              : "";
          })
          .join("")
      : "";

    const panelHtml = modules
      .map((m, i) => {
        const left = m.x - m.w / 2 - minX + pad;
        const top = m.y - m.h / 2 - minY + pad;
        const landscape = m.w > m.h;
        const phase =
          m.phase && this._config.show_phase
            ? `<span class="phase" style="background:${PHASE_COLORS[m.phase] || "#616161"}">${esc(m.phase)}</span>`
            : "";
        return `<button class="panel ${landscape ? "land" : "port"}" data-i="${i}"
          style="left:${pct(left, width)};top:${pct(top, height)};width:${pct(m.w, width)};height:${pct(m.h, height)}">
            <span class="glow"></span>
            ${phase}
            <span class="alert">!</span>
            <span class="val"><b class="w">–</b><small class="u">W</small></span>
            <span class="temp"></span>
          </button>`;
      })
      .join("");

    const title = this._config.title ? `<div class="title">${esc(this._config.title)}</div>` : "";
    const note =
      layout.attributes.source === "phases"
        ? `<div class="note">${esc(this._t("source_phases"))}</div>`
        : "";
    const modeLabel = { power: "power", today: "today_mode", health: "health", temperature: "temperature", efficiency: "efficiency" };
    const toolbar = this._config.show_toolbar
      ? `<div class="toolbar">
          <div class="modes">${MODES.map(
            (m) => `<button class="chip" data-mode="${m}">${esc(this._t(modeLabel[m]))}</button>`
          ).join("")}</div>
          <button class="chip replay-btn">▶ ${esc(this._t("replay"))}</button>
        </div>
        <div class="replay" hidden>
          <button class="play" aria-label="play">▶</button>
          <input type="range" min="0" max="0" value="0" step="1">
          <span class="clock">--:--</span>
          <button class="chip live-btn">${esc(this._t("live"))}</button>
        </div>`
      : "";

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="head">
          ${title}
          <div class="stats">
            <div><span class="big total">–</span><span class="unit">W</span><span class="cap">${esc(this._t("now"))}</span></div>
            <div><span class="big today">–</span><span class="unit">kWh</span><span class="cap">${esc(this._t("today"))}</span></div>
            <div><span class="big active">–</span><span class="unit">/ ${modules.length}</span><span class="cap">${esc(this._t("producing"))}</span></div>
            <div class="problems" hidden><span class="big nprob">0</span><span class="cap">${esc(this._t("problem"))}</span></div>
          </div>
          ${toolbar}
        </div>
        <div class="roof" style="aspect-ratio:${width} / ${height};width:min(100%, calc(${this._config.max_height || "70vh"} * ${width} / ${height}))">${labelHtml}${panelHtml}</div>
        ${note}
        <div class="legend"><span class="lname"></span><span class="lmin"></span><span class="bar"></span><span class="lmax"></span></div>
      </ha-card>`;

    this._modules = modules;
    this._els = [...this.shadowRoot.querySelectorAll(".panel")];
    this._els.forEach((el) =>
      el.addEventListener("click", () => {
        const m = this._modules[+el.dataset.i];
        const target = this._mode === "health" ? m.performance || m.power : m.power;
        if (!target) return;
        this.dispatchEvent(
          new CustomEvent("hass-more-info", { detail: { entityId: target }, bubbles: true, composed: true })
        );
      })
    );
    const q = (s) => this.shadowRoot.querySelector(s);
    this.shadowRoot.querySelectorAll(".modes .chip").forEach((b) =>
      b.addEventListener("click", () => {
        this._mode = b.dataset.mode;
        if (this._replay) this._stopReplay();
        else this._update();
      })
    );
    q(".replay-btn")?.addEventListener("click", () => this._startReplay());
    q(".live-btn")?.addEventListener("click", () => this._stopReplay());
    q(".play")?.addEventListener("click", () => (this._timer ? this._stopPlay() : this._play()));
    q(".replay input")?.addEventListener("input", (e) => {
      this._stopPlay();
      this._showFrame(+e.target.value);
    });
    this._built = true;
  }

  /* ------------------------------------------------------------- values */

  _liveRows() {
    const hass = this._hass;
    const demo = this._config.demo;
    return this._modules.map((m, i) => {
      const fake = demo ? 0.55 + 0.4 * Math.sin(i * 1.7 + Date.now() / 60000) : null;
      const w = demo ? Math.round(290 * fake) : num(hass, m.power);
      const t = demo ? Math.round(18 + 20 * fake) : num(hass, m.temperature);
      const eff = demo ? 95 + 2 * fake : num(hass, m.efficiency);
      const dc = demo ? w / (eff / 100) : num(hass, m.dc_power);
      const wh = demo ? 1800 * fake : num(hass, m.today);
      const perf = demo ? (i === 13 ? 78 : 96 + 6 * fake) : num(hass, m.performance);
      const perfWeek = demo ? perf : num(hass, m.performance_week);
      const noOutput = demo ? false : isOn(hass, m.no_output);
      const problem = demo ? i === 13 : isOn(hass, m.underperforming) || noOutput;
      return { m, w, t, eff, dc, wh, perf, perfWeek, problem, noOutput };
    });
  }

  _update() {
    if (!this._built || !this._modules) return;
    this._paint(this._liveRows(), false);
  }

  _paint(rows, replaying) {
    const mode = replaying ? "power" : this._mode;
    let total = 0, today = 0, active = 0, problems = 0;
    for (const r of rows) {
      if (r.w != null) total += r.w;
      if (r.wh != null) today += r.wh;
      if (r.w != null && r.w > 0) active += 1;
      if (r.problem) problems += 1;
    }
    const peak = Math.max(1, ...rows.map((r) => r.w || 0), ...rows.map((r) => (r.m.max || 0) * 0.6));
    const bestToday = Math.max(1, ...rows.map((r) => r.wh || 0));

    const view = (r) => {
      switch (mode) {
        case "today":
          return {
            level: r.wh == null ? 0 : clamp(r.wh / bestToday),
            value: r.wh == null ? "–" : (r.wh / 1000).toFixed(2),
            unit: "kWh",
          };
        case "health": {
          const p = r.perfWeek ?? r.perf;
          return {
            level: p == null ? 0 : 0.35 + 0.5 * clamp((p - 70) / 30),
            value: p == null ? "–" : Math.round(p),
            unit: "%",
            hue: p == null ? "" : p >= 95 ? "ok" : p >= 88 ? "warn" : "bad",
          };
        }
        case "temperature":
          return { level: r.t == null ? 0 : clamp(r.t / 70), value: r.t == null ? "–" : Math.round(r.t), unit: "°C" };
        case "efficiency":
          return {
            level: r.eff == null ? 0 : clamp((r.eff - 85) / 15),
            value: r.eff == null ? "–" : r.eff.toFixed(1),
            unit: "%",
          };
        default:
          return { level: r.w == null ? 0 : clamp(r.w / peak), value: r.w == null ? "–" : Math.round(r.w), unit: "W" };
      }
    };

    rows.forEach((r, i) => {
      const el = this._els[i];
      const v = view(r);
      this._setNumber(el.querySelector(".w"), v.value, replaying ? 0 : 1200);
      el.querySelector(".u").textContent = v.unit;
      el.querySelector(".temp").textContent =
        mode === "temperature" || r.t == null ? "" : `${Math.round(r.t)}°C`;
      el.style.setProperty("--level", v.level.toFixed(3));
      el.dataset.tone = mode === "health" ? v.hue : mode;
      el.classList.toggle("off", !r.w && mode === "power");
      el.classList.toggle("problem", !replaying && r.problem);
      el.title = [
        r.m.serial,
        r.m.label || null,
        r.m.phase ? `${this._t("phase")} ${r.m.phase}` : null,
        r.w != null ? `${Math.round(r.w)} W` : null,
        r.dc != null ? `${this._t("dc")} ${Math.round(r.dc)} W` : null,
        r.eff != null ? `${this._t("efficiency")} ${r.eff.toFixed(1)} %` : null,
        r.t != null ? `${Math.round(r.t)} °C` : null,
        r.wh != null ? `${(r.wh / 1000).toFixed(2)} kWh ${this._t("today")}` : null,
        r.perf != null ? `${Math.round(r.perf)} % ${this._t("vs_roof")}` : null,
        r.perfWeek != null ? `${Math.round(r.perfWeek)} % ${this._t("vs_roof")} (${this._t("week")})` : null,
        r.noOutput ? `⚠ ${this._t("no_output")}` : r.problem ? `⚠ ${this._t("problem")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    });

    const q = (s) => this.shadowRoot.querySelector(s);
    q(".total").textContent = Math.round(total).toLocaleString();
    if (!replaying) q(".today").textContent = (today / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
    q(".active").textContent = active;
    q(".problems").hidden = replaying || problems === 0;
    q(".nprob").textContent = problems;

    const legends = {
      power: [this._t("power"), "0 W", `${Math.round(peak)} W`],
      today: [this._t("today_mode"), "0", `${(bestToday / 1000).toFixed(2)} kWh`],
      health: [this._t("health"), "70 %", "100 %"],
      temperature: [this._t("temperature"), "0 °C", "70 °C"],
      efficiency: [this._t("efficiency"), "85 %", "100 %"],
    }[mode];
    q(".lname").textContent = legends[0];
    q(".lmin").textContent = legends[1];
    q(".lmax").textContent = legends[2];
    q(".bar").className = `bar ${mode}`;
    this.shadowRoot.querySelectorAll(".modes .chip").forEach((b) =>
      b.classList.toggle("on", !replaying && b.dataset.mode === this._mode)
    );
  }

  _setNumber(node, value, duration) {
    // Count smoothly to a new number instead of jumping.
    const target = typeof value === "number" ? value : parseFloat(value);
    const decimals = typeof value === "string" && value.includes(".") ? value.split(".")[1].length : 0;
    const from = parseFloat(node.dataset.v);
    if (node._raf) cancelAnimationFrame(node._raf);
    if (!duration || !Number.isFinite(target) || !Number.isFinite(from) || from === target) {
      node.textContent = value;
      node.dataset.v = Number.isFinite(target) ? target : "";
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      node.textContent = (from + (target - from) * eased).toFixed(decimals);
      if (k < 1) node._raf = requestAnimationFrame(step);
    };
    node.dataset.v = target;
    node._raf = requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------- replay */

  async _startReplay() {
    const q = (s) => this.shadowRoot.querySelector(s);
    q(".replay").hidden = false;
    q(".clock").textContent = this._t("loading");
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    // Our own power sensor, plus any other power sensor of the same
    // microinverter (e.g. from another integration) as history fallback.
    const hass = this._hass;
    const candidates = this._modules.map((m) => {
      const ids = m.power ? [m.power] : [];
      if (m.serial) {
        for (const [id, st] of Object.entries(hass.states)) {
          if (
            id !== m.power &&
            id.startsWith("sensor.") &&
            id.includes(m.serial) &&
            st.attributes.unit_of_measurement === "W"
          ) ids.push(id);
        }
      }
      return ids;
    });
    const ids = [...new Set(candidates.flat())];
    let hist = {};
    try {
      hist = await hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: new Date().toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
    } catch (err) {
      q(".clock").textContent = String(err?.message || err);
      return;
    }
    const parsed = {};
    for (const [id, states] of Object.entries(hist)) {
      parsed[id] = states
        .map((s) => [s.lu != null ? s.lu * 1000 : Date.parse(s.last_updated || s.last_changed), parseFloat(s.s ?? s.state)])
        .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
        .sort((a, b) => a[0] - b[0]);
    }
    // Per panel: the candidate with the most sunshine in it.
    const series = {};
    let first = Infinity;
    this._modules.forEach((m, i) => {
      let best = [];
      let bestScore = -1;
      for (const id of candidates[i]) {
        const s = parsed[id] || [];
        const score = s.filter(([, v]) => v > 0).length;
        if (score > bestScore) {
          best = s;
          bestScore = score;
        }
      }
      series[`#${i}`] = best;
      const firstSun = best.find(([, v]) => v > 0);
      if (firstSun) first = Math.min(first, firstSun[0]);
    });
    if (!Number.isFinite(first)) {
      q(".clock").textContent = this._t("no_history");
      return;
    }
    const now = Date.now();
    const step = 60 * 1000;
    const from = first - step;
    const frames = [];
    for (let t = from; t <= now; t += step) frames.push(t);
    if (!frames.length) frames.push(now);
    this._replay = { series, frames, index: 0 };
    q(".replay input").max = frames.length - 1;
    this._showFrame(0);
    this._play();
  }

  _valueAt(id, t) {
    // Linear interpolation between the readings around t: the gateway
    // reports every few minutes, so this turns steps into a smooth curve.
    const s = this._replay?.series[id];
    if (!s || !s.length || t < s[0][0]) return null;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid][0] <= t) lo = mid;
      else hi = mid - 1;
    }
    const [t0, v0] = s[lo];
    const next = s[lo + 1];
    if (!next) return v0;
    const [t1, v1] = next;
    // A long gap (> 20 min) means no data, not a slow change.
    if (t1 - t0 > 20 * 60 * 1000) return v0;
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }

  _showFrame(index) {
    if (!this._replay) return;
    const { frames } = this._replay;
    index = Math.max(0, Math.min(frames.length - 1, index));
    this._replay.index = index;
    const t = frames[index];
    const rows = this._modules.map((m, i) => ({
      m, w: this._valueAt(`#${i}`, t), t: null, eff: null, dc: null, wh: null,
      perf: null, perfWeek: null, problem: false, noOutput: false,
    }));
    this.shadowRoot.querySelector(".roof").classList.add("replaying");
    this._paint(rows, true);
    const q = (s) => this.shadowRoot.querySelector(s);
    q(".replay input").value = index;
    q(".clock").textContent = new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  _play() {
    this._stopPlay();
    if (!this._replay) return;
    if (this._replay.index >= this._replay.frames.length - 1) this._replay.index = 0;
    this.shadowRoot.querySelector(".play").textContent = "❚❚";
    this._timer = setInterval(() => {
      if (!this._replay || this._replay.index >= this._replay.frames.length - 1) {
        this._stopPlay();
        return;
      }
      this._showFrame(this._replay.index + 1);
    }, 45);
  }

  _stopPlay() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    const btn = this.shadowRoot?.querySelector(".play");
    if (btn) btn.textContent = "▶";
  }

  _stopReplay() {
    this._stopPlay();
    this._replay = null;
    const box = this.shadowRoot.querySelector(".replay");
    if (box) box.hidden = true;
    this.shadowRoot.querySelector(".roof")?.classList.remove("replaying");
    this._update();
  }
}


/* ===================================================================
 * System summary card: sun -> house <- grid, today's numbers, status.
 *
 *   type: custom:enphase-system-card
 *   entity: sensor.envoy_<serial>_panel_layout   # optional, found automatically
 *   title: Zonnepanelen
 * =================================================================== */

const ST = {
  en: {
    solar: "Solar", home: "Home", grid: "Grid", import: "from grid", export: "to grid",
    today: "Today", produced: "Produced", used: "Used", imported: "Imported", exported: "Exported",
    selfuse: "Self-consumption", sufficient: "Self-sufficiency", panels: "Panels producing",
    attention: "Need attention", cloud: "Enlighten", online: "connected", offline: "offline",
    token: "Token valid until", total: "Total produced", none: "all good",
  },
  nl: {
    solar: "Zon", home: "Huis", grid: "Net", import: "van het net", export: "naar het net",
    today: "Vandaag", produced: "Opgewekt", used: "Verbruikt", imported: "Afgenomen", exported: "Teruggeleverd",
    selfuse: "Eigen verbruik", sufficient: "Zelfvoorzienend", panels: "Panelen actief",
    attention: "Aandacht nodig", cloud: "Enlighten", online: "verbonden", offline: "geen verbinding",
    token: "Token geldig tot", total: "Totaal opgewekt", none: "alles in orde",
  },
};

function fmtPower(w) {
  if (w == null) return "–";
  const a = Math.abs(w);
  return a >= 1000 ? `${(w / 1000).toFixed(a >= 10000 ? 1 : 2)} kW` : `${Math.round(w)} W`;
}

function fmtEnergy(wh, unit) {
  if (wh == null) return "–";
  const kwh = unit === "Wh" ? wh / 1000 : unit === "MWh" ? wh * 1000 : wh;
  return kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${kwh.toFixed(kwh >= 100 ? 0 : 1)} kWh`;
}

class EnphaseSystemCard extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
  }

  static getStubConfig(hass) {
    return { entity: findLayoutEntity(hass) || "" };
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        { name: "entity", selector: { entity: { domain: "sensor", integration: "enphase_envoy_local" } } },
      ],
      computeLabel: (s) => ({ title: "Title / Titel", entity: "Panel layout sensor / Paneelindeling-sensor" })[s.name],
    };
  }

  getCardSize() {
    return 5;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  _t(key) {
    const lang = (this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2);
    return (ST[lang] || ST.en)[key] || ST.en[key] || key;
  }

  set hass(hass) {
    this._hass = hass;
    const entityId = this._config.entity || findLayoutEntity(hass);
    const layout = entityId ? hass.states[entityId] : undefined;
    if (!layout || !layout.attributes.gateway) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px">${esc(T.en.no_entity)}</div></ha-card>`;
      this._built = false;
      return;
    }
    this._layout = layout;
    if (!this._built) this._build();
    this._update();
  }

  _build() {
    const title = this._config.title ? `<div class="title">${esc(this._config.title)}</div>` : "";
    this.shadowRoot.innerHTML = `
      <style>${SYSTEM_STYLE}</style>
      <ha-card>
        ${title}
        <div class="flow">
          <button class="node sun" data-k="production_power">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><g><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></g></svg>
            <b class="v prod">–</b><span>${esc(this._t("solar"))}</span>
          </button>
          <div class="line l1"><i></i></div>
          <button class="node home" data-k="consumption_power">
            <svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/></svg>
            <b class="v cons">–</b><span>${esc(this._t("home"))}</span>
          </button>
          <div class="line l2"><i></i></div>
          <button class="node grid" data-k="net_power">
            <svg viewBox="0 0 24 24"><path d="M8 21 12 3l4 18"/><path d="M6 8h12M5 13h14M9.5 21h5"/></svg>
            <b class="v net">–</b><span class="gridcap">${esc(this._t("grid"))}</span>
          </button>
        </div>
        <div class="section">${esc(this._t("today"))}</div>
        <div class="tiles">
          <button class="tile" data-k="production_today"><span>${esc(this._t("produced"))}</span><b class="pt">–</b></button>
          <button class="tile" data-k="consumption_today"><span>${esc(this._t("used"))}</span><b class="ct">–</b></button>
          <button class="tile" data-k="grid_import_today"><span>${esc(this._t("imported"))}</span><b class="it">–</b></button>
          <button class="tile" data-k="grid_export_today"><span>${esc(this._t("exported"))}</span><b class="et">–</b></button>
        </div>
        <div class="bars">
          <div class="bar-row"><span>${esc(this._t("selfuse"))}</span><div class="track"><i class="sc"></i></div><b class="scv">–</b></div>
          <div class="bar-row"><span>${esc(this._t("sufficient"))}</span><div class="track"><i class="ss"></i></div><b class="ssv">–</b></div>
        </div>
        <div class="status">
          <span><i class="dot pdot"></i>${esc(this._t("panels"))} <b class="pa">–</b></span>
          <span><i class="dot adot"></i>${esc(this._t("attention"))} <b class="att">–</b></span>
          <span><i class="dot cdot"></i>${esc(this._t("cloud"))} <b class="cl">–</b></span>
          <span>${esc(this._t("total"))} <b class="tot">–</b></span>
        </div>
      </ha-card>`;
    this.shadowRoot.querySelectorAll("[data-k]").forEach((el) =>
      el.addEventListener("click", () => {
        const id = this._layout.attributes.gateway[el.dataset.k];
        if (id)
          this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
      })
    );
    this._built = true;
  }

  _update() {
    const hass = this._hass;
    const g = this._layout.attributes.gateway;
    const v = (k) => num(hass, g[k]);
    const unit = (k) => hass.states[g[k]]?.attributes.unit_of_measurement;
    const q = (s) => this.shadowRoot.querySelector(s);

    const prod = v("production_power");
    const cons = v("consumption_power");
    const net = v("net_power");
    q(".prod").textContent = fmtPower(prod);
    q(".cons").textContent = fmtPower(cons);
    q(".net").textContent = fmtPower(net == null ? null : Math.abs(net));
    q(".gridcap").textContent = net == null ? this._t("grid") : net < -5 ? this._t("export") : this._t("import");

    // Animated flow lines: sun -> home, and home <-> grid.
    const l1 = q(".l1"), l2 = q(".l2");
    l1.classList.toggle("on", (prod || 0) > 5);
    l2.classList.toggle("on", Math.abs(net || 0) > 5);
    l2.classList.toggle("rev", (net || 0) < -5);
    const speed = (w) => `${Math.max(0.6, 3 - Math.log10(Math.max(10, Math.abs(w || 0))) * 0.6)}s`;
    l1.style.setProperty("--speed", speed(prod));
    l2.style.setProperty("--speed", speed(net));

    q(".pt").textContent = fmtEnergy(v("production_today"), unit("production_today"));
    q(".ct").textContent = fmtEnergy(v("consumption_today"), unit("consumption_today"));
    q(".it").textContent = fmtEnergy(v("grid_import_today"), unit("grid_import_today"));
    q(".et").textContent = fmtEnergy(v("grid_export_today"), unit("grid_export_today"));
    q(".tot").textContent = fmtEnergy(v("production_lifetime"), unit("production_lifetime"));

    const pct = (k, bar, label) => {
      const p = v(k);
      q(bar).style.width = `${p == null ? 0 : Math.max(0, Math.min(100, p))}%`;
      q(label).textContent = p == null ? "–" : `${Math.round(p)}%`;
    };
    pct("self_consumption_today", ".sc", ".scv");
    pct("self_sufficiency_today", ".ss", ".ssv");

    // Panels producing and problems, from the layout's per-panel entities.
    const mods = this._layout.attributes.arrays.flatMap((a) => a.modules);
    const active = mods.filter((m) => (num(hass, m.power) || 0) > 0).length;
    const problems = mods.filter((m) => isOn(hass, m.underperforming) || isOn(hass, m.no_output)).length;
    q(".pa").textContent = `${active} / ${mods.length}`;
    q(".att").textContent = problems ? String(problems) : this._t("none");
    q(".adot").classList.toggle("bad", problems > 0);
    q(".pdot").classList.toggle("ok", active > 0);
    const cloud = hass.states[g.cloud_connected]?.state;
    q(".cl").textContent = cloud === "on" ? this._t("online") : cloud === "off" ? this._t("offline") : "–";
    q(".cdot").classList.toggle("ok", cloud === "on");
    q(".cdot").classList.toggle("bad", cloud === "off");
  }
}

const SYSTEM_STYLE = `
  :host { --sun: 255,176,32; --home: 3,169,244; --grid: 156,39,176; }
  ha-card { padding: 16px; }
  .title { font-size: 1.15rem; font-weight: 500; margin-bottom: 12px; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: inherit; }
  .flow { display: grid; grid-template-columns: 1fr minmax(30px, 1.2fr) 1fr minmax(30px, 1.2fr) 1fr; align-items: center; }
  .node { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .node svg { width: 54px; height: 54px; padding: 14px; box-sizing: border-box; border-radius: 50%;
              fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .sun svg { stroke: rgb(var(--sun)); background: rgba(var(--sun), .14); }
  .sun svg circle { fill: rgba(var(--sun), .35); }
  .home svg { stroke: rgb(var(--home)); background: rgba(var(--home), .14); }
  .grid svg { stroke: rgb(var(--grid)); background: rgba(var(--grid), .14); }
  .node b { font-size: 1.25rem; font-variant-numeric: tabular-nums; }
  .node span { font-size: .8rem; color: var(--secondary-text-color); }
  .line { height: 3px; border-radius: 2px; background: var(--divider-color, rgba(127,127,127,.25)); position: relative; overflow: hidden; margin-bottom: 40px; }
  .line i { position: absolute; inset: 0; opacity: 0; }
  .line.on i { opacity: 1; animation: flow var(--speed, 2s) linear infinite;
    background: repeating-linear-gradient(90deg, transparent 0 10px, rgb(var(--c)) 10px 18px); background-size: 28px 100%; }
  .l1 { --c: var(--sun); }
  .l2 { --c: var(--grid); }
  /* Grid -> home (import) runs right-to-left; export runs left-to-right. */
  .l2:not(.rev) i { animation-direction: reverse; }
  @keyframes flow { from { background-position: 0 0; } to { background-position: 28px 0; } }
  .section { margin: 16px 0 8px; font-size: .75rem; letter-spacing: .05em; text-transform: uppercase; color: var(--secondary-text-color); }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .tile { display: flex; flex-direction: column; gap: 2px; padding: 10px; border-radius: 10px;
          background: var(--secondary-background-color, rgba(127,127,127,.08)); }
  .tile span { font-size: .75rem; color: var(--secondary-text-color); }
  .tile b { font-size: 1.05rem; font-variant-numeric: tabular-nums; }
  .bars { margin-top: 12px; display: grid; gap: 8px; }
  .bar-row { display: grid; grid-template-columns: 9.5em 1fr 3em; align-items: center; gap: 10px; font-size: .85rem; }
  .bar-row span { color: var(--secondary-text-color); }
  .bar-row b { text-align: right; font-variant-numeric: tabular-nums; }
  .track { height: 8px; border-radius: 4px; background: var(--divider-color, rgba(127,127,127,.25)); overflow: hidden; }
  .track i { display: block; height: 100%; width: 0; border-radius: 4px; transition: width 1.2s ease;
             background: linear-gradient(90deg, rgb(var(--sun)), #66bb6a); }
  .status { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 14px; font-size: .8rem; color: var(--secondary-text-color); }
  .status b { color: var(--primary-text-color); font-weight: 500; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--disabled-text-color, #888); }
  .dot.ok { background: #4caf50; }
  .dot.bad { background: var(--error-color, #db4437); }
  @media (max-width: 500px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
`;

const STYLE = `
  :host { --panel: #0d0f12; --cell: rgba(255,255,255,.06); --sun: 255,176,32; }
  ha-card { padding: 16px; overflow: hidden; }
  .head { display:flex; flex-direction:column; gap:10px; margin-bottom:14px; }
  .title { font-size: 1.15rem; font-weight: 500; }
  .stats { display:flex; gap:22px; flex-wrap:wrap; }
  .stats > div { display:flex; align-items:baseline; gap:4px; }
  .stats > div[hidden] { display:none; }
  .big { font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .unit { color: var(--secondary-text-color); font-size: .9rem; }
  .cap { color: var(--secondary-text-color); font-size: .8rem; margin-left: 4px; }
  .problems .big { color: var(--error-color, #db4437); }
  .toolbar { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; }
  .modes { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font: inherit; font-size:.8rem; padding:4px 10px; border-radius: 14px; cursor:pointer;
          border: 1px solid var(--divider-color, rgba(127,127,127,.3)); background: transparent;
          color: var(--primary-text-color); }
  .chip.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .replay { display:flex; align-items:center; gap:10px; }
  .replay[hidden] { display:none; }
  .replay input { flex:1; accent-color: rgb(var(--sun)); }
  .replay .play { width:32px; height:32px; border-radius:50%; border:0; cursor:pointer;
                  background: rgb(var(--sun)); color:#000; font-size:.8rem; }
  .clock { font-variant-numeric: tabular-nums; min-width: 3.5em; white-space: nowrap; color: var(--secondary-text-color); font-size:.85rem; }
  .roof { position: relative; margin: 0 auto; container-type: inline-size; }
  .label { position:absolute; font-size: .75rem; letter-spacing: .04em; text-transform: uppercase;
           color: var(--secondary-text-color); white-space: nowrap; }
  .panel { position:absolute; box-sizing:border-box; padding:0; margin:0; cursor:pointer;
    border: 1.5px solid rgba(255,255,255,.75); border-radius: 2px; overflow:hidden; color:#fff;
    background:
      linear-gradient(var(--cell) 1px, transparent 1px) 0 0 / 100% 8.333%,
      linear-gradient(90deg, var(--cell) 1px, transparent 1px) 0 0 / 16.666% 100%,
      var(--panel);
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    font-family: inherit; transition: transform .15s ease, box-shadow .2s ease; }
  .panel.land { background:
      linear-gradient(var(--cell) 1px, transparent 1px) 0 0 / 100% 16.666%,
      linear-gradient(90deg, var(--cell) 1px, transparent 1px) 0 0 / 8.333% 100%,
      var(--panel); flex-direction: row; gap: 10%; }
  .panel:hover { transform: scale(1.03); z-index: 2; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
  .panel:focus-visible { outline: 2px solid var(--primary-color); }
  .glow { position:absolute; inset:0; pointer-events:none; --c: var(--sun);
    background: radial-gradient(ellipse at 50% 40%, rgba(var(--c), calc(var(--level,0) * .85)) 0%,
      rgba(var(--c), calc(var(--level,0) * .25)) 60%, transparent 100%);
  }
  /* --level is registered as a number (see below), so the glow can fade. */
  .panel { transition: --level 2.5s ease, transform .15s ease, box-shadow .2s ease; }
  .replaying .panel { transition: --level .1s linear, transform .15s ease; }
  .panel[data-tone="temperature"] .glow { --c: 255,112,67; }
  .panel[data-tone="efficiency"] .glow { --c: 102,187,106; }
  .panel[data-tone="today"] .glow { --c: 255,193,7; }
  .panel[data-tone="ok"] .glow { --c: 76,175,80; }
  .panel[data-tone="warn"] .glow { --c: 255,167,38; }
  .panel[data-tone="bad"] .glow { --c: 229,57,53; }
  .val { position:relative; display:flex; flex-direction:column; align-items:center; line-height:1; }
  .land .val { flex-direction: row; align-items: baseline; gap: 3px; }
  .w { font-size: clamp(.8rem, 2.4cqw, 1.5rem); font-weight: 700; font-variant-numeric: tabular-nums; }
  .val small { font-size: .7rem; opacity: .8; margin-top: 2px; }
  .land .val small { margin-top: 0; }
  .temp { position:absolute; bottom: 7%; font-size: .72rem; opacity: .9; }
  .land .temp { position: static; }
  .phase { position:absolute; top:4px; left:4px; font-size:.6rem; font-weight:600; padding:1px 4px;
           border-radius: 3px; opacity:.9; }
  .alert { display:none; position:absolute; top:4px; right:4px; width:16px; height:16px; border-radius:50%;
           background: var(--error-color, #db4437); font-size:.7rem; font-weight:700; line-height:16px; }
  .panel.problem { border-color: var(--error-color, #db4437); box-shadow: inset 0 0 0 1px var(--error-color, #db4437); }
  .panel.problem .alert { display:block; }
  .panel.off .val { opacity: .75; }
  .note { margin-top: 10px; font-size: .8rem; color: var(--secondary-text-color); }
  .legend { display:flex; align-items:center; gap:8px; margin-top: 12px; font-size:.75rem; color: var(--secondary-text-color); }
  .bar { flex: 1; height: 6px; border-radius: 3px; background: linear-gradient(90deg, #0d0f12, rgb(255,176,32)); }
  .bar.temperature { background: linear-gradient(90deg, #0d0f12, #ff7043); }
  .bar.efficiency { background: linear-gradient(90deg, #0d0f12, #66bb6a); }
  .bar.today { background: linear-gradient(90deg, #0d0f12, #ffc107); }
  .bar.health { background: linear-gradient(90deg, #e53935, #ffa726 60%, #4caf50); }
`;

// Gradients cannot be animated, but a registered number property can.
try {
  CSS.registerProperty({ name: "--level", syntax: "<number>", inherits: true, initialValue: "0" });
} catch (err) {
  /* already registered */
}

// The frontend may swap in its own element registry after loading extra
// modules, so (re)define until the cards are known where it counts.
const CARDS = [
  [TAG, EnphasePanelLayoutCard, "Enphase panel layout",
   "Every solar panel on its place on the roof: live power, today, health and a replay of the day."],
  ["enphase-system-card", EnphaseSystemCard, "Enphase system summary",
   "Solar, home and grid at a glance, today's energy, self-consumption and status."],
];

function defineCards() {
  for (const [tag, cls] of CARDS) {
    if (customElements.get(tag)) continue;
    try {
      customElements.define(tag, class extends cls {});
    } catch (err) {
      /* defined meanwhile */
    }
  }
}

defineCards();
let tries = 0;
const keepDefined = setInterval(() => {
  defineCards();
  if (++tries > 120) clearInterval(keepDefined);
}, 500);

window.customCards = window.customCards || [];
for (const [tag, , name, description] of CARDS) {
  if (!window.customCards.some((c) => c.type === tag)) {
    window.customCards.push({
      type: tag,
      name,
      description,
      preview: true,
      documentationURL: "https://github.com/George-120/ha-enphase-envoy-local",
    });
  }
}
console.info(`%c ENPHASE CARDS %c ${CARD_VERSION} `, "background:#ffb020;color:#000", "background:#222;color:#fff");
