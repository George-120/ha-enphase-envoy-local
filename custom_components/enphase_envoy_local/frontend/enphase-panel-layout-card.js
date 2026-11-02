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
 *   size: small | medium | large | full            # card size (default medium)
 *   max_height: 70vh                               # override the height limit
 *   demo: false                                    # fake sunny values (screenshots)
 */

const CARD_VERSION = "1.10.0";
const TAG = "enphase-panel-layout-card";

const PHASE_COLORS = { L1: "#8d6e63", L2: "#455a64", L3: "#9e9e9e" };
const MODES = ["power", "today", "health", "shade", "temperature", "efficiency"];

// Height limit of the roof drawing and the place it takes in a sections view.
const SIZES = {
  small: { height: "35vh", columns: 6, cardSize: 4 },
  medium: { height: "70vh", columns: 12, cardSize: 7 },
  large: { height: "85vh", columns: 12, cardSize: 10 },
  full: { height: "calc(100vh - 120px)", columns: "full", cardSize: 14 },
};
const SIZE_NAMES = {
  small: ["Small", "Klein"],
  medium: ["Medium", "Middel"],
  large: ["Large", "Groot"],
  full: ["Full screen", "Volledig scherm"],
};

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
    vs_roof: "of the good panels",
    week: "7 days",
    problem: "needs attention",
    no_output: "no output",
    loading: "Loading history…",
    no_history: "No sunshine recorded on this day",
    prev_day: "Previous day",
    next_day: "Next day",
    pick_day: "Pick a day",
    shade: "Shade",
    whole_day: "Whole day",
    shade_loading: "Analysing the last weeks…",
    shade_none: "Not enough history yet to find shade (needs a few days of sunshine).",
    shade_info: "Share of what the good panels on the same roof surface made, over the last {days} days. Lower = more shade or a weaker panel.",
    shade_worst: "most shade",
    expected: "Expected",
    no_eff_live: "No efficiency measured yet. It is measured while the panels produce (from 10 W DC); after sunset the last value of the day stays visible.",
    no_eff_yet: "No efficiency recorded yet at this moment of the day.",
    no_eff_day: "No efficiency was recorded on this day. It is stored from the moment the integration was set up, so earlier days only show power, energy and health.",
    no_data_day: "Nothing was recorded for this view on this day.",
    no_data_yet: "No data for this view yet.",
    data_since: "No {what} recorded at this moment. It is recorded since {time}; press Live for the current values.",
    edit_short: "Layout",
    edit: "Arrange panels",
    save: "Save",
    cancel: "Cancel",
    auto: "Automatic layout",
    rotate: "Rotate",
    roof: "Roof surface",
    new_roof: "+ New roof surface",
    roof_name: "Name of this roof surface",
    edit_hint: "Drag the panels to their place. Click a panel to rotate it or move it to another roof surface.",
    source_manual: "Layout drawn by hand",
    save_failed: "Saving failed",
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
    vs_roof: "van de goede panelen",
    week: "7 dagen",
    problem: "aandacht nodig",
    no_output: "geen opbrengst",
    loading: "Geschiedenis laden…",
    no_history: "Geen zon vastgelegd op deze dag",
    prev_day: "Vorige dag",
    next_day: "Volgende dag",
    pick_day: "Kies een dag",
    shade: "Schaduw",
    whole_day: "Hele dag",
    shade_loading: "De afgelopen weken worden geanalyseerd…",
    shade_none: "Nog niet genoeg geschiedenis om schaduw te vinden (een paar dagen zon nodig).",
    shade_info: "Deel van wat de goede panelen op hetzelfde dakvlak opleverden, over de afgelopen {days} dagen. Lager = meer schaduw of een zwakker paneel.",
    shade_worst: "meeste schaduw",
    expected: "Verwacht",
    no_eff_live: "Nog geen rendement gemeten. Dat wordt gemeten zolang de panelen produceren (vanaf 10 W DC); na zonsondergang blijft de laatste waarde van de dag staan.",
    no_eff_yet: "Op dit moment van de dag is nog geen rendement vastgelegd.",
    no_eff_day: "Op deze dag is geen rendement vastgelegd. Dat wordt bewaard vanaf het moment dat de integratie is ingesteld; eerdere dagen tonen alleen vermogen, opbrengst en gezondheid.",
    no_data_day: "Voor deze weergave is op deze dag niets vastgelegd.",
    no_data_yet: "Nog geen gegevens voor deze weergave.",
    data_since: "Op dit moment is nog geen {what} vastgelegd. Dat gebeurt sinds {time}; druk op Live voor de huidige waarden.",
    edit_short: "Indeling",
    edit: "Indeling aanpassen",
    save: "Opslaan",
    cancel: "Annuleren",
    auto: "Automatische indeling",
    rotate: "Draaien",
    roof: "Dakvlak",
    new_roof: "+ Nieuw dakvlak",
    roof_name: "Naam van dit dakvlak",
    edit_hint: "Sleep de panelen naar hun plek. Klik op een paneel om het te draaien of naar een ander dakvlak te zetten.",
    source_manual: "Zelf getekende indeling",
    save_failed: "Opslaan mislukt",
  },
};

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3a9 9 0 0 0-9 9H1l3.9 3.9.1.1L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/></svg>',
};

