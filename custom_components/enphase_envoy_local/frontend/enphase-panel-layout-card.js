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

const CARD_VERSION = "1.22.1";
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
  small: ["Small", "Klein", "Klein"],
  medium: ["Medium", "Middel", "Mittel"],
  large: ["Large", "Groot", "Groß"],
  full: ["Full screen", "Volledig scherm", "Vollbild"],
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
    yesterday: "Yesterday",
    shade: "Shade",
    shade_by_hour: "Shade per hour of the day",
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
    yesterday: "Gisteren",
    shade: "Schaduw",
    shade_by_hour: "Schaduw per uur van de dag",
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
  de: {
    producing: "aktiv",
    now: "jetzt",
    today: "heute",
    power: "Jetzt",
    today_mode: "Heute",
    health: "Zustand",
    temperature: "Temperatur",
    efficiency: "Wirkungsgrad",
    replay: "Tag abspielen",
    live: "Live",
    no_entity: "Kein Modulanordnungs-Sensor von Enphase Envoy Local gefunden.",
    source_phases: "Nach Phasen gruppiert (keine Anordnung in Enlighten)",
    dc: "DC",
    phase: "Phase",
    vs_roof: "der guten Module",
    week: "7 Tage",
    problem: "braucht Aufmerksamkeit",
    no_output: "keine Erzeugung",
    loading: "Verlauf wird geladen…",
    no_history: "An diesem Tag wurde kein Sonnenschein erfasst",
    prev_day: "Vorheriger Tag",
    next_day: "Nächster Tag",
    pick_day: "Tag auswählen",
    yesterday: "Gestern",
    shade: "Verschattung",
    shade_by_hour: "Verschattung nach Tageszeit",
    whole_day: "Ganzer Tag",
    shade_loading: "Die letzten Wochen werden analysiert…",
    shade_none: "Noch nicht genug Verlauf, um Verschattung zu erkennen (einige Sonnentage nötig).",
    shade_info: "Anteil dessen, was die guten Module auf derselben Dachfläche in den letzten {days} Tagen erzeugt haben. Niedriger = mehr Verschattung oder ein schwächeres Modul.",
    shade_worst: "stärkste Verschattung",
    expected: "Erwartet",
    no_eff_live: "Noch kein Wirkungsgrad gemessen. Er wird gemessen, solange die Module erzeugen (ab 10 W DC); nach Sonnenuntergang bleibt der letzte Wert des Tages sichtbar.",
    no_eff_yet: "Zu dieser Tageszeit wurde noch kein Wirkungsgrad erfasst.",
    no_eff_day: "An diesem Tag wurde kein Wirkungsgrad erfasst. Er wird ab der Einrichtung der Integration gespeichert, frühere Tage zeigen daher nur Leistung, Energie und Zustand.",
    no_data_day: "Für diese Ansicht wurde an diesem Tag nichts erfasst.",
    no_data_yet: "Noch keine Daten für diese Ansicht.",
    data_since: "Zu diesem Zeitpunkt wurden noch keine Werte erfasst ({what}). Die Erfassung läuft seit {time}; drücke Live für die aktuellen Werte.",
    edit_short: "Anordnung",
    edit: "Module anordnen",
    save: "Speichern",
    cancel: "Abbrechen",
    auto: "Automatische Anordnung",
    rotate: "Drehen",
    roof: "Dachfläche",
    new_roof: "+ Neue Dachfläche",
    roof_name: "Name dieser Dachfläche",
    edit_hint: "Ziehe die Module an ihren Platz. Klicke auf ein Modul, um es zu drehen oder einer anderen Dachfläche zuzuordnen.",
    source_manual: "Von Hand gezeichnete Anordnung",
    save_failed: "Speichern fehlgeschlagen",
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

// Size presets of the extra cards: width in a Sections dashboard and how
// much detail is shown, so the content always fits.
const CARD_SIZES = {
  small: { columns: 6, en: "Small", nl: "Klein", de: "Klein" },
  medium: { columns: 12, en: "Medium", nl: "Middel", de: "Mittel" },
  large: { columns: 12, en: "Large", nl: "Groot", de: "Groß" },
  full: { columns: "full", en: "Full width", nl: "Volledige breedte", de: "Volle Breite" },
};
const SIZE_FIELD = {
  name: "size",
  selector: {
    select: {
      mode: "dropdown",
      options: Object.entries(CARD_SIZES).map(([value, s]) => ({ value, label: `${s.en} / ${s.nl}` })),
    },
  },
};


/* "Clean" look, the style of the Easee Smart card: a calm dark-navy card,
 * flat tiles, segmented buttons and light large numbers. Classic = glass. */
const CLEAN = `
  :host { --ink: 255,255,255; }
  :host([tone="light"]) { --ink: 20,24,30; }
  /* Clean in a light Home Assistant theme: the light palette of the Easee card */
  :host([look="clean"][tone="light"]) {
    --c-bg: #FFFFFF; --c-panel: #F2F4F7; --c-line: #E3E7EC; --c-text: #14181E; --c-muted: #6B7480;
    --c-accent: #2F7FE0; --c-sel: #FFFFFF;
  }
  :host([look="clean"][tone="light"]) ha-card { box-shadow: 0 2px 10px rgba(20,24,30,.06); }
  :host([look="clean"][tone="light"]) .modes .chip.on, :host([look="clean"][tone="light"]) .seg button.on {
    box-shadow: 0 1px 4px rgba(20,24,30,.12) !important; }
  :host([look="clean"][tone="light"]) .act.on, :host([look="clean"][tone="light"]) .chip.primary,
  :host([look="clean"][tone="light"]) .replay .play { color: #FFFFFF !important; }
  :host([tone="light"]) .tf .tn { fill: #9a6b00; }
  :host([tone="light"]) .hl1, :host([tone="light"]) .hl2 { fill: rgba(255,255,255,.55); }
  :host([tone="light"]) .gbody { fill: rgba(20,24,30,.03); }
  :host([look="clean"]) {
    --c-bg: #14181E; --c-panel: #1C2129; --c-line: #2A303A; --c-text: #EDF0F4; --c-muted: #8C95A2;
    --c-accent: #5AA9FF; --c-sel: #2C3440;
    --g-fill: var(--c-panel); --g-fill-soft: var(--c-panel); --g-edge: transparent; --g-shine: none; --g-blur: none;
    --primary-text-color: var(--c-text); --secondary-text-color: var(--c-muted);
  }
  :host([look="clean"]) ha-card {
    background: var(--c-bg) !important; color: var(--c-text);
    border: 1px solid var(--c-line); border-radius: var(--ha-card-border-radius, 16px);
    box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none;
  }
  :host([look="clean"]) ha-card::before { display: none; }
  :host([look="clean"]) .title { font-size: 1.05rem; font-weight: 600; letter-spacing: .01em; }
  :host([look="clean"]) .cap, :host([look="clean"]) .unit { color: var(--c-muted); }
  :host([look="clean"]) .big { font-weight: 300; letter-spacing: -.02em; }
  :host([look="clean"]) .pfv, :host([look="clean"]) .volt b, :host([look="clean"]) .node b,
  :host([look="clean"]) .stat b, :host([look="clean"]) .figures b { font-weight: 300; letter-spacing: -.02em; }
  :host([look="clean"]) .modes, :host([look="clean"]) .act, :host([look="clean"]) .replay,
  :host([look="clean"]) .shade-bar, :host([look="clean"]) .live-btn, :host([look="clean"]) .tile,
  :host([look="clean"]) .chip:not(.modes .chip), :host([look="clean"]) .mode-note,
  :host([look="clean"]) .edit-sel select, :host([look="clean"]) .edit-sel input {
    background: var(--c-panel) !important; border: 0 !important; box-shadow: none !important;
    -webkit-backdrop-filter: none; backdrop-filter: none;
  }
  :host([look="clean"]) .tile, :host([look="clean"]) .pill, :host([look="clean"]) .rec,
  :host([look="clean"]) .day, :host([look="clean"]) .ph, :host([look="clean"]) .hero, :host([look="clean"]) .freq {
    background: var(--c-panel) !important; border: 0 !important; box-shadow: none !important; border-radius: 12px;
  }
  :host([look="clean"]) .tile b, :host([look="clean"]) .pill b, :host([look="clean"]) .rec b { font-weight: 500; }
  :host([look="clean"]) .tile span, :host([look="clean"]) .pill span { color: var(--c-muted); font-size: .72rem; }
  :host([look="clean"]) .day.on { background: var(--c-sel) !important; box-shadow: inset 0 0 0 1px rgba(245,197,66,.45) !important; }
  :host([look="clean"]) .ph.warn { box-shadow: inset 0 0 0 1px rgba(244,183,64,.6) !important; }
  :host([look="clean"]) .ph.bad { box-shadow: inset 0 0 0 1px rgba(229,72,77,.7) !important; }
  /* Segmented buttons like the Easee modes */
  :host([look="clean"]) .modes, :host([look="clean"]) .seg {
    background: var(--c-panel) !important; border-radius: 12px; padding: 3px; gap: 3px;
  }
  :host([look="clean"]) .modes .chip, :host([look="clean"]) .seg button {
    background: none !important; border: 0 !important; box-shadow: none !important; border-radius: 9px;
    color: var(--c-muted); font-weight: 400;
  }
  :host([look="clean"]) .modes .chip.on, :host([look="clean"]) .seg button.on {
    background: var(--c-sel) !important; color: var(--c-text); box-shadow: none !important; font-weight: 500;
  }
  :host([look="clean"]) .act.on, :host([look="clean"]) .chip.primary {
    background: var(--c-accent) !important; color: #06121F !important; font-weight: 600;
  }
  :host([look="clean"]) .replay { border-radius: 12px; }
  :host([look="clean"]) .replay .play { background: var(--c-accent); box-shadow: none; color: #06121F; }
  :host([look="clean"]) .cap.past { background: rgba(245,197,66,.18); border: 0; box-shadow: none; }
  :host([look="clean"]) .roof .panel::after { display: none; }
  :host([look="clean"]) .node svg { border: 0; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  :host([look="clean"]) .bars .track { box-shadow: none; background: var(--c-line); }
  :host([look="clean"]) .legend .bar { box-shadow: none; }
  :host([look="clean"]) .cell { background: var(--c-panel); }
  :host([look="clean"]) .tablewrap { background: var(--c-panel); border: 0; box-shadow: none; border-radius: 12px; }
  :host([look="clean"]) .scale { background: var(--c-panel); border: 0; }
  :host([look="clean"]) .msg { background: var(--c-panel); border: 0; border-radius: 12px; }
`;

const STYLE_FIELD = {
  name: "style",
  selector: { select: { mode: "list", options: [
    { value: "clean", label: "Clean" },
    { value: "classic", label: "Classic (glass / glas)" },
  ] } },
};

function applyLook(el, config) {
  el.setAttribute("look", config?.style === "classic" ? "classic" : "clean");
}

function applySize(el, config) {
  el.setAttribute("size", CARD_SIZES[config?.size] ? config.size : "medium");
  applyLook(el, config);
}

function sizeGrid(config) {
  const size = CARD_SIZES[config?.size] || CARD_SIZES.medium;
  return { columns: size.columns, min_columns: 6, rows: "auto" };
}

// Fixed card height chosen in the editor (px); empty = as high as the content.
function applyHeight(el, config) {
  const h = Number(config?.height);
  el.toggleAttribute("fixed", h > 0);
  if (h > 0) el.style.setProperty("--card-h", `${h}px`);
  else el.style.removeProperty("--card-h");
}

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
    applyHeight(this, this._config);
    // A fixed height: the roof gets what is left below the header.
    if (Number(this._config.height) > 0 && !config.max_height)
      this._config.max_height = `${Math.max(120, Number(this._config.height) - 260)}px`;
    this.toggleAttribute("small", this._config.size === "small");
    applyLook(this, this._config);
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
        STYLE_FIELD,
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
        { name: "height", selector: { number: { min: 150, max: 1600, step: 10, unit_of_measurement: "px", mode: "slider" } } },
      ],
      computeLabel: (s) =>
        ({
          title: "Title / Titel",
          entity: "Panel layout sensor / Paneelindeling-sensor",
          mode: "Start view / Startweergave",
          style: "Style / Stijl", size: "Size / Grootte",
          height: "Height / Hoogte (empty = automatic / leeg = automatisch)",
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
    this._stopShadePlay?.();
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
          <div class="player-top">
            <span class="sb-title">${esc(this._t("shade_by_hour"))}</span>
            <button class="live-btn whole-day">${esc(this._t("whole_day"))}</button>
          </div>
          <div class="player-main">
            <button class="play shade-play" aria-label="play">${ICONS.play}</button>
            <div class="shade-track">
              <input type="range" class="shade-hour" min="1" max="1" value="1" step="1" aria-label="hour">
              <div class="shade-ticks"></div>
            </div>
            <span class="clock shade-label">–</span>
          </div>
          <div class="shade-days"></div>
        </div>
        <div class="replay" hidden>
          <div class="player-top">
            <div class="day-pick">
              <button class="nav day-prev" title="${esc(this._t("prev_day"))}" aria-label="${esc(this._t("prev_day"))}">${ICONS.prev}</button>
              <button class="day-label" aria-haspopup="dialog" title="${esc(this._t("pick_day"))}">${ICONS.calendar}<span class="day-text">–</span></button>
              <button class="nav day-next" title="${esc(this._t("next_day"))}" aria-label="${esc(this._t("next_day"))}">${ICONS.next}</button>
            </div>
            <button class="live-btn"><span class="dot"></span>${esc(this._t("live"))}</button>
          </div>
          <div class="cal" hidden role="dialog" aria-label="${esc(this._t("pick_day"))}"></div>
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
      <style>${STYLE}${GLASS}${CLEAN}</style>
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
        if (this._mode !== "shade") this._stopShadePlay();
        if (this._mode === "shade" && this._replay) this._stopReplay();
        if (this._mode === "shade" && !this._shade) this._loadShade();
        if (this._replay) this._showFrame(this._replay.index);
        else this._update();
      })
    );
    q(".replay-btn")?.addEventListener("click", () => {
      if (this._mode === "shade") {
        this._mode = "power";
        q(".shade-bar").hidden = true;
        this._stopShadePlay();
      }
      this._startReplay();
    });
    if (q(".shade-bar")) q(".shade-bar").hidden = this._mode !== "shade";
    if (this._mode === "shade" && !this._shade) this._loadShade();
    q(".shade-hour")?.addEventListener("input", (e) => {
      this._stopShadePlay();
      this._setShadeHour(+e.target.value);
    });
    q(".whole-day")?.addEventListener("click", () => {
      this._stopShadePlay();
      this._setShadeHour(0);
    });
    q(".shade-play")?.addEventListener("click", () => (this._shadeTimer ? this._stopShadePlay() : this._playShade()));
    const shiftDay = (n) => {
      const d = new Date(this._replayDay || Date.now());
      d.setDate(d.getDate() + n);
      if (d <= new Date()) this._startReplay(d);
    };
    q(".day-prev")?.addEventListener("click", () => shiftDay(-1));
    q(".day-next")?.addEventListener("click", () => shiftDay(1));
    q(".day-label")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const cal = q(".cal");
      if (cal.hidden) this._openCal();
      else cal.hidden = true;
    });
    q(".cal")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.target.closest("button");
      if (!btn || btn.disabled) return;
      if (btn.dataset.month) {
        const d = new Date(this._calMonth);
        d.setMonth(d.getMonth() + +btn.dataset.month);
        this._calMonth = d.getTime();
        this._renderCal();
      } else if (btn.dataset.day) {
        q(".cal").hidden = true;
        this._startReplay(new Date(+btn.dataset.day));
      }
    });
    if (!this._calBound) {
      // The shadow root outlives rebuilds: bind these once.
      this._calBound = true;
      const close = () => {
        const cal = this.shadowRoot.querySelector(".cal");
        if (cal && !cal.hidden) cal.hidden = true;
      };
      this.shadowRoot.addEventListener("click", close);
      this.shadowRoot.addEventListener("keydown", (e) => e.key === "Escape" && close());
    }
    q(".edit-btn")?.addEventListener("click", () => this._startEdit());
    q(".replay .live-btn")?.addEventListener("click", () => this._stopReplay());
    q(".replay .play")?.addEventListener("click", () => (this._timer ? this._stopPlay() : this._play()));
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
    q(".replay .clock").textContent = this._t("loading");
    const start = new Date(day || Date.now());
    start.setHours(0, 0, 0, 0);
    this._replayDay = start.getTime();
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const isToday = end > new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const now = new Date();
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
      q(".replay .clock").textContent = String(err?.message || err);
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
    if (!Number.isFinite(first) && isToday && !day) {
      // Before sunrise there is nothing to replay yet: show yesterday.
      const prev = new Date(start);
      prev.setDate(prev.getDate() - 1);
      return this._startReplay(prev);
    }
    if (!Number.isFinite(first)) {
      q(".replay .clock").textContent = this._t("no_history");
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
    this._shadeHour = 0;
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

  _setShadeHour(index) {
    this._shadeHour = index;
    this._updateShadeLabel();
    this._update();
  }

  _playShade() {
    const sh = this._shade;
    if (!sh?.ready) return;
    const btn = this.shadowRoot.querySelector(".shade-play");
    btn.innerHTML = ICONS.pause;
    btn.classList.add("playing");
    if (!this._shadeHour || this._shadeHour >= sh.hours.length) this._setShadeHour(1);
    this._shadeTimer = setInterval(() => {
      if (this._shadeHour >= sh.hours.length) {
        this._stopShadePlay();
        this._setShadeHour(0);
        return;
      }
      this._setShadeHour(this._shadeHour + 1);
    }, 900);
  }

  _stopShadePlay() {
    if (this._shadeTimer) clearInterval(this._shadeTimer);
    this._shadeTimer = null;
    const btn = this.shadowRoot?.querySelector(".shade-play");
    if (btn) {
      btn.innerHTML = ICONS.play;
      btn.classList.remove("playing");
    }
  }

  _updateShadeLabel() {
    const q = (s) => this.shadowRoot.querySelector(s);
    const sh = this._shade;
    const label = q(".shade-label"), days = q(".shade-days"), slider = q(".shade-hour"), whole = q(".whole-day");
    if (!label) return;
    const ready = sh?.ready;
    if (slider) {
      slider.disabled = !ready;
      slider.max = ready ? sh.hours.length : 1;
      slider.classList.toggle("idle", !this._shadeHour);
      if (this._shadeHour) slider.value = this._shadeHour;
    }
    whole?.classList.toggle("on", !this._shadeHour);
    if (!ready) label.textContent = "–";
    else if (!this._shadeHour) label.textContent = this._t("whole_day");
    else {
      const h = sh.hours[this._shadeHour - 1];
      label.textContent = `${String(h - 1).padStart(2, "0")}–${String(h).padStart(2, "0")}u`;
    }
    const ticks = q(".shade-ticks");
    if (ticks) {
      ticks.innerHTML = ready
        ? sh.hours
            .map((h, i) => (h % 2 ? "" : `<span style="left:${sh.hours.length > 1 ? (i / (sh.hours.length - 1)) * 100 : 50}%">${String(h - 1).padStart(2, "0")}</span>`))
            .join("")
        : "";
    }
    if (days) days.textContent = ready ? this._t("shade_info").replace("{days}", sh.days) : "";
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

  /* ----------------------------------------------------------- calendar */

  _openCal() {
    const d = new Date(this._replayDay || Date.now());
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    this._calMonth = d.getTime();
    this._renderCal();
    this.shadowRoot.querySelector(".cal").hidden = false;
  }

  _renderCal() {
    const cal = this.shadowRoot.querySelector(".cal");
    const loc = this._locale();
    const first = new Date(this._calMonth);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = this._replayDay;
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    // Monday-first grid of six weeks.
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    const monday = new Date(2024, 0, 1); // a Monday
    const names = [...Array(7)].map((_, i) =>
      new Date(monday.getTime() + i * 86400000).toLocaleDateString(loc, { weekday: "short" }).replace(".", "").slice(0, 2)
    );
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const t = d.getTime();
      const cls = [
        d.getMonth() !== first.getMonth() ? "out" : "",
        t === today.getTime() ? "today" : "",
        t === selected ? "sel" : "",
      ].join(" ");
      cells.push(`<button class="cd ${cls}" data-day="${t}" ${t > today.getTime() ? "disabled" : ""}>${d.getDate()}</button>`);
    }
    const yesterday = today.getTime() - 86400000;
    cal.innerHTML = `
      <div class="cal-head">
        <button class="nav" data-month="-1" aria-label="${esc(this._t("prev_day"))}">${ICONS.prev}</button>
        <span class="cal-title">${esc(first.toLocaleDateString(loc, { month: "long", year: "numeric" }))}</span>
        <button class="nav" data-month="1" ${first.getTime() >= thisMonth ? "disabled" : ""}>${ICONS.next}</button>
      </div>
      <div class="cal-grid">${names.map((n) => `<span class="wd">${esc(n)}</span>`).join("")}${cells.join("")}</div>
      <div class="cal-foot">
        <button class="act" data-day="${yesterday}">${esc(this._t("yesterday"))}</button>
        <button class="act" data-day="${today.getTime()}">${esc(this._t("today_mode"))}</button>
      </div>`;
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
    q(".replay .clock").textContent = new Date(t).toLocaleTimeString(this._locale(), { hour: "2-digit", minute: "2-digit" });
  }

  _play() {
    this._stopPlay();
    if (!this._replay) return;
    if (this._replay.index >= this._replay.frames.length - 1) this._replay.index = 0;
    const playBtn = this.shadowRoot.querySelector(".replay .play");
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
    const btn = this.shadowRoot?.querySelector(".replay .play");
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
  de: {
    solar: "Solar", home: "Haus", grid: "Netz", import: "aus dem Netz", export: "ins Netz",
    today: "Heute", produced: "Erzeugt", used: "Verbraucht", imported: "Bezogen", exported: "Eingespeist",
    selfuse: "Eigenverbrauch", sufficient: "Autarkie", panels: "Module aktiv",
    attention: "Brauchen Aufmerksamkeit", cloud: "Enlighten", online: "verbunden", offline: "keine Verbindung",
    token: "Token gültig bis", total: "Gesamt erzeugt", none: "alles in Ordnung",
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
    applyHeight(this, this._config);
    applySize(this, this._config);
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
      , STYLE_FIELD, SIZE_FIELD, { name: "height", selector: { number: { min: 150, max: 1600, step: 10, unit_of_measurement: "px", mode: "slider" } } }],
      computeLabel: (s) => ({ title: "Title / Titel", entity: "Panel layout sensor / Paneelindeling-sensor", style: "Style / Stijl", size: "Size / Grootte", height: "Height / Hoogte (empty = automatic / leeg = automatisch)" })[s.name],
    };
  }

  getCardSize() {
    return 5;
  }

  getGridOptions() {
    return sizeGrid(this._config);
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
      <style>${SYSTEM_STYLE}${SIZE_STYLE}${GLASS}${CLEAN}</style>
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
  .day-label { font: inherit; font-weight: 600; font-size: .92rem; color: var(--primary-text-color); border: 0; background: transparent; }
  .replay { position: relative; z-index: 5; }
  .cal { position:absolute; z-index: 20; top: 52px; left: 10px; width: 290px; max-width: calc(100% - 20px); padding: 12px;
         border-radius: 20px; display:flex; flex-direction:column; gap: 8px; animation: slide .2s ease;
         background: var(--g-fill), color-mix(in srgb, var(--card-background-color, #1c1c1c) 97%, transparent);
         -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
         border: 1px solid var(--g-edge); box-shadow: 0 24px 48px -12px rgba(0,0,0,.7), var(--g-shine); }
  .cal[hidden] { display:none; }
  .cal-head { display:flex; align-items:center; justify-content:space-between; }
  .cal-title { font-weight: 650; font-size: .95rem; text-transform: capitalize; }
  .cal-grid { display:grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
  .cal .wd { text-align:center; font-size: .68rem; color: var(--secondary-text-color); text-transform: uppercase; padding: 4px 0; }
  .cd { font: inherit; font-size: .82rem; aspect-ratio: 1; border-radius: 50%; border: 1px solid transparent; cursor:pointer;
        background: transparent; color: var(--primary-text-color); font-variant-numeric: tabular-nums; transition: background .15s; }
  .cd:hover:not(:disabled) { background: rgba(var(--ink),.1); }
  .cd.out { color: var(--secondary-text-color); opacity: .55; }
  .cd:disabled { opacity: .22; cursor: default; }
  .cd.today { border-color: rgba(var(--sun), .7); color: rgb(var(--sun)); font-weight: 700; }
  .cd.sel { background: radial-gradient(120% 120% at 30% 20%, #ffd27a, rgb(var(--sun)) 55%, #e08900); color: #1a1200;
            font-weight: 700; box-shadow: 0 4px 12px -3px rgba(var(--sun), .7); border-color: transparent; }
  .cal-foot { display:flex; justify-content:flex-end; gap: 6px; }
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
  .line-exp { fill:none; stroke: rgba(var(--ink),.7); stroke-width: 1.5; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
  .shade-bar { display:flex; flex-direction:column; gap:10px; padding: 12px 14px 10px; border-radius: 20px;
               background: linear-gradient(160deg, rgba(124,135,255,.14), rgba(255,255,255,.035) 55%) !important;
               border-color: rgba(124,135,255,.3) !important; animation: slide .25s ease; }
  .shade-bar[hidden] { display:none; }
  .sb-title { font-weight: 600; font-size: .92rem; padding-left: 4px; }
  .whole-day.on { border-color: rgba(124,135,255,.7) !important; color: #fff;
                  background: linear-gradient(160deg, rgba(124,135,255,.45), rgba(124,135,255,.15)) !important; }
  .shade-bar .play { width:42px; height:42px; border-radius:50%; border:0; cursor:pointer; flex:none; display:grid; place-items:center;
                     color:#0d1033; background: radial-gradient(120% 120% at 30% 20%, #c9ceff, rgb(124,135,255) 55%, #4b55c9);
                     box-shadow: 0 8px 22px -6px rgba(124,135,255,.7), inset 0 1px 0 rgba(255,255,255,.55); transition: transform .15s ease; }
  .shade-bar .play svg { width:20px; height:20px; fill: currentColor; }
  .shade-bar .play:not(.playing) svg { margin-left: 2px; }
  .shade-bar .play:hover { transform: scale(1.06); }
  .shade-track { position: relative; flex: 1; min-width: 120px; padding-bottom: 14px; }
  .shade-hour { width: 100%; margin: 0; accent-color: rgb(124,135,255); cursor: pointer; }
  .shade-hour.idle { opacity: .45; }
  .shade-ticks { position:absolute; left:8px; right:8px; bottom:0; height:12px; font-size:.65rem; color: var(--secondary-text-color); }
  .shade-ticks span { position:absolute; transform: translateX(-50%); font-variant-numeric: tabular-nums; }
  .shade-days { font-size:.75rem; color: var(--secondary-text-color); padding-left: 4px; }
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
  .roof.editing { background-image: radial-gradient(rgba(var(--ink),.08) 1px, transparent 1px);
                  background-size: 12px 12px; border-radius: 8px; outline: 1px dashed rgba(var(--ink),.15); }
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
  de: {
    title: "Solarprognose", yesterday: "Gestern", today: "Heute", tomorrow: "Morgen", day_after: "Übermorgen",
    expected: "Erwartet", actual: "Erzeugt", of_expected: "der Prognose", so_far: "bisher erwartet",
    no_forecast: "Noch keine Prognose. Aktiviere 'Solarprognose' in den Optionen von Enphase Envoy Local (standardmäßig aktiv) und warte eine Minute.",
    calibrated: "Kalibriert anhand von {n} sonnigen Tagen deiner eigenen Anlage", not_calibrated: "Noch nicht kalibriert: wird nach dem ersten sonnigen Tag genau",
    peak: "Spitze", now: "jetzt", source: "Wetter: Open-Meteo",
    compass: "N,NNO,NO,ONO,O,OSO,SO,SSO,S,SSW,SW,WSW,W,WNW,NW,NNW", learned: "von deinen Modulen gelernt", assumed: "angenommen", roof: "Dach",
  },
};

class EnphaseForecastCard extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    applyHeight(this, this._config);
    applySize(this, this._config);
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
      schema: [{ name: "title", selector: { text: {} } }, STYLE_FIELD, SIZE_FIELD, { name: "height", selector: { number: { min: 150, max: 1600, step: 10, unit_of_measurement: "px", mode: "slider" } } }],
      computeLabel: (s) => ({ title: "Title / Titel", style: "Style / Stijl", size: "Size / Grootte", height: "Height / Hoogte (empty = automatic / leeg = automatisch)" })[s.name],
    };
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return sizeGrid(this._config);
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
      <style>${FORECAST_STYLE}${SIZE_STYLE}${GLASS}${CLEAN}</style>
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
                <stop offset="0" style="stop-color:rgb(var(--ink))" stop-opacity=".22"/>
                <stop offset="1" style="stop-color:rgb(var(--ink))" stop-opacity="0"/>
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
      // One source: the sensor with the longest history (ours may be younger).
      const merged = {};
      const bestId = ids.reduce((b, id) => ((stats[id] || []).length > (stats[b] || []).length ? id : b), ids[0]);
      for (const r of stats[bestId] || []) {
        if (r.mean == null) continue;
        merged[toMs(r.start) + 3600000] = r.mean; // keyed by hour end, like the forecast
      }
      this._actual = merged;
      this._actualIds = [bestId, ...ids.filter((id) => id !== bestId)];
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
    // Real production only (the CTs show a few watts of noise at night).
    const sunny = expDay.filter(([, v]) => v > 20).map(([t]) => t).concat(actDay.filter(([, v]) => v > 20).map(([t]) => t));
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
  .exp-line { fill: none; stroke: rgba(var(--ink),.75); stroke-width: 2; stroke-dasharray: 6 5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .act-area { fill: url(#fact); }
  .act-line { fill: none; stroke: rgb(var(--sun)); stroke-width: 2.5; vector-effect: non-scaling-stroke; stroke-linejoin: round;
              filter: drop-shadow(0 0 6px rgba(var(--sun), .6)); }
  .now { stroke: var(--error-color, #e53935); stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-dasharray: 3 3; }
  .hover { stroke: rgba(var(--ink),.5); stroke-width: 1; vector-effect: non-scaling-stroke; }
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
  .lg-exp { border-top: 2px dashed rgba(var(--ink),.75); }
  .lg-act { border-top: 3px solid rgb(var(--sun)); }
  .orient { display:flex; flex-wrap:wrap; gap: 6px 14px; margin-top: 10px; font-size: .72rem; color: var(--secondary-text-color); }
  .orient b { color: var(--primary-text-color); font-weight: 600; }
  .orient i { font-style: normal; opacity: .7; }
  .msg { padding: 14px; border-radius: 16px; font-size: .85rem; background: var(--g-fill-soft); border: 1px solid var(--g-edge); }
  .msg[hidden] { display:none; }
  @media (max-width: 460px) { .days { grid-template-columns: repeat(2, 1fr); } }
`;

/* ===================================================================
 * Shared helpers for the extra cards.
 * =================================================================== */

const XT = {
  en: {
    grid: "Grid & phases", frequency: "Frequency", imbalance: "Imbalance", current: "Current", pf: "Power factor",
    production: "Production", importing: "from grid", exporting: "to grid", highest: "Highest today",
    lowest: "Lowest today", above: "Above 250 V", reactive: "Reactive", apparent: "Apparent", at: "at",
    no_grid: "No grid meter found (consumption CTs needed).", minutes: "min",
    inverters: "Microinverters", panel: "Panel", roof: "Roof", phase: "Phase", ac: "AC", dc: "DC",
    eff: "Eff.", temp: "Temp", today: "Today", health: "Health", report: "Report", ago: "ago",
    dc_total: "DC in", ac_total: "AC out", losses: "Losses", fleet: "Efficiency", tavg: "Temp avg", tmax: "Temp max",
    oldest: "Oldest report", now: "now", total: "Lifetime",
    energy: "Production", month: "Month", year: "Year", records: "Records", best_day: "Best day",
    best_month: "Best month", this_year: "This year", last_year: "Last year", avg_day: "Average per day",
    peak_today: "Peak today", lifetime: "Lifetime", since: "since", days_with_sun: "days", no_stats: "No statistics yet.",
    vs_last_year: "vs. last year", kwh: "kWh",
  },
  nl: {
    grid: "Net & fasen", frequency: "Frequentie", imbalance: "Onbalans", current: "Stroom", pf: "Arbeidsfactor",
    production: "Productie", importing: "van het net", exporting: "naar het net", highest: "Hoogste vandaag",
    lowest: "Laagste vandaag", above: "Boven 250 V", reactive: "Blind", apparent: "Schijnbaar", at: "om",
    no_grid: "Geen netmeter gevonden (verbruiks-CT's nodig).", minutes: "min",
    inverters: "Micro-omvormers", panel: "Paneel", roof: "Dak", phase: "Fase", ac: "AC", dc: "DC",
    eff: "Rend.", temp: "Temp", today: "Vandaag", health: "Gezond", report: "Melding", ago: "geleden",
    dc_total: "DC in", ac_total: "AC uit", losses: "Verlies", fleet: "Rendement", tavg: "Temp gem.", tmax: "Temp max",
    oldest: "Oudste melding", now: "nu", total: "Totaal",
    energy: "Opbrengst", month: "Maand", year: "Jaar", records: "Records", best_day: "Beste dag",
    best_month: "Beste maand", this_year: "Dit jaar", last_year: "Vorig jaar", avg_day: "Gemiddeld per dag",
    peak_today: "Piek vandaag", lifetime: "Totaal ooit", since: "sinds", days_with_sun: "dagen", no_stats: "Nog geen statistieken.",
    vs_last_year: "t.o.v. vorig jaar", kwh: "kWh",
  },
  de: {
    grid: "Netz & Phasen", frequency: "Frequenz", imbalance: "Schieflast", current: "Strom", pf: "Leistungsfaktor",
    production: "Erzeugung", importing: "aus dem Netz", exporting: "ins Netz", highest: "Höchstwert heute",
    lowest: "Tiefstwert heute", above: "Über 250 V", reactive: "Blind", apparent: "Schein", at: "um",
    no_grid: "Kein Netzzähler gefunden (Verbrauchs-Stromwandler erforderlich).", minutes: "Min.",
    inverters: "Mikrowechselrichter", panel: "Modul", roof: "Dach", phase: "Phase", ac: "AC", dc: "DC",
    eff: "Wirkgr.", temp: "Temp.", today: "Heute", health: "Zustand", report: "Meldung", ago: "her",
    dc_total: "DC ein", ac_total: "AC aus", losses: "Verluste", fleet: "Wirkungsgrad", tavg: "Temp. Ø", tmax: "Temp. max.",
    oldest: "Älteste Meldung", now: "jetzt", total: "Gesamt",
    energy: "Erzeugung", month: "Monat", year: "Jahr", records: "Rekorde", best_day: "Bester Tag",
    best_month: "Bester Monat", this_year: "Dieses Jahr", last_year: "Letztes Jahr", avg_day: "Durchschnitt pro Tag",
    peak_today: "Spitze heute", lifetime: "Gesamt seit Beginn", since: "seit", days_with_sun: "Tage", no_stats: "Noch keine Statistiken.",
    vs_last_year: "ggü. Vorjahr", kwh: "kWh",
  },
};

class EnphaseBaseCard extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    applyHeight(this, this._config);
    applySize(this, this._config);
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
  }

  static getStubConfig() {
    return {};
  }

  static getConfigForm() {
    return {
      schema: [{ name: "title", selector: { text: {} } }, STYLE_FIELD, SIZE_FIELD, { name: "height", selector: { number: { min: 150, max: 1600, step: 10, unit_of_measurement: "px", mode: "slider" } } }],
      computeLabel: (s) => ({ title: "Title / Titel", style: "Style / Stijl", size: "Size / Grootte", height: "Height / Hoogte (empty = automatic / leeg = automatisch)" })[s.name],
    };
  }

  getGridOptions() {
    return sizeGrid(this._config);
  }

  _t(key) {
    const lang = (this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2);
    return (XT[lang] || XT.en)[key] || XT.en[key] || key;
  }

  _locale() {
    return this._hass?.locale?.language || this._hass?.language || undefined;
  }

  _layout() {
    const id = this._config.entity || findLayoutEntity(this._hass);
    return id ? this._hass.states[id] : undefined;
  }

  _g(key) {
    const id = this._layout()?.attributes.gateway?.[key];
    return id ? num(this._hass, id) : null;
  }

  _gState(key) {
    const id = this._layout()?.attributes.gateway?.[key];
    return id ? this._hass.states[id] : undefined;
  }

  _more(entityId) {
    if (entityId) this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  _time(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleTimeString(this._locale(), { hour: "2-digit", minute: "2-digit" }) : "–";
  }
}

const fmt = (v, digits = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }));

function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/* ===================================================================
 * Grid & phases card: voltage gauges per phase, current, power factor,
 * frequency, today's extremes.
 *
 *   type: custom:enphase-grid-card
 * =================================================================== */

const V_MIN = 200, V_MAX = 260;
const V_BANDS = [
  [200, 207, "#e53935"], [207, 220, "#ffa726"], [220, 245, "#66bb6a"],
  [245, 250, "#ffa726"], [250, 253, "#ff7043"], [253, 260, "#e53935"],
];

class EnphaseGridCard extends EnphaseBaseCard {
  getCardSize() {
    return 5;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
  }

  _build() {
    const ang = (v) => Math.PI + ((Math.max(V_MIN, Math.min(V_MAX, v)) - V_MIN) / (V_MAX - V_MIN)) * Math.PI;
    const bands = V_BANDS.map(([a, b, c]) => `<path d="${arcPath(60, 60, 48, ang(a) + 0.01, ang(b) - 0.01)}" stroke="${c}"/>`).join("");
    const phase = (p) => `
      <div class="ph" data-p="${p}">
        <div class="ph-head"><span class="pchip" style="background:${PHASE_COLORS[p]}">${p}</span><span class="flow"></span></div>
        <svg class="gauge" viewBox="0 0 120 70">
          <g class="bands">${bands}</g>
          <line class="needle" x1="60" y1="60" x2="60" y2="18"/>
          <circle cx="60" cy="60" r="4" class="hub"/>
        </svg>
        <div class="volt"><b>–</b><span>V</span></div>
        <div class="rows">
          <span>${esc(this._t("current"))}</span><b class="cur">–</b>
          <span>${esc(this._t("pf"))}</span><b class="pf">–</b>
          <span>${esc(this._t("production"))}</span><b class="prod">–</b>
        </div>
      </div>`;
    this.shadowRoot.innerHTML = `
      <style>${SIZE_STYLE}${XSTYLE}${GRID_STYLE}${GLASS}${CLEAN}</style>
      <ha-card>
        <div class="top">
          <div class="title">${esc(this._config.title || this._t("grid"))}</div>
          <button class="freq"><span class="cap">${esc(this._t("frequency"))}</span><b>–</b><span class="unit">Hz</span><span class="range"></span></button>
        </div>
        <div class="phases">${["L1", "L2", "L3"].map(phase).join("")}</div>
        <div class="msg" hidden>${esc(this._t("no_grid"))}</div>
        <div class="foot">
          <button class="pill vmax"><span>${esc(this._t("highest"))}</span><b>–</b></button>
          <button class="pill vmin"><span>${esc(this._t("lowest"))}</span><b>–</b></button>
          <button class="pill above"><span>${esc(this._t("above"))}</span><b>–</b></button>
          <button class="pill imb"><span>${esc(this._t("imbalance"))}</span><b>–</b></button>
          <button class="pill gpf"><span>${esc(this._t("pf"))}</span><b>–</b></button>
        </div>
      </ha-card>`;
    const gw = () => this._layout()?.attributes.gateway || {};
    const q = (s) => this.shadowRoot.querySelector(s);
    q(".freq").addEventListener("click", () => this._more(gw().frequency));
    q(".vmax").addEventListener("click", () => this._more(gw().grid_voltage_max_today));
    q(".vmin").addEventListener("click", () => this._more(gw().grid_voltage_min_today));
    q(".above").addEventListener("click", () => this._more(gw().minutes_above_250v_today));
    q(".imb").addEventListener("click", () => this._more(gw().phase_imbalance));
    q(".gpf").addEventListener("click", () => this._more(gw().power_factor));
    this.shadowRoot.querySelectorAll(".ph").forEach((el) =>
      el.addEventListener("click", () => {
        const p = el.dataset.p.toLowerCase();
        this._more(gw()[`grid_phase_voltage_${p}`] || gw()[`production_phase_voltage_${p}`]);
      })
    );
    this._built = true;
  }

  _update() {
    if (!this._built || !this._layout()) return;
    const q = (s) => this.shadowRoot.querySelector(s);
    let any = false;
    for (const p of ["L1", "L2", "L3"]) {
      const k = p.toLowerCase();
      const el = this.shadowRoot.querySelector(`.ph[data-p="${p}"]`);
      const v = this._g(`grid_phase_voltage_${k}`) ?? this._g(`production_phase_voltage_${k}`);
      const net = this._g(`net_phase_power_${k}`);
      el.hidden = v == null && net == null;
      if (v != null) any = true;
      el.querySelector(".volt b").textContent = fmt(v, 1);
      const deg = v == null ? -90 : -90 + ((Math.max(V_MIN, Math.min(V_MAX, v)) - V_MIN) / (V_MAX - V_MIN)) * 180;
      el.querySelector(".needle").style.transform = `rotate(${deg}deg)`;
      el.classList.toggle("warn", v != null && v > 250);
      el.classList.toggle("bad", v != null && (v >= 253 || v < 207));
      el.querySelector(".cur").textContent = `${fmt(this._g(`grid_phase_current_${k}`), 2)} A`;
      const pf = this._g(`grid_phase_power_factor_${k}`);
      el.querySelector(".pf").textContent = fmt(pf, 2);
      el.querySelector(".prod").textContent = `${fmt(this._g(`production_phase_power_${k}`))} W`;
      const flow = el.querySelector(".flow");
      flow.textContent = net == null ? "" : `${net > 0 ? "↓" : "↑"} ${fmt(Math.abs(net))} W`;
      flow.className = `flow ${net == null ? "" : net > 0 ? "in" : "out"}`;
      flow.title = net == null ? "" : this._t(net > 0 ? "importing" : "exporting");
    }
    q(".msg").hidden = any;
    q(".freq b").textContent = fmt(this._g("frequency"), 2);
    const fmin = this._g("frequency_min_today"), fmax = this._g("frequency_max_today");
    q(".freq .range").textContent = fmin != null && fmax != null ? `${fmt(fmin, 2)}–${fmt(fmax, 2)}` : "";
    const vmaxAt = this._gState("grid_voltage_max_time")?.state;
    q(".vmax b").textContent = `${fmt(this._g("grid_voltage_max_today"), 1)} V${vmaxAt && vmaxAt !== "unknown" ? ` · ${this._time(vmaxAt)}` : ""}`;
    q(".vmax").classList.toggle("warn", (this._g("grid_voltage_max_today") || 0) > 250);
    q(".vmin b").textContent = `${fmt(this._g("grid_voltage_min_today"), 1)} V`;
    const above = this._g("minutes_above_250v_today");
    q(".above b").textContent = `${fmt(above)} ${this._t("minutes")}`;
    q(".above").classList.toggle("warn", (above || 0) > 0);
    q(".imb b").textContent = `${fmt(this._g("phase_imbalance"), 1)} A`;
    q(".gpf b").textContent = fmt(this._g("power_factor"), 2);
  }
}

const GRID_STYLE = `
  .top { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom: 12px; flex-wrap: wrap; }
  .freq { display:flex; align-items:baseline; gap:6px; padding: 6px 12px; border-radius: 999px; }
  .freq b { font-size: 1.2rem; font-variant-numeric: tabular-nums; }
  .freq .range { font-size: .72rem; color: var(--secondary-text-color); }
  .phases { display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  .ph { padding: 12px; border-radius: 18px; cursor: pointer; display:flex; flex-direction:column; gap: 4px;
        background: var(--g-fill-soft); border: 1px solid var(--g-edge); box-shadow: var(--g-shine);
        transition: transform .15s ease, border-color .2s; }
  .ph:hover { transform: translateY(-2px); }
  .ph[hidden] { display:none; }
  .ph.warn { border-color: rgba(255,167,38,.6); }
  .ph.bad { border-color: rgba(229,57,53,.75); box-shadow: 0 0 0 1px rgba(229,57,53,.4), var(--g-shine); }
  .ph-head { display:flex; justify-content:space-between; align-items:center; }
  .pchip { font-size: .7rem; font-weight: 700; color: #fff; padding: 2px 8px; border-radius: 999px; }
  .flow { font-size: .78rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .flow.in { color: rgb(171,71,188); }
  .flow.out { color: rgb(102,187,106); }
  .gauge { width: 100%; max-width: 170px; margin: 2px auto -6px; display:block; overflow: visible; }
  .bands path { fill: none; stroke-width: 9; stroke-linecap: round; opacity: .85; }
  .needle { stroke: var(--primary-text-color); stroke-width: 2.5; stroke-linecap: round; transform-origin: 60px 60px;
            transition: transform 1.2s cubic-bezier(.2,.9,.25,1.15); }
  .hub { fill: var(--primary-text-color); }
  .volt { text-align:center; }
  .volt b { font-size: 1.5rem; font-weight: 650; font-variant-numeric: tabular-nums; }
  .volt span { color: var(--secondary-text-color); margin-left: 3px; }
  .rows { display:grid; grid-template-columns: 1fr auto; gap: 3px 8px; font-size: .78rem; margin-top: 4px; }
  .rows span { color: var(--secondary-text-color); }
  .rows b { font-variant-numeric: tabular-nums; text-align:right; font-weight: 600; }
  .foot { display:flex; flex-wrap:wrap; gap: 6px; margin-top: 12px; }
`;

/* ===================================================================
 * Microinverter table: every value of every microinverter, sortable.
 *
 *   type: custom:enphase-inverters-card
 * =================================================================== */

const INV_COLS = [
  ["panel", (r) => r.label + r.serial],
  ["phase", (r) => r.phase || ""],
  ["ac", (r) => r.ac],
  ["dc", (r) => r.dc],
  ["dcv", (r) => r.dcv],
  ["eff", (r) => r.eff],
  ["temp", (r) => r.temp],
  ["today", (r) => r.today],
  ["health", (r) => r.health],
  ["report", (r) => r.age],
];

class EnphaseInvertersCard extends EnphaseBaseCard {
  getCardSize() {
    return 9;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    const now = Date.now();
    if (!this._lastPaint || now - this._lastPaint > 3000) this._update();
  }

  _build() {
    this._sort = this._sort || ["ac", -1];
    const label = { panel: "panel", phase: "phase", ac: "ac", dc: "dc", dcv: "dc", eff: "eff", temp: "temp", today: "today", health: "health", report: "report" };
    const units = { ac: "W", dc: "W", dcv: "V · A", eff: "%", temp: "°C", today: "kWh", health: "%", report: "" };
    this.shadowRoot.innerHTML = `
      <style>${SIZE_STYLE}${XSTYLE}${INV_STYLE}${GLASS}${CLEAN}</style>
      <ha-card>
        <div class="top"><div class="title">${esc(this._config.title || this._t("inverters"))}</div><span class="count"></span></div>
        <div class="sum">
          ${["dc_total", "ac_total", "losses", "fleet", "tavg", "tmax", "oldest"]
            .map((k) => `<button class="tile" data-k="${k}"><span>${esc(this._t(k))}</span><b>–</b></button>`)
            .join("")}
        </div>
        <div class="tablewrap">
          <table>
            <thead><tr>${INV_COLS.map(([k]) => `<th data-k="${k}"><span>${esc(this._t(label[k]))}${k === "dcv" ? " V·A" : ""}</span>${units[k] && k !== "dcv" ? `<small>${units[k]}</small>` : ""}<i class="arrow"></i></th>`).join("")}</tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </ha-card>`;
    this.shadowRoot.querySelectorAll("th").forEach((th) =>
      th.addEventListener("click", () => {
        const k = th.dataset.k;
        this._sort = [k, this._sort[0] === k ? -this._sort[1] : k === "panel" || k === "phase" ? 1 : -1];
        this._update();
      })
    );
    const map = { dc_total: "inverters_dc_power", ac_total: "production_power", losses: "conversion_losses", fleet: "fleet_efficiency", tavg: "inverter_temperature_avg", tmax: "inverter_temperature_max", oldest: "oldest_inverter_report" };
    this.shadowRoot.querySelectorAll(".sum .tile").forEach((b) =>
      b.addEventListener("click", () => this._more(this._layout()?.attributes.gateway?.[map[b.dataset.k]]))
    );
    this._built = true;
  }

  _rows() {
    const hass = this._hass;
    const arrays = this._layout()?.attributes.arrays || [];
    const rows = [];
    for (const a of arrays)
      for (const m of a.modules) {
        if (!m.serial) continue;
        const rep = m.last_report ? hass.states[m.last_report]?.state : null;
        const t = rep ? Date.parse(rep) : NaN;
        rows.push({
          m, serial: m.serial, label: a.label || "", phase: m.phase,
          ac: num(hass, m.power), dc: num(hass, m.dc_power), dcv: num(hass, m.dc_voltage), dca: num(hass, m.dc_current),
          eff: num(hass, m.efficiency), temp: num(hass, m.temperature), today: num(hass, m.today),
          health: num(hass, m.performance_week) ?? num(hass, m.performance),
          problem: isOn(hass, m.underperforming) || isOn(hass, m.no_output),
          age: Number.isFinite(t) ? (Date.now() - t) / 60000 : null,
        });
      }
    return rows;
  }

  _update() {
    if (!this._built || !this._layout()) return;
    this._lastPaint = Date.now();
    const q = (s) => this.shadowRoot.querySelector(s);
    const rows = this._rows();
    const [key, dir] = this._sort;
    const getter = INV_COLS.find(([k]) => k === key)[1];
    rows.sort((a, b) => {
      const x = getter(a), y = getter(b);
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y, undefined, { numeric: true }) : x - y) * dir;
    });
    const maxAc = Math.max(1, ...rows.map((r) => r.ac || 0));
    const maxToday = Math.max(0.001, ...rows.map((r) => r.today || 0));
    const ago = (m) => (m == null ? "–" : m < 1 ? this._t("now") : `${Math.round(m)} ${this._t("minutes")}`);
    q("tbody").innerHTML = rows
      .map((r) => `
        <tr class="${r.problem ? "problem" : ""} ${(r.ac || 0) > 0 ? "" : "idle"}" data-e="${esc(r.m.power || "")}">
          <td class="panel"><b>…${esc(r.serial.slice(-4))}</b><small>${esc(r.label)}</small></td>
          <td>${r.phase ? `<span class="pchip" style="background:${PHASE_COLORS[r.phase] || "#616161"}">${esc(r.phase)}</span>` : "–"}</td>
          <td class="bar"><i style="width:${((r.ac || 0) / maxAc) * 100}%"></i><b>${fmt(r.ac)}</b></td>
          <td>${fmt(r.dc)}</td>
          <td class="dim">${fmt(r.dcv, 1)} · ${fmt(r.dca, 2)}</td>
          <td class="${r.eff != null && r.eff < 93 ? "low" : ""}">${fmt(r.eff, 1)}</td>
          <td class="${r.temp != null && r.temp > 60 ? "hot" : ""}">${fmt(r.temp)}</td>
          <td class="bar today"><i style="width:${((r.today || 0) / maxToday) * 100}%"></i><b>${fmt(r.today == null ? null : r.today / 1000, 2)}</b></td>
          <td class="${r.health != null ? (r.health >= 95 ? "ok" : r.health >= 88 ? "mid" : "low") : ""}">${fmt(r.health)}</td>
          <td class="dim ${r.age != null && r.age > 30 ? "late" : ""}">${ago(r.age)}</td>
        </tr>`)
      .join("");
    this.shadowRoot.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => this._more(tr.dataset.e)));
    this.shadowRoot.querySelectorAll("th").forEach((th) => {
      th.classList.toggle("on", th.dataset.k === key);
      th.querySelector(".arrow").textContent = th.dataset.k === key ? (dir > 0 ? "▲" : "▼") : "";
    });
    q(".count").textContent = `${rows.filter((r) => (r.ac || 0) > 0).length} / ${rows.length}`;
    const vals = {
      dc_total: `${fmt(this._g("inverters_dc_power"))} W`,
      ac_total: `${fmt(this._g("production_power"))} W`,
      losses: `${fmt(this._g("conversion_losses"))} W`,
      fleet: `${fmt(this._g("fleet_efficiency"), 1)} %`,
      tavg: `${fmt(this._g("inverter_temperature_avg"), 1)} °C`,
      tmax: `${fmt(this._g("inverter_temperature_max"))} °C`,
      oldest: ago(this._g("oldest_inverter_report")),
    };
    this.shadowRoot.querySelectorAll(".sum .tile").forEach((b) => (b.querySelector("b").textContent = vals[b.dataset.k]));
  }
}

const INV_STYLE = `
  .top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom: 12px; }
  .count { font-size: .8rem; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .sum { display:grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; margin-bottom: 12px; }
  .sum .tile { font: inherit; color: inherit; text-align:left; cursor:pointer; display:flex; flex-direction:column; gap:2px;
               padding: 8px 10px; border-radius: 14px; }
  .sum .tile span { font-size: .7rem; color: var(--secondary-text-color); }
  .sum .tile b { font-size: .95rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tablewrap { overflow-x: auto; border-radius: 16px; border: 1px solid var(--g-edge); background: rgba(0,0,0,.12); }
  table { width: 100%; border-collapse: collapse; font-size: .8rem; font-variant-numeric: tabular-nums; }
  th { position: sticky; top: 0; text-align: right; font-weight: 600; font-size: .7rem; color: var(--secondary-text-color);
       padding: 8px 8px; cursor: pointer; white-space: nowrap; user-select: none;
       background: color-mix(in srgb, var(--card-background-color, #1c1c1c) 92%, transparent); border-bottom: 1px solid var(--g-edge); }
  th small { display:block; font-weight: 400; opacity: .7; }
  th.on { color: rgb(var(--sun)); }
  th .arrow { font-style: normal; margin-left: 3px; font-size: .6rem; }
  th:first-child, td:first-child { text-align: left; }
  td { padding: 6px 8px; text-align: right; border-bottom: 1px solid rgba(var(--ink),.05); white-space: nowrap; }
  tbody tr { cursor: pointer; transition: background .15s; }
  tbody tr:hover { background: rgba(var(--ink),.05); }
  tbody tr.problem td:first-child { box-shadow: inset 3px 0 0 var(--error-color, #e53935); }
  td.panel b { display:block; font-size: .82rem; }
  td.panel small { color: var(--secondary-text-color); font-size: .68rem; }
  td.bar { position: relative; min-width: 64px; }
  td.bar i { position:absolute; right: 6px; top: 50%; transform: translateY(-50%); height: 60%; border-radius: 6px;
             background: linear-gradient(90deg, rgba(var(--sun), .05), rgba(var(--sun), .35)); max-width: calc(100% - 12px); }
  td.bar.today i { background: linear-gradient(90deg, rgba(255,193,7,.05), rgba(255,193,7,.3)); }
  td.bar b { position: relative; font-weight: 600; }
  td.dim { color: var(--secondary-text-color); }
  tr.idle td { opacity: .55; }
  tr.idle td.low { color: inherit; font-weight: inherit; }
  td.low { color: var(--error-color, #e53935); font-weight: 600; }
  td.mid { color: #ffa726; }
  td.ok { color: #66bb6a; }
  td.hot { color: #ff7043; font-weight: 600; }
  td.late { color: #ffa726; }
  .pchip { font-size: .65rem; font-weight: 700; color: #fff; padding: 1px 7px; border-radius: 999px; }
`;

/* ===================================================================
 * Energy history card: month calendar, year bars and records, from the
 * long-term statistics of the lifetime production counter.
 *
 *   type: custom:enphase-energy-card
 * =================================================================== */

class EnphaseEnergyCard extends EnphaseBaseCard {
  getCardSize() {
    return 7;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    if (!this._loaded && !this._loading) this._load();
  }

  _build() {
    this._tab = this._tab || "month";
    const now = new Date();
    this._month = this._month || new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    this.shadowRoot.innerHTML = `
      <style>${SIZE_STYLE}${XSTYLE}${ENERGY_STYLE}${GLASS}${CLEAN}</style>
      <ha-card>
        <div class="top">
          <div class="title">${esc(this._config.title || this._t("energy"))}</div>
          <div class="seg">${["month", "year", "records"].map((t) => `<button data-t="${t}">${esc(this._t(t))}</button>`).join("")}</div>
        </div>
        <div class="body"><div class="msg">…</div></div>
      </ha-card>`;
    this.shadowRoot.querySelectorAll(".seg button").forEach((b) =>
      b.addEventListener("click", () => {
        this._tab = b.dataset.t;
        this._paint();
      })
    );
    this.shadowRoot.querySelector(".body").addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (!nav) return;
      const d = new Date(this._month);
      d.setMonth(d.getMonth() + +nav.dataset.nav);
      if (d.getTime() <= Date.now()) {
        this._month = d.getTime();
        this._paint();
      }
    });
    this._built = true;
  }

  async _load() {
    this._loading = true;
    const hass = this._hass;
    const layout = this._layout();
    const serial = layout?.attributes.serial;
    const own = layout?.attributes.gateway?.production_lifetime;
    const ids = [own].filter(Boolean);
    for (const [id, st] of Object.entries(hass.states)) {
      if (id === own || !id.startsWith("sensor.") || !serial || !id.includes(serial)) continue;
      const u = st.attributes.unit_of_measurement;
      if ((u === "Wh" || u === "kWh" || u === "MWh") && st.attributes.state_class === "total_increasing" &&
          /lifetime|totaal|total/i.test(id) && /produc/i.test(id) && !/net|consum|verbruik|_l\d$/i.test(id))
        ids.push(id);
    }
    if (!ids.length) {
      this._loading = false;
      this._loaded = true;
      this._days = {};
      return this._paint();
    }
    try {
      const meta = await hass.callWS({ type: "recorder/get_statistics_metadata", statistic_ids: ids });
      const unit = Object.fromEntries(meta.map((m) => [m.statistic_id, m.statistics_unit_of_measurement]));
      const start = new Date();
      start.setFullYear(start.getFullYear() - 2, 0, 1);
      start.setHours(0, 0, 0, 0);
      const stats = await hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        statistic_ids: ids,
        period: "day",
        types: ["change"],
      });
      const best = ids.reduce((b, id) => ((stats[id] || []).length > (stats[b] || []).length ? id : b), ids[0]);
      const k = { Wh: 0.001, kWh: 1, MWh: 1000 }[unit[best]] ?? 1;
      const toMs = (v) => (typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v));
      const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      // Lifetime counters sometimes jump (a gateway glitch, a replaced meter,
      // the core integration re-adding the counter): such a day can read
      // thousands of kWh, or a negative value. Those days are rebuilt from the
      // hourly statistics, leaving out the faulty hours.
      const kwp = ((layout.attributes.arrays || []).flatMap((a) => a.modules || []).reduce((t, m) => t + (m.max || 0), 0) / 1000) || null;
      const lat = ((hass.config?.latitude ?? 52) * Math.PI) / 180;
      const dayHours = (d) => {
        const n = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
        const decl = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + n)) / 365);
        return (2 * Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(decl)))) * 180) / Math.PI / 15;
      };
      const raw = (stats[best] || []).filter((r) => r.change != null).map((r) => [new Date(toMs(r.start)), r.change * k]);
      const ok = raw.map(([, v]) => v).filter((v) => v > 0).sort((x, y) => x - y);
      const p95 = ok.length ? ok[Math.floor(ok.length * 0.95)] : 50;
      const peak = kwp || p95 / 6;
      const dayCap = (d) => Math.max(peak * dayHours(d) * 0.85, 2);
      const hourCap = peak * 1.25;
      const days = {};
      const suspect = [];
      raw.forEach(([d, v], i) => {
        const near = raw.slice(Math.max(0, i - 5), i + 6).filter((_, j) => j !== Math.min(i, 5)).map(([, x]) => x).filter((x) => x >= 0 && x <= dayCap(d));
        const neighbour = near.length >= 3 ? Math.max(...near) : null;
        if (v < 0 || v > dayCap(d) || (neighbour != null && v > 5 && v > neighbour * 2.2)) suspect.push(d);
        else days[key(d)] = v;
      });
      await Promise.all(suspect.slice(-60).map(async (d) => {
        try {
          const end = new Date(d.getTime() + 86400000);
          const rows = (await hass.callWS({
            type: "recorder/statistics_during_period", start_time: d.toISOString(), end_time: end.toISOString(),
            statistic_ids: [best], period: "hour", types: ["change"],
          }))[best] || [];
          const vals = rows.map((r) => (r.change == null ? null : r.change * k));
          const good = (v) => v != null && v >= 0 && v <= hourCap;
          let total = 0;
          vals.forEach((v, i) => {
            if (good(v)) total += v;
            else {
              // A faulty hour gets the mean of the hours around it.
              const around = [vals[i - 1], vals[i + 1]].filter(good);
              total += around.length ? around.reduce((t, x) => t + x, 0) / around.length : 0;
            }
          });
          if (rows.length >= 20 && total <= dayCap(d)) days[key(d)] = total;
        } catch (e) {
          /* leave the day out */
        }
      }));
      // Our own production meter counts best: it wins on every full day it has.
      if (own && own !== best && stats[own]) {
        const ku = { Wh: 0.001, kWh: 1, MWh: 1000 }[unit[own]] ?? 1;
        stats[own].slice(1).forEach((r) => {
          const d = new Date(toMs(r.start));
          const v = r.change * ku;
          if (r.change != null && v >= 0 && v <= dayCap(d)) days[key(d)] = v;
        });
      }
      this._days = days;
      this._repaired = suspect.length;
      this._source = best;
    } catch (err) {
      this._days = {};
    }
    this._loading = false;
    this._loaded = true;
    this._paint();
    // Refresh every 30 minutes for today's value.
    clearTimeout(this._reload);
    this._reload = setTimeout(() => (this._loaded = false), 30 * 60000);
  }

  _day(d) {
    return this._days?.[`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`];
  }

  _paint() {
    if (!this._built) return;
    this.shadowRoot.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.t === this._tab));
    const body = this.shadowRoot.querySelector(".body");
    if (!this._days) return;
    if (!Object.keys(this._days).length) {
      body.innerHTML = `<div class="msg">${esc(this._t("no_stats"))}</div>`;
      return;
    }
    body.innerHTML = this._tab === "month" ? this._monthHtml() : this._tab === "year" ? this._yearHtml() : this._recordsHtml();
  }

  _monthHtml() {
    const loc = this._locale();
    const first = new Date(this._month);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const vals = [];
    for (let i = 1; i <= daysIn; i++) vals.push(this._day(new Date(first.getFullYear(), first.getMonth(), i)));
    const max = Math.max(0.1, ...vals.filter((v) => v != null));
    const total = vals.reduce((a, v) => a + (v || 0), 0);
    const counted = vals.filter((v) => v != null).length;
    // Compare the same days of last year (only up to today in the running month).
    let lastYear = 0, sameDays = 0;
    vals.forEach((v, i) => {
      if (v == null) return;
      sameDays += v;
      lastYear += this._day(new Date(first.getFullYear() - 1, first.getMonth(), i + 1)) || 0;
    });
    const lead = (first.getDay() + 6) % 7;
    const monday = new Date(2024, 0, 1);
    const names = [...Array(7)].map((_, i) => new Date(monday.getTime() + i * 86400000).toLocaleDateString(loc, { weekday: "short" }).replace(".", "").slice(0, 2));
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(`<span class="cell empty"></span>`);
    vals.forEach((v, i) => {
      const d = new Date(first.getFullYear(), first.getMonth(), i + 1);
      const future = d > today;
      const level = v == null ? 0 : Math.max(0.08, v / max);
      const has = v != null && !future;
      cells.push(`<span class="cell ${future ? "future" : ""} ${has ? "has" : ""} ${d.getTime() === today.getTime() ? "today" : ""}" style="--l:${(has ? level : 0).toFixed(3)}" title="${esc(d.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" }))}: ${fmt(v, 1)} kWh">
        <span class="fill"></span><i>${i + 1}</i><b>${has ? fmt(v, v < 10 ? 1 : 0) : ""}</b></span>`);
    });
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    const diff = lastYear > 0 ? Math.round((sameDays / lastYear - 1) * 100) : null;
    return `
      <div class="mhead">
        <button class="nav" data-nav="-1">${ICONS.prev}</button>
        <span class="mtitle">${esc(first.toLocaleDateString(loc, { month: "long", year: "numeric" }))}</span>
        <button class="nav" data-nav="1" ${first.getTime() >= thisMonth ? "disabled" : ""}>${ICONS.next}</button>
      </div>
      <div class="figs">
        <div><b class="big">${fmt(total, total < 100 ? 1 : 0)}</b><span class="unit">kWh</span></div>
        <div><span class="cap">${esc(this._t("avg_day"))}</span><b>${fmt(counted ? total / counted : null, 1)} kWh</b></div>
        ${diff != null ? `<div><span class="cap">${esc(this._t("vs_last_year"))}</span><b class="${diff >= 0 ? "up" : "down"}">${diff >= 0 ? "+" : ""}${diff} %</b></div>` : ""}
      </div>
      <div class="cal">${names.map((n) => `<span class="wd">${esc(n)}</span>`).join("")}${cells.join("")}</div>`;
  }

  _months(year) {
    const out = [];
    for (let m = 0; m < 12; m++) {
      let s = 0, n = 0;
      const days = new Date(year, m + 1, 0).getDate();
      for (let i = 1; i <= days; i++) {
        const v = this._day(new Date(year, m, i));
        if (v != null) {
          s += v;
          n++;
        }
      }
      out.push(n ? s : null);
    }
    return out;
  }

  _yearHtml() {
    const loc = this._locale();
    const y = new Date().getFullYear();
    const cur = this._months(y), prev = this._months(y - 1);
    const max = Math.max(1, ...cur.filter(Boolean), ...prev.filter(Boolean));
    const bars = cur
      .map((v, m) => {
        const name = new Date(y, m, 1).toLocaleDateString(loc, { month: "short" }).replace(".", "");
        return `<div class="mb" title="${esc(name)}: ${fmt(v)} kWh (${y - 1}: ${fmt(prev[m])} kWh)">
          <div class="bars"><i class="prev" style="height:${((prev[m] || 0) / max) * 100}%"></i><i class="cur" style="height:${((v || 0) / max) * 100}%"></i></div>
          <b>${v == null ? "" : fmt(v)}</b><span>${esc(name)}</span></div>`;
      })
      .join("");
    const tot = cur.reduce((a, v) => a + (v || 0), 0), totPrev = prev.reduce((a, v) => a + (v || 0), 0);
    return `
      <div class="figs">
        <div><span class="cap">${y}</span><b class="big">${fmt(tot)}</b><span class="unit">kWh</span></div>
        <div><span class="cap">${y - 1}</span><b>${fmt(totPrev)} kWh</b></div>
      </div>
      <div class="ybars">${bars}</div>
      <div class="legend"><span><i class="lg cur"></i>${y}</span><span><i class="lg prev"></i>${y - 1}</span></div>`;
  }

  _recordsHtml() {
    const loc = this._locale();
    const entries = Object.entries(this._days).map(([k, v]) => {
      const [y, m, d] = k.split("-").map(Number);
      return [new Date(y, m, d), v];
    });
    const best = entries.reduce((b, e) => (!b || e[1] > b[1] ? e : b), null);
    const months = {};
    for (const [d, v] of entries) {
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      months[k] = (months[k] || 0) + v;
    }
    const bestMonth = Object.entries(months).reduce((b, e) => (!b || e[1] > b[1] ? e : b), null);
    const y = new Date().getFullYear();
    const yearTotal = entries.filter(([d]) => d.getFullYear() === y).reduce((a, [, v]) => a + v, 0);
    const lifetime = this._g("production_lifetime");
    // The gateway's lifetime counter can have been reset (new meter, firmware):
    // the recorded days then add up to more, so the larger one is shown.
    const unitK = { MWh: 1000, kWh: 1, Wh: 0.001 }[this._gState("production_lifetime")?.attributes.unit_of_measurement] ?? 0.001;
    const meter = lifetime == null ? 0 : lifetime * unitK;
    const summed = entries.reduce((a, [, v]) => a + v, 0);
    const fromDays = summed > meter * 1.02;
    const total = Math.max(meter, summed);
    const first = entries.length ? entries.reduce((a, e) => (e[0] < a ? e[0] : a), entries[0][0]) : null;
    const peak = this._g("peak_power_today");
    const peakTime = this._gState("peak_power_time")?.state;
    const sunny = entries.filter(([d, v]) => d.getFullYear() === y && v > 1).length;
    const [bmY, bmM] = bestMonth ? bestMonth[0].split("-").map(Number) : [0, 0];
    const rec = (icon, label, value, sub) => `<div class="rec"><span class="ico">${icon}</span><div><span class="cap">${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div></div>`;
    return `<div class="recs">
      ${rec("☀️", this._t("best_day"), best ? `${fmt(best[1], 1)} kWh` : "–", best ? esc(best[0].toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" })) : "")}
      ${rec("📅", this._t("best_month"), bestMonth ? `${fmt(bestMonth[1])} kWh` : "–", bestMonth ? esc(new Date(bmY, bmM, 1).toLocaleDateString(loc, { month: "long", year: "numeric" })) : "")}
      ${rec("📈", this._t("this_year"), `${fmt(yearTotal)} kWh`, `${sunny} ${esc(this._t("days_with_sun"))}`)}
      ${rec("⚡", this._t("peak_today"), peak == null ? "–" : `${fmt(peak)} W`, peakTime ? `${esc(this._t("at"))} ${this._time(peakTime)}` : "")}
      ${rec("🏆", this._t("lifetime"), total ? `${fmt(total / 1000, 2)} MWh` : "–", fromDays && first ? `${esc(this._t("since"))} ${esc(first.toLocaleDateString(loc, { month: "long", year: "numeric" }))}` : "")}
    </div>`;
  }
}

const ENERGY_STYLE = `
  .top { display:flex; justify-content:space-between; align-items:center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .seg { display:inline-flex; gap:2px; padding:3px; border-radius:999px; background: rgba(127,127,127,.12); }
  .seg button { font: inherit; font-size: .8rem; border:0; background: transparent; color: var(--secondary-text-color);
                padding: 6px 13px; border-radius: 999px; cursor:pointer; }
  .seg button.on { color: var(--primary-text-color); font-weight: 600;
                   background: linear-gradient(160deg, rgba(255,255,255,.26), rgba(255,255,255,.08));
                   box-shadow: 0 4px 14px -4px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.35); }
  .mhead { display:flex; align-items:center; justify-content:space-between; margin-bottom: 6px; }
  .mtitle { font-weight: 650; text-transform: capitalize; }
  .nav { width:32px; height:32px; border-radius:50%; border:0; background:transparent; cursor:pointer; color: var(--primary-text-color); display:grid; place-items:center; }
  .nav svg { width:20px; height:20px; fill: currentColor; }
  .nav:disabled { opacity: .25; cursor: default; }
  .figs { display:flex; gap: 22px; flex-wrap: wrap; align-items: baseline; margin: 4px 0 12px; }
  .figs > div { display:flex; align-items: baseline; gap: 5px; }
  .figs .cap { margin: 0; }
  .figs b.up { color: #66bb6a; }
  .figs b.down { color: #ef5350; }
  .cal { display:grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; container-type: inline-size; }
  .cal .wd { text-align:center; font-size:.68rem; text-transform: uppercase; color: var(--secondary-text-color); }
  .cell { position: relative; aspect-ratio: 1.3; border-radius: 12px; min-width: 0; overflow: hidden;
          display:flex; align-items:center; justify-content:center;
          background: rgba(var(--ink),.035); border: 1px solid rgba(var(--ink),.07); box-shadow: inset 0 1px 0 rgba(var(--ink),.06); }
  .cell.empty { background: none; border: 0; box-shadow: none; }
  .cell.future { opacity: .3; }
  .cell.today { border-color: rgba(var(--sun), .9); box-shadow: 0 0 0 1px rgba(var(--sun), .5), inset 0 1px 0 rgba(255,255,255,.1); }
  /* Production fills the cell from the bottom, like a bar. */
  .cell .fill { position:absolute; left:0; right:0; bottom:0; height: calc(var(--l) * 100%);
                background: linear-gradient(180deg, rgba(255,200,60,.85), rgba(224,137,0,.9));
                box-shadow: 0 -1px 0 rgba(255,236,170,.7) inset; transition: height .8s ease; }
  .cell i { position:absolute; top: 4px; left: 6px; font-style: normal; font-size: .62rem; font-weight: 600;
            color: var(--secondary-text-color); line-height: 1; z-index: 1; }
  .cell.has i { color: rgba(255,255,255,.72); text-shadow: 0 1px 2px rgba(0,0,0,.6); }
  .cell b { position: relative; z-index: 1; margin-top: 8px; font-size: clamp(.7rem, 2.6cqw, .95rem); font-weight: 700;
            font-variant-numeric: tabular-nums; color: #fff; padding: 1px 6px; border-radius: 8px;
            background: rgba(0,0,0,.45); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
  .cell b:empty { display:none; }
  .ybars { display:grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 6px; align-items: end; height: 190px; }
  .mb { display:flex; flex-direction:column; align-items:center; gap: 3px; height: 100%; justify-content: flex-end; }
  .mb .bars { position: relative; width: 100%; flex: 1; display:flex; align-items:flex-end; justify-content:center; gap: 2px; }
  .mb .bars i { display:block; width: 42%; border-radius: 6px 6px 3px 3px; transition: height .8s ease; }
  .mb i.cur { background: linear-gradient(180deg, #ffd27a, rgb(var(--sun)) 60%, #e08900); box-shadow: 0 0 10px rgba(var(--sun), .35); }
  .mb i.prev { background: rgba(var(--ink),.18); }
  .mb b { font-size: .62rem; font-variant-numeric: tabular-nums; min-height: 1em; }
  .mb span { font-size: .65rem; color: var(--secondary-text-color); text-transform: capitalize; }
  .legend { display:flex; gap: 14px; margin-top: 8px; font-size: .75rem; color: var(--secondary-text-color); }
  .lg { display:inline-block; width: 12px; height: 8px; border-radius: 3px; margin-right: 5px; }
  .lg.cur { background: rgb(var(--sun)); }
  .lg.prev { background: rgba(var(--ink),.25); }
  .recs { display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .rec { display:flex; gap: 10px; align-items:center; padding: 12px; border-radius: 16px;
         background: var(--g-fill-soft); border: 1px solid var(--g-edge); box-shadow: var(--g-shine); }
  .rec .ico { font-size: 1.4rem; width: 40px; height: 40px; display:grid; place-items:center; border-radius: 50%;
              background: rgba(var(--sun), .14); flex: none; }
  .rec > div { display:flex; flex-direction:column; min-width: 0; }
  .rec b { font-size: 1.1rem; font-variant-numeric: tabular-nums; }
  .rec small { font-size: .72rem; color: var(--secondary-text-color); }
  @media (max-width: 460px) { .mb b { display:none; } }
`;

const SIZE_STYLE = `
  :host([size="small"]) ha-card { padding: 12px; }
  :host([size="small"]) .title { font-size: 1rem; }
  :host([size="small"]) .big { font-size: 1.3rem; }
  :host([size="small"]) .phases { grid-template-columns: 1fr; }
  :host([size="small"]) .ph { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
  :host([size="small"]) .gauge { max-width: 90px; margin: 0; }
  :host([size="small"]) .rows { flex: 1 1 120px; }
  :host([size="small"]) .foot .gpf, :host([size="small"]) .freq .range { display:none; }
  :host([size="small"]) th:nth-child(4), :host([size="small"]) td:nth-child(4),
  :host([size="small"]) th:nth-child(5), :host([size="small"]) td:nth-child(5),
  :host([size="small"]) th:nth-child(10), :host([size="small"]) td:nth-child(10) { display:none; }
  :host([size="small"]) .sum { grid-template-columns: repeat(3, 1fr); }
  :host([size="small"]) .sum .tile:nth-child(n+4) { display:none; }
  :host([size="small"]) .mb b { display:none; }
  :host([size="small"]) .cell b { font-size: .62rem; padding: 0 3px; }
  :host([size="small"]) .days { grid-template-columns: repeat(2, 1fr); }
  :host([size="small"]) .orient, :host([size="small"]) .legend .calib { display:none; }
  :host([size="large"]) .phases, :host([size="full"]) .phases { gap: 14px; }
  :host([size="full"]) .recs { grid-template-columns: repeat(5, 1fr); }
`;

const XSTYLE = `
  :host { --sun: 255,176,32; }
  ha-card { padding: 16px; overflow: hidden; }
  .title { font-size: 1.15rem; font-weight: 500; }
  .cap { color: var(--secondary-text-color); font-size: .78rem; }
  .big { font-size: 1.6rem; font-weight: 650; font-variant-numeric: tabular-nums; }
  .unit { color: var(--secondary-text-color); font-size: .9rem; }
  button { font: inherit; color: inherit; }
  .pill { display:flex; flex-direction:column; align-items:flex-start; gap:1px; cursor:pointer; padding: 7px 12px; border-radius: 14px;
          background: var(--g-fill-soft); border: 1px solid var(--g-edge); box-shadow: var(--g-shine); }
  .pill span { font-size: .68rem; color: var(--secondary-text-color); }
  .pill b { font-size: .9rem; font-variant-numeric: tabular-nums; }
  .pill.warn { border-color: rgba(255,167,38,.7); }
  .pill.warn b { color: #ffa726; }
  .freq { cursor: pointer; background: var(--g-fill-soft); border: 1px solid var(--g-edge); box-shadow: var(--g-shine); }
  .msg { padding: 14px; border-radius: 16px; font-size: .85rem; color: var(--secondary-text-color);
         background: var(--g-fill-soft); border: 1px solid var(--g-edge); }
  .msg[hidden] { display:none; }
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
  :host { display: block; height: 100%; }
  :host([fixed]) { height: auto; }
  ha-card { display: block; height: 100%; box-sizing: border-box; }
  :host([fixed]) ha-card { height: var(--card-h); overflow-y: auto; scrollbar-width: thin; }
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
/* ===================================================================
 * Power factor card: the power triangle on the unit circle.
 * P (active) on the x-axis, Q (reactive) on the y-axis, S is the vector.
 * cos φ = P / S is the projection on the x-axis, sin φ = Q / S on the y-axis.
 * A trail shows where the vector has been over the last hours.
 *
 *   type: custom:enphase-power-factor-card
 *   source: grid | L1 | L2 | L3 | production   (default grid)
 *   scale: unit | power                         (default unit)
 *   hours: 2                                    (trail length, 0 = off)
 * =================================================================== */

const PF_T = {
  en: {
    title: "Power factor", grid: "Grid", production: "Solar", unit: "Unit circle", power: "To scale",
    active: "Active", reactive: "Reactive", apparent: "Apparent", angle: "Phase angle",
    inductive: "inductive (lagging)", capacitive: "capacitive (leading)", resistive: "resistive",
    importing: "import", exporting: "export", nopower: "Too little power to determine cos φ",
    noq: "Reactive power of this phase is disabled: direction taken from the grid total",
    trail: "last", hours: "h", good: "good", fair: "moderate", poor: "low",
    source: "Source / Bron", scale: "Scale / Schaal", hoursl: "Trail (hours, 0 = off) / Spoor (uren, 0 = uit)",
  },
  nl: {
    title: "Arbeidsfactor", grid: "Net", production: "Zon", unit: "Eenheidscirkel", power: "Op schaal",
    active: "Werkelijk", reactive: "Blind", apparent: "Schijnbaar", angle: "Fasehoek",
    inductive: "inductief (naijlend)", capacitive: "capacitief (voorijlend)", resistive: "ohms",
    importing: "afname", exporting: "teruglevering", nopower: "Te weinig vermogen om cos φ te bepalen",
    noq: "Blindvermogen van deze fase staat uit: richting afgeleid van het nettotaal",
    trail: "laatste", hours: "u", good: "goed", fair: "matig", poor: "laag",
  },
  de: {
    title: "Leistungsfaktor", grid: "Netz", production: "Solar", unit: "Einheitskreis", power: "Maßstabsgetreu",
    active: "Wirk", reactive: "Blind", apparent: "Schein", angle: "Phasenwinkel",
    inductive: "induktiv (nacheilend)", capacitive: "kapazitiv (voreilend)", resistive: "ohmsch",
    importing: "Bezug", exporting: "Einspeisung", nopower: "Zu wenig Leistung, um cos φ zu bestimmen",
    noq: "Blindleistung dieser Phase ist deaktiviert: Richtung aus der Netzsumme abgeleitet",
    trail: "letzte", hours: "h", good: "gut", fair: "mäßig", poor: "niedrig",
    source: "Quelle", scale: "Maßstab", hoursl: "Spur (Stunden, 0 = aus)",
  },
};

const PF_SOURCES = ["grid", "L1", "L2", "L3", "production"];
const PF_C = 150, PF_R = 104;

class EnphasePowerFactorCard extends EnphaseBaseCard {
  static getStubConfig() {
    return { source: "grid" };
  }

  static getConfigForm() {
    const base = EnphaseBaseCard.getConfigForm();
    return {
      schema: [
        ...base.schema,
        { name: "source", selector: { select: { mode: "dropdown", options: [
          { value: "grid", label: "Grid / Net" }, { value: "L1", label: "L1" }, { value: "L2", label: "L2" },
          { value: "L3", label: "L3" }, { value: "production", label: "Solar / Zon" }] } } },
        { name: "scale", selector: { select: { mode: "dropdown", options: [
          { value: "unit", label: "Unit circle / Eenheidscirkel" }, { value: "power", label: "To scale / Op schaal" }] } } },
        { name: "hours", selector: { number: { min: 0, max: 24, step: 1, mode: "box" } } },
      ],
      computeLabel: (s) => ({ source: PF_T.en.source, scale: PF_T.en.scale, hours: PF_T.en.hoursl })[s.name] || base.computeLabel(s),
    };
  }

  getCardSize() {
    return 6;
  }

  setConfig(config) {
    super.setConfig(config);
    this._src = PF_SOURCES.includes(this._config.source) ? this._config.source : "grid";
    this._scale = this._config.scale === "power" ? "power" : "unit";
    this._trail = [];
    this._cur = null;
    this._histKey = null;
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
  }

  _p(key) {
    return (PF_T[(this._locale() || "en").slice(0, 2)] || PF_T.en)[key] || PF_T.en[key] || key;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
  }

  /* Entity ids for the chosen source. */
  _ids(src = this._src) {
    const gw = this._layout()?.attributes.gateway || {};
    if (src === "grid") return { p: gw.net_power, q: gw.grid_reactive_power, s: gw.grid_apparent_power, pf: gw.power_factor };
    if (src === "production")
      return { p: gw.production_power, q: gw.production_reactive_power, s: gw.production_apparent_power, pf: gw.production_power_factor };
    const k = src.toLowerCase();
    return { p: gw[`net_phase_power_${k}`], q: gw[`grid_phase_reactive_power_${k}`], s: gw[`grid_phase_apparent_power_${k}`],
             pf: gw[`grid_phase_power_factor_${k}`], qsign: gw.grid_reactive_power };
  }

  /* P, Q, S from whatever is available: S and Q measured, or derived from the power factor. */
  _solve(P, Q, S, PF, qsign) {
    if (P == null) return null;
    if (S == null && PF != null && PF > 0.005) S = Math.abs(P) / PF;
    if (S == null && Q != null) S = Math.hypot(P, Q);
    if (S == null) return null;
    S = Math.max(S, Math.abs(P));
    let derived = false;
    if (Q == null) {
      Q = Math.sqrt(Math.max(0, S * S - P * P)) * (qsign != null && qsign < 0 ? -1 : 1);
      derived = true;
    }
    return { P, Q, S, derived };
  }

  _build() {
    const c = PF_C, r = PF_R;
    const tick = (a, l) => {
      const x = c + Math.cos(a) * (r + 20), y = c - Math.sin(a) * (r + 20);
      return `<text class="ax" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${l}</text>`;
    };
    this.shadowRoot.innerHTML = `
      <style>${SIZE_STYLE}${XSTYLE}${PF_STYLE}${GLASS}${CLEAN}</style>
      <ha-card>
        <div class="top">
          <div class="title">${esc(this._config.title || this._p("title"))}</div>
          <div class="seg src">${PF_SOURCES.map((s) => `<button data-s="${s}">${esc(s.startsWith("L") ? s : this._p(s))}</button>`).join("")}</div>
        </div>
        <div class="body">
          <div class="dial">
            <svg viewBox="0 0 300 300" class="circ">
              <defs>
                <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" class="ahp"/></marker>
                <radialGradient id="glow"><stop offset="0" stop-color="rgb(var(--pf-col))" stop-opacity=".55"/><stop offset="1" stop-color="rgb(var(--pf-col))" stop-opacity="0"/></radialGradient>
              </defs>
              <path class="quad q1" d="M${c},${c} L${c + r},${c} A${r},${r} 0 0 0 ${c},${c - r} z"/>
              <path class="quad q4" d="M${c},${c} L${c},${c + r} A${r},${r} 0 0 0 ${c + r},${c} z"/>
              <circle cx="${c}" cy="${c}" r="${r}" class="ring"/>
              <circle cx="${c}" cy="${c}" r="${r / 2}" class="ring thin"/>
              <line x1="${c - r - 14}" y1="${c}" x2="${c + r + 16}" y2="${c}" class="axis" marker-end="url(#ah)"/>
              <line x1="${c}" y1="${c + r + 14}" x2="${c}" y2="${c - r - 16}" class="axis" marker-end="url(#ah)"/>
              <text class="axl" x="${c + r + 12}" y="${c - 8}" text-anchor="end">P</text>
              <text class="axl" x="${c + 8}" y="${c - r - 6}">Q</text>
              ${tick(0, "0°")}${tick(Math.PI / 2, "90°")}${tick(Math.PI, "180°")}${tick(-Math.PI / 2, "270°")}
              <text class="qcap" x="${c + r - 4}" y="${c - r + 10}" text-anchor="end">${esc(this._p("importing"))} · ind.</text>
              <text class="qcap" x="${c + r - 4}" y="${c + r - 4}" text-anchor="end">${esc(this._p("importing"))} · cap.</text>
              <text class="qcap" x="${c - r + 4}" y="${c - r + 10}">${esc(this._p("exporting"))}</text>
              <text class="qcap" x="${c - r + 4}" y="${c + r - 4}">${esc(this._p("exporting"))}</text>
              <g class="trail"></g>
              <line class="proj px"/><line class="proj py"/>
              <line class="cosl"/><line class="sinl"/>
              <path class="arc"/>
              <text class="arct">φ</text>
              <line class="vec" x1="${c}" y1="${c}"/>
              <circle class="halo" r="22" fill="url(#glow)"/>
              <circle class="dot" r="7"/>
              <text class="lab cosx" text-anchor="middle">cos φ</text>
              <text class="lab siny" text-anchor="end">sin φ</text>
              <text class="lab st">S</text>
            </svg>
            <button class="scale"></button>
          </div>
          ${this._sideHtml()}
        </div>
      </ha-card>`;
    this._wire();
    this._built = true;
  }

  _sideHtml() {
    return `
          <div class="side">
            <button class="hero"><span class="cap">cos φ</span><b class="pfv">–</b><span class="kind"></span><span class="bar"><i></i></span></button>
            <div class="tiles">
              <button class="pill tp"><span>${esc(this._p("active"))} · P</span><b>–</b></button>
              <button class="pill tq"><span>${esc(this._p("reactive"))} · Q</span><b>–</b></button>
              <button class="pill ts"><span>${esc(this._p("apparent"))} · S</span><b>–</b></button>
              <div class="pill ta"><span>${esc(this._p("angle"))} · φ</span><b>–</b></div>
            </div>
            <div class="note" hidden></div>
          </div>`;
  }

  _wire() {
    const q = (s) => this.shadowRoot.querySelector(s);
    this.shadowRoot.querySelectorAll(".src button").forEach((b) =>
      b.addEventListener("click", () => {
        this._src = b.dataset.s;
        this._trail = [];
        this._histKey = null;
        this._update();
      })
    );
    q(".scale").addEventListener("click", () => {
      this._scale = this._scale === "unit" ? "power" : "unit";
      this._update();
    });
    q(".tp").addEventListener("click", () => this._more(this._ids().p));
    q(".tq").addEventListener("click", () => this._more(this._ids().q || this._ids().qsign));
    q(".ts").addEventListener("click", () => this._more(this._ids().s));
    q(".hero").addEventListener("click", () => this._more(this._ids().pf));
  }

  async _loadHistory() {
    const hours = this._config.hours ?? 2;
    const ids = this._ids();
    const key = `${this._src}|${hours}|${Math.floor(Date.now() / 300000)}`;
    if (!hours || this._histKey === key || !ids.p) return;
    this._histKey = key;
    const want = [ids.p, ids.q, ids.s, ids.pf, ids.qsign].filter((id) => id && this._hass.states[id]);
    try {
      const stats = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(Date.now() - hours * 3600e3).toISOString(),
        statistic_ids: want,
        period: "5minute",
        types: ["mean"],
      });
      const toMs = (v) => (typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v));
      const at = {};
      for (const [id, rows] of Object.entries(stats)) for (const row of rows) {
        if (row.mean == null) continue;
        (at[toMs(row.start)] ||= {})[id] = row.mean;
      }
      const pts = Object.keys(at).map(Number).sort((a, b) => a - b).map((t) => {
        const v = at[t];
        const s = this._solve(v[ids.p], ids.q ? v[ids.q] : null, ids.s ? v[ids.s] : null, ids.pf ? v[ids.pf] : null, v[ids.qsign] ?? v[ids.q]);
        return s && s.S >= 5 ? { t, ...s } : null;
      }).filter(Boolean);
      if (this._src === key.split("|")[0]) {
        this._hist = pts;
        this._draw(false);
      }
    } catch (e) {
      /* no statistics (yet) */
    }
  }

  _update() {
    if (!this._built || !this._layout()) return;
    const q = (s) => this.shadowRoot.querySelector(s);
    this.shadowRoot.querySelectorAll(".src button").forEach((b) => {
      b.classList.toggle("on", b.dataset.s === this._src);
      const ids = this._ids(b.dataset.s);
      b.hidden = !ids.p || !this._hass.states[ids.p];
    });
    q(".scale").textContent = `◎ ${this._p(this._scale)}`;
    const ids = this._ids();
    const v = (id) => (id ? num(this._hass, id) : null);
    const sol = this._solve(v(ids.p), v(ids.q), v(ids.s), v(ids.pf), v(ids.qsign));
    this._now = sol && sol.S >= 5 ? sol : null;
    if (this._now) {
      const last = this._trail[this._trail.length - 1];
      if (!last || Date.now() - last.t > 15000) this._trail.push({ t: Date.now(), ...this._now });
      if (this._trail.length > 240) this._trail.shift();
    }
    if (this._histKey?.split("|")[0] !== this._src) this._hist = [];
    this._loadHistory();

    const P = this._now?.P, Q = this._now?.Q, S = this._now?.S;
    const pf = this._now ? Math.abs(P) / S : null;
    q(".pfv").textContent = pf == null ? "–" : pf.toFixed(2).replace(".", (0.5).toLocaleString(this._locale()).charAt(1));
    const grade = pf == null ? "" : pf >= 0.95 ? "good" : pf >= 0.8 ? "fair" : "poor";
    this.style.setProperty("--pf-col", { good: "102,187,106", fair: "255,167,38", poor: "239,83,80" }[grade] || "120,144,156");
    q(".hero").dataset.g = grade;
    q(".hero .bar i").style.width = `${((pf ?? 0) * 100).toFixed(1)}%`;
    q(".kind").textContent = this._now
      ? `${this._p(grade)} · ${Math.abs(Q) < S * 0.05 ? this._p("resistive") : this._p(Q > 0 ? "inductive" : "capacitive")}`
      : this._p("nopower");
    q(".tp b").textContent = this._now ? `${fmt(P)} W` : "–";
    q(".tq b").textContent = this._now ? `${fmt(Q)} var` : "–";
    q(".ts b").textContent = this._now ? `${fmt(S)} VA` : "–";
    q(".ta b").textContent = this._now ? `${fmt(Math.acos(Math.min(1, pf)) * 180 / Math.PI, 1)}°` : "–";
    const note = q(".note");
    note.hidden = !(this._now?.derived);
    note.textContent = this._p("noq");
    this._draw(true);
  }

  /* Radius of a point: always 1 on the unit circle, or S relative to the largest S. */
  _rad(pt, max) {
    return this._scale === "unit" ? 1 : Math.min(1, pt.S / max);
  }

  _draw(animate) {
    const pts = [...(this._hist || []), ...this._trail];
    const max = Math.max(1, ...pts.map((p) => p.S), this._now?.S || 0) * 1.08;
    const c = PF_C, r = PF_R;
    const xy = (pt) => {
      const a = Math.atan2(pt.Q, pt.P), k = this._rad(pt, max) * r;
      return [c + Math.cos(a) * k, c - Math.sin(a) * k];
    };
    const tg = this.shadowRoot.querySelector(".trail");
    if (pts.length > 1) {
      const xs = pts.map(xy);
      const n = xs.length;
      tg.innerHTML =
        `<polyline points="${xs.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>` +
        xs.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.4 + 1.8 * i / n).toFixed(2)}" style="opacity:${(0.12 + 0.6 * i / n).toFixed(2)}"/>`).join("");
    } else tg.innerHTML = "";

    const target = this._now ? { a: Math.atan2(this._now.Q, this._now.P), k: this._rad(this._now, max) } : { a: 0, k: 0 };
    const from = this._cur || target;
    // Turn the shortest way round.
    let da = target.a - from.a;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    cancelAnimationFrame(this._raf);
    const t0 = performance.now(), dur = animate && this._cur ? 900 : 0;
    const step = (now) => {
      const f = dur ? Math.min(1, (now - t0) / dur) : 1;
      const e = 1 - Math.pow(1 - f, 3);
      this._cur = { a: from.a + da * e, k: from.k + (target.k - from.k) * e };
      this._geom(this._cur);
      if (f < 1) this._raf = requestAnimationFrame(step);
    };
    if (dur) this._raf = requestAnimationFrame(step);
    else step(t0);
  }

  _geom({ a, k }) {
    const c = PF_C, r = PF_R, sr = this.shadowRoot;
    const set = (sel, attrs) => {
      const el = sr.querySelector(sel);
      for (const [n, v] of Object.entries(attrs)) el.setAttribute(n, typeof v === "number" ? v.toFixed(2) : v);
    };
    const L = k * r, x = c + Math.cos(a) * L, y = c - Math.sin(a) * L;
    const on = this._now ? "1" : "0";
    set(".vec", { x2: x, y2: y, opacity: on });
    set(".dot", { cx: x, cy: y, opacity: on });
    set(".halo", { cx: x, cy: y, opacity: on });
    set(".proj.px", { x1: x, y1: y, x2: x, y2: c, opacity: on });
    set(".proj.py", { x1: x, y1: y, x2: c, y2: y, opacity: on });
    set(".cosl", { x1: c, y1: c, x2: x, y2: c, opacity: on });
    set(".sinl", { x1: c, y1: c, x2: c, y2: y, opacity: on });
    const down = y > c, left = x < c;
    set(".cosx", { x: (c + x) / 2, y: c + (down ? -9 : 17), opacity: on && Math.abs(x - c) > 22 ? "1" : "0" });
    set(".siny", { x: c + (left ? 30 : -7), y: (c + y) / 2 + 4, opacity: on && Math.abs(y - c) > 14 ? "1" : "0" });
    sr.querySelector(".siny").setAttribute("text-anchor", left ? "start" : "end");
    set(".st", { x: x + Math.cos(a) * 14 - 4, y: y - Math.sin(a) * 14 + 4, opacity: on });
    // Angle arc from the nearest P half-axis to the vector: that angle is φ in cos φ.
    const base = Math.cos(a) >= 0 ? 0 : Math.PI;
    let d = a - base;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    const ar = 30, p0 = [c + Math.cos(base) * ar, c - Math.sin(base) * ar], p1 = [c + Math.cos(a) * ar, c - Math.sin(a) * ar];
    const sweep = (d > 0) !== (base === Math.PI) ? 0 : 1;
    const sw = base === 0 ? (d > 0 ? 0 : 1) : (d > 0 ? 0 : 1);
    set(".arc", { d: `M${p0[0].toFixed(2)},${p0[1].toFixed(2)} A${ar},${ar} 0 0 ${sw} ${p1[0].toFixed(2)},${p1[1].toFixed(2)}`, opacity: on && Math.abs(d) > 0.03 && L > 34 ? "1" : "0" });
    const mid = base + d / 2;
    set(".arct", { x: c + Math.cos(mid) * (ar + 11) - 4, y: c - Math.sin(mid) * (ar + 11) + 4, opacity: on && Math.abs(d) > 0.12 && L > 34 ? "1" : "0" });
    void sweep;
  }
}

const PF_STYLE = `
  :host { --pf-col: 120,144,156; }
  .top { display:flex; justify-content:space-between; align-items:center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .seg { display:inline-flex; flex-wrap: wrap; gap:2px; padding:3px; border-radius:999px; background: rgba(127,127,127,.12); }
  .seg button { font: inherit; font-size: .78rem; border:0; background: transparent; color: var(--secondary-text-color);
                padding: 5px 11px; border-radius: 999px; cursor:pointer; }
  .seg button[hidden] { display:none; }
  .seg button.on { color: var(--primary-text-color); font-weight: 600;
                   background: linear-gradient(160deg, rgba(255,255,255,.26), rgba(255,255,255,.08));
                   box-shadow: 0 4px 14px -4px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.35); }
  .body { display:grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 14px; align-items: center; container-type: inline-size; }
  @container (max-width: 1px) {}
  .dial { position: relative; }
  .circ { width: 100%; max-height: 420px; display:block; overflow: visible; }
  .ring { fill: none; stroke: rgba(var(--ink),.28); stroke-width: 1.2; }
  .ring.thin { stroke: rgba(var(--ink),.08); stroke-dasharray: 2 4; }
  .quad { fill: rgba(var(--ink),.025); }
  .axis { stroke: rgba(var(--ink),.45); stroke-width: 1.2; }
  .ahp { fill: rgba(var(--ink),.55); }
  .ax { font-size: 10px; fill: rgba(120,160,255,.85); }
  .axl { font-size: 13px; font-weight: 700; fill: var(--primary-text-color); font-style: italic; }
  .qcap { font-size: 8.5px; fill: var(--secondary-text-color); opacity: .75; letter-spacing: .02em; }
  .trail polyline { fill: none; stroke: rgba(var(--pf-col), .35); stroke-width: 1.2; stroke-linejoin: round; }
  .trail circle { fill: rgb(var(--pf-col)); }
  .proj { stroke: rgba(var(--ink),.55); stroke-width: 1; stroke-dasharray: 4 3; }
  .cosl { stroke: rgb(255,176,32); stroke-width: 4; stroke-linecap: round; }
  .sinl { stroke: rgb(171,71,188); stroke-width: 4; stroke-linecap: round; }
  .arc { fill: none; stroke: rgb(120,160,255); stroke-width: 1.5; }
  .arct { font-size: 12px; fill: rgb(120,160,255); font-style: italic; }
  .vec { stroke: rgb(var(--pf-col)); stroke-width: 3.2; stroke-linecap: round; filter: drop-shadow(0 0 6px rgba(var(--pf-col), .6)); }
  .dot { fill: rgb(var(--pf-col)); stroke: #fff; stroke-width: 2; }
  .lab { font-size: 11px; font-style: italic; font-weight: 600; }
  .cosx { fill: rgb(255,176,32); }
  .siny { fill: rgb(200,120,220); }
  .st { fill: var(--primary-text-color); font-size: 14px; font-weight: 700; }
  .scale { position:absolute; left: 0; bottom: 0; font-size: .7rem; padding: 4px 10px; border-radius: 999px; cursor:pointer;
           color: var(--secondary-text-color); background: var(--g-fill-soft); border: 1px solid var(--g-edge); }
  .side { display:flex; flex-direction:column; gap: 10px; min-width: 0; }
  .hero { display:flex; flex-direction:column; align-items:flex-start; gap: 2px; padding: 14px 16px; border-radius: 20px; cursor:pointer; text-align:left;
          background: linear-gradient(150deg, rgba(var(--pf-col), .22), rgba(var(--pf-col), .05)); border: 1px solid rgba(var(--pf-col), .45);
          box-shadow: var(--g-shine); transition: background .6s, border-color .6s; }
  .pfv { font-size: 2.6rem; line-height: 1.05; font-weight: 700; font-variant-numeric: tabular-nums; color: rgb(var(--pf-col)); transition: color .6s; }
  .kind { font-size: .8rem; color: var(--secondary-text-color); }
  .bar { width: 100%; height: 6px; border-radius: 99px; background: rgba(var(--ink),.1); margin-top: 8px; overflow: hidden; position: relative; }
  .bar::after { content:""; position:absolute; left:95%; top:0; bottom:0; width:2px; background: rgba(var(--ink),.6); }
  .bar i { display:block; height:100%; border-radius: 99px; background: rgb(var(--pf-col)); transition: width 1s cubic-bezier(.2,.9,.25,1); }
  .tiles { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .tiles .pill { min-width: 0; }
  .tiles .pill span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .ta { cursor: default; }
  .note { font-size: .72rem; color: var(--secondary-text-color); line-height: 1.35; }
  .note[hidden] { display:none; }
  :host([size="small"]) .body { grid-template-columns: 1fr; }
  :host([size="small"]) .pfv { font-size: 2rem; }
  @media (max-width: 600px) { .body { grid-template-columns: 1fr; } }
`;

/* ===================================================================
 * cos φ as a glass of beer: beer = active power P, foam = reactive
 * power Q, the whole glass = apparent power S. cos φ = beer / glass.
 * The bubbles are live: the more active power, the more bubbles.
 *
 *   type: custom:enphase-beer-card
 * =================================================================== */

const BEER_T = {
  en: { title: "cos φ in a glass of beer", beer: "Beer · P", foam: "Foam · Q", glass: "Glass · S" },
  nl: { title: "cos φ in een glas bier", beer: "Bier · P", foam: "Schuim · Q", glass: "Glas · S" },
  de: { title: "cos φ im Bierglas", beer: "Bier · P", foam: "Schaum · Q", glass: "Glas · S" },
};
const B_TOP = 24, B_FLOOR = 292, B_H = B_FLOOR - B_TOP;
const bLeft = (y) => 34 + ((y - 20) * 20) / 272;
const bRight = (y) => 220 - bLeft(y);

/* Small seeded random so the glass looks the same on every redraw. */
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

class EnphaseBeerCard extends EnphasePowerFactorCard {
  static getStubConfig() {
    return { source: "grid" };
  }

  getCardSize() {
    return 7;
  }

  _b(key) {
    return (BEER_T[(this._locale() || "en").slice(0, 2)] || BEER_T.en)[key] || BEER_T.en[key];
  }

  _build() {
    const rnd = seeded(7);
    // Bubbles rise in a few streams from nucleation points on the bottom, plus loose ones.
    const streams = [62, 88, 104, 131, 150, 163];
    let bubbles = "";
    for (let i = 0; i < 64; i++) {
      const x = i < 40 ? streams[i % streams.length] + (rnd() - 0.5) * 6 : 50 + rnd() * 120;
      const r = 0.7 + rnd() * (i < 40 ? 1.3 : 2);
      const d = 2.6 + rnd() * 3.4;
      bubbles += `<circle class="bub" data-i="${i}" cx="${x.toFixed(1)}" cy="${B_FLOOR - 2}" r="${r.toFixed(2)}"
        style="--d:${d.toFixed(2)}s;--dl:-${(rnd() * d).toFixed(2)}s;--w:${((rnd() - 0.5) * 10).toFixed(1)}px"/>`;
    }
    let drops = "";
    for (let i = 0; i < 46; i++) {
      const y = 40 + rnd() * 250, x = bLeft(y) + 4 + rnd() * (bRight(y) - bLeft(y) - 8);
      const rx = 0.8 + rnd() * 2.4;
      drops += `<g class="drop"><ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(2)}" ry="${(rx * (1.1 + rnd() * 0.5)).toFixed(2)}"/>
        <circle cx="${(x - rx * 0.35).toFixed(1)}" cy="${(y - rx * 0.4).toFixed(1)}" r="${(rx * 0.32).toFixed(2)}" class="dh"/></g>`;
    }
    this._bumps = Array.from({ length: 9 }, () => 0.5 + rnd());
    this._lace = Array.from({ length: 18 }, () => [rnd(), 1 + rnd() * 2.6]);
    const inner = `M${bLeft(B_TOP)},${B_TOP} L${bRight(B_TOP)},${B_TOP} L${bRight(B_FLOOR)},${B_FLOOR} L${bLeft(B_FLOOR)},${B_FLOOR} Z`;
    this.shadowRoot.innerHTML = `
      <style>${SIZE_STYLE}${XSTYLE}${PF_STYLE}${BEER_STYLE}${GLASS}${CLEAN}</style>
      <ha-card>
        <div class="top">
          <div class="title">${esc(this._config.title || this._b("title"))}</div>
          <div class="seg src">${PF_SOURCES.map((s) => `<button data-s="${s}">${esc(s.startsWith("L") ? s : this._p(s))}</button>`).join("")}</div>
        </div>
        <div class="body">
          <div class="dial">
            <svg viewBox="0 0 330 340" class="glass">
              <defs>
                <clipPath id="inner"><path d="${inner}"/></clipPath>
                <clipPath id="beerclip"><rect class="beerrect" x="0" width="220" y="${B_FLOOR}" height="0"/></clipPath>
                <clipPath id="wetclip"><rect class="wetrect" x="0" width="220" y="${B_FLOOR}" height="40"/></clipPath>
                <linearGradient id="beer" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#ffd86a"/><stop offset=".35" stop-color="#f5ae22"/>
                  <stop offset=".8" stop-color="#d4840b"/><stop offset="1" stop-color="#b06a05"/></linearGradient>
                <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stop-color="#3a1d00" stop-opacity=".55"/><stop offset=".14" stop-color="#3a1d00" stop-opacity="0"/>
                  <stop offset=".24" stop-color="#fff6d0" stop-opacity=".28"/><stop offset=".34" stop-color="#fff" stop-opacity="0"/>
                  <stop offset=".78" stop-color="#3a1d00" stop-opacity="0"/><stop offset="1" stop-color="#3a1d00" stop-opacity=".5"/></linearGradient>
                <linearGradient id="foam" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#fffdf7"/><stop offset=".55" stop-color="#fbf1dc"/><stop offset="1" stop-color="#ecd3a0"/></linearGradient>
                <linearGradient id="fshade" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stop-color="#8a6a3a" stop-opacity=".35"/><stop offset=".2" stop-color="#8a6a3a" stop-opacity="0"/>
                  <stop offset=".8" stop-color="#8a6a3a" stop-opacity="0"/><stop offset="1" stop-color="#8a6a3a" stop-opacity=".32"/></linearGradient>
                <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity=".28"/></linearGradient>
                <radialGradient id="shadow"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
                <filter id="ftex" x="0" y="0" width="1" height="1">
                  <feTurbulence type="fractalNoise" baseFrequency="0.22 0.3" numOctaves="3" seed="3" result="n"/>
                  <feColorMatrix in="n" type="matrix" values="0 0 0 0 .62  0 0 0 0 .5  0 0 0 0 .33  -2.4 0 0 0 1.32" result="spots"/>
                  <feComposite in="spots" in2="SourceGraphic" operator="in"/>
                </filter>
              </defs>
              <ellipse cx="110" cy="322" rx="78" ry="9" fill="url(#shadow)"/>
              <path class="gbody" d="M30,18 L190,18 L170,314 Q169,320 162,320 L58,320 Q51,320 50,314 Z"/>
              <g clip-path="url(#inner)">
                <g class="liquid">
                  <rect class="beer" x="0" width="220" fill="url(#beer)"/>
                  <g clip-path="url(#beerclip)"><g class="bubs">${bubbles}</g></g>
                  <rect class="beer" x="0" width="220" fill="url(#shade)"/>
                  <path class="foamp" fill="url(#foam)"/>
                  <path class="foamp tex" fill="#fff" filter="url(#ftex)"/>
                  <path class="foamp" fill="url(#fshade)"/>
                  <g class="fbubs"></g>
                  <path class="lace"/>
                </g>
              </g>
              <path class="gbase" d="M${bLeft(B_FLOOR) - 2},${B_FLOOR} L${bRight(B_FLOOR) + 2},${B_FLOOR} L169.6,314 Q169,320 162,320 L58,320 Q51,320 50.4,314 Z"/>
              <ellipse class="gbase-hl" cx="110" cy="${B_FLOOR + 2}" rx="${(bRight(B_FLOOR) - bLeft(B_FLOOR)) / 2}" ry="3"/>
              <g clip-path="url(#wetclip)" class="drops">${drops}</g>
              <path class="hl1" d="M40,26 L50,26 L64,300 L58,300 Z"/>
              <path class="hl2" d="M55,30 L58,30 L70,296 L68,296 Z"/>
              <path class="hl3" d="M178,28 L184,28 L166,306 L162,306 Z"/>
              <path class="gedge" d="M30,18 L190,18 L170,314 Q169,320 162,320 L58,320 Q51,320 50,314 Z"/>
              <line class="rim" x1="30" y1="18.5" x2="190" y2="18.5"/>
              <g class="tags">
                <line class="lead lf"/><text class="tag tf"><tspan class="tn"></tspan><tspan class="tv" dy="15"></tspan></text>
                <line class="lead lb"/><text class="tag tb"><tspan class="tn"></tspan><tspan class="tv" dy="15"></tspan></text>
                <path class="brace"/>
                <text class="tag ts2"><tspan class="tn"></tspan><tspan class="tv" dy="15"></tspan></text>
              </g>
            </svg>
            <button class="scale"></button>
          </div>
          ${this._sideHtml()}
        </div>
      </ha-card>`;
    this._wire();
    this._built = true;
  }

  _draw(animate) {
    const pts = [...(this._hist || []), ...this._trail];
    const max = Math.max(1, ...pts.map((p) => p.S), this._now?.S || 0) * 1.05;
    const pf = this._now ? Math.abs(this._now.P) / this._now.S : 0;
    const fill = !this._now ? 0 : this._scale === "unit" ? 0.88 : Math.max(0.12, Math.min(0.9, this._now.S / max));
    const target = { fill, pf };
    const from = this._lvl || { fill: 0, pf };
    cancelAnimationFrame(this._raf);
    const t0 = performance.now(), dur = animate ? 1400 : 0;
    const step = (now) => {
      const f = dur ? Math.min(1, (now - t0) / dur) : 1;
      // Pour in: ease out with a little settle at the end.
      const e = f === 1 ? 1 : 1 - Math.pow(2, -9 * f) * Math.cos(f * 7);
      this._lvl = { fill: from.fill + (target.fill - from.fill) * e, pf: from.pf + (target.pf - from.pf) * e };
      this._geom(this._lvl);
      if (f < 1) this._raf = requestAnimationFrame(step);
    };
    if (dur) this._raf = requestAnimationFrame(step);
    else step(t0);
    // Live bubbles: more active power, more bubbles.
    const P = Math.abs(this._now?.P || 0);
    const n = this._now ? Math.round(10 + 54 * Math.min(1, Math.sqrt(P / 3000))) : 0;
    this.shadowRoot.querySelectorAll(".bub").forEach((b) => b.classList.toggle("on", +b.dataset.i < n));
  }

  _geom({ fill, pf }) {
    const sr = this.shadowRoot;
    const set = (sel, attrs) => sr.querySelectorAll(sel).forEach((el) => {
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, typeof v === "number" ? v.toFixed(2) : v);
    });
    const foamTop = B_FLOOR - fill * B_H;
    const foamH = fill > 0 ? Math.max(4, fill * (1 - pf) * B_H) : 0;
    const beerTop = Math.min(B_FLOOR, foamTop + foamH);
    set(".beer", { y: beerTop, height: B_FLOOR - beerTop + 2 });
    set(".beerrect", { y: beerTop, height: B_FLOOR - beerTop });
    set(".wetrect", { y: foamTop - 4, height: B_FLOOR - foamTop + 30 });
    // Foam: a domed, bumpy head, a little higher against the glass.
    if (fill > 0) {
      const l = bLeft(foamTop), r = bRight(foamTop), w = r - l, n = this._bumps.length;
      const dome = Math.min(7, foamH * 0.6);
      let d = `M${(l - 2).toFixed(2)},${(beerTop + 1).toFixed(2)} L${(l - 2).toFixed(2)},${(foamTop - 1.5).toFixed(2)}`;
      for (let i = 0; i < n; i++) {
        const x1 = l + (w * (i + 1)) / n;
        const rise = dome * Math.sin((Math.PI * (i + 0.5)) / n);
        const by = foamTop - rise - this._bumps[i] * Math.min(3.2, foamH * 0.3);
        d += ` Q${(l + (w * (i + 0.5)) / n).toFixed(2)},${by.toFixed(2)} ${x1.toFixed(2)},${(foamTop - dome * Math.sin((Math.PI * (i + 1)) / n) * 0.8).toFixed(2)}`;
      }
      d += ` L${(r + 2).toFixed(2)},${(beerTop + 1).toFixed(2)} Z`;
      set(".foamp", { d });
      // Bigger bubbles where foam meets beer, and lacing on the glass above the foam.
      const bl = bLeft(beerTop), br = bRight(beerTop);
      sr.querySelector(".fbubs").innerHTML = foamH > 6
        ? this._lace.map(([u, rr], i) => `<circle cx="${(bl + 6 + u * (br - bl - 12)).toFixed(1)}" cy="${(beerTop - 1.5 - (i % 3) * 2.2).toFixed(1)}" r="${rr.toFixed(2)}"/>`).join("")
        : "";
      const ly = foamTop - 10;
      set(".lace", { d: `M${bLeft(ly) + 3},${ly} q6,4 12,1 q5,5 9,0 M${bRight(ly) - 22},${ly + 2} q5,3 10,0 q4,4 9,1`, opacity: fill > 0.3 ? 0.5 : 0 });
    } else {
      set(".foamp", { d: "" });
      sr.querySelector(".fbubs").innerHTML = "";
    }
    // Labels to the right of the glass.
    const on = this._now && fill > 0;
    const tx = 212;
    const fy = foamTop + foamH / 2, by = (beerTop + B_FLOOR) / 2;
    set(".lf", { x1: bRight(fy) - 4, y1: fy, x2: tx - 4, y2: Math.min(fy, by - 34), opacity: on ? 1 : 0 });
    set(".lb", { x1: bRight(by) - 4, y1: by, x2: tx - 4, y2: Math.max(by, fy + 34), opacity: on ? 1 : 0 });
    set(".tf", { x: tx, y: Math.min(fy, by - 34) - 2, opacity: on ? 1 : 0 });
    set(".tb", { x: tx, y: Math.max(by, fy + 34) - 2, opacity: on ? 1 : 0 });
    set(".tf tspan", { x: tx });
    set(".tb tspan", { x: tx });
    const q = (s) => sr.querySelector(s);
    q(".tf .tn").textContent = this._b("foam");
    q(".tb .tn").textContent = this._b("beer");
    q(".tf .tv").textContent = this._now ? `${fmt(Math.abs(this._now.Q))} var` : "";
    q(".tb .tv").textContent = this._now ? `${fmt(Math.abs(this._now.P))} W` : "";
    // Brace over the whole contents = S.
    const bx = 300;
    set(".brace", { d: `M${bx - 6},${foamTop} q6,0 6,6 L${bx},${(foamTop + B_FLOOR) / 2 - 6} q0,6 6,6 q-6,0 -6,6 L${bx},${B_FLOOR - 6} q0,6 -6,6`, opacity: on ? 1 : 0 });
    set(".ts2", { x: bx + 10, y: (foamTop + B_FLOOR) / 2 - 4, opacity: on ? 1 : 0 });
    set(".ts2 tspan", { x: bx + 10 });
    q(".ts2 .tn").textContent = "S";
    q(".ts2 .tv").textContent = "";
  }
}

const BEER_STYLE = `
  .glass { width: 100%; max-height: 460px; display:block; overflow: visible; }
  .gbody { fill: rgba(var(--ink),.05); }
  .gedge { fill: none; stroke: rgba(var(--ink),.5); stroke-width: 1.6; }
  .rim { stroke: rgba(var(--ink),.85); stroke-width: 2.2; stroke-linecap: round; }
  .gbase { fill: url(#base); stroke: rgba(var(--ink),.25); stroke-width: .8; }
  .gbase-hl { fill: none; stroke: rgba(var(--ink),.35); stroke-width: 1; }
  .hl1 { fill: rgba(255,255,255,.17); }
  .hl2 { fill: rgba(255,255,255,.32); }
  .hl3 { fill: rgba(var(--ink),.08); }
  .bub { fill: rgba(255,248,215,.75); stroke: rgba(255,255,255,.55); stroke-width: .35; opacity: 0; }
  .bub.on { animation: rise var(--d) linear infinite; animation-delay: var(--dl); }
  @keyframes rise {
    0% { transform: translate(0, 0); opacity: 0; }
    6% { opacity: .85; }
    50% { transform: translate(var(--w), -140px); }
    100% { transform: translate(0, -280px); opacity: .85; }
  }
  .tex { opacity: .5; }
  .fbubs circle { fill: rgba(255,252,240,.55); stroke: rgba(190,150,80,.55); stroke-width: .5; }
  .lace { fill: none; stroke: rgba(255,250,235,.55); stroke-width: 1.4; stroke-linecap: round; }
  .drop ellipse { fill: rgba(var(--ink),.12); stroke: rgba(var(--ink),.22); stroke-width: .4; }
  .drop .dh { fill: rgba(255,255,255,.7); }
  .lead { stroke: rgba(var(--ink),.4); stroke-width: 1; stroke-dasharray: 3 3; }
  .tag { font-size: 11px; fill: var(--secondary-text-color); }
  .tag .tv { font-size: 13px; font-weight: 700; fill: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .tf .tn { fill: #f3e3c0; }
  .tb .tn { fill: #f5ae22; }
  .brace { fill: none; stroke: rgba(var(--ink),.55); stroke-width: 1.3; }
  .ts2 .tn { font-size: 14px; font-weight: 700; fill: var(--primary-text-color); font-style: italic; }
  @media (prefers-reduced-motion: reduce) { .bub.on { animation-duration: 0s; } }
`;

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
  ["enphase-grid-card", EnphaseGridCard, "Enphase grid & phases",
   "Voltage gauges per phase (with the 253 V limit), current, power factor, frequency and today's extremes."],
  ["enphase-power-factor-card", EnphasePowerFactorCard, "Enphase power factor (cos φ)",
   "The power triangle on the unit circle: P, Q, S and cos φ live, with a trail of the last hours. Grid, per phase or solar."],
  ["enphase-beer-card", EnphaseBeerCard, "Enphase cos φ beer glass",
   "cos φ explained with a glass of beer: beer = active power, foam = reactive power, the glass = apparent power. Live bubbles."],
  ["enphase-inverters-card", EnphaseInvertersCard, "Enphase microinverters",
   "Every microinverter in a sortable table: AC, DC, efficiency, temperature, today, health and last report."],
  ["enphase-energy-card", EnphaseEnergyCard, "Enphase production history",
   "Calendar of daily production, months compared with last year, and records."],
  ["enphase-system-card", EnphaseSystemCard, "Enphase system summary",
   "Solar, home and grid at a glance, today's energy, self-consumption and status."],
];

function defineCards() {
  for (const [tag, cls] of CARDS) {
    if (customElements.get(tag)) continue;
    try {
      customElements.define(tag, class extends cls {
        set hass(hass) {
          // Follow the light or dark Home Assistant theme (like the Easee card).
          const tone = hass?.themes?.darkMode === false ? "light" : "dark";
          if (this.getAttribute("tone") !== tone) this.setAttribute("tone", tone);
          super.hass = hass;
        }

        get hass() {
          return this._hass;
        }
      });
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
