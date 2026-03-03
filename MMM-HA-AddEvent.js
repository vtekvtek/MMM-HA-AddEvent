/* global Module */

Module.register("MMM-HA-AddEvent", {
  defaults: {
    buttonText: "Add Event",
    calendarTitle: "Add Family Event",

    // MMM-Keyboard (lavolp3) integration
    keyboardKey: "MMM-HA-AddEvent",
    keyboardStyle: "default", // keep "default" for text entry

    // UI defaults
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

    this._activeTargetId = null;
    this._keyboardOpenFor = null;

    this._current = this._blankState();

    this.sendSocketNotification("CONFIG", this.config);
    this._renderPortal();
  },

  getStyles() {
    return ["MMM-HA-AddEvent.css"];
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

  notificationReceived(notification, payload) {
    if (notification !== "KEYBOARD_INPUT") return;
    if (!payload || payload.key !== this.config.keyboardKey) return;

    const targetId = payload.data && payload.data.targetId ? payload.data.targetId : this._activeTargetId;
    const message = payload.message != null ? String(payload.message) : "";

    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (!el) return;

    el.value = message;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },

  open() {
    this._current = this._defaultState();
    this._visible = true;
    this._activeTargetId = null;
    this._keyboardOpenFor = null;

    this._renderPortal();

    setTimeout(() => {
      const el = document.getElementById("ha_summary");
      if (el) el.focus({ preventScroll: true });
    }, 0);
  },

  close() {
    this._visible = false;
    this._activeTargetId = null;
    this._keyboardOpenFor = null;

    this._forceHideMMMKeyboard();
    this._renderPortal();
  },

  _blankState() {
    return {
      summary: "",
      description: "",
      allDay: false,

      // timed mode
      startDT: "",
      endDT: "",

      // all-day mode (date-only)
      startDate: "",
      endDate: ""
    };
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
    // expects YYYY-MM-DD
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ""));
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const da = Number(m[3]);
    const dt = new Date(y, mo, da, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  },

  _addDaysDateOnly(dateStr, days) {
    const dt = this._parseDateOnly(dateStr);
    if (!dt) return "";
    dt.setDate(dt.getDate() + Number(days || 0));
    return this._toDateOnly(dt);
  },

  _openKeyboardForTarget(targetId) {
    if (!targetId) return;

    // prevent reopen loops if keyboard already opened for this field
    if (this._keyboardOpenFor === targetId) return;

    this._activeTargetId = targetId;
    this._keyboardOpenFor = targetId;

    this.sendNotification("KEYBOARD", {
      key: this.config.keyboardKey,
      style: "default",
      data: { targetId }
    });

    // After opening once, allow re-open later if user taps again (not per keystroke)
    setTimeout(() => {
      if (this._keyboardOpenFor === targetId) this._keyboardOpenFor = null;
    }, 250);
  },

  _forceHideMMMKeyboard() {
    // MMM-Keyboard doesn't expose a hide notification. It hides by removing this class.
    const kbContainer = document.querySelector(".kbContainer");
    if (kbContainer) kbContainer.classList.remove("show-keyboard");

    const inputDiv = document.getElementById("inputDiv");
    if (inputDiv) inputDiv.style.display = "none";

    const kbInput = document.getElementById("kbInput");
    if (kbInput) kbInput.value = "";
  },

  _renderPortal() {
    if (!this._portal) return;

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

    // Title
    form.appendChild(this._rowText("Title", "ha_summary", this._current.summary));

    // All-day toggle
    form.appendChild(this._rowAllDayToggle());

    // Time/date rows depend on allDay
    if (this._current.allDay) {
      form.appendChild(this._rowDate("Start Date", "ha_start_date", this._current.startDate));
      form.appendChild(this._rowDate("End Date", "ha_end_date", this._current.endDate));
      const hint = document.createElement("div");
      hint.className = "haHint";
      hint.textContent = "All-day end date is inclusive here.";
      form.appendChild(hint);
    } else {
      form.appendChild(this._rowDateTime("Start", "ha_start_dt", this._current.startDT));
      form.appendChild(this._rowDateTime("End", "ha_end_dt", this._current.endDT));
    }

    // Notes
    form.appendChild(this._rowTextArea("Notes", "ha_desc", this._current.description));

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

  _rowText(label, id, value) {
    const row = this._rowBase(label, id);

    const input = document.createElement("input");
    input.type = "text";
    input.id = id;
    input.value = value || "";

    // Tap to open MMM-Keyboard
    input.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._openKeyboardForTarget(id);
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
      this._openKeyboardForTarget(id);
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
      this._forceHideMMMKeyboard();

      this._current.allDay = !!toggle.checked;

      // When switching on all-day, derive dates from current startDT
      if (this._current.allDay) {
        const base = this._current.startDT ? String(this._current.startDT).split("T")[0] : this._toDateOnly(new Date());
        this._current.startDate = base;
        this._current.endDate = base;
      } else {
        // Switching back to timed: default start/end based on now
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

    // Let native picker handle this in Electron touch, do not open MMM-Keyboard
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

        // keep end >= start
        const s = this._parseDateOnly(this._current.startDate);
        const e = this._parseDateOnly(this._current.endDate);
        if (s && e && e < s) {
          this._current.endDate = this._current.startDate;
        }
        this._renderPortal();
      }
      if (id === "ha_end_date") {
        this._current.endDate = input.value;

        const s = this._parseDateOnly(this._current.startDate);
        const e = this._parseDateOnly(this._current.endDate);
        if (s && e && e < s) {
          this._current.endDate = this._current.startDate;
        }
        this._renderPortal();
      }
    });

    row.appendChild(input);
    return row;
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

      // HA expects end_date to be exclusive, so add 1 day to inclusive UI endDate
      const endExclusive = this._addDaysDateOnly(this._current.endDate, 1);

      this.sendSocketNotification("CREATE_EVENT", {
        allDay: true,
        summary,
        description,
        start_date: this._current.startDate,
        end_date: endExclusive
      });

      this._forceHideMMMKeyboard();
      return;
    }

    // Timed event
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

    this._forceHideMMMKeyboard();
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
