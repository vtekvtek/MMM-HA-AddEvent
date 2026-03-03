const NodeHelper = require("node_helper");
const { exec } = require("child_process");

module.exports = NodeHelper.create({
  start() {
    this.cfg = null;
  },

  _execCmd(cmd, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || stdout || err.message || String(err)).trim();
          reject(new Error(msg));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
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

    // Your local served ICS URL that the MM calendar module uses
    const icsUrl =
      this.cfg.calendarIcsUrl ||
      this.cfg.calendarUrl ||
      "http://192.168.1.5:8888/modules/Family.ics";

    // vdirsyncer command (configurable)
    const vdirCmd = this.cfg.vdirsyncerCmd || "vdirsyncer sync";

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

    const url = `${haUrl}/api/services/calendar/create_event`;

    const body = {
      entity_id: entityId,
      summary
    };
    if (description) body.description = description;

    if (payload?.allDay) {
      const start_date = String(payload?.start_date ?? "");
      const end_date = String(payload?.end_date ?? ""); // exclusive

      if (!start_date || !end_date) {
        this.sendSocketNotification("RESULT", { ok: false, error: "Missing all-day dates" });
        return;
      }

      body.start_date = start_date;
      body.end_date = end_date;
    } else {
      const start_date_time = payload?.start_date_time;
      const end_date_time = payload?.end_date_time;

      if (!start_date_time || !end_date_time) {
        this.sendSocketNotification("RESULT", { ok: false, error: "Missing start/end time" });
        return;
      }

      body.start_date_time = start_date_time;
      body.end_date_time = end_date_time;
    }

    try {
      // Step 1: HA create_event
      this.sendSocketNotification("PROGRESS", { step: "ha" });

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

      // Step 2: vdirsyncer sync
      this.sendSocketNotification("PROGRESS", { step: "sync" });
      await this._execCmd(vdirCmd, Number(this.cfg.vdirsyncerTimeoutMs) || 120000);

      // Step 3: force MagicMirror calendar module to fetch the updated ICS
      this.sendSocketNotification("PROGRESS", { step: "fetch" });

      try {
        if (this.io && this.io.of) {
          this.io.of("calendar").emit("FETCH_CALENDAR", { url: icsUrl });
        }
      } catch (e) {
        // non-fatal, CalendarExt3 may still update on its own interval
      }

      // Done
      this.sendSocketNotification("PROGRESS", { step: "done" });
      this.sendSocketNotification("RESULT", { ok: true });
    } catch (e) {
      this.sendSocketNotification("RESULT", { ok: false, error: e?.message || String(e) });
    }
  }
});
