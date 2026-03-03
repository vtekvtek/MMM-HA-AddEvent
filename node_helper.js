const NodeHelper = require("node_helper");
const { exec } = require("child_process");

module.exports = NodeHelper.create({
  start() {
    this.cfg = null;
    this._busy = false;
  },

  socketNotificationReceived: async function (notification, payload) {
    if (notification === "CONFIG") {
      this.cfg = payload;
      return;
    }
    if (notification !== "CREATE_EVENT") return;

    if (this._busy) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Busy, try again." });
      return;
    }
    this._busy = true;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    try {
      if (!this.cfg) throw new Error("Missing config");

      const haUrl = String(this.cfg.haUrl || "").replace(/\/+$/, "");
      const token = this.cfg.haToken;
      const entityId = this.cfg.calendarEntityId || "calendar.family";

      const calendarIcsUrl = String(this.cfg.calendarIcsUrl || "").trim();
      const vdirsyncerCmd = String(this.cfg.vdirsyncerCmd || "").trim();
      const vdirsyncerTimeoutMs = Number(this.cfg.vdirsyncerTimeoutMs || 120000);

      if (!haUrl) throw new Error("Missing haUrl in config");
      if (!token) throw new Error("Missing haToken in config");
      if (!calendarIcsUrl) throw new Error("Missing calendarIcsUrl in config");

      const summary = String(payload?.summary ?? "").trim();
      const description = String(payload?.description ?? "").trim();
      if (!summary) throw new Error("Missing title");

      // 1) Create event in HA
      this.sendSocketNotification("PROGRESS", { step: "ha" });

      const url = `${haUrl}/api/services/calendar/create_event`;
      const body = { entity_id: entityId, summary };
      if (description) body.description = description;

      if (payload?.allDay) {
        const start_date = String(payload?.start_date ?? "");
        const end_date = String(payload?.end_date ?? ""); // exclusive
        if (!start_date || !end_date) throw new Error("Missing all-day dates");
        body.start_date = start_date;
        body.end_date = end_date;
      } else {
        const start_date_time = payload?.start_date_time;
        const end_date_time = payload?.end_date_time;
        if (!start_date_time || !end_date_time) throw new Error("Missing start/end time");
        body.start_date_time = start_date_time;
        body.end_date_time = end_date_time;
      }

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
        throw new Error(`${res.status} ${txt || res.statusText || "Request failed"}`);
      }

      // 2) Run vdirsyncer
      if (vdirsyncerCmd) {
        this.sendSocketNotification("PROGRESS", { step: "sync" });

        await new Promise((resolve, reject) => {
          exec(vdirsyncerCmd, { timeout: vdirsyncerTimeoutMs }, (err, stdout, stderr) => {
            if (err) {
              const msg = (stderr || stdout || err.message || "").trim();
              reject(new Error(msg ? `vdirsyncer failed: ${msg}` : "vdirsyncer failed"));
              return;
            }
            resolve();
          });
        });
      }

      // 3) Wait a moment to avoid racing the file write/webserver
      await sleep(1500);

      // 4) Force fetch with a cache-busted URL
      this.sendSocketNotification("PROGRESS", { step: "fetch" });

      const bustedUrl =
        `${calendarIcsUrl}${calendarIcsUrl.includes("?") ? "&" : "?"}mmts=${Date.now()}`;

      console.log(`[MMM-HA-AddEvent] FETCH_CALENDAR busted url: ${bustedUrl}`);
      this.io.of("calendar").emit("FETCH_CALENDAR", { url: bustedUrl });

      // One retry a bit later with a *different* busted URL
      setTimeout(() => {
        const busted2 =
          `${calendarIcsUrl}${calendarIcsUrl.includes("?") ? "&" : "?"}mmts=${Date.now()}`;
        console.log(`[MMM-HA-AddEvent] RETRY FETCH_CALENDAR busted url: ${busted2}`);
        this.io.of("calendar").emit("FETCH_CALENDAR", { url: busted2 });
      }, 4000);

      this.sendSocketNotification("PROGRESS", { step: "done" });
      this.sendSocketNotification("RESULT", { ok: true });
    } catch (e) {
      this.sendSocketNotification("RESULT", { ok: false, error: e?.message || String(e) });
    } finally {
      this._busy = false;
    }
  }
});
