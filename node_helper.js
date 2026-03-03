const NodeHelper = require("node_helper");

// Node 18+ has global fetch. If your MM is older Node, you can add node-fetch.
module.exports = NodeHelper.create({
  start() {
    this.cfg = null;
  },

  socketNotificationReceived: async function (notification, payload) {
    if (notification === "CONFIG") {
      this.cfg = payload;
      return;
    }

    if (notification !== "CREATE_EVENT") return;

    if (!this.cfg) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing config" });
      return;
    }

    const summary = payload && payload.summary ? String(payload.summary) : "";
    const description = payload && payload.description ? String(payload.description) : "";

    if (!summary.trim()) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing title" });
      return;
    }

    const url = `${this.cfg.haUrl}/api/services/calendar/create_event`;

    // Build HA service body
    const body = {
      entity_id: this.cfg.calendarEntityId,
      summary: summary.trim()
    };

    if (description.trim()) body.description = description.trim();

    if (payload.allDay) {
      // Proper all-day events use start_date + end_date (end is exclusive)
      // This is what makes iPhone show "All-day" instead of midnight blocks. :contentReference[oaicite:2]{index=2}
      if (!payload.start_date || !payload.end_date) {
        this.sendSocketNotification("RESULT", { ok: false, error: "Missing all-day dates" });
        return;
      }
      body.start_date = payload.start_date;
      body.end_date = payload.end_date;
    } else {
      if (!payload.start_date_time || !payload.end_date_time) {
        this.sendSocketNotification("RESULT", { ok: false, error: "Missing start/end time" });
        return;
      }
      body.start_date_time = payload.start_date_time;
      body.end_date_time = payload.end_date_time;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cfg.haToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const txt = await res.text();
        this.sendSocketNotification("RESULT", { ok: false, error: `${res.status} ${txt}` });
        return;
      }

      this.sendSocketNotification("RESULT", { ok: true });
    } catch (e) {
      this.sendSocketNotification("RESULT", { ok: false, error: e && e.message ? e.message : String(e) });
    }
  }
});
