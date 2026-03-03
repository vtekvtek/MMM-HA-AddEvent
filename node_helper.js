const NodeHelper = require("node_helper");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

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
    const calendarIcsPath = String(this.cfg.calendarIcsPath || "").trim(); // optional, local path to Family.ics
    const vdirsyncerCmd = String(this.cfg.vdirsyncerCmd || "").trim();
    const vdirsyncerTimeoutMs = Number(this.cfg.vdirsyncerTimeoutMs || 120000);

    // Poll settings
    const verifyTimeoutMs = Number(this.cfg.verifyTimeoutMs || 45000);
    const verifyEveryMs = Number(this.cfg.verifyEveryMs || 1000);

    if (!haUrl) return this._fail("Missing haUrl in config");
    if (!token) return this._fail("Missing haToken in config");

    const summary = String(payload?.summary ?? "").trim();
    const description = String(payload?.description ?? "").trim();

    if (!summary) return this._fail("Missing title");

    // 1) Create event in HA
    this.sendSocketNotification("PROGRESS", { step: "ha" });

    const serviceUrl = `${haUrl}/api/services/calendar/create_event`;
    const body = { entity_id: entityId, summary };
    if (description) body.description = description;

    if (payload?.allDay) {
      const start_date = String(payload?.start_date ?? "");
      const end_date = String(payload?.end_date ?? ""); // exclusive
      if (!start_date || !end_date) return this._fail("Missing all-day dates");
      body.start_date = start_date;
      body.end_date = end_date;
    } else {
      const start_date_time = payload?.start_date_time;
      const end_date_time = payload?.end_date_time;
      if (!start_date_time || !end_date_time) return this._fail("Missing start/end time");
      body.start_date_time = start_date_time;
      body.end_date_time = end_date_time;
    }

    try {
      const res = await fetch(serviceUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return this._fail(`${res.status} ${txt || res.statusText || "Request failed"}`);
      }
    } catch (e) {
      return this._fail(e?.message || String(e));
    }

    // 2) Run vdirsyncer sync
    if (vdirsyncerCmd) {
      this.sendSocketNotification("PROGRESS", { step: "sync" });

      const ok = await this._execCmd(vdirsyncerCmd, vdirsyncerTimeoutMs);
      if (!ok.ok) return this._fail(`vdirsyncer failed: ${ok.error}`);
    }

    // 3) Verify the ICS is actually updated (this is the key fix)
    if (!calendarIcsUrl && !calendarIcsPath) {
      // Nothing to verify or refresh
      this.sendSocketNotification("RESULT", { ok: true });
      return;
    }

    this.sendSocketNotification("PROGRESS", { step: "fetch" });

    const verify = await this._waitForIcsToContain({
      summary,
      calendarIcsUrl,
      calendarIcsPath,
      timeoutMs: verifyTimeoutMs,
      everyMs: verifyEveryMs
    });

    if (!verify.ok) {
      // Even if verify fails, still try to fetch once, but tell you why
      if (calendarIcsUrl) {
        this.io.of("calendar").emit("FETCH_CALENDAR", calendarIcsUrl);
      }
      this.sendSocketNotification("RESULT", {
        ok: true,
        warn: `ICS verify timed out: ${verify.error || "no match yet"}`
      });
      return;
    }

    // 4) Now fetch calendar, after we know the file includes the new event
    if (calendarIcsUrl) {
      this.io.of("calendar").emit("FETCH_CALENDAR", calendarIcsUrl);
    }

    this.sendSocketNotification("PROGRESS", { step: "done" });
    this.sendSocketNotification("RESULT", { ok: true });
  },

  _fail(msg) {
    this.sendSocketNotification("RESULT", { ok: false, error: msg });
  },

  _execCmd(cmd, timeoutMs) {
    return new Promise((resolve) => {
      exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: (stderr || err.message || String(err)).trim() });
          return;
        }
        resolve({ ok: true, out: String(stdout || "").trim() });
      });
    });
  },

  async _waitForIcsToContain({ summary, calendarIcsUrl, calendarIcsPath, timeoutMs, everyMs }) {
    const start = Date.now();
    const needle = `SUMMARY:${summary}`;

    while (Date.now() - start < timeoutMs) {
      try {
        let txt = "";

        if (calendarIcsPath) {
          // local file path check
          const p = path.resolve(calendarIcsPath);
          txt = fs.readFileSync(p, "utf8");
        } else if (calendarIcsUrl) {
          // url check, force no-store
          const res = await fetch(calendarIcsUrl, {
            headers: {
              "Cache-Control": "no-cache",
              "Pragma": "no-cache"
            }
          });
          txt = await res.text();
        }

        if (txt && txt.includes(needle)) {
          return { ok: true };
        }
      } catch (e) {
        // ignore and keep polling
      }

      await new Promise((r) => setTimeout(r, everyMs));
    }

    return { ok: false, error: `Did not find "${needle}" within ${timeoutMs}ms` };
  }
});
