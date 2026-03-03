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

    this._portal = document.getElementById("HA_EVENTADD_PORTAL");
    if (!this._portal) {
      this._portal = document.createElement("div");
      this._portal.id = "HA_EVENTADD_PORTAL";
      document.body.appendChild(this._portal);
    }

    this._activeTargetId = null;
    this._current = {
      summary: "",
      description: "",
      start: "",
      end: "",
    };

    this.sendSocketNotification("CONFIG", this.config);
    this._renderPortal();
  },

  getStyles() {
    return ["MMM-HA-AddEvent.css"];
  },

  getDom() {
    const wrap = document.createElement("div");
    const btn = document.createElement("button");
    btn.innerText = this.config.buttonText || "Add Event";
    btn.style.cursor = "pointer";
    btn.onclick = () => this.open();
    wrap.appendChild(btn);
    return wrap;
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

    const wasFocused = document.activeElement === el;

    // Use last known caret for this field, otherwise end
    const desired = this._caretPos[targetId];
    const nextValue = String(message);
    const caret =
      typeof desired === "number"
        ? Math.min(desired, nextValue.length)
        : nextValue.length;

    el.value = nextValue;
    el.dispatchEvent(new Event("input", { bubbles: true }));

    if (wasFocused) {
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

    this._current = {
      summary: "",
      description: "",
      start: this._toDateTimeLocal(now),
      end: this._toDateTimeLocal(end),
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
    this.sendNotification("KEYBOARD_HIDE");
    this.sendNotification("HIDE_KEYBOARD");
    this.sendNotification("CLOSE_KEYBOARD");
  },

  _toDateTimeLocal(d) {
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

    const title = document.createElement("div");
    title.className = "haTitle";
    title.textContent = "Add Family Event";

    const form = document.createElement("div");

    form.appendChild(
      this._row("Title", "text", "ha_summary", this._current.summary, true)
    );
    form.appendChild(
      this._row("Start", "datetime-local", "ha_start", this._current.start, false)
    );
    form.appendChild(
      this._row("End", "datetime-local", "ha_end", this._current.end, false)
    );
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
    });

    // Track caret so KEYBOARD_INPUT updates don't force editing only at end
    const saveCaret = () => {
      if (typeof input.selectionStart === "number") {
        this._caretPos[id] = input.selectionStart;
      }
    };
    input.addEventListener("click", saveCaret);
    input.addEventListener("keyup", saveCaret);
    input.addEventListener("select", saveCaret);
    input.addEventListener("pointerup", saveCaret);

    // Keyboard for text
    if (useKeyboard && type === "text") {
      input.addEventListener("focus", () => this._openKeyboardForTarget(id, "default"));
    }

    // Open native picker immediately for datetime-local, and hide the right-side icon via CSS
    if (type === "datetime-local") {
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
    ta.addEventListener("click", saveCaret);
    ta.addEventListener("keyup", saveCaret);
    ta.addEventListener("select", saveCaret);
    ta.addEventListener("pointerup", saveCaret);

    if (useKeyboard) {
      ta.addEventListener("focus", () => this._openKeyboardForTarget(id, "default"));
    }

    row.append(l, ta);
    return row;
  },

  _submit() {
    const start = new Date(this._current.start);
    const end = new Date(this._current.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      alert("End time must be after start time.");
      return;
    }

    this.sendSocketNotification("CREATE_EVENT", {
      summary: this._current.summary.trim(),
      start_date_time: new Date(this._current.start).toISOString(),
      end_date_time: new Date(this._current.end).toISOString(),
      description: this._current.description.trim(),
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
