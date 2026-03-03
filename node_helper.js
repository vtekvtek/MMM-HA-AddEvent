const NodeHelper = require("node_helper");
const { exec } = require("child_process");
const fs = require("fs");

function execPromise(cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${err.message}\n${stderr || ""}`.trim()));
        return;
      }
      resolve({ stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

async function statSafe(p) {
  try {
    return await fs.promises.stat(p);
  } catch (e) {
    return null;
  }
}

// Wait for file size + mtime to stop changing across 2 consecutive checks.
async function waitForStableFile(path, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const intervalMs = opts.intervalMs ?? 350;
  const stableReadsNeeded = opts.stableReadsNeeded ?? 2;

  const start = Date.now();
  let last = null;
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    const st = await statSafe(path);
    if (!st) {
      stableCount = 0;
      last = null;
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    const cur = { size: st.size, mtimeMs: st.mtimeMs };

    if (last && cur.size === last.size && cur.mtimeMs === last.mtimeMs) {
      stableCount += 1;
      if (stableCount >= stableReadsNeeded) return cur;
    } else {
      stableCount = 0;
    }

    last = cur;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`ICS file did not stabilize in time: ${path}`);
}

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

      // Step 2: vdirsyncer sync (optional)
      if (this.cfg.vdirsyncerCmd) {
        this.sendSocketNotification("PROGRESS", { step: "sync" });
        await execPromise(String(this.cfg.vdirsyncerCmd), Number(this.cfg.vdirsyncerTimeoutMs) || 120000);
      }

      // Step 3: wait for ICS file to settle (optional but recommended)
      if (this.cfg.calendarIcsPath) {
        this.sendSocketNotification("PROGRESS", { step: "wait_ics" });
        await waitForStableFile(String(this.cfg.calendarIcsPath), {
          timeoutMs: 20000,
          intervalMs: 350,
          stableReadsNeeded: 2
        });
      }

      // Tell frontend it is safe to fetch now
      this.sendSocketNotification("PROGRESS", { step: "fetch" });
      this.sendSocketNotification("RESULT", { ok: true });
    } catch (e) {
      this.sendSocketNotification("RESULT", { ok: false, error: e?.message || String(e) });
    }
  }
});
