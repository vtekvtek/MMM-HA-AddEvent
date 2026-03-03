const NodeHelper = require("node_helper");

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

    const summary = String(payload?.summary ?? "").trim();
    const description = String(payload?.description ?? "").trim();

    // New UI sends full timestamps already:
    // start_date_time, end_date_time (ISO strings)
    const start_date_time = payload?.start_date_time;
    const end_date_time = payload?.end_date_time;

    if (!summary || !start_date_time || !end_date_time) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing fields" });
      return;
    }

    // Basic sanity: end after start
    const startMs = Date.parse(start_date_time);
    const endMs = Date.parse(end_date_time);

    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Invalid date/time format" });
      return;
    }

    if (endMs <= startMs) {
      this.sendSocketNotification("RESULT", { ok: false, error: "End time must be after start time" });
      return;
    }

    // Prefer config calendarEntityId, fallback to calendar.family if omitted
    const entityId = this.cfg.calendarEntityId || "calendar.family";
    const haUrl = String(this.cfg.haUrl || "").replace(/\/+$/, "");
    const token = this.cfg.haToken;

    if (!haUrl) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing haUrl in config" });
      return;
    }
    if (!token) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing haToken in config" });
      return;
    }

    const url = `${haUrl}/api/services/calendar/create_event`;
    const body = {
      entity_id: entityId,
      summary,
      description,
      start_date_time,
      end_date_time
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        this.sendSocketNotification("RESULT", {
          ok: false,
          error: `${res.status} ${txt || res.statusText || "Request failed"}`
        });
        return;
      }

      this.sendSocketNotification("RESULT", { ok: true });
    } catch (e) {
      this.sendSocketNotification("RESULT", { ok: false, error: e?.message || String(e) });
    }
  }
});
