Module.register("MMM-HA-AddEvent", {
  defaults: {
    buttonText: "Add Event"
  },

  start() {
    this.open = false;
    this.status = "";
    this.sendSocketNotification("CONFIG", this.config);
  },

  getDom() {
    const wrap = document.createElement("div");

    const btn = document.createElement("button");
    btn.innerText = this.open ? "Cancel" : (this.config.buttonText || "Add Event");
    btn.style.cursor = "pointer";
    btn.onclick = () => {
      this.open = !this.open;
      this.status = "";
      this.updateDom();
    };
    wrap.appendChild(btn);

    if (this.open) {
      const box = document.createElement("div");
      box.style.marginTop = "10px";

      const make = (ph) => {
        const i = document.createElement("input");
        i.type = "text";
        i.placeholder = ph;
        i.style.display = "block";
        i.style.marginTop = "6px";
        i.style.width = "280px";
        return i;
      };

      const summary = make("Title, ex: Dentist");
      const date = make("Date, YYYY-MM-DD");
      const start = make("Start, HH:MM (24h)");
      const end = make("End, HH:MM (24h)");
      const desc = make("Notes (optional)");

      box.appendChild(summary);
      box.appendChild(date);
      box.appendChild(start);
      box.appendChild(end);
      box.appendChild(desc);

      const submit = document.createElement("button");
      submit.innerText = "Create";
      submit.style.marginTop = "10px";
      submit.onclick = () => {
        this.status = "Sending…";
        this.updateDom();
        this.sendSocketNotification("CREATE_EVENT", {
          summary: summary.value.trim(),
          date: date.value.trim(),
          start: start.value.trim(),
          end: end.value.trim(),
          description: desc.value.trim()
        });
      };

      box.appendChild(submit);
      wrap.appendChild(box);
    }

    if (this.status) {
      const s = document.createElement("div");
      s.style.marginTop = "8px";
      s.innerText = this.status;
      wrap.appendChild(s);
    }

    return wrap;
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "RESULT") return;
    this.status = payload.ok ? "Created ✅" : `Failed: ${payload.error || "unknown error"}`;
    if (payload.ok) this.open = false;
    this.updateDom();
  }
});