// Other W sensors of a microinverter that are not its AC power.
const SKIP_POWER = /(_dc_|_dc$|dc_vermogen|dc_power|max)/i;

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
      size: this.constructor.defaultSize || "medium",
      show_labels: true,
      show_phase: true,
      show_toolbar: true,
      ...config,
    };
    if (!SIZES[this._config.size]) this._config.size = "medium";
    this.toggleAttribute("small", this._config.size === "small");
    this._mode = MODES.includes(this._config.mode) ? this._config.mode : "power";
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
    this._replay = null;
  }

  static getStubConfig(hass) {
    return { entity: findLayoutEntity(hass) || "", mode: "power", size: this.defaultSize || "medium" };
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
          name: "size",
          selector: {
            select: {
              mode: "dropdown",
              options: Object.entries(SIZE_NAMES).map(([value, [en, nl]]) => ({
                value,
                label: `${en} / ${nl}`,
              })),
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
          size: "Size / Grootte",
          show_toolbar: "Buttons and replay / Knoppen en afspelen",
          show_labels: "Roof names / Dakvlaknamen",
          show_phase: "Phase badges / Fase-labels",
          max_height: "Max height / Max. hoogte (optional / optioneel)",
        })[s.name],
    };
  }

  get _size() {
    return SIZES[this._config?.size] || SIZES.medium;
  }

  getCardSize() {
    return this._size.cardSize;
  }

  getGridOptions() {
    return { columns: this._size.columns, min_columns: 6, rows: "auto" };
  }

  disconnectedCallback() {
    this._stopPlay();
  }

  set hass(hass) {
    this._hass = hass;
    const entityId = this._config.entity || findLayoutEntity(hass) || this._lastEntity;
    let layout = entityId ? hass.states[entityId] : undefined;
    const usable = layout && Array.isArray(layout.attributes.arrays) && layout.attributes.arrays.length;
    if (usable) {
      this._lastEntity = entityId;
      this._lastGood = layout;
    } else if (this._lastGood) {
      // Sensor briefly unavailable (restart, reload, reconnect): keep the
      // drawing instead of replacing it with a message.
      layout = this._lastGood;
    } else {
      this._renderMessage(this._t("no_entity"));
      return;
    }
    if (this._built && !this.shadowRoot.querySelector(".roof")) this._built = false;
    this._layoutState = layout;
    const key = JSON.stringify(layout.attributes.arrays);
    if (!this._built || (key !== this._layoutKey && !this._draft)) {
      this._layoutKey = key;
      this._build(layout);
    }
    if (!this._replay) this._update();
  }

  _t(key) {
    const lang = (this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2);
    return (T[lang] || T.en)[key] || T.en[key] || key;
  }

  _locale() {
    return this._hass?.locale?.language || this._hass?.language || undefined;
  }

  _renderMessage(text) {
    this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px">${esc(text)}</div></ha-card>`;
    this._built = false;
  }

  /* ------------------------------------------------------------ building */

  _build(layout) {
    const editing = !!this._draft;
    const arrays = editing ? this._draft : layout.attributes.arrays || [];
    const modules = arrays.flatMap((a, ai) =>
      a.modules.map((m) => ({ ...m, label: a.label, arrayIndex: ai }))
    );
    if (!modules.length) {
      this._renderMessage(this._t("no_entity"));
      return;
    }
    const pad = editing ? 110 : 4;
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
            if (!a.modules.length) return "";
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
        const sel = editing && this._selected === m.serial ? " selected" : "";
        return `<button class="panel ${landscape ? "land" : "port"}${sel}" data-i="${i}"
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
    const note = editing
      ? ""
      : layout.attributes.source === "manual"
      ? `<div class="note">${esc(this._t("source_manual"))}</div>`
      : layout.attributes.source === "phases"
        ? `<div class="note">${esc(this._t("source_phases"))}${
            layout.attributes.layout_status
              ? `<br><span class="why">${esc(layout.attributes.layout_status)}</span>`
              : ""
          }</div>`
        : "";
    const modeLabel = { power: "power", today: "today_mode", health: "health", shade: "shade", temperature: "temperature", efficiency: "efficiency" };
    const toolbar = this._config.show_toolbar
      ? `<div class="toolbar">
          <div class="modes" role="tablist">${MODES.map(
            (m) => `<button class="chip" role="tab" data-mode="${m}">${esc(this._t(modeLabel[m]))}</button>`
          ).join("")}</div>
        </div>
        <div class="shade-bar" hidden>
          <span class="shade-label">${esc(this._t("whole_day"))}</span>
          <input type="range" class="shade-hour" min="0" max="0" value="0" step="1" aria-label="hour">
          <span class="shade-days"></span>
        </div>
        <div class="replay" hidden>
          <div class="player-top">
            <div class="day-pick">
              <button class="nav day-prev" title="${esc(this._t("prev_day"))}" aria-label="${esc(this._t("prev_day"))}">${ICONS.prev}</button>
              <label class="day-label">${ICONS.calendar}<span class="day-text">–</span><input type="date" class="day" aria-label="${esc(this._t("pick_day"))}"></label>
              <button class="nav day-next" title="${esc(this._t("next_day"))}" aria-label="${esc(this._t("next_day"))}">${ICONS.next}</button>
            </div>
            <button class="live-btn"><span class="dot"></span>${esc(this._t("live"))}</button>
          </div>
          <div class="player-main">
            <button class="play" aria-label="play">${ICONS.play}</button>
            <div class="track">
              <svg class="curve" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="sunfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="rgb(255,176,32)" stop-opacity=".55"/>
                    <stop offset="1" stop-color="rgb(255,176,32)" stop-opacity=".04"/>
                  </linearGradient>
                  <clipPath id="played"><rect class="played-rect" x="0" y="0" width="0" height="100"/></clipPath>
                </defs>
                <path class="area-all" d=""/>
                <path class="area-done" d="" clip-path="url(#played)"/>
                <path class="line-done" d="" clip-path="url(#played)"/>
                <path class="line-exp" d=""/>
                <line class="cursor" x1="0" x2="0" y1="0" y2="100"/>
              </svg>
              <input type="range" min="0" max="0" value="0" step="1" aria-label="time">
              <div class="ticks"><span>06</span><span>09</span><span>12</span><span>15</span><span>18</span></div>
            </div>
            <span class="clock">--:--</span>
          </div>
        </div>`
      : "";

    this.shadowRoot.innerHTML = `
      <style>${STYLE}${GLASS}</style>
      <ha-card>
        <div class="head">
          <div class="toprow">
            ${title || "<span></span>"}
            ${this._config.show_toolbar ? `<div class="actions">
              <button class="act replay-btn">${ICONS.history}<span>${esc(this._t("replay"))}</span></button>
              ${this._hass?.user?.is_admin && !editing ? `<button class="act edit-btn" title="${esc(this._t("edit"))}">${ICONS.edit}<span>${esc(this._t("edit_short"))}</span></button>` : ""}
            </div>` : ""}
          </div>
          <div class="stats">
            <div><span class="big total">–</span><span class="unit">W</span><span class="cap">${esc(this._t("now"))}</span></div>
            <div><span class="big today">–</span><span class="unit">kWh</span><span class="cap tcap">${esc(this._t("today"))}</span></div>
            <div><span class="big active">–</span><span class="unit">/ ${modules.length}</span><span class="cap">${esc(this._t("producing"))}</span></div>
            <div class="problems" hidden><span class="big nprob">0</span><span class="cap">${esc(this._t("problem"))}</span></div>
          </div>
          ${toolbar}
        </div>
        <div class="mode-note" hidden></div>
        <div class="roof${editing ? " editing" : ""}" style="aspect-ratio:${width} / ${height};width:min(100%, calc(${this._config.max_height || this._size.height} * ${width} / ${height}))">${labelHtml}${panelHtml}</div>
        ${editing ? this._editBarHtml(arrays) : ""}
        ${note}
        <div class="legend"><span class="lname"></span><span class="lmin"></span><span class="bar"></span><span class="lmax"></span></div>
      </ha-card>`;

    this._modules = modules;
    this._geom = { minX, minY, width, height, pad };
    this._els = [...this.shadowRoot.querySelectorAll(".panel")];
    if (editing) this._bindEditor(arrays);
    this._els.forEach((el) =>
      el.addEventListener("click", () => {
        if (this._draft) return;
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
        q(".shade-bar").hidden = this._mode !== "shade";
        if (this._mode === "shade" && !this._shade) this._loadShade();
        if (this._replay) this._showFrame(this._replay.index);
        else this._update();
      })
    );
    q(".replay-btn")?.addEventListener("click", () => this._startReplay());
    if (q(".shade-bar")) q(".shade-bar").hidden = this._mode !== "shade";
    if (this._mode === "shade" && !this._shade) this._loadShade();
    q(".shade-hour")?.addEventListener("input", (e) => {
      this._shadeHour = +e.target.value;
      this._updateShadeLabel();
      if (this._replay) this._showFrame(this._replay.index);
      else this._update();
    });
    const shiftDay = (n) => {
      const d = new Date(this._replayDay || Date.now());
      d.setDate(d.getDate() + n);
      if (d <= new Date()) this._startReplay(d);
    };
    q(".day-prev")?.addEventListener("click", () => shiftDay(-1));
    q(".day-next")?.addEventListener("click", () => shiftDay(1));
    q(".day-label")?.addEventListener("click", (e) => {
      const input = q(".replay .day");
      if (e.target !== input && input?.showPicker) {
        e.preventDefault();
        try { input.showPicker(); } catch (err) { input.focus(); }
      }
    });
    q(".replay .day")?.addEventListener("change", (e) => {
      if (!e.target.value) return;
      const [y, mo, d] = e.target.value.split("-").map(Number);
      this._startReplay(new Date(y, mo - 1, d));
    });
    q(".edit-btn")?.addEventListener("click", () => this._startEdit());
    q(".live-btn")?.addEventListener("click", () => this._stopReplay());
    q(".play")?.addEventListener("click", () => (this._timer ? this._stopPlay() : this._play()));
    q(".replay input[type=range]")?.addEventListener("input", (e) => {
      this._stopPlay();
      this._showFrame(+e.target.value);
    });
    this._built = true;
  }

  /* ------------------------------------------------------------ editor */

  _startEdit() {
    if (this._replay) this._stopReplay();
    const arrays = this._layoutState?.attributes.arrays || [];
    this._draft = arrays.map((a) => ({
      label: a.label || "",
      modules: a.modules.filter((m) => m.serial).map((m) => ({ ...m })),
    }));
    this._selected = null;
    this._build(this._layoutState);
    this._update();
  }

  _endEdit() {
    this._draft = null;
    this._selected = null;
    this._build(this._layoutState);
    this._update();
  }

  _editBarHtml(arrays) {
    let sel = "";
    const ai = arrays.findIndex((a) => a.modules.some((m) => m.serial === this._selected));
    if (ai >= 0) {
      const options = arrays
        .map((a, i) => (a.modules.length || i === ai ? `<option value="${i}"${i === ai ? " selected" : ""}>${esc(a.label || `${this._t("roof")} ${i + 1}`)}</option>` : ""))
        .join("");
      sel = `<div class="edit-sel">
          <span class="serial">${esc(this._selected)}</span>
          <button class="chip rotate">⟳ ${esc(this._t("rotate"))}</button>
          <label>${esc(this._t("roof"))} <select class="roof-pick">${options}<option value="new">${esc(this._t("new_roof"))}</option></select></label>
          <input class="roof-name" placeholder="${esc(this._t("roof_name"))}" value="${esc(arrays[ai].label)}">
        </div>`;
    }
    return `<div class="editbar">
        <div class="hint">${esc(this._t("edit_hint"))}</div>
        ${sel}
        <div class="edit-actions">
          <button class="chip primary save">${esc(this._t("save"))}</button>
          <button class="chip cancel">${esc(this._t("cancel"))}</button>
          <button class="chip auto">${esc(this._t("auto"))}</button>
        </div>
      </div>`;
  }

  _bindEditor(arrays) {
    const q = (s) => this.shadowRoot.querySelector(s);
    const roof = q(".roof");
    const GRID = 25;
    const snap = (v) => Math.round(v / GRID) * GRID;
    const find = (serial) => {
      for (const a of arrays) {
        const m = a.modules.find((x) => x.serial === serial);
        if (m) return { a, m };
      }
      return {};
    };
    const place = (el, m) => {
      const { minX, minY, width, height, pad } = this._geom;
      el.style.left = `${((m.x - m.w / 2 - minX + pad) / width) * 100}%`;
      el.style.top = `${((m.y - m.h / 2 - minY + pad) / height) * 100}%`;
    };
    this._els.forEach((el) => {
      el.addEventListener("pointerdown", (ev) => {
        const { m } = find(this._modules[+el.dataset.i].serial);
        if (!m) return;
        ev.preventDefault();
        el.setPointerCapture(ev.pointerId);
        const perPx = this._geom.width / roof.clientWidth;
        const start = { x: ev.clientX, y: ev.clientY, mx: m.x, my: m.y };
        let moved = false;
        el.classList.add("dragging");
        const move = (e) => {
          const dx = e.clientX - start.x, dy = e.clientY - start.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
          m.x = snap(start.mx + dx * perPx);
          m.y = snap(start.my + dy * perPx);
          place(el, m);
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          el.classList.remove("dragging");
          if (!moved) {
            m.x = start.mx;
            m.y = start.my;
            this._selected = this._selected === m.serial ? null : m.serial;
          }
          this._build(this._layoutState);
          this._update();
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      });
    });
    q(".rotate")?.addEventListener("click", () => {
      const { m } = find(this._selected);
      if (!m) return;
      [m.w, m.h] = [m.h, m.w];
      this._build(this._layoutState);
      this._update();
    });
    q(".roof-pick")?.addEventListener("change", (e) => {
      const { a, m } = find(this._selected);
      if (!m) return;
      a.modules.splice(a.modules.indexOf(m), 1);
      if (e.target.value === "new") {
        arrays.push({ label: `${this._t("roof")} ${arrays.length + 1}`, modules: [m] });
      } else {
        arrays[+e.target.value].modules.push(m);
      }
      this._build(this._layoutState);
      this._update();
    });
    q(".roof-name")?.addEventListener("change", (e) => {
      const { a } = find(this._selected);
      if (!a) return;
      a.label = e.target.value.trim();
      this._build(this._layoutState);
      this._update();
    });
    q(".cancel").addEventListener("click", () => this._endEdit());
    const serial = this._layoutState.attributes.serial;
    const call = async (service, data, btn) => {
      btn.disabled = true;
      try {
        await this._hass.callService("enphase_envoy_local", service, { serial, ...data });
        this._endEdit();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = `${this._t("save_failed")}: ${err.message || err}`;
      }
    };
    q(".save").addEventListener("click", (e) =>
      call(
        "set_panel_layout",
        {
          arrays: arrays
            .filter((a) => a.modules.length)
            .map((a) => ({
              label: a.label,
              modules: a.modules.map(({ serial: s, x, y, w, h }) => ({ serial: s, x, y, w, h })),
            })),
        },
        e.currentTarget
      )
    );
    q(".auto").addEventListener("click", (e) => call("reset_panel_layout", {}, e.currentTarget));
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
    const mode = this._mode;
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
        case "shade": {
          const p = this._shadeValue(r.m.serial);
          return {
            level: p == null ? 0 : 0.25 + 0.75 * clamp((100 - p) / 30),
            value: p == null ? "–" : Math.round(p),
            unit: "%",
            hue: "shade",
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
      el.querySelector(".temp").textContent = this._draft
        ? `…${String(r.m.serial || "").slice(-4)}`
        : mode === "temperature" || r.t == null
        ? ""
        : `${Math.round(r.t)}°C`;
      el.style.setProperty("--level", v.level.toFixed(3));
      el.dataset.tone = mode === "health" || mode === "shade" ? v.hue : mode;
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
        this._shadeWorst(r.m.serial),
        r.noOutput ? `⚠ ${this._t("no_output")}` : r.problem ? `⚠ ${this._t("problem")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    });

    const q = (s) => this.shadowRoot.querySelector(s);
    q(".total").textContent = Math.round(total).toLocaleString();
    q(".today").textContent = (today / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
    q(".active").textContent = active;
    q(".problems").hidden = replaying || problems === 0;
    q(".nprob").textContent = problems;

    const legends = {
      power: [this._t("power"), "0 W", `${Math.round(peak)} W`],
      today: [this._t("today_mode"), "0", `${(bestToday / 1000).toFixed(2)} kWh`],
      health: [this._t("health"), "70 %", "100 %"],
      temperature: [this._t("temperature"), "0 °C", "70 °C"],
      efficiency: [this._t("efficiency"), "85 %", "100 %"],
      shade: [this._t("shade"), "100 %", "70 %"],
    }[mode];
    // Say so when a view has nothing to show, instead of a roof full of dashes.
    const needs = { efficiency: "eff", temperature: "t", today: "wh", health: "perf" }[mode];
    let empty = needs && rows.every((r) => r[needs] == null && (needs !== "perf" || r.perfWeek == null));
    if (mode === "shade") empty = !this._shade?.ready;
    const note = q(".mode-note");
    if (note) {
      note.hidden = !empty;
      if (empty) {
        const pastDay = replaying && this._replayDay && this._replayDay < new Date().setHours(0, 0, 0, 0);
        // In a replay: from when this view has data at all.
        let since = null;
        if (replaying && (mode === "temperature" || mode === "efficiency")) {
          const pre = mode === "temperature" ? "t" : "e";
          const firsts = this._modules
            .map((m, i) => this._replay?.series[`${pre}${i}`]?.[0]?.[0])
            .filter((t) => t != null);
          if (firsts.length) since = Math.min(...firsts);
        }
        note.textContent = since
          ? this._t("data_since")
              .replace("{what}", this._t(mode === "temperature" ? "temperature" : "efficiency").toLowerCase())
              .replace("{time}", new Date(since).toLocaleString(this._locale(), { weekday: "short", hour: "2-digit", minute: "2-digit" }))
          : mode === "shade"
          ? this._t(this._shade?.loading ? "shade_loading" : "shade_none")
          : mode === "efficiency"
            ? this._t(pastDay ? "no_eff_day" : replaying ? "no_eff_yet" : "no_eff_live")
            : this._t(pastDay ? "no_data_day" : "no_data_yet");
      }
    }
    q(".lname").textContent = legends[0];
    q(".lmin").textContent = legends[1];
    q(".lmax").textContent = legends[2];
    q(".bar").className = `bar ${mode}`;
    this.shadowRoot.querySelectorAll(".modes .chip").forEach((b) =>
      b.classList.toggle("on", b.dataset.mode === this._mode)
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

  async _startReplay(day) {
    const q = (s) => this.shadowRoot.querySelector(s);
    this._stopPlay();
    this._replay = null;
    q(".replay").hidden = false;
    q(".replay-btn")?.classList.add("on");
    q(".clock").textContent = this._t("loading");
    const start = new Date(day || Date.now());
    start.setHours(0, 0, 0, 0);
    this._replayDay = start.getTime();
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const isToday = end > new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const dayInput = q(".replay .day");
    const now = new Date();
    dayInput.value = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
    dayInput.max = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    q(".day-next").disabled = isToday;
    const yesterday = new Date(now);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    q(".day-text").textContent = isToday
      ? this._t("today_mode")
      : start.toLocaleDateString(this._locale(), { weekday: "long", day: "numeric", month: "long" });
    q(".tcap").classList.toggle("past", !isToday);
    this._drawCurve(null);
    const until = isToday ? Date.now() : end.getTime();

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
            st.attributes.unit_of_measurement === "W" &&
            !SKIP_POWER.test(id)
          ) ids.push(id);
        }
      }
      return ids;
    });
    const extra = this._modules.flatMap((m) => [m.temperature, m.efficiency].filter(Boolean));
    const ids = [...new Set([...candidates.flat(), ...extra])];
    let hist = {};
    try {
      hist = await hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: new Date(until).toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
    } catch (err) {
      q(".clock").textContent = String(err?.message || err);
      return;
    }
    if (this._replayDay !== start.getTime()) return; // another day was picked meanwhile
    const parsed = {};
    for (const [id, states] of Object.entries(hist)) {
      parsed[id] = states
        .map((s) => [s.lu != null ? s.lu * 1000 : Date.parse(s.last_updated || s.last_changed), parseFloat(s.s ?? s.state)])
        .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
        .sort((a, b) => a[0] - b[0]);
    }
    // Per panel: the candidate with the most sunshine in it.
    const series = {};
    let first = Infinity, last = -Infinity;
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
      if (m.temperature) series[`t${i}`] = parsed[m.temperature] || [];
      if (m.efficiency) series[`e${i}`] = parsed[m.efficiency] || [];
      for (const [t, v] of best) {
        if (v > 0) {
          first = Math.min(first, t);
          last = Math.max(last, t);
        }
      }
    });
    q(".tcap").textContent = isToday
      ? this._t("today")
      : start.toLocaleDateString(this._locale(), { weekday: "short", day: "numeric", month: "short" });
    if (!Number.isFinite(first)) {
      q(".clock").textContent = this._t("no_history");
      this._paint(this._modules.map((m) => this._emptyRow(m)), true);
      return;
    }
    const step = 60 * 1000;
    const from = first - step;
    const to = Math.min(until, last + 15 * step);
    const frames = [];
    for (let t = from; t <= to; t += step) frames.push(t);
    if (!frames.length) frames.push(to);
    // Energy per panel up to every frame (integrated power), for "today" and health.
    const energy = this._modules.map((m, i) => {
      let wh = 0, prev = null;
      return frames.map((t) => {
        const w = this._valueAtSeries(series[`#${i}`], t) || 0;
        if (prev != null) wh += ((prev + w) / 2) * (step / 3600000);
        prev = w;
        return wh;
      });
    });
    const totals = frames.map((t) =>
      this._modules.reduce((sum, m, i) => sum + (this._valueAtSeries(series[`#${i}`], t) || 0), 0)
    );
    const hourly = this._forecastHourly();
    const expected = hourly ? frames.map((t) => this._expectedAt(hourly, t)) : null;
    this._replay = { series, frames, energy, totals, index: 0 };
    this._drawCurve(totals, frames, expected && expected.some((v) => v) ? expected : null);
    q(".replay input[type=range]").max = frames.length - 1;
    this._showFrame(0);
    this._play();
  }

  _drawCurve(totals, frames, expected) {
    const q = (s) => this.shadowRoot.querySelector(s);
    const all = q(".area-all"), done = q(".area-done"), line = q(".line-done"), ticks = q(".ticks");
    const exp = q(".line-exp");
    if (!all) return;
    if (exp) exp.setAttribute("d", "");
    if (!totals || totals.length < 2) {
      all.setAttribute("d", "");
      done.setAttribute("d", "");
      line.setAttribute("d", "");
      if (ticks) ticks.innerHTML = "";
      return;
    }
    const peak = Math.max(1, ...totals, ...(expected || []).map((v) => v || 0));
    const n = totals.length - 1;
    if (exp && expected) {
      exp.setAttribute(
        "d",
        expected
          .map((v, i) => (v == null ? null : `${(i / n) * 1000},${(96 - (v / peak) * 86).toFixed(1)}`))
          .reduce((d, p, i, arr) => (p == null ? d : `${d}${d && arr[i - 1] != null ? "L" : "M"}${p}`), "")
      );
    }
    const pts = totals.map((v, i) => [(i / n) * 1000, 96 - (v / peak) * 86]);
    const stroke = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const area = `${stroke}L1000,100L0,100Z`;
    all.setAttribute("d", area);
    done.setAttribute("d", area);
    line.setAttribute("d", stroke);
    // Hour ticks under the curve, placed where those hours fall.
    if (ticks && frames) {
      const t0 = frames[0], t1 = frames[frames.length - 1];
      const marks = [];
      const d = new Date(t0);
      d.setMinutes(0, 0, 0);
      for (d.setHours(d.getHours() + 1); d.getTime() < t1; d.setHours(d.getHours() + 1)) {
        if (d.getHours() % 2) continue;
        const pos = ((d.getTime() - t0) / (t1 - t0)) * 100;
        if (pos > 4 && pos < 96) marks.push(`<span style="left:${pos.toFixed(1)}%">${String(d.getHours()).padStart(2, "0")}</span>`);
      }
      ticks.innerHTML = marks.join("");
    }
  }

  /* -------------------------------------------------------------- shade */

  async _loadShade() {
    const DAYS = 14;
    this._shade = { loading: true, ready: false };
    this._update();
    const hass = this._hass;
    const candidates = this._modules.map((m) => {
      const ids = m.power ? [m.power] : [];
      if (m.serial) {
        for (const [id, st] of Object.entries(hass.states)) {
          if (id !== m.power && id.startsWith("sensor.") && id.includes(m.serial) && st.attributes.unit_of_measurement === "W" && !SKIP_POWER.test(id))
            ids.push(id);
        }
      }
      return ids;
    });
    const end = new Date();
    end.setMinutes(0, 0, 0);
    const start = new Date(end.getTime() - DAYS * 86400000);
    let stats = {};
    try {
      stats = await hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: [...new Set(candidates.flat())],
        period: "hour",
        types: ["mean"],
      });
    } catch (err) {
      this._shade = { loading: false, ready: false };
      this._update();
      return;
    }
    const toMs = (v) => (typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v));
    // Per panel: hour start -> mean W, from the candidate with most data.
    const series = this._modules.map((m, i) => {
      let best = new Map();
      for (const id of candidates[i]) {
        const rows = stats[id] || [];
        if (rows.length > best.size) best = new Map(rows.filter((r) => r.mean != null).map((r) => [toMs(r.start), r.mean]));
      }
      return best;
    });
    const groups = {};
    this._modules.forEach((m, i) => (groups[m.label || ""] ||= []).push(i));
    const hours = new Set();
    const acc = this._modules.map(() => ({}));
    let daysSeen = new Set();
    const times = new Set(series.flatMap((s) => [...s.keys()]));
    for (const t of times) {
      for (const idx of Object.values(groups)) {
        const vals = idx.map((i) => series[i].get(t)).filter((v) => v != null).sort((a, b) => a - b);
        if (vals.length < 3) continue;
        const med = (a) => (a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2);
        const ref = med(vals.filter((v) => v >= med(vals)));
        if (ref < 15) continue;
        const h = new Date(t).getHours();
        hours.add(h);
        daysSeen.add(new Date(t).toDateString());
        for (const i of idx) {
          const v = series[i].get(t);
          if (v == null) continue;
          const a = (acc[i][h] ||= [0, 0]);
          a[0] += Math.min(v, ref);
          a[1] += ref;
        }
      }
    }
    const hourList = [...hours].sort((a, b) => a - b);
    const ratio = new Map();
    this._modules.forEach((m, i) => {
      const per = {};
      let sv = 0, sr = 0;
      for (const h of hourList) {
        const a = acc[i][h];
        if (!a || !a[1]) continue;
        per[h] = (a[0] / a[1]) * 100;
        sv += a[0];
        sr += a[1];
      }
      per.all = sr ? (sv / sr) * 100 : null;
      ratio.set(m.serial, per);
    });
    this._shade = { loading: false, ready: hourList.length > 0, hours: hourList, ratio, days: daysSeen.size };
    const slider = this.shadowRoot.querySelector(".shade-hour");
    if (slider) {
      slider.max = hourList.length;
      slider.value = this._shadeHour = 0;
    }
    this._updateShadeLabel();
    if (this._replay) this._showFrame(this._replay.index);
    else this._update();
  }

  _shadeValue(serial) {
    const sh = this._shade;
    if (!sh?.ready) return null;
    const per = sh.ratio.get(serial);
    if (!per) return null;
    const key = this._shadeHour ? sh.hours[this._shadeHour - 1] : "all";
    return per[key] ?? null;
  }

  _shadeWorst(serial) {
    const per = this._shade?.ready ? this._shade.ratio.get(serial) : null;
    if (!per) return null;
    let worst = null;
    for (const h of this._shade.hours) if (per[h] != null && (worst == null || per[h] < per[worst])) worst = h;
    if (worst == null || per[worst] > 92) return null;
    return `${this._t("shade")}: ${this._t("shade_worst")} ${String(worst - 1).padStart(2, "0")}–${String(worst).padStart(2, "0")} (${Math.round(per[worst])} %)`;
  }

  _updateShadeLabel() {
    const q = (s) => this.shadowRoot.querySelector(s);
    const sh = this._shade;
    const label = q(".shade-label"), days = q(".shade-days");
    if (!label) return;
    if (!sh?.ready || !this._shadeHour) label.textContent = this._t("whole_day");
    else {
      const h = sh.hours[this._shadeHour - 1];
      label.textContent = `${String(h - 1).padStart(2, "0")}:00 – ${String(h).padStart(2, "0")}:00`;
    }
    if (days) days.textContent = sh?.ready ? this._t("shade_info").replace("{days}", sh.days) : "";
  }

  /* ---------------------------------------------------------- forecast */

  _forecastHourly() {
    const id = this._layoutState?.attributes.gateway?.forecast_today;
    const rows = id ? this._hass.states[id]?.attributes.hourly : null;
    return Array.isArray(rows) ? rows.map(([t, wh]) => [Date.parse(t), wh]) : null;
  }

  _expectedAt(hourly, t) {
    // Hour values are means over the hour before; interpolate between hour middles.
    if (!hourly) return null;
    const mids = hourly.map(([end, wh]) => [end - 1800000, wh]);
    if (t < mids[0][0] || t > mids[mids.length - 1][0]) return null;
    let lo = 0;
    while (lo < mids.length - 2 && mids[lo + 1][0] <= t) lo++;
    const [t0, v0] = mids[lo], [t1, v1] = mids[lo + 1] || mids[lo];
    return t1 === t0 ? v0 : v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }

  _emptyRow(m) {
    return { m, w: null, t: null, eff: null, dc: null, wh: null, perf: null, perfWeek: null, problem: false, noOutput: false };
  }

  _valueAtSeries(s, t) {
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
    if (t1 - t0 > 20 * 60 * 1000) return v0;
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }

  _valueAt(id, t) {
    // Linear interpolation between the readings around t: the gateway
    // reports every few minutes, so this turns steps into a smooth curve.
    return this._valueAtSeries(this._replay?.series[id], t);
  }

  _showFrame(index) {
    if (!this._replay) return;
    const { frames, energy, series } = this._replay;
    index = Math.max(0, Math.min(frames.length - 1, index));
    this._replay.index = index;
    const t = frames[index];
    const rows = this._modules.map((m, i) => {
      const w = this._valueAt(`#${i}`, t);
      const temp = series[`t${i}`]?.length ? this._valueAtSeries(series[`t${i}`], t) : null;
      const eff = w > 5 && series[`e${i}`]?.length ? this._valueAtSeries(series[`e${i}`], t) : null;
      return { ...this._emptyRow(m), w, t: temp, eff, wh: energy[i][index] };
    });
    // Health up to this moment: like the integration, compared with the
    // better half of the same roof surface, never above 100 %.
    const groups = {};
    rows.forEach((r) => (groups[r.m.label || ""] ||= []).push(r));
    for (const group of Object.values(groups)) {
      const values = group.map((r) => r.wh).filter((v) => v != null).sort((a, b) => a - b);
      if (values.length < 3) continue;
      const med = (arr) => {
        const k = arr.length >> 1;
        return arr.length % 2 ? arr[k] : (arr[k - 1] + arr[k]) / 2;
      };
      const mid = med(values);
      const ref = med(values.filter((v) => v >= mid));
      if (ref < 50) continue; // the day has hardly started
      for (const r of group) {
        r.perf = Math.min(100, (r.wh / ref) * 100);
        r.problem = false;
      }
    }
    this.shadowRoot.querySelector(".roof").classList.add("replaying");
    this._paint(rows, true);
    const q = (s) => this.shadowRoot.querySelector(s);
    q(".replay input[type=range]").value = index;
    const x = frames.length > 1 ? (index / (frames.length - 1)) * 1000 : 0;
    q(".played-rect")?.setAttribute("width", x.toFixed(1));
    q(".cursor")?.setAttribute("x1", x.toFixed(1));
    q(".cursor")?.setAttribute("x2", x.toFixed(1));
    q(".clock").textContent = new Date(t).toLocaleTimeString(this._locale(), { hour: "2-digit", minute: "2-digit" });
  }

  _play() {
    this._stopPlay();
    if (!this._replay) return;
    if (this._replay.index >= this._replay.frames.length - 1) this._replay.index = 0;
    const playBtn = this.shadowRoot.querySelector(".play");
    playBtn.innerHTML = ICONS.pause;
    playBtn.classList.add("playing");
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
    if (btn) {
      btn.innerHTML = ICONS.play;
      btn.classList.remove("playing");
    }
  }

  _stopReplay() {
    this._stopPlay();
    this._replay = null;
    this._replayDay = null;
    const cap = this.shadowRoot.querySelector(".tcap");
    if (cap) {
      cap.textContent = this._t("today");
      cap.classList.remove("past");
    }
    this.shadowRoot.querySelector(".replay-btn")?.classList.remove("on");
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
      <style>${SYSTEM_STYLE}${GLASS}</style>
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
  .stats { display:flex; gap:22px; flex-wrap:wrap; align-items:baseline; }
  .stats > div { display:flex; align-items:baseline; gap:4px; }
  .stats > div[hidden] { display:none; }
  .big { font-size: 1.6rem; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .unit { color: var(--secondary-text-color); font-size: .9rem; }
  .cap { color: var(--secondary-text-color); font-size: .8rem; margin-left: 4px; }
  .cap.past { color: rgb(var(--sun)); background: rgba(var(--sun), .14); padding: 2px 8px; border-radius: 999px;
              font-weight: 600; align-self: center; }
  .problems .big { color: var(--error-color, #db4437); }

  .toolbar { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
  .modes { display:inline-flex; gap:2px; padding:3px; border-radius: 999px; max-width:100%; overflow-x:auto;
           background: rgba(127,127,127,.12); scrollbar-width: none; }
  .modes::-webkit-scrollbar { display:none; }
  .modes .chip { border: 0; background: transparent; color: var(--secondary-text-color); padding: 6px 13px;
                 border-radius: 999px; white-space: nowrap; transition: background .2s, color .2s; }
  .modes .chip:hover { color: var(--primary-text-color); }
  .modes .chip.on { background: var(--card-background-color, #1c1c1c); color: var(--primary-text-color);
                    box-shadow: 0 1px 3px rgba(0,0,0,.35), inset 0 0 0 1px rgba(var(--sun), .35); font-weight: 600; }
  .chip { font: inherit; font-size:.8rem; padding:4px 10px; border-radius: 14px; cursor:pointer;
          border: 1px solid var(--divider-color, rgba(127,127,127,.3)); background: transparent;
          color: var(--primary-text-color); }
  .chip.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .toprow { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
  .toprow:empty, .toprow:has(> span:only-child) { display:none; }
  .actions { display:flex; gap:6px; margin-left:auto; }
  .act { font: inherit; font-size:.8rem; display:inline-flex; align-items:center; gap:6px; cursor:pointer;
         padding: 6px 12px 6px 10px; border-radius: 999px; border: 1px solid var(--divider-color, rgba(127,127,127,.3));
         background: transparent; color: var(--primary-text-color); transition: background .2s, border-color .2s; }
  .act svg { width:16px; height:16px; fill: currentColor; opacity:.85; }
  .act:hover { background: rgba(127,127,127,.12); }
  .act.on { border-color: rgba(var(--sun), .6); color: rgb(var(--sun)); background: rgba(var(--sun), .1); }

  .replay { display:flex; flex-direction:column; gap:10px; padding: 12px 14px 10px; border-radius: 16px;
            background: linear-gradient(180deg, rgba(var(--sun), .07), rgba(127,127,127,.06));
            border: 1px solid rgba(var(--sun), .18); animation: slide .25s ease; }
  .replay[hidden] { display:none; }
  @keyframes slide { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform:none; } }
  .player-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .day-pick { display:flex; align-items:center; gap:2px; min-width:0; }
  .nav { width:30px; height:30px; border-radius:50%; border:0; background:transparent; cursor:pointer;
         color: var(--primary-text-color); display:grid; place-items:center; flex:none; }
  .nav svg { width:20px; height:20px; fill: currentColor; }
  .nav:hover:not(:disabled) { background: rgba(127,127,127,.15); }
  .nav:disabled { opacity:.3; cursor: default; }
  .day-label { position:relative; display:inline-flex; align-items:center; gap:7px; cursor:pointer; min-width:0;
               padding: 5px 10px; border-radius: 10px; font-weight: 600; font-size: .92rem; }
  .day-label:hover { background: rgba(127,127,127,.12); }
  .day-label svg { width:16px; height:16px; fill: rgb(var(--sun)); flex:none; }
  .day-text { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .day-text::first-letter { text-transform: uppercase; }
  .day-label input { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; border:0; padding:0;
                     color-scheme: dark light; }
  .live-btn { font: inherit; font-size:.78rem; font-weight:600; letter-spacing:.04em; text-transform: uppercase;
              display:inline-flex; align-items:center; gap:6px; cursor:pointer; padding: 5px 11px; border-radius:999px;
              border: 1px solid var(--divider-color, rgba(127,127,127,.3)); background: transparent; color: var(--primary-text-color); }
  .live-btn .dot { width:8px; height:8px; border-radius:50%; background: var(--error-color, #e53935);
                   box-shadow: 0 0 0 0 rgba(229,57,53,.6); animation: pulse 1.8s infinite; }
  .live-btn:hover { background: rgba(127,127,127,.12); }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(229,57,53,.55); } 70% { box-shadow: 0 0 0 7px rgba(229,57,53,0); } 100% { box-shadow: 0 0 0 0 rgba(229,57,53,0); } }
  .player-main { display:flex; align-items:center; gap:12px; }
  .replay .play { width:42px; height:42px; border-radius:50%; border:0; cursor:pointer; flex:none; display:grid; place-items:center;
                  background: rgb(var(--sun)); color:#1a1200; box-shadow: 0 4px 14px rgba(var(--sun), .35);
                  transition: transform .15s ease, box-shadow .2s ease; }
  .replay .play svg { width:20px; height:20px; fill: currentColor; }
  .replay .play:not(.playing) svg { margin-left: 2px; }
  .replay .play:hover { transform: scale(1.06); }
  .replay .play:active { transform: scale(.96); }
  .track { position:relative; flex:1; height:54px; min-width:120px; }
  .curve { position:absolute; inset:0 0 14px 0; width:100%; height:calc(100% - 14px); overflow:visible; }
  .area-all { fill: rgba(127,127,127,.18); }
  .area-done { fill: url(#sunfill); }
  .line-done { fill:none; stroke: rgb(var(--sun)); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .line-exp { fill:none; stroke: rgba(255,255,255,.7); stroke-width: 1.5; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
  .shade-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding: 8px 12px; border-radius: 16px; }
  .shade-bar[hidden] { display:none; }
  .shade-label { font-weight:600; font-size:.85rem; min-width: 7.5em; font-variant-numeric: tabular-nums; }
  .shade-bar input { flex: 1 1 140px; accent-color: rgb(140,150,255); }
  .shade-days { flex-basis:100%; font-size:.75rem; color: var(--secondary-text-color); }
  .panel[data-tone="shade"] .glow { --c: 124,135,255; }
  .bar.shade { background: linear-gradient(90deg, #0d0f12, rgb(124,135,255)); }
  .cursor { stroke: rgb(var(--sun)); stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-dasharray: 3 3; opacity:.9; }
  .ticks { position:absolute; left:0; right:0; bottom:0; height:12px; font-size:.65rem; color: var(--secondary-text-color); }
  .ticks span { position:absolute; transform: translateX(-50%); font-variant-numeric: tabular-nums; }
  .replay input[type=range] { -webkit-appearance:none; appearance:none; position:absolute; left:0; right:0; top:0;
                              height:calc(100% - 14px); width:100%; margin:0; background:transparent; cursor:pointer; }
  .replay input[type=range]::-webkit-slider-runnable-track { height:100%; background:transparent; }
  .replay input[type=range]::-moz-range-track { height:100%; background:transparent; }
  .replay input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%;
              margin-top: calc((54px - 14px) / 2 - 8px); background:#fff; border: 3px solid rgb(var(--sun));
              box-shadow: 0 2px 6px rgba(0,0,0,.4); }
  .replay input[type=range]::-moz-range-thumb { width:12px; height:12px; border-radius:50%; background:#fff;
              border: 3px solid rgb(var(--sun)); box-shadow: 0 2px 6px rgba(0,0,0,.4); }
  .clock { font-variant-numeric: tabular-nums; min-width: 3.2em; white-space: nowrap; text-align:right;
           color: var(--primary-text-color); font-size:1.05rem; font-weight:600; }
  :host([small]) .act span { display:none; }
  :host([small]) .act { padding: 6px; }
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
  :host([small]) .big { font-size: 1.25rem; }
  :host([small]) .w { font-size: clamp(.6rem, 2.4cqw, 1rem); }
  :host([small]) .val small, :host([small]) .temp { display: none; }
  :host([small]) .phase { font-size: .5rem; padding: 0 3px; }
  .roof.editing { background-image: radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px);
                  background-size: 12px 12px; border-radius: 8px; outline: 1px dashed rgba(255,255,255,.15); }
  .roof.editing .panel { cursor: grab; touch-action: none; }
  .roof.editing .panel.dragging { cursor: grabbing; z-index: 5; opacity: .85; transition: none; }
  .panel.selected { outline: 3px solid rgb(var(--sun)); outline-offset: 1px; z-index: 4; }
  .editbar { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; font-size: .85rem; }
  .editbar .hint { color: var(--secondary-text-color); }
  .edit-sel, .edit-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .edit-sel .serial { font-variant-numeric: tabular-nums; font-weight: 600; }
  .edit-sel select, .edit-sel input { font: inherit; color: var(--primary-text-color); background: var(--card-background-color);
                  border: 1px solid var(--divider-color); border-radius: 8px; padding: 4px 8px; }
  .edit-sel input { flex: 1 1 10em; min-width: 8em; }
  .chip.primary { background: rgb(var(--sun)); color: #000; border-color: transparent; font-weight: 600; }
  .note .why { opacity: .7; font-size: .72rem; word-break: break-word; }
  .note { margin-top: 10px; font-size: .8rem; color: var(--secondary-text-color); }
  .legend { display:flex; align-items:center; gap:8px; margin-top: 12px; font-size:.75rem; color: var(--secondary-text-color); }
  .bar { flex: 1; height: 6px; border-radius: 3px; background: linear-gradient(90deg, #0d0f12, rgb(255,176,32)); }
  .bar.temperature { background: linear-gradient(90deg, #0d0f12, #ff7043); }
  .bar.efficiency { background: linear-gradient(90deg, #0d0f12, #66bb6a); }
  .bar.today { background: linear-gradient(90deg, #0d0f12, #ffc107); }
  .bar.health { background: linear-gradient(90deg, #e53935, #ffa726 60%, #4caf50); }
`;


/* ===================================================================
 * Forecast card: expected vs. actual production, yesterday to day after
 * tomorrow, from the integration's calibrated Open-Meteo forecast.
 *
 *   type: custom:enphase-forecast-card
 *   title: Opbrengstverwachting
 * =================================================================== */

const FT = {
  en: {
    title: "Solar forecast", yesterday: "Yesterday", today: "Today", tomorrow: "Tomorrow", day_after: "Day after",
    expected: "Expected", actual: "Produced", of_expected: "of expected", so_far: "expected so far",
    no_forecast: "No forecast yet. Turn on 'Solar forecast' in the options of Enphase Envoy Local (on by default) and wait a minute.",
    calibrated: "Calibrated on {n} sunny days of your own system", not_calibrated: "Not calibrated yet: becomes accurate after the first sunny day",
    peak: "Peak", now: "now", source: "Weather: Open-Meteo",
    compass: "N,NNE,NE,ENE,E,ESE,SE,SSE,S,SSW,SW,WSW,W,WNW,NW,NNW", learned: "learned from your panels", assumed: "assumed", roof: "Roof",
  },
  nl: {
    title: "Opbrengstverwachting", yesterday: "Gisteren", today: "Vandaag", tomorrow: "Morgen", day_after: "Overmorgen",
    expected: "Verwacht", actual: "Opgewekt", of_expected: "van verwacht", so_far: "verwacht tot nu",
    no_forecast: "Nog geen verwachting. Zet 'Opbrengstverwachting' aan in de opties van Enphase Envoy Local (staat standaard aan) en wacht een minuut.",
    calibrated: "Gekalibreerd op {n} zonnige dagen van je eigen installatie", not_calibrated: "Nog niet gekalibreerd: wordt nauwkeurig na de eerste zonnige dag",
    peak: "Piek", now: "nu", source: "Weer: Open-Meteo",
    compass: "N,NNO,NO,ONO,O,OZO,ZO,ZZO,Z,ZZW,ZW,WZW,W,WNW,NW,NNW", learned: "geleerd van je panelen", assumed: "aangenomen", roof: "Dak",
  },
};

class EnphaseForecastCard extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._day = 0; // -1 yesterday, 0 today, 1 tomorrow, 2 day after
    this._built = false;
    this._actual = {};
  }

  static getStubConfig() {
    return { title: "" };
  }

  static getConfigForm() {
    return {
      schema: [{ name: "title", selector: { text: {} } }],
      computeLabel: (s) => ({ title: "Title / Titel" })[s.name],
    };
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  _t(key) {
    const lang = (this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2);
    return (FT[lang] || FT.en)[key] || FT.en[key] || key;
  }

  _locale() {
    return this._hass?.locale?.language || this._hass?.language || undefined;
  }

  set hass(hass) {
    this._hass = hass;
    const fcId =
      this._config.entity ||
      Object.keys(hass.states).find(
        (id) => id.startsWith("sensor.") && Array.isArray(hass.states[id].attributes?.hourly) && hass.states[id].attributes.calibration !== undefined
      );
    const fc = fcId ? hass.states[fcId] : undefined;
    this._fc = fc;
    if (!this._built) this._build();
    const key = fc ? `${fc.attributes.updated}` : "none";
    if (key !== this._fcKey) {
      this._fcKey = key;
      this._loadActual();
    }
    const now = Date.now();
    if (!this._lastPaint || now - this._lastPaint > 30000) this._paint();
  }

  _build() {
    const days = [-1, 0, 1, 2];
    const names = { "-1": "yesterday", 0: "today", 1: "tomorrow", 2: "day_after" };
    this.shadowRoot.innerHTML = `
      <style>${FORECAST_STYLE}${GLASS}</style>
      <ha-card>
        <div class="top">
          <div class="title">${esc(this._config.title || this._t("title"))}</div>
          <div class="source">${esc(this._t("source"))}</div>
        </div>
        <div class="days">${days
          .map(
            (d) => `<button class="day" data-d="${d}">
              <span class="dn">${esc(this._t(names[d]))}</span>
              <span class="dd"></span>
              <b class="dv">–</b>
              <span class="dbar"><i></i></span>
            </button>`
          )
          .join("")}</div>
        <div class="figures">
          <div><span class="big exp">–</span><span class="unit">kWh</span><span class="cap">${esc(this._t("expected"))}</span></div>
          <div class="act-fig"><span class="big actv">–</span><span class="unit">kWh</span><span class="cap">${esc(this._t("actual"))}</span></div>
          <div class="pct-fig"><span class="pct">–</span><span class="cap pcap"></span></div>
        </div>
        <div class="chart">
          <svg viewBox="0 0 1000 220" preserveAspectRatio="none">
            <defs>
              <linearGradient id="fexp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="rgb(255,255,255)" stop-opacity=".22"/>
                <stop offset="1" stop-color="rgb(255,255,255)" stop-opacity="0"/>
              </linearGradient>
              <linearGradient id="fact" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="rgb(255,176,32)" stop-opacity=".6"/>
                <stop offset="1" stop-color="rgb(255,176,32)" stop-opacity=".04"/>
              </linearGradient>
            </defs>
            <g class="grid"></g>
            <path class="exp-area" d=""/>
            <path class="exp-line" d=""/>
            <path class="act-area" d=""/>
            <path class="act-line" d=""/>
            <line class="now" x1="-10" x2="-10" y1="0" y2="200"/>
            <line class="hover" x1="-10" x2="-10" y1="0" y2="200"/>
          </svg>
          <div class="xlabels"></div>
          <div class="tip" hidden></div>
        </div>
        <div class="legend">
          <span><i class="lg-exp"></i>${esc(this._t("expected"))}</span>
          <span><i class="lg-act"></i>${esc(this._t("actual"))}</span>
          <span class="calib"></span>
        </div>
        <div class="orient"></div>
        <div class="msg" hidden>${esc(this._t("no_forecast"))}</div>
      </ha-card>`;
    this.shadowRoot.querySelectorAll(".day").forEach((b) =>
      b.addEventListener("click", () => {
        this._day = +b.dataset.d;
        this._paint();
      })
    );
    const chart = this.shadowRoot.querySelector(".chart");
    chart.addEventListener("pointermove", (e) => this._hover(e));
    chart.addEventListener("pointerleave", () => this._hover(null));
    this._built = true;
  }

  _dayStart(offset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.getTime();
  }

  _hourly() {
    const rows = this._fc?.attributes.hourly || [];
    return rows.map(([t, wh]) => [Date.parse(t), wh]);
  }

  async _loadActual() {
    // Actual production per hour from the statistics of the production sensors.
    const hass = this._hass;
    const layout = Object.values(hass.states).find((st) => st.attributes.gateway && Array.isArray(st.attributes.arrays));
    const own = layout?.attributes.gateway?.production_power;
    const serial = layout?.attributes.serial;
    const ids = [own].filter(Boolean);
    for (const [id, st] of Object.entries(hass.states)) {
      if (id === own || !id.startsWith("sensor.") || !serial || !id.includes(serial)) continue;
      if (st.attributes.unit_of_measurement === "W" && /product|opgewekt|productie/i.test(id + (st.attributes.friendly_name || "")))
        ids.push(id);
    }
    if (!ids.length) return;
    const start = new Date(this._dayStart(-1));
    try {
      const stats = await hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: new Date().toISOString(),
        statistic_ids: ids,
        period: "hour",
        types: ["mean"],
      });
      const toMs = (v) => (typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v));
      // Per hour the highest of the candidates (our sensor may be younger).
      const merged = {};
      for (const id of ids)
        for (const r of stats[id] || []) {
          if (r.mean == null) continue;
          const t = toMs(r.start) + 3600000; // keyed by hour end, like the forecast
          merged[t] = Math.max(merged[t] || 0, r.mean);
        }
      this._actual = merged;
      this._actualIds = ids;
    } catch (err) {
      this._actual = {};
    }
    this._paint();
  }

  _paint() {
    if (!this._built) return;
    this._lastPaint = Date.now();
    const q = (s) => this.shadowRoot.querySelector(s);
    const hourly = this._hourly();
    q(".msg").hidden = hourly.length > 0;
    q(".chart").style.display = hourly.length ? "" : "none";
    if (!hourly.length) return;
    const now = Date.now();
    // Running hour: add the live production so far.
    const live = this._actualIds?.map((id) => parseFloat(this._hass.states[id]?.state)).find((v) => Number.isFinite(v));
    const actual = { ...this._actual };
    const curEnd = Math.ceil(now / 3600000) * 3600000;
    if (live != null && actual[curEnd] == null) actual[curEnd] = live;

    const sum = (from, to, src) => {
      let wh = 0;
      for (const [t, v] of src) if (t > from && t <= to) wh += v;
      return wh / 1000;
    };
    const actualRows = Object.entries(actual).map(([t, v]) => [+t, v]);
    this.shadowRoot.querySelectorAll(".day").forEach((b) => {
      const d = +b.dataset.d;
      const from = this._dayStart(d), to = from + 86400000;
      const exp = sum(from, to, hourly);
      const act = d <= 0 ? sum(from, to, actualRows) : null;
      b.querySelector(".dd").textContent = new Date(from).toLocaleDateString(this._locale(), { weekday: "short", day: "numeric" });
      b.querySelector(".dv").textContent = `${(d < 0 && act ? act : exp).toFixed(1)} kWh`;
      b.classList.toggle("on", d === this._day);
      b._exp = exp;
    });
    const maxDay = Math.max(0.1, ...[...this.shadowRoot.querySelectorAll(".day")].map((b) => b._exp || 0));
    this.shadowRoot.querySelectorAll(".day").forEach((b) => (b.querySelector(".dbar i").style.width = `${((b._exp || 0) / maxDay) * 100}%`));

    const from = this._dayStart(this._day), to = from + 86400000;
    const expDay = hourly.filter(([t]) => t > from && t <= to);
    const actDay = actualRows.filter(([t]) => t > from && t <= Math.min(to, curEnd)).sort((a, b) => a[0] - b[0]);
    const expKwh = sum(from, to, hourly);
    const actKwh = sum(from, to, actualRows);
    q(".exp").textContent = expKwh.toFixed(1);
    const past = this._day <= 0;
    q(".act-fig").style.display = past ? "" : "none";
    q(".actv").textContent = actKwh.toFixed(1);
    let pctText = "", capText = "";
    if (this._day === 0) {
      const soFar = sum(from, now, hourly) + ((expDay.find(([t]) => t > now && t - 3600000 < now) || [0, 0])[1] * ((now % 3600000) / 3600000)) / 1000;
      if (soFar > 0.05) {
        pctText = `${Math.round((actKwh / soFar) * 100)} %`;
        capText = `${this._t("of_expected")} (${soFar.toFixed(1)} kWh ${this._t("so_far")})`;
      }
    } else if (this._day < 0 && expKwh > 0.05) {
      pctText = `${Math.round((actKwh / expKwh) * 100)} %`;
      capText = this._t("of_expected");
    }
    q(".pct").textContent = pctText;
    q(".pcap").textContent = capText;
    q(".pct-fig").style.display = pctText ? "" : "none";

    // Chart window: from an hour before the first sun to an hour after the last.
    const sunny = expDay.filter(([, v]) => v > 1).map(([t]) => t).concat(actDay.filter(([, v]) => v > 1).map(([t]) => t));
    const x0 = sunny.length ? Math.min(...sunny) - 2 * 3600000 : from + 6 * 3600000;
    const x1 = sunny.length ? Math.max(...sunny) + 3600000 : from + 20 * 3600000;
    const peak = Math.max(50, ...expDay.map(([, v]) => v), ...actDay.map(([, v]) => v)) * 1.12;
    const X = (t) => ((t - x0) / (x1 - x0)) * 1000;
    const Y = (v) => 200 - (v / peak) * 190;
    const mid = (t) => t - 1800000;
    const path = (rows) =>
      rows.map(([t, v], i) => `${i ? "L" : "M"}${X(mid(t)).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const area = (rows) =>
      rows.length ? `${path(rows)}L${X(mid(rows[rows.length - 1][0])).toFixed(1)},200L${X(mid(rows[0][0])).toFixed(1)},200Z` : "";
    const smoothRows = (rows) => rows.filter(([t]) => mid(t) >= x0 - 3600000 && mid(t) <= x1 + 3600000);
    const e = smoothRows(expDay), a = smoothRows(actDay);
    q(".exp-line").setAttribute("d", path(e));
    q(".exp-area").setAttribute("d", area(e));
    q(".act-line").setAttribute("d", past ? path(a) : "");
    q(".act-area").setAttribute("d", past ? area(a) : "");
    const nowLine = q(".now");
    const nx = this._day === 0 ? X(now) : -10;
    nowLine.setAttribute("x1", nx);
    nowLine.setAttribute("x2", nx);
    nowLine.style.display = this._day === 0 && nx >= 0 && nx <= 1000 ? "" : "none";
    // Grid and hour labels.
    const grid = [];
    const labels = [];
    const d = new Date(x0);
    d.setMinutes(0, 0, 0);
    for (d.setHours(d.getHours() + 1); d.getTime() < x1; d.setHours(d.getHours() + 1)) {
      const x = X(d.getTime());
      if (d.getHours() % 2 === 0) {
        grid.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="0" y2="200"/>`);
        labels.push(`<span style="left:${(x / 10).toFixed(1)}%">${String(d.getHours()).padStart(2, "0")}:00</span>`);
      }
    }
    for (let i = 1; i <= 3; i++) grid.push(`<line class="h" x1="0" x2="1000" y1="${(200 - i * 50).toFixed(0)}" y2="${(200 - i * 50).toFixed(0)}"/>`);
    q(".grid").innerHTML = grid.join("");
    q(".xlabels").innerHTML = labels.join("");
    this._view = { x0, x1, expDay, actDay, past };

    const cal = this._fc?.attributes.calibration || {};
    const n = Math.min(...Object.values(cal).map((c) => c.calibration_days ?? 0));
    q(".calib").textContent = Number.isFinite(n) && n > 0 ? this._t("calibrated").replace("{n}", n) : this._t("not_calibrated");
    const dirs = this._t("compass").split(",");
    q(".orient").innerHTML = Object.entries(cal)
      .map(([label, c]) => {
        if (c.azimuth == null) return "";
        const dir = dirs[Math.round(((c.azimuth % 360) / 22.5)) % 16];
        const how = c.orientation === "learned" ? this._t("learned") : c.orientation === "enlighten" ? "Enlighten" : this._t("assumed");
        return `<span><b>${esc(label === "all" ? this._t("roof") : label)}</b> ${esc(dir)} · ${Math.round(c.tilt)}° <i>${esc(how)}</i></span>`;
      })
      .join("");
  }

  _hover(e) {
    const q = (s) => this.shadowRoot.querySelector(s);
    const tip = q(".tip"), line = q(".hover");
    if (!e || !this._view) {
      tip.hidden = true;
      line.style.display = "none";
      return;
    }
    line.style.display = "";
    const box = q(".chart svg").getBoundingClientRect();
    const f = (e.clientX - box.left) / box.width;
    const { x0, x1, expDay, actDay, past } = this._view;
    const t = x0 + f * (x1 - x0);
    const end = Math.ceil(t / 3600000) * 3600000;
    const exp = expDay.find(([h]) => h === end)?.[1];
    const act = actDay.find(([h]) => h === end)?.[1];
    if (exp == null && act == null) return this._hover(null);
    const x = f * 1000;
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    const fmt = (d) => d.toLocaleTimeString(this._locale(), { hour: "2-digit", minute: "2-digit" });
    tip.innerHTML = `<b>${fmt(new Date(end - 3600000))}–${fmt(new Date(end))}</b>
      <span><i class="lg-exp"></i>${esc(this._t("expected"))} ${exp == null ? "–" : Math.round(exp) + " Wh"}</span>
      ${past ? `<span><i class="lg-act"></i>${esc(this._t("actual"))} ${act == null ? "–" : Math.round(act) + " Wh"}</span>` : ""}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(f * 100, 12), 88)}%`;
  }
}

const FORECAST_STYLE = `
  :host { --sun: 255,176,32; }
  ha-card { padding: 16px; overflow: hidden; }
  .top { display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom: 12px; }
  .title { font-size: 1.15rem; font-weight: 500; }
  .source { font-size: .72rem; color: var(--secondary-text-color); }
  .days { display:grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .day { font: inherit; color: var(--primary-text-color); cursor:pointer; text-align:left; display:flex; flex-direction:column; gap:2px;
         padding: 10px 12px; border-radius: 16px; background: var(--g-fill-soft); border: 1px solid var(--g-edge);
         box-shadow: var(--g-shine); transition: transform .15s ease, border-color .2s; }
  .day:hover { transform: translateY(-1px); }
  .day.on { border-color: rgba(var(--sun), .6); background: linear-gradient(160deg, rgba(var(--sun), .28), rgba(var(--sun), .06)); }
  .dn { font-size: .78rem; font-weight: 600; }
  .dd { font-size: .7rem; color: var(--secondary-text-color); }
  .dv { font-size: 1.05rem; font-variant-numeric: tabular-nums; margin-top: 4px; }
  .dbar { height: 4px; border-radius: 2px; background: rgba(127,127,127,.2); overflow:hidden; margin-top: 6px; }
  .dbar i { display:block; height:100%; width:0; border-radius:2px; background: rgb(var(--sun)); transition: width .8s ease; }
  .figures { display:flex; gap: 22px; flex-wrap: wrap; align-items: baseline; margin-bottom: 8px; }
  .figures > div { display:flex; align-items:baseline; gap:4px; }
  .big { font-size: 1.7rem; font-weight: 650; font-variant-numeric: tabular-nums; }
  .actv { color: rgb(var(--sun)); }
  .unit { color: var(--secondary-text-color); font-size: .9rem; }
  .cap { color: var(--secondary-text-color); font-size: .8rem; margin-left: 4px; }
  .pct { font-size: 1.1rem; font-weight: 650; padding: 2px 10px; border-radius: 999px;
         background: linear-gradient(160deg, rgba(102,187,106,.35), rgba(102,187,106,.1)); border: 1px solid rgba(102,187,106,.45); }
  .chart { position: relative; height: 200px; margin-top: 6px; touch-action: pan-y; }
  .chart svg { width: 100%; height: 180px; display:block; overflow: visible; }
  .grid line { stroke: rgba(127,127,127,.16); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .grid line.h { stroke-dasharray: 2 6; }
  .exp-area { fill: url(#fexp); }
  .exp-line { fill: none; stroke: rgba(255,255,255,.75); stroke-width: 2; stroke-dasharray: 6 5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .act-area { fill: url(#fact); }
  .act-line { fill: none; stroke: rgb(var(--sun)); stroke-width: 2.5; vector-effect: non-scaling-stroke; stroke-linejoin: round;
              filter: drop-shadow(0 0 6px rgba(var(--sun), .6)); }
  .now { stroke: var(--error-color, #e53935); stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-dasharray: 3 3; }
  .hover { stroke: rgba(255,255,255,.5); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .xlabels { position: relative; height: 16px; font-size: .68rem; color: var(--secondary-text-color); }
  .xlabels span { position:absolute; transform: translateX(-50%); font-variant-numeric: tabular-nums; }
  .tip { position:absolute; top: 4px; transform: translateX(-50%); display:flex; flex-direction:column; gap:3px; pointer-events:none;
         padding: 8px 10px; border-radius: 12px; font-size: .75rem; white-space: nowrap; z-index: 2;
         background: var(--g-fill), color-mix(in srgb, var(--card-background-color, #1c1c1c) 80%, transparent);
         -webkit-backdrop-filter: var(--g-blur); backdrop-filter: var(--g-blur); border: 1px solid var(--g-edge); box-shadow: var(--g-shine); }
  .tip[hidden] { display:none; }
  .legend { display:flex; gap: 16px; flex-wrap: wrap; align-items:center; font-size: .75rem; color: var(--secondary-text-color); margin-top: 6px; }
  .legend .calib { margin-left: auto; }
  .lg-exp, .lg-act { display:inline-block; width: 16px; height: 0; margin-right: 6px; vertical-align: middle; }
  .lg-exp { border-top: 2px dashed rgba(255,255,255,.75); }
  .lg-act { border-top: 3px solid rgb(var(--sun)); }
  .orient { display:flex; flex-wrap:wrap; gap: 6px 14px; margin-top: 10px; font-size: .72rem; color: var(--secondary-text-color); }
  .orient b { color: var(--primary-text-color); font-weight: 600; }
  .orient i { font-style: normal; opacity: .7; }
  .msg { padding: 14px; border-radius: 16px; font-size: .85rem; background: var(--g-fill-soft); border: 1px solid var(--g-edge); }
  .msg[hidden] { display:none; }
  @media (max-width: 460px) { .days { grid-template-columns: repeat(2, 1fr); } }
`;

/* Liquid glass look shared by both cards. */
const GLASS = `
  :host {
    --g-fill: linear-gradient(155deg, rgba(255,255,255,.13) 0%, rgba(255,255,255,.045) 42%, rgba(255,255,255,.07) 100%);
    --g-fill-soft: linear-gradient(155deg, rgba(255,255,255,.09), rgba(255,255,255,.025));
    --g-edge: rgba(255,255,255,.16);
    --g-shine: inset 0 1px 0 rgba(255,255,255,.22), inset 0 -1px 0 rgba(255,255,255,.05);
    --g-blur: blur(22px) saturate(175%);
  }
  ha-card {
    position: relative; isolation: isolate; border-radius: 26px;
    background: var(--g-fill), color-mix(in srgb, var(--ha-card-background, var(--card-background-color, #1c1c1c)) 70%, transparent);
    -webkit-backdrop-filter: var(--g-blur); backdrop-filter: var(--g-blur);
    border: 1px solid var(--g-edge);
    box-shadow: 0 18px 40px -12px rgba(0,0,0,.45), var(--g-shine);
  }
  ha-card::before {
    content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: -1;
    background:
      radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,.14), transparent 55%),
      radial-gradient(80% 50% at 100% 100%, rgba(var(--sun), .08), transparent 60%);
  }
  .modes, .act, .replay, .shade-bar, .live-btn, .tile, .chip:not(.modes .chip), .nav:hover, .edit-sel select, .edit-sel input {
    background: var(--g-fill-soft) !important;
    -webkit-backdrop-filter: var(--g-blur); backdrop-filter: var(--g-blur);
    border: 1px solid var(--g-edge) !important;
    box-shadow: var(--g-shine);
  }
  .modes .chip.on {
    background: linear-gradient(160deg, rgba(255,255,255,.26), rgba(255,255,255,.08)) !important;
    box-shadow: 0 4px 14px -4px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.35), inset 0 0 0 1px rgba(255,255,255,.14);
    color: var(--primary-text-color);
  }
  .act.on, .chip.primary {
    background: linear-gradient(160deg, rgba(var(--sun), .38), rgba(var(--sun), .14)) !important;
    border-color: rgba(var(--sun), .55) !important; color: #fff6e0;
  }
  .replay { border-radius: 20px; background:
      linear-gradient(160deg, rgba(var(--sun), .10), rgba(255,255,255,.035) 55%) !important; }
  .replay .play { box-shadow: 0 8px 22px -6px rgba(var(--sun), .7), inset 0 1px 0 rgba(255,255,255,.55); 
    background: radial-gradient(120% 120% at 30% 20%, #ffd27a, rgb(var(--sun)) 55%, #e08900); }
  .replay input[type=range]::-webkit-slider-thumb { background: rgba(255,255,255,.92); }
  .cap.past { background: linear-gradient(160deg, rgba(var(--sun), .32), rgba(var(--sun), .12));
              border: 1px solid rgba(var(--sun), .4); box-shadow: inset 0 1px 0 rgba(255,255,255,.25); }
  .roof .panel { border-radius: 4px; }
  .roof .panel::after {
    content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
    background: linear-gradient(140deg, rgba(255,255,255,.16) 0%, rgba(255,255,255,.04) 28%, transparent 46%,
                transparent 70%, rgba(255,255,255,.05) 100%);
  }
  .mode-note { margin: 0 auto 14px; max-width: 34em; padding: 10px 14px; border-radius: 16px; font-size: .82rem;
               line-height: 1.4; color: var(--primary-text-color); text-align: center;
               background: var(--g-fill-soft); border: 1px solid var(--g-edge); box-shadow: var(--g-shine);
               -webkit-backdrop-filter: var(--g-blur); backdrop-filter: var(--g-blur); }
  .mode-note[hidden] { display: none; }
  .legend .bar { border-radius: 999px; box-shadow: inset 0 1px 0 rgba(255,255,255,.2); }
  /* System card */
  .node svg { border: 1px solid var(--g-edge); box-shadow: var(--g-shine), 0 8px 18px -8px rgba(0,0,0,.6);
              -webkit-backdrop-filter: var(--g-blur); backdrop-filter: var(--g-blur); }
  .tile { border-radius: 16px; }
  .bars .track { box-shadow: inset 0 1px 2px rgba(0,0,0,.35); }
  @media (prefers-reduced-transparency: reduce) {
    ha-card, .modes, .act, .replay, .tile, .mode-note { -webkit-backdrop-filter: none; backdrop-filter: none; }
  }
`;

// Gradients cannot be animated, but a registered number property can.
try {
  CSS.registerProperty({ name: "--level", syntax: "<number>", inherits: true, initialValue: "0" });
} catch (err) {
  /* already registered */
}

// The frontend may swap in its own element registry after loading extra
// modules, so (re)define until the cards are known where it counts.
const sized = (size) =>
  class extends EnphasePanelLayoutCard {
    static defaultSize = size;
  };
const LAYOUT_DESCRIPTION =
  "Every solar panel on its place on the roof: live power, today, health and a replay of the day.";
const CARDS = [
  [TAG, EnphasePanelLayoutCard, "Enphase panel layout", LAYOUT_DESCRIPTION],
  ...Object.entries(SIZE_NAMES).map(([size, [en, nl]]) => [
    `${TAG}-${size}`,
    sized(size),
    `Enphase panel layout – ${en} (${nl})`,
    `${LAYOUT_DESCRIPTION} ${en} card.`,
  ]),
  ["enphase-forecast-card", EnphaseForecastCard, "Enphase solar forecast",
   "Expected vs. produced, yesterday to the day after tomorrow, calibrated on your own panels."],
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
  if (++tries > 120) {
    clearInterval(keepDefined);
    // Keep checking now and then: the frontend may swap its registry later
    // (e.g. after reconnecting), which would leave the cards undefined.
    setInterval(defineCards, 10000);
  }
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
