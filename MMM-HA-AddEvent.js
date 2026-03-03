/* global Module */

Module.register("MMM-HA-AddEvent", {
  defaults: {
    buttonText: "Add Event",
    keyboardKey: "MMM-HA-AddEvent",
    keyboardStyle: "default",
  },

  start() {
    this._visible = false;

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
      endDate: "",
    };

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
    row.className = "haAddRow";

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

  _hideKeyboard() {
    this._activeTargetId = null;

    // Broad compatibility across forks
    this.sendNotification("KEYBOARD_HIDE");
    this.sendNotification("HIDE_KEYBOARD");
    this.sendNotification("CLOSE_KEYBOARD");
    this.sendNotification("KEYBOARD", { key: this.config.keyboardKey, action: "hide" });
  },

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

    const desired = this._caretPos[targetId];
    const caret =
      typeof desired === "number"
        ? Math.min(desired, nextValue.length)
        : nextValue.length;

    el.value = nextValue;
    el.dispatchEvent(new Event("input", { bubbles: true }));

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
    const now = new Date();
    now.setSeconds(0, 0);
    const mins = now.getMinutes();
    const rounded = Math.ceil(mins / 5) * 5;
    now.setMinutes(rounded);

    const end = new Date(now.getTime() + 30 * 60 * 1000);

    const dateOnly = this._toDateOnly(now);

    this._current = {
      summary: "",
      description: "",
      start: this._toDateTimeLocal(now),
      end: this._toDateTimeLocal(end),
      allDay: false,
      date: dateOnly,
      endDate: dateOnly,
    };

    this._visible = true;
    this._renderPortal();

    setTimeout(() => {
      const el = document.getElementById("ha_summary");
      if (el) el.focus();
    }, 0);
  },

  close() {
    // Hide keyboard BEFORE tearing down DOM so the keyboard module doesn't lose context
    this._hideKeyboard();

    this._visible = false;
    this._renderPortal();
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

  _addDaysDateOnly(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + days);
    return this._toDateOnly(d);
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
      if (e.target === overlay) this.close();
    };

    const modal = document.createElement("div");
    modal.className = "haModal";

    // Hide keyboard when tapping anything in the modal that is not Title/Notes
    modal.addEventListener("pointerdown", (e) => {
      const t = e.target;
      const isTextField =
        t &&
        ((t.tagName === "INPUT" && t.type === "text") ||
          t.tagName === "TEXTAREA");
      if (!isTextField) this._hideKeyboard();
    });

    const title = document.createElement("div");
    title.className = "haTitle";
    title.textContent = "Add Family Event";

    const form = document.createElement("div");

    form.appendChild(
      this._row("Title", "text", "ha_summary", this._current.summary, true)
    );

    form.appendChild(this._allDayRow());

    if (this._current.allDay) {
      // Multi-day all-day: Start Date + End Date (inclusive UI, exclusive API)
      form.appendChild(
        this._row("Start Date", "date", "ha_date", this._current.date, false)
      );
      form.appendChild(
        this._row("End Date", "date", "ha_endDate", this._current.endDate, false)
      );
    } else {
      form.appendChild(
        this._row("Start", "datetime-local", "ha_start", this._current.start, false)
      );
      form.appendChild(
        this._row("End", "datetime-local", "ha_end", this._current.end, false)
      );
    }

    form.appendChild(
      this._rowTextArea("Notes", "ha_desc", this._current.description, true)
    );

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

      if (this._current.allDay) {
        const d = new Date(this._current.start);
        const dateOnly = !isNaN(d.getTime()) ? this._toDateOnly(d) : this._current.date;
        this._current.date = dateOnly || this._toDateOnly(new Date());
        this._current.endDate = this._current.endDate || this._current.date;
        this._hideKeyboard();
      }

      this._renderPortal();
    };

    const label = document.createElement("div");
    label.className = "haInlineLabel";
    label.textContent = "All Day Event";
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
      if (id === "ha_endDate") this._current.endDate = input.value;
    });

    const saveCaret = () => {
      if (typeof input.selectionStart === "number") {
        this._caretPos[id] = input.selectionStart;
      }
    };
    input.addEventListener("pointerup", () => setTimeout(saveCaret, 0));
    input.addEventListener("click", () => setTimeout(saveCaret, 0));
    input.addEventListener("keyup", saveCaret);
    input.addEventListener("select", saveCaret);

    if (useKeyboard && type === "text") {
      input.addEventListener("focus", () => this._openKeyboardForTarget(id, "default"));
      input.addEventListener("blur", () => {
        setTimeout(() => {
          const ae = document.activeElement;
          const stillText =
            ae &&
            ((ae.tagName === "INPUT" && ae.type === "text") ||
              ae.tagName === "TEXTAREA");
          if (!stillText) this._hideKeyboard();
        }, 60);
      });
    }

    if (type === "datetime-local" || type === "date") {
      const show = () => {
        this._hideKeyboard();
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

    const saveCaret = () => {
      if (typeof ta.selectionStart === "number") {
        this._caretPos[id] = ta.selectionStart;
      }
    };
    ta.addEventListener("pointerup", () => setTimeout(saveCaret, 0));
    ta.addEventListener("click", () => setTimeout(saveCaret, 0));
    ta.addEventListener("keyup", saveCaret);
    ta.addEventListener("select", saveCaret);

    if (useKeyboard) {
      ta.addEventListener("focus", () => this._openKeyboardForTarget(id, "default"));
      ta.addEventListener("blur", () => {
        setTimeout(() => {
          const ae = document.activeElement;
          const stillText =
            ae &&
            ((ae.tagName === "INPUT" && ae.type === "text") ||
              ae.tagName === "TEXTAREA");
          if (!stillText) this._hideKeyboard();
        }, 60);
      });
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
      const start_date = this._current.date;
      const endDateInclusive = this._current.endDate || start_date;

      if (!start_date) {
        alert("Please choose a start date.");
        return;
      }

      // Ensure end >= start
      const startD = new Date(`${start_date}T00:00:00`);
      const endD = new Date(`${endDateInclusive}T00:00:00`);
      if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || endD < startD) {
        alert("End date must be the same or after start date.");
        return;
      }

      // HA expects end_date exclusive, so add 1 day to the inclusive end date
      const end_date = this._addDaysDateOnly(endDateInclusive, 1);

      this.sendSocketNotification("CREATE_EVENT", {
        summary,
        description,
        start_date,
        end_date,
      });

      this.close();
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
      description,
      start_date_time: new Date(this._current.start).toISOString(),
      end_date_time: new Date(this._current.end).toISOString(),
    });

    this.close();
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "RESULT") return;

    if (payload.ok) {
      // already closed on submit, but harmless
      this._hideKeyboard();
    } else {
      alert(`Failed: ${payload.error || "unknown error"}`);
    }
  },
});
