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

    const haUrl = String(this.cfg.haUrl || "").replace(/\/+$/, "");
    const token = this.cfg.haToken;
    const entityId = this.cfg.calendarEntityId || "calendar.family";

    if (!haUrl) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing haUrl in config" });
      return;
    }
    if (!token) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing haToken in config" });
      return;
    }

    const summary = String(payload?.summary ?? "").trim();
    const description = String(payload?.description ?? "").trim();

    if (!summary) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing title" });
      return;
    }

    const hasTimed = payload?.start_date_time && payload?.end_date_time;
    const hasAllDay = payload?.start_date && payload?.end_date;

    if (!hasTimed && !hasAllDay) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing date fields" });
      return;
    }

    const body = {
      entity_id: entityId,
      summary,
      description,
    };

    if (hasAllDay) {
      body.start_date = String(payload.start_date);
      body.end_date = String(payload.end_date);
    } else {
      const startMs = Date.parse(payload.start_date_time);
      const endMs = Date.parse(payload.end_date_time);

      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        this.sendSocketNotification("RESULT", { ok: false, error: "Invalid date/time format" });
        return;
      }
      if (endMs <= startMs) {
        this.sendSocketNotification("RESULT", { ok: false, error: "End time must be after start time" });
        return;
      }

      body.start_date_time = payload.start_date_time;
      body.end_date_time = payload.end_date_time;
    }

    const url = `${haUrl}/api/services/calendar/create_event`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        this.sendSocketNotification("RESULT", {
          ok: false,
          error: `${res.status} ${txt || res.statusText || "Request failed"}`,
        });
        return;
      }

      this.sendSocketNotification("RESULT", { ok: true });
    } catch (e) {
      this.sendSocketNotification("RESULT", { ok: false, error: e?.message || String(e) });
    }
  },
});
