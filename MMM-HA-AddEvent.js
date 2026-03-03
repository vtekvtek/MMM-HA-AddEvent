/* global Module */

Module.register("MMM-HA-AddEvent", {
  defaults: {
    buttonText: "Add Event",
    calendarTitle: "Add Family Event",
    defaultDurationMinutes: 30,
    minuteRounding: 5
  },

  start() {
    this._visible = false;

    this._portal = document.getElementById("HA_EVENTADD_PORTAL");
    if (!this._portal) {
      this._portal = document.createElement("div");
      this._portal.id = "HA_EVENTADD_PORTAL";
      document.body.appendChild(this._portal);
    }

    this._keyboard = null;
    this._activeField = null;

    this._current = this._defaultState();

    this.sendSocketNotification("CONFIG", this.config);
    this._renderPortal();
  },

  getStyles() {
    // simple-keyboard CSS plus our CSS
    return [
      "https://unpkg.com/simple-keyboard@latest/build/css/index.css",
      "MMM-HA-AddEvent.css"
    ];
  },

  getScripts() {
    // simple-keyboard JS
    return ["https://unpkg.com/simple-keyboard@latest/build/index.js"];
  },

  getDom() {
    const wrap = document.createElement("div");
    wrap.className = "haAddWrap";

    const row = document.createElement("div");
    row.className = "haAddRow isAccent";

    const btn = document.createElement("div");
    btn.className = "haAddButton";
    btn.tabIndex = 0;

    const left = document.createElement("div");
    left.className = "haAddTitleWrap";

    const label = document.createElement("div");
    label.className = "haAddLabel";
    label.textContent = this.config.buttonText || "Add Event";

    left.appendChild(label);

    const right = document.createElement("div");
    right.className = "haAddMeta";

    const hint = document.createElement("div");
    hint.className = "haAddHint";
    hint.textContent = "Tap to open";

    right.appendChild(hint);

    btn.append(left, right);

    btn.addEventListener("click", () => this.open());
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.open();
      }
    });

    row.appendChild(btn);
    wrap.appendChild(row);
    return wrap;
  },

  open() {
    this._current = this._defaultState();
    this._visible = true;
    this._activeField = "ha_summary";
    this._renderPortal();

    setTimeout(() => {
      const el = document.getElementById("ha_summary");
      if (el) el.focus({ preventScroll: true });
      this._initKeyboardIfNeeded();
      this._syncKeyboardToField("ha_summary");
    }, 0);
  },

  close() {
    this._visible = false;
    this._activeField = null;
    this._destroyKeyboard();
    this._renderPortal();
  },

  _defaultState() {
    const now = new Date();
    now.setSeconds(0, 0);

    const round = Math.max(1, Number(this.config.minuteRounding) || 5);
    const mins = now.getMinutes();
    const rounded = Math.ceil(mins / round) * round;
    now.setMinutes(rounded);

    const duration = Math.max(5, Number(this.config.defaultDurationMinutes) || 30);
    const end = new Date(now.getTime() + duration * 60 * 1000);

    const startDT = this._toDateTimeLocal(now);
    const endDT = this._toDateTimeLocal(end);

    const startDate = this._toDateOnly(now);
    const endDate = startDate; // inclusive in UI

    return {
      summary: "",
      description: "",
      allDay: false,
      startDT,
      endDT,
      startDate,
      endDate
    };
  },

  _toDateTimeLocal(d) {
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  _toDateOnly(d) {
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  _parseDateOnly(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ""));
    if (!m) return null;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  },

  _addDaysDateOnly(dateStr, days) {
    const dt = this._parseDateOnly(dateStr);
    if (!dt) return "";
    dt.setDate(dt.getDate() + Number(days || 0));
    return this._toDateOnly(dt);
  },

  _renderPortal() {
    this._portal.classList.toggle("is-open", !!this._visible);
    this._portal.innerHTML = "";
    if (!this._visible) return;

    const root = document.createElement("div");
    root.className = "haEventAddRoot";

    const overlay = document.createElement("div");
    overlay.className = "haOverlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const modal = document.createElement("div");
    modal.className = "haModal";

    const title = document.createElement("div");
    title.className = "haTitle";
    title.textContent = this.config.calendarTitle || "Add Event";

    const form = document.createElement("div");

    form.appendChild(this._rowText("Title", "ha_summary", this._current.summary));
    form.appendChild(this._rowAllDayToggle());

    if (this._current.allDay) {
      form.appendChild(this._rowDate("Start Date", "ha_start_date", this._current.startDate));
      form.appendChild(this._rowDate("End Date", "ha_end_date", this._current.endDate));
      const hint = document.createElement("div");
      hint.className = "haHint";
      hint.textContent = "End date is inclusive here.";
      form.appendChild(hint);
    } else {
      form.appendChild(this._rowDateTime("Start", "ha_start_dt", this._current.startDT));
      form.appendChild(this._rowDateTime("End", "ha_end_dt", this._current.endDT));
    }

    form.appendChild(this._rowTextArea("Notes", "ha_desc", this._current.description));

    // Keyboard container (simple-keyboard)
    const kbWrap = document.createElement("div");
    kbWrap.className = "haKbWrap";
    kbWrap.innerHTML = `<div class="simple-keyboard haKb"></div>`;
    form.appendChild(kbWrap);

    const btnBar = document.createElement("div");
    btnBar.className = "haButtons";

    const cancel = document.createElement("button");
    cancel.className = "haBtn cancel";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());

    const save = document.createElement("button");
    save.className = "haBtn save";
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", () => this._submit());

    btnBar.append(cancel, save);
    form.appendChild(btnBar);

    modal.append(title, form);
    overlay.appendChild(modal);
    root.appendChild(overlay);
    this._portal.appendChild(root);

    // ensure keyboard exists after DOM is mounted
    setTimeout(() => {
      this._initKeyboardIfNeeded();
      if (!this._activeField) this._activeField = "ha_summary";
      this._syncKeyboardToField(this._activeField);
    }, 0);
  },

  _rowBase(label, id) {
    const row = document.createElement("div");
    row.className = "haRow";

    const l = document.createElement("label");
    l.textContent = label;
    l.htmlFor = id;

    row.appendChild(l);
    return row;
  },

  _setActiveField(id) {
    this._activeField = id;

    const el = document.getElementById(id);
    if (el) el.focus({ preventScroll: true });

    this._syncKeyboardToField(id);
  },

  _rowText(label, id, value) {
    const row = this._rowBase(label, id);

    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.value = value || "";

    // Use pointerdown so touch works reliably in Electron
    input.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._setActiveField(id);
    });

    input.addEventListener("input", () => {
      if (id === "ha_summary") this._current.summary = input.value;
    });

    row.appendChild(input);
    return row;
  },

  _rowTextArea(label, id, value) {
    const row = this._rowBase(label, id);

    const ta = document.createElement("textarea");
    ta.id = id;
    ta.value = value || "";

    ta.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._setActiveField(id);
    });

    ta.addEventListener("input", () => {
      this._current.description = ta.value;
    });

    row.appendChild(ta);
    return row;
  },

  _rowAllDayToggle() {
    const row = document.createElement("div");
    row.className = "haRow haRowInline";

    const l = document.createElement("label");
    l.className = "haInlineLabel";
    l.textContent = "All-day";
    l.htmlFor = "ha_allday";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.id = "ha_allday";
    toggle.checked = !!this._current.allDay;

    toggle.addEventListener("change", () => {
      this._current.allDay = !!toggle.checked;

      if (this._current.allDay) {
        const base = this._current.startDT ? String(this._current.startDT).split("T")[0] : this._toDateOnly(new Date());
        this._current.startDate = base;
        this._current.endDate = base;
      } else {
        const fresh = this._defaultState();
        this._current.startDT = fresh.startDT;
        this._current.endDT = fresh.endDT;
      }

      this._renderPortal();
    });

    row.append(l, toggle);
    return row;
  },

  _rowDateTime(label, id, value) {
    const row = this._rowBase(label, id);

    const input = document.createElement("input");
    input.type = "datetime-local";
    input.id = id;
    input.value = value || "";

    input.addEventListener("change", () => {
      if (id === "ha_start_dt") this._current.startDT = input.value;
      if (id === "ha_end_dt") this._current.endDT = input.value;
    });

    row.appendChild(input);
    return row;
  },

  _rowDate(label, id, value) {
    const row = this._rowBase(label, id);

    const input = document.createElement("input");
    input.type = "date";
    input.id = id;
    input.value = value || "";

    input.addEventListener("change", () => {
      if (id === "ha_start_date") {
        this._current.startDate = input.value;
        const s = this._parseDateOnly(this._current.startDate);
        const e = this._parseDateOnly(this._current.endDate);
        if (s && e && e < s) this._current.endDate = this._current.startDate;
        this._renderPortal();
      }
      if (id === "ha_end_date") {
        this._current.endDate = input.value;
        const s = this._parseDateOnly(this._current.startDate);
        const e = this._parseDateOnly(this._current.endDate);
        if (s && e && e < s) this._current.endDate = this._current.startDate;
        this._renderPortal();
      }
    });

    row.appendChild(input);
    return row;
  },

  _initKeyboardIfNeeded() {
    if (this._keyboard) return;

    const KeyboardCtor = window.SimpleKeyboard && window.SimpleKeyboard.default;
    const kbEl = document.querySelector(".simple-keyboard");
    if (!KeyboardCtor || !kbEl) return;

    this._keyboard = new KeyboardCtor({
      onChange: (input) => this._onKbChange(input),
      onKeyPress: (btn) => this._onKbKeyPress(btn),
      // Keep it stable, do not auto switch layouts
      layout: {
        default: [
          "1 2 3 4 5 6 7 8 9 0 {bksp}",
          "q w e r t y u i o p",
          "a s d f g h j k l",
          "{shift} z x c v b n m {enter}",
          "{space} {clear}"
        ],
        shift: [
          "! @ # $ % ^ & * ( ) {bksp}",
          "Q W E R T Y U I O P",
          "A S D F G H J K L",
          "{shift} Z X C V B N M {enter}",
          "{space} {clear}"
        ]
      },
      display: {
        "{bksp}": "⌫",
        "{enter}": "Enter",
        "{shift}": "Shift",
        "{space}": "Space",
        "{clear}": "Clear"
      }
    });
  },

  _syncKeyboardToField(fieldId) {
    if (!this._keyboard || !fieldId) return;
    const el = document.getElementById(fieldId);
    if (!el) return;
    this._keyboard.setInput(el.value || ""); // keeps keyboard buffer aligned :contentReference[oaicite:2]{index=2}
  },

  _onKbChange(input) {
    // Every keypress updates the active field
    const id = this._activeField;
    if (!id) return;

    const el = document.getElementById(id);
    if (!el) return;

    el.value = input;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },

  _onKbKeyPress(btn) {
    if (btn === "{shift}") {
      const current = this._keyboard.options.layoutName || "default";
      this._keyboard.setOptions({ layoutName: current === "default" ? "shift" : "default" });
    }
    if (btn === "{clear}") {
      this._keyboard.clearInput();
    }
    if (btn === "{enter}") {
      // Optional: jump from Title to Notes on Enter
      if (this._activeField === "ha_summary") {
        this._setActiveField("ha_desc");
      }
    }
  },

  _destroyKeyboard() {
    // simple-keyboard does not require a hard destroy, just drop reference
    this._keyboard = null;
  },

  _submit() {
    const summary = (this._current.summary || "").trim();
    const description = (this._current.description || "").trim();

    if (!summary) {
      alert("Title is required.");
      return;
    }

    if (this._current.allDay) {
      const s = this._parseDateOnly(this._current.startDate);
      const e = this._parseDateOnly(this._current.endDate);
      if (!s || !e) {
        alert("Start Date and End Date are required.");
        return;
      }
      if (e < s) {
        alert("End Date must be on or after Start Date.");
        return;
      }

      // end_date is exclusive for true all-day behavior in many calendar backends
      const endExclusive = this._addDaysDateOnly(this._current.endDate, 1);

      this.sendSocketNotification("CREATE_EVENT", {
        allDay: true,
        summary,
        description,
        start_date: this._current.startDate,
        end_date: endExclusive
      });

      return;
    }

    const start = new Date(this._current.startDT);
    const end = new Date(this._current.endDT);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      alert("End time must be after start time.");
      return;
    }

    this.sendSocketNotification("CREATE_EVENT", {
      allDay: false,
      summary,
      description,
      start_date_time: new Date(this._current.startDT).toISOString(),
      end_date_time: new Date(this._current.endDT).toISOString()
    });
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "RESULT") return;

    if (payload && payload.ok) {
      this.close();
    } else {
      const msg = payload && payload.error ? payload.error : "unknown error";
      alert(`Failed: ${msg}`);
    }
  }
});
