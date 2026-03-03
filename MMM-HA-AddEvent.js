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
    this._capsLock = false;
    this._shiftOneShot = false;
    this._pendingOneShotReset = false;
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

    row.appendChild(btn);
    wrap.appendChild(row);
    return wrap;
  },

  open() {
    this._current = this._defaultState();
    this._visible = true;
    this._activeField = "ha_summary";

    this._capsLock = false;
    this._shiftOneShot = false;
    this._autoCapNext = true;

    this._applyVisibility();
    this._syncUIFromState();

    setTimeout(() => {
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
    now.setMinutes(Math.ceil(now.getMinutes() / round) * round);

    const duration = Math.max(5, Number(this.config.defaultDurationMinutes) || 30);
    const end = new Date(now.getTime() + duration * 60000);

    return {
      summary: "",
      description: "",
      allDay: false,
      startDT: this._toDateTimeLocal(now),
      endDT: this._toDateTimeLocal(end),
      startDate: this._toDateOnly(now),
      endDate: this._toDateOnly(now)
    };
  },

  _pad(x) {
    return String(x).padStart(2, "0");
  },

  _toDateTimeLocal(d) {
    return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())}T${this._pad(d.getHours())}:${this._pad(d.getMinutes())}`;
  },

  _toDateOnly(d) {
    return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())}`;
  },

  _buildOnce() {
    this._portal.innerHTML = "";

    const root = document.createElement("div");
    root.className = "haEventAddRoot";

    const overlay = document.createElement("div");
    overlay.className = "haOverlay";
    overlay.addEventListener("pointerdown", e => {
      if (e.target === overlay) this.close();
    });

    const modal = document.createElement("div");
    modal.className = "haModal";

    const title = document.createElement("div");
    title.className = "haTitle";
    title.textContent = this.config.calendarTitle;

    const form = document.createElement("div");

    const summary = document.createElement("input");
    summary.id = "ha_summary";
    summary.type = "text";
    summary.addEventListener("pointerdown", () => this._setActiveField("ha_summary"));
    summary.addEventListener("input", () => {
      this._current.summary = summary.value;
    });

    const desc = document.createElement("textarea");
    desc.id = "ha_desc";
    desc.addEventListener("pointerdown", () => this._setActiveField("ha_desc"));
    desc.addEventListener("input", () => {
      this._current.description = desc.value;
    });

    const kbWrap = document.createElement("div");
    kbWrap.className = "haKbWrap";

    const kb = document.createElement("div");
    kb.className = "simple-keyboard";
    kbWrap.appendChild(kb);

    form.append(summary, desc, kbWrap);

    modal.append(title, form);
    overlay.appendChild(modal);
    root.appendChild(overlay);
    this._portal.appendChild(root);

    this._refs = { summary, desc, kbEl: kb };
  },

  _setActiveField(id) {
    this._activeField = id;
    this._autoCapNext = true;
    this._shiftOneShot = false;
    this._pendingOneShotReset = false;
    this._applyKeyboardCaseMode(true);
    this._syncKeyboardToActive();
  },

  _initKeyboardIfNeeded() {
    if (this._keyboard) return;

    const ctor = window.SimpleKeyboard && window.SimpleKeyboard.default;
    if (!ctor) return;

    this._keyboard = new ctor(this._refs.kbEl, {
      theme: "hg-theme-default haKbTheme",
      onChange: input => this._onKbChange(input),
      onKeyPress: btn => this._onKbKeyPress(btn),
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

    this._keyboard.setOptions({
      buttonTheme: this._capsLock ? [{ class: "hg-activeButton", buttons: "{caps}" }] : []
    });
  },

  _applyKeyboardCaseMode(force) {
    if (!this._keyboard) return;

    const wantUpper = this._capsLock || this._autoCapNext;
    const layoutName = wantUpper ? "shift" : "default";

    this._keyboard.setOptions({ layoutName });
  },

  _syncKeyboardToActive() {
    if (!this._keyboard) return;

    const el = document.getElementById(this._activeField);
    if (!el) return;

    this._keyboard.setInput(el.value || "");
  },

  _onKbChange(input) {
    const el = document.getElementById(this._activeField);
    if (!el) return;

    const before = el.value;
    el.value = input;
    el.dispatchEvent(new Event("input", { bubbles: true }));

    if (this._autoCapNext && before.length === 0 && input.length > 0) {
      this._autoCapNext = false;
      this._applyKeyboardCaseMode(true);
    }

    if (this._pendingOneShotReset) {
      this._pendingOneShotReset = false;
      this._shiftOneShot = false;
      this._applyKeyboardCaseMode(true);
    }
  },

  _onKbKeyPress(btn) {
    if (!this._keyboard) return;

    if (btn === "{caps}") {
      this._capsLock = !this._capsLock;

      this._keyboard.setOptions({
        buttonTheme: this._capsLock
          ? [{ class: "hg-activeButton", buttons: "{caps}" }]
          : []
      });

      this._shiftOneShot = false;
      this._pendingOneShotReset = false;
      this._applyKeyboardCaseMode(true);
      return;
    }

    if (btn === "{shift}") {
      const current = this._keyboard.options.layoutName || "default";
      this._keyboard.setOptions({
        layoutName: current === "default" ? "shift" : "default"
      });

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
      if (this._activeField === "ha_summary")
        this._setActiveField("ha_desc");
      return;
    }

    if (this._shiftOneShot)
      this._pendingOneShotReset = true;
  }
});
