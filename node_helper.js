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

    const { summary, date, start, end, description } = payload;
    if (!summary || !date || !start || !end) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing fields" });
      return;
    }

    const tz = this.cfg.tzOffset || "-05:00";
    const start_date_time = `${date}T${start}:00${tz}`;
    const end_date_time = `${date}T${end}:00${tz}`;

    const url = `${this.cfg.haUrl}/api/services/calendar/create_event`;
    const body = {
      entity_id: this.cfg.calendarEntityId,
      summary,
      description,
      start_date_time,
      end_date_time
    };

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
      this.sendSocketNotification("RESULT", { ok: false, error: e.message });
    }
  }
});
