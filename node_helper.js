const NodeHelper = require("node_helper");
const { exec } = require("child_process");

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

    const calendarIcsUrl = String(this.cfg.calendarIcsUrl || "").trim();
    const vdirsyncerCmd = String(this.cfg.vdirsyncerCmd || "").trim();
    const vdirsyncerTimeoutMs = Number(this.cfg.vdirsyncerTimeoutMs || 120000);

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

    // 1) Create event in HA
    this.sendSocketNotification("PROGRESS", { step: "ha" });

    const url = `${haUrl}/api/services/calendar/create_event`;
    const body = { entity_id: entityId, summary };
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
    } catch (e) {
      this.sendSocketNotification("RESULT", { ok: false, error: e?.message || String(e) });
      return;
    }

    // 2) Run vdirsyncer (optional)
    if (vdirsyncerCmd) {
      this.sendSocketNotification("PROGRESS", { step: "sync" });

      const ok = await new Promise((resolve) => {
        const child = exec(vdirsyncerCmd, { timeout: vdirsyncerTimeoutMs }, (err, stdout, stderr) => {
          if (err) {
            const msg = (stderr || stdout || err.message || "").trim();
            this.sendSocketNotification("RESULT", {
              ok: false,
              error: msg ? `vdirsyncer failed: ${msg}` : "vdirsyncer failed"
            });
            resolve(false);
            return;
          }
          resolve(true);
        });

        // If exec couldn't even start, catch it
        child.on("error", (err) => {
          this.sendSocketNotification("RESULT", {
            ok: false,
            error: `vdirsyncer failed: ${err?.message || String(err)}`
          });
          resolve(false);
        });
      });

      if (!ok) return;
    }

    // 3) Force calendar module to fetch that same URL immediately
    if (calendarIcsUrl) {
      this.sendSocketNotification("PROGRESS", { step: "fetch" });

      try {
        // This is what the default calendar module listens for
        this.io.of("calendar").emit("FETCH_CALENDAR", { url: calendarIcsUrl });

        // Tiny nudge again shortly after, helps if file write + webserver lag by a moment
        setTimeout(() => {
          this.io.of("calendar").emit("FETCH_CALENDAR", { url: calendarIcsUrl });
        }, 1200);
      } catch (e) {
        // Don’t fail the whole flow if the fetch nudge fails
      }
    }

    this.sendSocketNotification("PROGRESS", { step: "done" });
    this.sendSocketNotification("RESULT", { ok: true });
  }
});
