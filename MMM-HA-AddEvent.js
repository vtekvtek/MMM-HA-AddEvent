/* global Module */

Module.register("MMM-HA-AddEvent", {

  defaults: {
    buttonText: "Add Event",
    calendarTitle: "Add Family Event",
    defaultDurationMinutes: 60,
    minuteRounding: 5
  },

  start() {

    this._visible = false
    this._activeField = "ha_summary"

    this._keyboard = null

    this._capsLock = false
    this._shiftOneShot = false
    this._pendingOneShotReset = false
    this._autoCapNext = true

    this._endManuallyEdited = false

    this._isSaving = false
    this._status = ""
    this._postSaveTimer = null

    this._current = this._defaultState()

    this._portal = document.getElementById("HA_EVENTADD_PORTAL")

    if (!this._portal) {
      this._portal = document.createElement("div")
      this._portal.id = "HA_EVENTADD_PORTAL"
      document.body.appendChild(this._portal)
    }

    this._refs = {}

    this.sendSocketNotification("CONFIG", this.config)

    this._buildOnce()
    this._applyVisibility()
    this._syncUIFromState()
    this._renderStatus()
    this._setFormDisabled(false)
  },

  getStyles() {
    return [
      "https://unpkg.com/simple-keyboard@latest/build/css/index.css",
      "MMM-HA-AddEvent.css"
    ]
  },

  getScripts() {
    return [
      "https://unpkg.com/simple-keyboard@latest/build/index.js"
    ]
  },

  getDom() {

    const wrap = document.createElement("div")
    wrap.className = "haAddWrap"

    const row = document.createElement("div")
    row.className = "haAddRow isAccent"

    const btn = document.createElement("div")
    btn.className = "haAddButton"
    btn.tabIndex = 0

    const left = document.createElement("div")
    left.className = "haAddTitleWrap"

    const label = document.createElement("div")
    label.className = "haAddLabel"
    label.textContent = this.config.buttonText

    left.appendChild(label)

    const right = document.createElement("div")
    right.className = "haAddMeta"

    const hint = document.createElement("div")
    hint.className = "haAddHint"
    hint.textContent = "Tap to open"

    right.appendChild(hint)

    btn.append(left, right)

    btn.addEventListener("click", () => this.open())

    row.appendChild(btn)
    wrap.appendChild(row)

    return wrap
  },

  open() {

    this._current = this._defaultState()

    this._visible = true
    this._endManuallyEdited = false

    this._setSaving(false, "")
    this._removePostSaveNotice()

    this._applyVisibility()
    this._syncUIFromState()

    setTimeout(() => {

      const el = this._refs.summary
      if (el) el.focus()

      this._initKeyboardIfNeeded()
      this._applyKeyboardCaseMode(true)
      this._syncKeyboardToActive()

    }, 0)
  },

  close() {

    this._visible = false

    this._setSaving(false, "")
    this._removePostSaveNotice()

    clearTimeout(this._postSaveTimer)
    this._postSaveTimer = null

    this._applyVisibility()
  },

  _applyVisibility() {
    this._portal.classList.toggle("is-open", !!this._visible)
  },

  _defaultState() {

    const now = new Date()
    now.setSeconds(0, 0)

    const round = Math.max(1, Number(this.config.minuteRounding) || 5)

    const mins = now.getMinutes()
    const rounded = Math.ceil(mins / round) * round
    now.setMinutes(rounded)

    const duration = Math.max(5, Number(this.config.defaultDurationMinutes) || 60)

    const end = new Date(now.getTime() + duration * 60000)

    return {
      summary: "",
      description: "",
      allDay: false,
      startDT: this._toDateTimeLocal(now),
      endDT: this._toDateTimeLocal(end),
      startDate: this._toDateOnly(now),
      endDate: this._toDateOnly(now)
    }
  },

  _pad(x) {
    return String(x).padStart(2, "0")
  },

  _toDateTimeLocal(d) {
    return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())}T${this._pad(d.getHours())}:${this._pad(d.getMinutes())}`
  },

  _toDateOnly(d) {
    return `${d.getFullYear()}-${this._pad(d.getMonth()+1)}-${this._pad(d.getDate())}`
  },

  _buildOnce() {

    this._portal.innerHTML = ""

    const root = document.createElement("div")
    root.className = "haEventAddRoot"

    const overlay = document.createElement("div")
    overlay.className = "haOverlay"

    overlay.addEventListener("pointerdown", e => {
      if (e.target === overlay) this.close()
    })

    const modal = document.createElement("div")
    modal.className = "haModal"

    const title = document.createElement("div")
    title.className = "haTitle"
    title.textContent = this.config.calendarTitle

    const form = document.createElement("div")

    const statusEl = document.createElement("div")
    statusEl.className = "haStatus"
    statusEl.style.display = "none"

    form.appendChild(statusEl)

    const summaryRow = this._rowBase("Title","ha_summary")

    const summary = document.createElement("input")
    summary.id = "ha_summary"

    summary.addEventListener("input", () => {
      this._current.summary = summary.value
    })

    summaryRow.appendChild(summary)

    const descRow = this._rowBase("Notes","ha_desc")

    const desc = document.createElement("textarea")
    desc.id = "ha_desc"

    desc.addEventListener("input", () => {
      this._current.description = desc.value
    })

    descRow.appendChild(desc)

    const btnBar = document.createElement("div")
    btnBar.className = "haButtons"

    const cancel = document.createElement("button")
    cancel.className = "haBtn cancel"
    cancel.textContent = "Cancel"
    cancel.addEventListener("click", () => this.close())

    const save = document.createElement("button")
    save.className = "haBtn save"
    save.textContent = "Save"
    save.addEventListener("click", () => this._submit())

    btnBar.append(cancel, save)

    form.append(summaryRow, descRow, btnBar)

    modal.append(title, form)
    overlay.appendChild(modal)
    root.appendChild(overlay)
    this._portal.appendChild(root)

    this._refs = {
      modal,
      overlay,
      summary,
      desc,
      statusEl
    }
  },

  _rowBase(label,id) {

    const row = document.createElement("div")
    row.className = "haRow"

    const l = document.createElement("label")
    l.textContent = label
    l.htmlFor = id

    row.appendChild(l)

    return row
  },

  _submit() {

    if (this._isSaving) return

    this._setSaving(true, "Saving to calendar…")

    this.sendSocketNotification("CREATE_EVENT", {
      summary: this._current.summary,
      description: this._current.description
    })
  },

  socketNotificationReceived(notification,payload) {

    if (notification === "PROGRESS") {

      if (payload.step === "ha") {
        this._setSaving(true,"Saving to calendar…")
      }

      if (payload.step === "sync") {
        this._setSaving(true,"Syncing iCloud…")
      }

      if (payload.step === "done") {
        this._setSaving(true,"Saved.")
      }

      return
    }

    if (notification !== "RESULT") return

    if (payload && payload.ok) {

      this._setSaving(false,"")

      this._showPostSaveNotice()

      return
    }

    this._setSaving(false,"Error saving event.")
  },

  _setSaving(isSaving,statusText) {

    this._isSaving = !!isSaving
    this._status = statusText || ""

    this._renderStatus()
  },

  _renderStatus() {

    const el = this._refs.statusEl
    if (!el) return

    el.textContent = this._status
    el.style.display = this._status ? "block" : "none"
  },

  _removePostSaveNotice() {

    const modal = this._refs?.modal
    if (!modal) return

    const existing = modal.querySelector(".haPostSaveNotice")

    if (existing) existing.remove()
  },

  _showPostSaveNotice() {

    const modal = this._refs.modal

    this._removePostSaveNotice()

    const box = document.createElement("div")
    box.className = "haPostSaveNotice"

    box.innerHTML = `
      <div style="font-size:22px; line-height:1.3;">
        Saved.<br>
        Event will show on the mirror after the next calendar refresh ~ 10 minutes.
      </div>
      <div style="margin-top:10px;">
        <button class="haBtn save">OK</button>
      </div>
    `

    modal.appendChild(box)

    const cleanup = () => {
      this._removePostSaveNotice()
      clearTimeout(this._postSaveTimer)
      this._postSaveTimer = null
      this.close()
    }

    box.querySelector("button").addEventListener("click", cleanup)

    this._postSaveTimer = setTimeout(cleanup,5000)
  }

})
