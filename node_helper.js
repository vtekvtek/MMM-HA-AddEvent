const NodeHelper = require("node_helper");
const { exec } = require("child_process");

module.exports = NodeHelper.create({
  start() {
    this.cfg = null;
    this._refreshInFlight = false;
    this._lastIcsSig = null;
  },

  socketNotificationReceived: async function (notification, payload) {
    if (notification === "CONFIG") {
      this.cfg = payload;
      return;
    }
    if (notification !== "CREATE_EVENT") return;

    if (this._refreshInFlight) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Busy, try again in a second." });
      return;
    }
    this._refreshInFlight = true;

    try {
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

      // helper
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

      // 3) Wait until the served ICS actually changes (prevents “one behind”)
      // We compute a simple signature: status + content-length of a cache-busted GET.
      if (calendarIcsUrl) {
        this.sendSocketNotification("PROGRESS", { step: "fetch" });

        const readSig = async () => {
          const bust = `${calendarIcsUrl}${calendarIcsUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`;
          const r = await fetch(bust, {
            method: "GET",
            headers: {
              "Cache-Control": "no-cache, no-store, max-age=0",
              Pragma: "no-cache"
            }
          });
          const len = Number(r.headers.get("content-length") || 0);
          return `${r.status}:${len}`;
        };

        // small settle time after file write
        await sleep(1500);

        let sig = null;
        for (let i = 0; i < 6; i++) {
          try {
            sig = await readSig();
          } catch (e) {
            sig = null;
          }
          if (sig && sig !== this._lastIcsSig) break;
          await sleep(900);
        }

        if (sig) this._lastIcsSig = sig;

        // 4) Emit exactly ONE manual fetch (no overlap)
        console.log(`[MMM-HA-AddEvent] Emitting FETCH_CALENDAR for ${calendarIcsUrl}`);
        this.io.of("calendar").emit("FETCH_CALENDAR", { url: calendarIcsUrl });

        // Optional: one retry after a few seconds if the signature never changed
        if (!sig || sig === this._lastIcsSig) {
          setTimeout(() => {
            console.log(`[MMM-HA-AddEvent] Retry FETCH_CALENDAR for ${calendarIcsUrl}`);
            this.io.of("calendar").emit("FETCH_CALENDAR", { url: calendarIcsUrl });
          }, 6000);
        }
      }

      this.sendSocketNotification("PROGRESS", { step: "done" });
      this.sendSocketNotification("RESULT", { ok: true });
    } catch (e) {
      this.sendSocketNotification("RESULT", { ok: false, error: e?.message || String(e) });
    } finally {
      this._refreshInFlight = false;
    }
  }
});
