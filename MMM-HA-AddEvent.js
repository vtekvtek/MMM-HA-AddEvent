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

    this._activeField = "ha_summary";
    this._keyboard = null;

    // Keyboard state
    this._capsLock = false;          // persistent caps lock
    this._shiftOneShot = false;      // one-letter shift
    this._pendingOneShotReset = false;

    // Auto-cap first letter only (per field focus)
    this._autoCapNext = true;

    this._current = this._defaultState();

    this._portal = document.getElementById("HA_EVENTADD_PORTAL");
    if (!this._portal) {
      this._portal = document.createElement("div");
      this._portal.id = "HA_EVENTADD_PORTAL";
      document.body.appendChild(this._portal);
    }

    this._refs = {};

    this.sendSocketNotification("CONFIG", this.config);
    this._buildOnce();
    this._applyVisibility();
    this._syncUIFromState();
  },

  getStyles() {
    return [
      "https://unpkg.com/simple-keyboard@latest/build/css/index.css",
      "MMM-HA-AddEvent.css"
    ];
  },

  getScripts() {
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

    // First-letter caps when opening
    this._capsLock = false;
    this._shiftOneShot = false;
    this._autoCapNext = true;

    this._applyVisibility();
    this._syncUIFromState();

    setTimeout(() => {
      const el = this._refs.summary;
      if (el) el.focus({ preventScroll: true });
      this._initKeyboardIfNeeded();
      this._applyKeyboardCaseMode(true);
      this._syncKeyboardToActive();
    }, 0);
  },

  close() {
    this._visible = false;
    this._applyVisibility();
  },

  _applyVisibility() {
    this._portal.classList.toggle("is-open", !!this._visible);
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
    const endDate = startDate;

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

  _pad(x) {
    return String(x).padStart(2, "0");
  },

  _toDateTimeLocal(d) {
    return `${d.getFullYear()}-${this._pad(d.getMonth() + 1)}-${this._pad(d.getDate())}T${this._pad(d.getHours())}:${this._pad(d.getMinutes())}`;
  },

  _toDateOnly(d) {
    return `${d.getFullYear()}-${this._pad(d.getMonth() + 1)}-${this._pad(d.getDate())}`;
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

  _buildOnce() {
    this._portal.innerHTML = "";

    const root = document.createElement("div");
    root.className = "haEventAddRoot";

    const overlay = document.createElement("div");
    overlay.className = "haOverlay";

    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) this.close();
    });

    const modal = document.createElement("div");
    modal.className = "haModal";

    modal.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });

    const title = document.createElement("div");
    title.className = "haTitle";
    title.textContent = this.config.calendarTitle || "Add Event";

    const form = document.createElement("div");

    // Title row
    const summaryRow = this._rowBase("Title", "ha_summary");
    const summary = document.createElement("input");
    summary.type = "text";
    summary.id = "ha_summary";
    summary.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this._setActiveField("ha_summary");
    });
    summary.addEventListener("input", () => {
      this._current.summary = summary.value;
      this._syncKeyboardToActive();
    });
    summaryRow.appendChild(summary);

    // All day row
    const allDayRow = document.createElement("div");
    allDayRow.className = "haRowInline";

    const allDayLabel = document.createElement("div");
    allDayLabel.className = "haInlineLabel";
    allDayLabel.textContent = "All Day Event";

    const allDayToggle = document.createElement("input");
    allDayToggle.type = "checkbox";
    allDayToggle.id = "ha_allday";
    allDayToggle.className = "haCheck";
    allDayToggle.addEventListener("change", () => {
      this._current.allDay = !!allDayToggle.checked;

      if (this._current.allDay) {
        const base = this._current.startDT ? String(this._current.startDT).split("T")[0] : this._toDateOnly(new Date());
        this._current.startDate = base;
        this._current.endDate = base;
      } else {
        const fresh = this._defaultState();
        this._current.startDT = fresh.startDT;
        this._current.endDT = fresh.endDT;
      }

      this._syncUIFromState();
    });

    allDayLabel.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      allDayToggle.checked = !allDayToggle.checked;
      allDayToggle.dispatchEvent(new Event("change"));
    });

    allDayRow.append(allDayLabel, allDayToggle);

    // Timed container
    const timedWrap = document.createElement("div");
    timedWrap.className = "haTimedWrap";

    const startDTRow = this._rowBase("Start", "ha_start_dt");
    const startDT = document.createElement("input");
    startDT.type = "datetime-local";
    startDT.id = "ha_start_dt";
    startDT.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this._showPicker(startDT);
    });
    startDT.addEventListener("focus", () => this._showPicker(startDT));
    startDT.addEventListener("change", () => {
      this._current.startDT = startDT.value;
    });
    startDTRow.appendChild(startDT);

    const endDTRow = this._rowBase("End", "ha_end_dt");
    const endDT = document.createElement("input");
    endDT.type = "datetime-local";
    endDT.id = "ha_end_dt";
    endDT.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this._showPicker(endDT);
    });
    endDT.addEventListener("focus", () => this._showPicker(endDT));
    endDT.addEventListener("change", () => {
      this._current.endDT = endDT.value;
    });
    endDTRow.appendChild(endDT);

    timedWrap.append(startDTRow, endDTRow);

    // All-day container
    const alldayWrap = document.createElement("div");
    alldayWrap.className = "haAllDayWrap";

    const startDateRow = this._rowBase("Start Date", "ha_start_date");
    const startDate = document.createElement("input");
    startDate.type = "date";
    startDate.id = "ha_start_date";
    startDate.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this._showPicker(startDate);
    });
    startDate.addEventListener("focus", () => this._showPicker(startDate));
    startDate.addEventListener("change", () => {
      this._current.startDate = startDate.value;
      const s = this._parseDateOnly(this._current.startDate);
      const ed = this._parseDateOnly(this._current.endDate);
      if (s && ed && ed < s) {
        this._current.endDate = this._current.startDate;
        endDate.value = this._current.endDate;
      }
    });
    startDateRow.appendChild(startDate);

    const endDateRow = this._rowBase("End Date", "ha_end_date");
    const endDate = document.createElement("input");
    endDate.type = "date";
    endDate.id = "ha_end_date";
    endDate.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this._showPicker(endDate);
    });
    endDate.addEventListener("focus", () => this._showPicker(endDate));
    endDate.addEventListener("change", () => {
      this._current.endDate = endDate.value;
      const s = this._parseDateOnly(this._current.startDate);
      const ed = this._parseDateOnly(this._current.endDate);
      if (s && ed && ed < s) {
        this._current.endDate = this._current.startDate;
        endDate.value = this._current.endDate;
      }
    });
    endDateRow.appendChild(endDate);

    const hint = document.createElement("div");
    hint.className = "haHint";
    hint.textContent = "End date is inclusive.";

    alldayWrap.append(startDateRow, endDateRow, hint);

    // Notes row
    const descRow = this._rowBase("Notes", "ha_desc");
    const desc = document.createElement("textarea");
    desc.id = "ha_desc";
    desc.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this._setActiveField("ha_desc");
    });
    desc.addEventListener("input", () => {
      this._current.description = desc.value;
      this._syncKeyboardToActive();
    });
    descRow.appendChild(desc);

    // Keyboard container
    const kbWrap = document.createElement("div");
    kbWrap.className = "haKbWrap";
    const kb = document.createElement("div");
    kb.className = "simple-keyboard";
    kbWrap.appendChild(kb);

    // Buttons
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

    form.append(summaryRow, allDayRow, timedWrap, alldayWrap, descRow, kbWrap, btnBar);

    modal.append(title, form);
    overlay.appendChild(modal);
    root.appendChild(overlay);
    this._portal.appendChild(root);

    this._refs = {
      overlay,
      modal,
      summary,
      desc,
      allDayToggle,
      timedWrap,
      alldayWrap,
      startDT,
      endDT,
      startDate,
      endDate,
      kbEl: kb
    };

    setTimeout(() => {
      this._initKeyboardIfNeeded();
      this._syncUIFromState();
      this._applyKeyboardCaseMode(true);
      this._syncKeyboardToActive();
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

  _showPicker(inputEl) {
    if (!inputEl) return;
    try {
      if (typeof inputEl.showPicker === "function") {
        inputEl.showPicker();
      } else {
        inputEl.focus({ preventScroll: true });
      }
    } catch (e) {
      try {
        inputEl.focus({ preventScroll: true });
      } catch (err) {}
    }
  },

  _setActiveField(id) {
    this._activeField = id;
    const el = document.getElementById(id);
    if (el) el.focus({ preventScroll: true });

    // First-letter-only caps on field switch
    this._autoCapNext = true;
    this._shiftOneShot = false;
    this._pendingOneShotReset = false;

    this._applyKeyboardCaseMode(true);
    this._syncKeyboardToActive();
  },

  _initKeyboardIfNeeded() {
    if (this._keyboard) return;

    const ctor = window.SimpleKeyboard && window.SimpleKeyboard.default;
    if (typeof ctor !== "function") return;

    const kbEl = this._refs.kbEl;
    if (!kbEl) return;

    this._keyboard = new ctor(kbEl, {
      // This is the key fix, keep our theme class even if the library manages classes
      theme: "hg-theme-default haKbTheme",
      onChange: (input) => this._onKbChange(input),
      onKeyPress: (btn) => this._onKbKeyPress(btn),
      layout: {
        default: [
          "1 2 3 4 5 6 7 8 9 0 {bksp}",
          "q w e r t y u i o p",
          "a s d f g h j k l",
          "{caps} z x c v b n m {shift}",
          "{space} {clear} {enter}"
        ],
        shift: [
          "! @ # $ % ^ & * ( ) {bksp}",
          "Q W E R T Y U I O P",
          "A S D F G H J K L",
          "{caps} Z X C V B N M {shift}",
          "{space} {clear} {enter}"
        ]
      },
      display: {
        "{bksp}": "⌫",
        "{enter}": "Enter",
        "{shift}": "Shift",
        "{caps}": "Caps",
        "{space}": "Space",
        "{clear}": "Clear"
      }
    });

    // Extra insurance
    kbEl.classList.add("haKbTheme");
  },

  _applyKeyboardCaseMode(force) {
    if (!this._keyboard) return;

    const wantUpper = !!this._capsLock || !!this._autoCapNext;
    const target = wantUpper ? "shift" : "default";

    if (force) {
      this._keyboard.setOptions({ layoutName: target });
      return;
    }

    const current = this._keyboard.options.layoutName || "default";
    if (current !== target) this._keyboard.setOptions({ layoutName: target });
  },

  _syncKeyboardToActive() {
    if (!this._keyboard) return;

    const id = this._activeField;
    const el = document.getElementById(id);
    if (!el) return;

    const v = el.value || "";
    this._keyboard.setInput(v);

    if (v.length > 0) {
      this._autoCapNext = false;
      this._applyKeyboardCaseMode(true);
    }
  },

  _onKbChange(input) {
    const id = this._activeField;
    if (!id) return;

    const el = document.getElementById(id);
    if (!el) return;

    const before = el.value || "";
    el.value = input;
    el.dispatchEvent(new Event("input", { bubbles: true }));

    // First-letter-only caps: once first char lands, drop autoCapNext
    if (this._autoCapNext) {
      if (before.length === 0 && input.length >= 1) {
        this._autoCapNext = false;
        this._applyKeyboardCaseMode(true);
      }
    }

    // One-shot shift reset
    if (this._pendingOneShotReset) {
      this._pendingOneShotReset = false;
      this._shiftOneShot = false;
      this._applyKeyboardCaseMode(true);
    }
  },

  _onKbKeyPress(btn) {
    if (btn === "{caps}") {
  this._capsLock = !this._capsLock;

  // Tell SimpleKeyboard to visually toggle Caps
  this._keyboard.setOptions({
    buttonTheme: [
      {
        class: "hg-activeButton",
        buttons: "{caps}",
        enabled: this._capsLock
      }
    ]
  });

  this._shiftOneShot = false;
  this._pendingOneShotReset = false;
  this._applyKeyboardCaseMode(true);
  return;
}
    }

    if (btn === "{shift}") {
      const current = this._keyboard.options.layoutName || "default";
      const temp = current === "default" ? "shift" : "default";
      this._keyboard.setOptions({ layoutName: temp });

      this._shiftOneShot = true;
      this._pendingOneShotReset = false;
      return;
    }

    if (btn === "{clear}") {
      this._keyboard.clearInput();
      this._autoCapNext = true;
      this._applyKeyboardCaseMode(true);
      return;
    }

    if (btn === "{enter}") {
      if (this._activeField === "ha_summary") this._setActiveField("ha_desc");
      return;
    }

    if (this._shiftOneShot) this._pendingOneShotReset = true;
  },

  _syncUIFromState() {
    if (!this._refs || !this._refs.summary) return;

    this._refs.summary.value = this._current.summary || "";
    this._refs.desc.value = this._current.description || "";

    this._refs.allDayToggle.checked = !!this._current.allDay;

    this._refs.startDT.value = this._current.startDT || "";
    this._refs.endDT.value = this._current.endDT || "";

    this._refs.startDate.value = this._current.startDate || "";
    this._refs.endDate.value = this._current.endDate || "";

    this._refs.timedWrap.style.display = this._current.allDay ? "none" : "block";
    this._refs.alldayWrap.style.display = this._current.allDay ? "block" : "none";
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
