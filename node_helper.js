const NodeHelper = require("node_helper");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function statMtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (e) {
    return 0;
  }
}

async function waitForMtimeBump(filePath, beforeMs, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const now = statMtimeMs(filePath);
    if (now && now > beforeMs) return now;
    await sleep(250);
  }
  return null;
}

function execWithTimeout(cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message || String(err)).trim();
        reject(new Error(msg));
        return;
      }
      resolve({ stdout, stderr });
    });
    // just in case, ensure kill on timeout
    child.on("error", (e) => reject(e));
  });
}

module.exports = NodeHelper.create({
  start() {
    this.cfg = null;
  },

  socketNotificationReceived: async function (notification, payload) {
    if (notification === "CONFIG") {
      this.cfg = payload || {};
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

    const vdirCmd = String(this.cfg.vdirsyncerCmd || "").trim();
    const vdirTimeout = Number(this.cfg.vdirsyncerTimeoutMs || 120000);

    // IMPORTANT: local path to the .ics file vdirsyncer writes
    // Example: "/home/magicmirror/MagicMirror/modules/Family.ics"
    const icsPath = String(this.cfg.calendarIcsPath || "").trim();

    // URL the calendar module uses
    const icsUrl = String(this.cfg.calendarIcsUrl || "").trim();

    if (!haUrl) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing haUrl in config" });
      return;
    }
    if (!token) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing haToken in config" });
      return;
    }
    if (!vdirCmd) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing vdirsyncerCmd in config" });
      return;
    }
    if (!icsPath) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing calendarIcsPath in config" });
      return;
    }
    if (!icsUrl) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing calendarIcsUrl in config" });
      return;
    }

    const summary = String(payload?.summary ?? "").trim();
    const description = String(payload?.description ?? "").trim();

    if (!summary) {
      this.sendSocketNotification("RESULT", { ok: false, error: "Missing title" });
      return;
    }

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

      // Snapshot mtime BEFORE sync
      const beforeMtime = statMtimeMs(icsPath);

      this.sendSocketNotification("PROGRESS", { step: "sync" });
      await execWithTimeout(vdirCmd, vdirTimeout);

      // Wait for the file to actually change on disk
      this.sendSocketNotification("PROGRESS", { step: "wait_ics" });
      const bumped = await waitForMtimeBump(icsPath, beforeMtime, 20000);

      if (!bumped) {
        // If vdirsyncer succeeded but file mtime did not change, we still proceed,
        // but tell you why it might be one behind (server cache or atomic write location mismatch)
        this.sendSocketNotification("RESULT", {
          ok: true,
          fetchUrl: icsUrl,
          warning: `vdirsyncer ran but ${path.basename(icsPath)} mtime did not bump`
        });
        return;
      }

      this.sendSocketNotification("PROGRESS", { step: "fetch" });

      // Done: only now tell the frontend to fetch
      this.sendSocketNotification("RESULT", { ok: true, fetchUrl: icsUrl });
    } catch (e) {
      this.sendSocketNotification("RESULT", { ok: false, error: e?.message || String(e) });
    }
  }
});
