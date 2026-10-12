(function () {
  "use strict";

  const BASE = window.APP_BASE || "";
  const MIN_SPAN = 0.1;

  const state = {
    variables: [],
    selectedIndex: null,
    editingIndex: null,
    scale: 1,
    naturalWidth: 0,
    naturalHeight: 0,
    duration: 0,
    videoFile: null,
    currentTime: 0,
  };

  const el = (id) => document.getElementById(id);
  const els = {
    uploadZone: el("upload-zone"),
    videoInput: el("video-input"),
    canvasWrap: el("canvas-wrap"),
    video: el("base-video"),
    boxesLayer: el("boxes-layer"),
    addVarBtn: el("add-var-btn"),
    varList: el("var-list"),
    saveBtn: el("save-btn"),
    saveStatus: el("save-status"),
    tplName: el("tpl-name"),
    fontFaceStyles: el("font-face-styles"),
    toolbar: el("text-toolbar"),
    tbFont: el("tb-font"),
    tbSize: el("tb-size"),
    tbColor: el("tb-color"),
    tbDelete: el("tb-delete"),
    timeline: el("timeline"),
    ruler: el("timeline-ruler"),
    tracks: el("timeline-tracks"),
    playhead: el("playhead"),
    playBtn: el("play-btn"),
    readout: el("time-readout"),
    timeFields: el("time-fields"),
    fieldStart: el("field-start"),
    fieldEnd: el("field-end"),
    scroll: el("timeline-scroll"),
  };

  function fontFamilyFor(slug) {
    return `tpl-font-${slug}`;
  }

  let statusTimer = null;
  function showStatus(message, kind) {
    if (statusTimer) clearTimeout(statusTimer);
    els.saveStatus.textContent = message;
    els.saveStatus.className = "save-status " + (kind === "error" ? "status-error" : "status-ok");
    els.saveStatus.hidden = false;
    statusTimer = setTimeout(() => { els.saveStatus.hidden = true; }, 5000);
  }

  function injectFontFaces() {
    let css = "";
    window.FONTS.forEach((f) => {
      const slug = f.file.replace(/\.ttf$/, "");
      css += `@font-face{font-family:"${fontFamilyFor(slug)}";src:url(${BASE}/static/fonts/${f.file});font-display:swap;}\n`;
    });
    els.fontFaceStyles.textContent = css;
  }

  function populateFontSelect(select) {
    select.innerHTML = window.FONTS.map((f) => {
      const slug = f.file.replace(/\.ttf$/, "");
      return `<option value="${slug}">${f.name}</option>`;
    }).join("");
  }

  function fmt(seconds) {
    const s = Math.max(0, seconds || 0);
    const mins = Math.floor(s / 60);
    const rest = (s - mins * 60).toFixed(1).padStart(4, "0");
    return `${mins}:${rest}`;
  }

  function nextLabel() {
    let n = state.variables.length + 1;
    let label = `text${n}`;
    while (state.variables.some((v) => v.label === label)) {
      n += 1;
      label = `text${n}`;
    }
    return label;
  }

  function makeVariable(xNatural, yNatural) {
    const label = nextLabel();
    const width = Math.max(80, Math.round(state.naturalWidth * 0.5));
    const fontSize = Math.max(18, Math.round(state.naturalHeight * 0.07));
    const start = Math.min(state.currentTime, Math.max(0, state.duration - MIN_SPAN));
    const span = Math.min(3, Math.max(MIN_SPAN, state.duration * 0.25 || 3));
    const end = Math.min(state.duration || start + span, start + span);
    return {
      label,
      x: Math.round(xNatural),
      y: Math.round(yNatural),
      width,
      font_size: fontSize,
      color: "#ffffff",
      align: "center",
      font: window.FONTS.length ? window.FONTS[0].file.replace(/\.ttf$/, "") : "roboto",
      default_text: label,
      line_height: 1.2,
      start: round3(start),
      end: round3(Math.max(start + MIN_SPAN, end)),
    };
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function isActive(v, time) {
    return time + 0.001 >= v.start && time <= v.end + 0.001;
  }

  function setupUpload() {
    els.videoInput.addEventListener("change", (e) => {
      if (e.target.files[0]) loadVideoFile(e.target.files[0]);
    });
    ["dragover", "dragenter"].forEach((evt) =>
      els.uploadZone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.uploadZone.classList.add("dragover");
      })
    );
    ["dragleave", "dragend"].forEach((evt) =>
      els.uploadZone.addEventListener(evt, () => els.uploadZone.classList.remove("dragover"))
    );
    els.uploadZone.addEventListener("drop", (e) => {
      e.preventDefault();
      els.uploadZone.classList.remove("dragover");
      if (e.dataTransfer.files[0]) loadVideoFile(e.dataTransfer.files[0]);
    });
  }

  function loadVideoFile(file) {
    if (!file.type.startsWith("video/")) {
      showStatus("Please choose a video file.", "error");
      return;
    }
    state.videoFile = file;
    const url = URL.createObjectURL(file);
    els.video.src = url;
    els.video.onloadedmetadata = () => {
      state.naturalWidth = els.video.videoWidth;
      state.naturalHeight = els.video.videoHeight;
      state.duration = els.video.duration || 0;
      els.uploadZone.hidden = true;
      els.canvasWrap.hidden = false;
      els.timeline.hidden = false;
      els.addVarBtn.disabled = false;
      recomputeScale();
      renderAll();
    };
  }

  function loadExisting(record) {
    state.variables = JSON.parse(JSON.stringify(record.variables));
    state.naturalWidth = record.width;
    state.naturalHeight = record.height;
    state.duration = record.duration || 0;
    els.addVarBtn.disabled = false;
    const finish = () => {
      if (els.video.videoWidth) {
        state.naturalWidth = els.video.videoWidth;
        state.naturalHeight = els.video.videoHeight;
      }
      if (els.video.duration) state.duration = els.video.duration;
      recomputeScale();
      renderAll();
    };
    if (els.video.readyState >= 1) finish();
    else els.video.onloadedmetadata = finish;
  }

  function recomputeScale() {
    state.scale = els.canvasWrap.clientWidth / state.naturalWidth;
  }

  window.addEventListener("resize", () => {
    if (!state.naturalWidth) return;
    recomputeScale();
    renderBoxes();
    renderTimeline();
    hideToolbar();
  });

  function renderAll() {
    renderBoxes();
    renderVarList();
    renderTimeline();
    updateReadout();
    hideToolbar();
  }

  function renderBoxes() {
    els.boxesLayer.innerHTML = "";
    state.variables.forEach((v, i) => {
      const box = document.createElement("div");
      const visible = i === state.selectedIndex || isActive(v, state.currentTime);
      box.className = "var-box" + (i === state.selectedIndex ? " selected" : "");
      box.style.display = visible ? "" : "none";
      box.style.left = v.x * state.scale + "px";
      box.style.top = v.y * state.scale + "px";
      box.style.width = v.width * state.scale + "px";
      box.style.fontFamily = `"${fontFamilyFor(v.font)}"`;
      box.style.fontSize = Math.max(6, v.font_size * state.scale) + "px";
      box.style.color = v.color;
      box.style.textAlign = v.align;
      box.style.lineHeight = v.line_height || 1.2;

      const textDiv = document.createElement("div");
      textDiv.className = "var-box-text";
      textDiv.textContent = v.default_text || v.label;
      box.appendChild(textDiv);

      const tag = document.createElement("span");
      tag.className = "box-label-tag";
      tag.textContent = v.label;
      tag.title = "Click to rename (used as the API key)";
      box.appendChild(tag);

      const handle = document.createElement("div");
      handle.className = "resize-handle";
      box.appendChild(handle);

      box.addEventListener("mousedown", (e) => onBoxMouseDown(e, i, box, textDiv));
      handle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        startResize(e, i, box);
      });
      tag.addEventListener("mousedown", (e) => e.stopPropagation());
      tag.addEventListener("click", (e) => {
        e.stopPropagation();
        startLabelRename(i, tag);
      });
      textDiv.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        enterTextEditMode(i);
      });
      textDiv.addEventListener("blur", () => exitTextEditMode(i));
      textDiv.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          textDiv.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          textDiv.blur();
        }
      });
      els.boxesLayer.appendChild(box);
    });
  }

  function renderVarList() {
    els.varList.innerHTML = "";
    if (!state.variables.length) {
      els.varList.innerHTML = '<p class="muted small">No text yet.</p>';
      els.timeFields.hidden = true;
      return;
    }
    state.variables.forEach((v, i) => {
      const item = document.createElement("div");
      item.className = "var-list-item" + (i === state.selectedIndex ? " selected" : "");
      const color = /^#[0-9a-fA-F]{3,8}$/.test(v.color || "") ? v.color : "#ffffff";
      item.innerHTML = `<span class="swatch" style="background:${color}"></span><code>${escapeHtml(v.label)}</code><span class="muted small">${v.start.toFixed(1)}–${v.end.toFixed(1)}s</span>`;
      item.addEventListener("click", () => {
        commitActiveEdit();
        selectVariable(i);
        seekTo(v.start);
        positionToolbar(i);
        showToolbar();
      });
      els.varList.appendChild(item);
    });
    syncTimeFields();
  }

  function renderTimeline() {
    const duration = state.duration || 1;
    els.ruler.innerHTML = "";
    const steps = Math.min(12, Math.max(2, Math.round(duration)));
    for (let i = 0; i <= steps; i += 1) {
      const t = (duration * i) / steps;
      const mark = document.createElement("span");
      mark.className = "ruler-mark";
      mark.style.left = (t / duration) * 100 + "%";
      mark.textContent = fmt(t);
      els.ruler.appendChild(mark);
    }
    els.tracks.innerHTML = "";
    state.variables.forEach((v, i) => {
      const row = document.createElement("div");
      row.className = "timeline-row" + (i === state.selectedIndex ? " selected" : "");
      const bar = document.createElement("div");
      bar.className = "timeline-bar";
      bar.style.left = (v.start / duration) * 100 + "%";
      bar.style.width = ((v.end - v.start) / duration) * 100 + "%";
      bar.innerHTML = `<span class="bar-handle left"></span><span class="bar-label">${escapeHtml(v.label)}</span><span class="bar-handle right"></span>`;
      bar.addEventListener("mousedown", (e) => {
        if (e.target.classList.contains("bar-handle")) return;
        startBarDrag(e, i, "move");
      });
      bar.querySelector(".left").addEventListener("mousedown", (e) => {
        e.stopPropagation();
        startBarDrag(e, i, "start");
      });
      bar.querySelector(".right").addEventListener("mousedown", (e) => {
        e.stopPropagation();
        startBarDrag(e, i, "end");
      });
      row.appendChild(bar);
      row.addEventListener("mousedown", (e) => {
        if (e.target.closest(".timeline-bar")) return;
        const rect = els.tracks.getBoundingClientRect();
        seekTo(((e.clientX - rect.left) / rect.width) * duration);
      });
      els.tracks.appendChild(row);
    });
    movePlayhead();
  }

  function startBarDrag(e, i, mode) {
    e.preventDefault();
    commitActiveEdit();
    selectVariable(i);
    const v = state.variables[i];
    const origin = e.clientX;
    const start0 = v.start;
    const end0 = v.end;
    const width = els.tracks.getBoundingClientRect().width || 1;
    function onMove(ev) {
      const delta = ((ev.clientX - origin) / width) * state.duration;
      if (mode === "move") {
        let start = start0 + delta;
        let end = end0 + delta;
        const span = end0 - start0;
        if (start < 0) { start = 0; end = span; }
        if (end > state.duration) { end = state.duration; start = end - span; }
        v.start = round3(Math.max(0, start));
        v.end = round3(Math.min(state.duration, end));
      } else if (mode === "start") {
        v.start = round3(Math.max(0, Math.min(start0 + delta, v.end - MIN_SPAN)));
      } else {
        v.end = round3(Math.min(state.duration, Math.max(end0 + delta, v.start + MIN_SPAN)));
      }
      renderTimeline();
      renderBoxes();
      syncTimeFields();
      renderVarList();
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function movePlayhead() {
    const duration = state.duration || 1;
    els.playhead.style.left = (state.currentTime / duration) * 100 + "%";
  }

  function updateReadout() {
    els.readout.textContent = `${fmt(state.currentTime)} / ${fmt(state.duration)}`;
    els.playBtn.textContent = els.video.paused ? "Play" : "Pause";
  }

  function seekTo(time) {
    const next = Math.max(0, Math.min(time, state.duration || time));
    state.currentTime = next;
    if (els.video.readyState >= 1) {
      try { els.video.currentTime = next; } catch (err) { /* not seekable yet */ }
    }
    movePlayhead();
    updateReadout();
    renderBoxes();
  }

  function syncTimeFields() {
    const v = currentSelected();
    els.timeFields.hidden = !v;
    if (!v) return;
    if (document.activeElement !== els.fieldStart) els.fieldStart.value = v.start;
    if (document.activeElement !== els.fieldEnd) els.fieldEnd.value = v.end;
    els.fieldStart.max = state.duration || "";
    els.fieldEnd.max = state.duration || "";
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function selectVariable(i) {
    state.selectedIndex = i;
    updateSelectionClasses();
    syncTimeFields();
  }

  function deselectAll() {
    state.selectedIndex = null;
    updateSelectionClasses();
    hideToolbar();
    syncTimeFields();
  }

  function updateSelectionClasses() {
    Array.from(els.boxesLayer.children).forEach((box, i) => {
      const v = state.variables[i];
      const visible = i === state.selectedIndex || (v && isActive(v, state.currentTime));
      box.style.display = visible ? "" : "none";
      box.classList.toggle("selected", i === state.selectedIndex);
    });
    Array.from(els.varList.children).forEach((item, i) => {
      item.classList.toggle("selected", i === state.selectedIndex);
    });
    Array.from(els.tracks.children).forEach((row, i) => {
      row.classList.toggle("selected", i === state.selectedIndex);
    });
  }

  function deleteVariable(i) {
    commitActiveEdit();
    state.variables.splice(i, 1);
    state.selectedIndex = null;
    renderAll();
  }

  function commitActiveEdit() {
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains("var-box-text") && active.isContentEditable) {
      active.blur();
    }
  }

  function enterTextEditMode(i) {
    if (state.selectedIndex !== i) selectVariable(i);
    hideToolbar();
    const box = els.boxesLayer.children[i];
    if (!box) return;
    const textDiv = box.querySelector(".var-box-text");
    state.editingIndex = i;
    textDiv.contentEditable = "true";
    textDiv.classList.add("editing");
    textDiv.focus();
    const range = document.createRange();
    range.selectNodeContents(textDiv);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function exitTextEditMode(i) {
    if (state.editingIndex !== i) return;
    state.editingIndex = null;
    const box = els.boxesLayer.children[i];
    const v = state.variables[i];
    if (!box || !v) return;
    const textDiv = box.querySelector(".var-box-text");
    textDiv.contentEditable = "false";
    textDiv.classList.remove("editing");
    const text = textDiv.innerText.replace(/\n+$/, "");
    v.default_text = text || v.label;
    textDiv.textContent = v.default_text;
    if (state.selectedIndex === i) {
      positionToolbar(i);
      showToolbar();
    }
  }

  function startLabelRename(i, tag) {
    commitActiveEdit();
    selectVariable(i);
    const v = state.variables[i];
    const oldLabel = v.label;
    tag.contentEditable = "true";
    tag.classList.add("editing");
    tag.focus();
    window.getSelection().selectAllChildren(tag);
    function commit() {
      tag.contentEditable = "false";
      tag.classList.remove("editing");
      tag.removeEventListener("blur", commit);
      tag.removeEventListener("keydown", onKeydown);
      const newLabel = tag.textContent.trim();
      const labelRe = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
      if (!labelRe.test(newLabel)) {
        showStatus("Label must start with a letter and contain only letters, numbers, or underscores.", "error");
        tag.textContent = oldLabel;
        return;
      }
      if (state.variables.some((other, idx) => idx !== i && other.label === newLabel)) {
        showStatus(`Label "${newLabel}" is already used.`, "error");
        tag.textContent = oldLabel;
        return;
      }
      v.label = newLabel;
      tag.textContent = newLabel;
      renderVarList();
      renderTimeline();
    }
    function onKeydown(e) {
      if (e.key === "Enter") { e.preventDefault(); tag.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); tag.textContent = oldLabel; tag.blur(); }
    }
    tag.addEventListener("blur", commit);
    tag.addEventListener("keydown", onKeydown);
  }

  function bindToolbarEvents() {
    populateFontSelect(els.tbFont);
    els.tbFont.addEventListener("change", () => {
      const v = currentSelected();
      if (!v) return;
      v.font = els.tbFont.value;
      refreshBoxStyle(state.selectedIndex);
    });
    els.tbSize.addEventListener("input", () => {
      const v = currentSelected();
      if (!v) return;
      v.font_size = Number(els.tbSize.value) || 1;
      refreshBoxStyle(state.selectedIndex);
    });
    els.tbColor.addEventListener("input", () => {
      const v = currentSelected();
      if (!v) return;
      v.color = els.tbColor.value;
      refreshBoxStyle(state.selectedIndex);
      renderVarList();
    });
    els.toolbar.querySelectorAll(".tb-align-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = currentSelected();
        if (!v) return;
        v.align = btn.dataset.align;
        refreshBoxStyle(state.selectedIndex);
        updateAlignButtons(v.align);
      });
    });
    els.tbDelete.addEventListener("click", () => {
      if (state.selectedIndex === null) return;
      deleteVariable(state.selectedIndex);
    });
    function applyTime(field) {
      const v = currentSelected();
      if (!v) return;
      const value = Number(field === "start" ? els.fieldStart.value : els.fieldEnd.value);
      if (Number.isNaN(value)) return;
      if (field === "start") v.start = round3(Math.max(0, Math.min(value, v.end - MIN_SPAN)));
      else v.end = round3(Math.min(state.duration || value, Math.max(value, v.start + MIN_SPAN)));
      renderTimeline();
      renderVarList();
      renderBoxes();
    }
    els.fieldStart.addEventListener("change", () => applyTime("start"));
    els.fieldEnd.addEventListener("change", () => applyTime("end"));
  }

  function currentSelected() {
    return state.selectedIndex === null ? null : state.variables[state.selectedIndex];
  }

  function refreshBoxStyle(i) {
    const box = els.boxesLayer.children[i];
    const v = state.variables[i];
    if (!box || !v) return;
    box.style.left = v.x * state.scale + "px";
    box.style.top = v.y * state.scale + "px";
    box.style.width = v.width * state.scale + "px";
    box.style.fontFamily = `"${fontFamilyFor(v.font)}"`;
    box.style.fontSize = Math.max(6, v.font_size * state.scale) + "px";
    box.style.color = v.color;
    box.style.textAlign = v.align;
    positionToolbar(i);
  }

  function updateAlignButtons(align) {
    els.toolbar.querySelectorAll(".tb-align-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.align === align);
    });
  }

  function positionToolbar(i) {
    const box = els.boxesLayer.children[i];
    if (!box || box.style.display === "none") return;
    const wrapW = els.canvasWrap.clientWidth;
    const boxLeft = parseFloat(box.style.left) || 0;
    const boxTop = parseFloat(box.style.top) || 0;
    const boxWidth = parseFloat(box.style.width) || box.offsetWidth;
    els.toolbar.hidden = false;
    const tbWidth = els.toolbar.offsetWidth;
    const tbHeight = els.toolbar.offsetHeight;
    let left = boxLeft + boxWidth / 2 - tbWidth / 2;
    left = Math.max(4, Math.min(left, wrapW - tbWidth - 4));
    let top = boxTop - tbHeight - 10;
    if (top < 4) top = boxTop + box.offsetHeight + 10;
    els.toolbar.style.left = left + "px";
    els.toolbar.style.top = top + "px";
  }

  function showToolbar() {
    const v = currentSelected();
    if (!v) return;
    els.tbFont.value = v.font;
    els.tbSize.value = v.font_size;
    els.tbColor.value = v.color;
    updateAlignButtons(v.align);
    positionToolbar(state.selectedIndex);
    els.toolbar.hidden = false;
  }

  function hideToolbar() {
    els.toolbar.hidden = true;
  }

  function onBoxMouseDown(e, i, box, textDiv) {
    if (textDiv.isContentEditable && document.activeElement === textDiv) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    commitActiveEdit();
    const wasSelected = state.selectedIndex === i;
    selectVariable(i);
    hideToolbar();
    const v = state.variables[i];
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = v.x * state.scale;
    const startTop = v.y * state.scale;
    let moved = false;
    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      let newLeft = Math.max(0, Math.min(startLeft + dx, els.canvasWrap.clientWidth - box.offsetWidth));
      let newTop = Math.max(0, Math.min(startTop + dy, els.canvasWrap.clientHeight - box.offsetHeight));
      box.style.left = newLeft + "px";
      box.style.top = newTop + "px";
      v.x = Math.round(newLeft / state.scale);
      v.y = Math.round(newTop / state.scale);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!moved && wasSelected) enterTextEditMode(i);
      else showToolbar();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function startResize(e, i, box) {
    e.preventDefault();
    commitActiveEdit();
    selectVariable(i);
    hideToolbar();
    const v = state.variables[i];
    const startX = e.clientX;
    const startWidth = v.width * state.scale;
    function onMove(ev) {
      let newWidth = Math.max(20, startWidth + (ev.clientX - startX));
      newWidth = Math.min(newWidth, els.canvasWrap.clientWidth - box.offsetLeft);
      box.style.width = newWidth + "px";
      v.width = Math.round(newWidth / state.scale);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      showToolbar();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function addVariableAt(xNatural, yNatural) {
    const v = makeVariable(xNatural, yNatural);
    state.variables.push(v);
    const idx = state.variables.length - 1;
    renderBoxes();
    renderVarList();
    renderTimeline();
    selectVariable(idx);
    enterTextEditMode(idx);
  }

  function addVariableCentered() {
    const width = Math.max(80, Math.round(state.naturalWidth * 0.5));
    const x = (state.naturalWidth - width) / 2;
    const step = state.naturalHeight * 0.12;
    const y = state.naturalHeight * 0.35 + (state.variables.length % 5) * step;
    addVariableAt(Math.max(0, x), Math.max(0, Math.min(y, state.naturalHeight - 40)));
  }

  function validate() {
    const name = els.tplName.value.trim();
    if (!name) {
      showStatus("Please give the video template a name.", "error");
      els.tplName.focus();
      return false;
    }
    if (!window.IS_EDIT && !state.videoFile) {
      showStatus("Please upload a video.", "error");
      return false;
    }
    if (!state.variables.length) {
      showStatus("Add at least one text layer before saving.", "error");
      return false;
    }
    const labelRe = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
    const seen = new Set();
    for (const v of state.variables) {
      if (!labelRe.test(v.label)) {
        showStatus(`Invalid label "${v.label}".`, "error");
        return false;
      }
      if (seen.has(v.label)) {
        showStatus(`Duplicate label "${v.label}".`, "error");
        return false;
      }
      seen.add(v.label);
      if (!(v.end > v.start)) {
        showStatus(`"${v.label}" must end after it starts.`, "error");
        return false;
      }
    }
    return true;
  }

  async function save() {
    commitActiveEdit();
    if (!validate()) return;
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = "Saving...";
    try {
      const name = els.tplName.value.trim();
      if (window.IS_EDIT) {
        const res = await fetch(`${BASE}/api/videos/${window.VIDEO_ID}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, variables: state.variables }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        els.saveBtn.textContent = "Saved";
        showStatus("Video template saved.", "ok");
        setTimeout(() => { els.saveBtn.textContent = "Save video"; }, 1500);
      } else {
        const form = new FormData();
        form.append("name", name);
        form.append("variables", JSON.stringify(state.variables));
        form.append("video", state.videoFile);
        const res = await fetch(`${BASE}/api/videos`, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        window.location.href = `${BASE}/videos/${data.id}/preview`;
        return;
      }
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      els.saveBtn.disabled = false;
      if (els.saveBtn.textContent === "Saving...") els.saveBtn.textContent = "Save video";
    }
  }

  function onTime() {
    state.currentTime = els.video.currentTime || 0;
    movePlayhead();
    updateReadout();
    updateSelectionClasses();
    if (state.selectedIndex !== null && !els.toolbar.hidden) positionToolbar(state.selectedIndex);
  }

  function init() {
    injectFontFaces();
    bindToolbarEvents();
    els.addVarBtn.addEventListener("click", () => {
      commitActiveEdit();
      addVariableCentered();
    });
    els.playBtn.addEventListener("click", () => {
      if (els.video.paused) els.video.play();
      else els.video.pause();
    });
    els.video.addEventListener("timeupdate", onTime);
    els.video.addEventListener("play", updateReadout);
    els.video.addEventListener("pause", updateReadout);
    els.video.addEventListener("seeked", onTime);
    els.ruler.addEventListener("mousedown", (e) => {
      const rect = els.ruler.getBoundingClientRect();
      seekTo(((e.clientX - rect.left) / rect.width) * state.duration);
    });
    els.canvasWrap.addEventListener("dblclick", (e) => {
      if (e.target.closest(".var-box")) return;
      if (!state.naturalWidth) return;
      const rect = els.canvasWrap.getBoundingClientRect();
      commitActiveEdit();
      addVariableAt((e.clientX - rect.left) / state.scale, (e.clientY - rect.top) / state.scale);
    });
    els.canvasWrap.addEventListener("mousedown", (e) => {
      if (e.target.closest(".var-box") || e.target.closest(".text-toolbar")) return;
      commitActiveEdit();
      deselectAll();
    });
    els.saveBtn.addEventListener("click", save);
    if (window.INITIAL_VIDEO) loadExisting(window.INITIAL_VIDEO);
    else setupUpload();
  }

  init();
})();
