/* global Module */

Module.register("MMM-HA-AddEvent", {
  defaults: {
    buttonText: "Add Event",
    keyboardKey: "MMM-HA-AddEvent",
    keyboardStyle: "default",
  },

  start() {
    this._visible = false;

    // Track caret positions per input so keyboard updates don't force cursor to the end
    this._caretPos = {};
    this._activeTargetId = null;

    this._portal = document.getElementById("HA_EVENTADD_PORTAL");
    if (!this._portal) {
      this._portal = document.createElement("div");
      this._portal.id = "HA_EVENTADD_PORTAL";
      document.body.appendChild(this._portal);
    }

    this._current = {
      summary: "",
      description: "",
      start: "",
      end: "",
      allDay: false,
      date: "",
    };

    this.sendSocketNotification("CONFIG", this.config);
    this._renderPortal();
  },

  getStyles() {
    return ["MMM-HA-AddEvent.css"];
  },

  // Card-style button, whole thing clickable
  getDom() {
    const wrap = document.createElement("div");
    wrap.className = "haAddWrap";

    const row = document.createElement("div");
    row.className = "haAddRow isAccent";

    const inner = document.createElement("div");
    inner.className = "haAddButton";
    inner.onclick = () => this.open();

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
    hint.textContent = "Tap to create";

    right.appendChild(hint);

    inner.append(left, right);
    row.appendChild(inner);
    wrap.appendChild(row);

    return wrap;
  },

  // MMM-Keyboard integration
  _openKeyboardForTarget(targetId, styleOverride) {
    this._activeTargetId = targetId;
    this.sendNotification("KEYBOARD", {
      key: this.config.keyboardKey,
      style: styleOverride || this.config.keyboardStyle,
      data: { targetId },
    });
  },

  notificationReceived(notification, payload) {
    if (notification !== "KEYBOARD_INPUT") return;
    if (!payload || payload.key !== this.config.keyboardKey) return;

    const targetId = payload.data?.targetId;
    const message = payload.message ?? "";
    if (!targetId) return;

    const el = document.getElementById(targetId);
    if (!el) return;

    const nextValue = String(message);

    // Use last known caret for this field, otherwise end
    const desired = this._caretPos[targetId];
    const caret =
      typeof desired === "number"
        ? Math.min(desired, nextValue.length)
        : nextValue.length;

    el.value = nextValue;
    el.dispatchEvent(new Event("input", { bubbles: true }));

    // Always refocus/restore caret for the active target, keyboard can blur inputs
    if (this._activeTargetId === targetId) {
      requestAnimationFrame(() => {
        try {
          el.focus();
          if (typeof el.setSelectionRange === "function") {
            el.setSelectionRange(caret, caret);
          }
        } catch (e) {}
      });
    }
  },

  open() {
    // Default start/end to "now + 30" in local time, rounded to next 5 min
    const now = new Date();
    now.setSeconds(0, 0);
    const mins = now.getMinutes();
    const rounded = Math.ceil(mins / 5) * 5;
    now.setMinutes(rounded);

    const end = new Date(now.getTime() + 30 * 60 * 1000);

    this._current = {
      summary: "",
      description: "",
      start: this._toDateTimeLocal(now),
      end: this._toDateTimeLocal(end),
      allDay: false,
      date: this._toDateOnly(now),
    };

    this._visible = true;
    this._renderPortal();

    setTimeout(() => {
      const el = document.getElementById("ha_summary");
      if (el) el.focus();
    }, 0);
  },

  close() {
    this._visible = false;
    this._activeTargetId = null;
    this._renderPortal();

    // Try common hide notifications, different keyboard forks use different ones
    this.sendNotification("KEYBOARD_HIDE");
    this.sendNotification("HIDE_KEYBOARD");
    this.sendNotification("CLOSE_KEYBOARD");
  },

  _pad(x) {
    return String(x).padStart(2, "0");
  },

  _toDateTimeLocal(d) {
    return `${d.getFullYear()}-${this._pad(d.getMonth() + 1)}-${this._pad(
      d.getDate()
    )}T${this._pad(d.getHours())}:${this._pad(d.getMinutes())}`;
  },

  _toDateOnly(d) {
    return `${d.getFullYear()}-${this._pad(d.getMonth() + 1)}-${this._pad(
      d.getDate()
    )}`;
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
    overlay.onclick = (e) => {
      // click outside modal closes
      if (e.target === overlay) this.close();
    };

    const modal = document.createElement("div");
    modal.className = "haModal";

    const title = document.createElement("div");
    title.className = "haTitle";
    title.textContent = "Add Family Event";

    const form = document.createElement("div");

    form.appendChild(this._row("Title", "text", "ha_summary", this._current.summary, true));
    form.appendChild(this._allDayRow());

    if (this._current.allDay) {
      form.appendChild(this._row("Date", "date", "ha_date", this._current.date, false));
    } else {
      form.appendChild(this._row("Start", "datetime-local", "ha_start", this._current.start, false));
      form.appendChild(this._row("End", "datetime-local", "ha_end", this._current.end, false));
    }

    form.appendChild(this._rowTextArea("Notes", "ha_desc", this._current.description, true));

    const btnBar = document.createElement("div");
    btnBar.className = "haButtons";

    const cancel = document.createElement("button");
    cancel.className = "haBtn cancel";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = () => this.close();

    const save = document.createElement("button");
    save.className = "haBtn save";
    save.type = "button";
    save.textContent = "Save";
    save.onclick = () => this._submit();

    btnBar.append(cancel, save);
    form.appendChild(btnBar);

    modal.append(title, form);
    overlay.appendChild(modal);
    root.appendChild(overlay);

    this._portal.appendChild(root);
  },

  _allDayRow() {
    const row = document.createElement("div");
    row.className = "haRowInline";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "haCheck";
    cb.checked = !!this._current.allDay;

    cb.onchange = () => {
      this._current.allDay = cb.checked;

      // Keep date in sync with current start if switching to all-day
      if (this._current.allDay) {
        const d = new Date(this._current.start);
        if (!isNaN(d.getTime())) this._current.date = this._toDateOnly(d);
      }

      this._renderPortal();
    };

    const label = document.createElement("div");
    label.className = "haInlineLabel";
    label.textContent = "All Day Event";

    // Make label tappable too
    label.onclick = () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    };

    row.append(cb, label);
    return row;
  },

  _row(label, type, id, value, useKeyboard) {
    const row = document.createElement("div");
    row.className = "haRow";

    const l = document.createElement("label");
    l.textContent = label;
    l.htmlFor = id;

    const input = document.createElement("input");
    input.type = type;
    input.id = id;
    input.value = value || "";

    input.addEventListener("input", () => {
      if (id === "ha_summary") this._current.summary = input.value;
      if (id === "ha_start") this._current.start = input.value;
      if (id === "ha_end") this._current.end = input.value;
      if (id === "ha_date") this._current.date = input.value;
    });

    // Track caret so KEYBOARD_INPUT updates don't force editing only at end
    const saveCaret = () => {
      if (typeof input.selectionStart === "number") {
        this._caretPos[id] = input.selectionStart;
      }
    };

    input.addEventListener("pointerup", () => setTimeout(saveCaret, 0));
    input.addEventListener("click", () => setTimeout(saveCaret, 0));
    input.addEventListener("keyup", saveCaret);
    input.addEventListener("select", saveCaret);
    input.addEventListener("focus", () => setTimeout(saveCaret, 0));

    // Keyboard for text
    if (useKeyboard && type === "text") {
      input.addEventListener("focus", () => this._openKeyboardForTarget(id, "default"));
    }

    // Open native picker immediately for date/datetime-local
    if (type === "datetime-local" || type === "date") {
      const show = () => {
        if (typeof input.showPicker === "function") input.showPicker();
      };
      input.addEventListener("pointerdown", show);
      input.addEventListener("focus", show);
    }

    row.append(l, input);
    return row;
  },

  _rowTextArea(label, id, value, useKeyboard) {
    const row = document.createElement("div");
    row.className = "haRow";

    const l = document.createElement("label");
    l.textContent = label;
    l.htmlFor = id;

    const ta = document.createElement("textarea");
    ta.id = id;
    ta.value = value || "";

    ta.addEventListener("input", () => {
      this._current.description = ta.value;
    });

    // Track caret
    const saveCaret = () => {
      if (typeof ta.selectionStart === "number") {
        this._caretPos[id] = ta.selectionStart;
      }
    };

    ta.addEventListener("pointerup", () => setTimeout(saveCaret, 0));
    ta.addEventListener("click", () => setTimeout(saveCaret, 0));
    ta.addEventListener("keyup", saveCaret);
    ta.addEventListener("select", saveCaret);
    ta.addEventListener("focus", () => setTimeout(saveCaret, 0));

    if (useKeyboard) {
      ta.addEventListener("focus", () => this._openKeyboardForTarget(id, "default"));
    }

    row.append(l, ta);
    return row;
  },

  _submit() {
    const summary = this._current.summary.trim();
    const description = this._current.description.trim();

    if (!summary) {
      alert("Please enter a title.");
      return;
    }

    if (this._current.allDay) {
      const date = this._current.date;
      if (!date) {
        alert("Please choose a date.");
        return;
      }

      // All-day: midnight to next midnight (local), HA gets ISO UTC
      const startLocal = new Date(`${date}T00:00:00`);
      const endLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

      this.sendSocketNotification("CREATE_EVENT", {
        summary,
        start_date_time: startLocal.toISOString(),
        end_date_time: endLocal.toISOString(),
        description,
      });
      return;
    }

    const start = new Date(this._current.start);
    const end = new Date(this._current.end);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      alert("End time must be after start time.");
      return;
    }

    this.sendSocketNotification("CREATE_EVENT", {
      summary,
      start_date_time: new Date(this._current.start).toISOString(),
      end_date_time: new Date(this._current.end).toISOString(),
      description,
    });
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "RESULT") return;

    if (payload.ok) {
      this.close();
    } else {
      alert(`Failed: ${payload.error || "unknown error"}`);
    }
  },
});
