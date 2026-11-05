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
    tbBold: el("tb-bold"),
    tbItalic: el("tb-italic"),
    tbUnderline: el("tb-underline"),
    tbStrike: el("tb-strike"),
    tbCase: el("tb-case"),
    tbMore: el("tb-more"),
    tbMorePanel: el("tb-more-panel"),
    tbLineHeight: el("tb-line-height"),
    tbLetterSpacing: el("tb-letter-spacing"),
    tbBgColor: el("tb-bg-color"),
    tbBgClear: el("tb-bg-clear"),
    tbStrokeWidth: el("tb-stroke-width"),
    tbStrokeColor: el("tb-stroke-color"),
    tbStrokeClear: el("tb-stroke-clear"),
    tbOpacity: el("tb-opacity"),
    tbOpacityVal: el("tb-opacity-val"),
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
    labelFields: el("label-fields"),
    fieldLabel: el("field-label"),
    scroll: el("timeline-scroll"),

    propsPanel: el("props-panel"),
    inspFont: el("insp-font"),
    inspSize: el("insp-size"),
    inspColor: el("insp-color"),
    inspColorText: el("insp-color-text"),
    inspBold: el("insp-bold"),
    inspItalic: el("insp-italic"),
    inspUnderline: el("insp-underline"),
    inspStrike: el("insp-strike"),
    inspCase: el("insp-case"),
    inspLineHeight: el("insp-line-height"),
    inspLetterSpacing: el("insp-letter-spacing"),
    inspBgColor: el("insp-bg-color"),
    inspBgClear: el("insp-bg-clear"),
    inspStrokeWidth: el("insp-stroke-width"),
    inspStrokeColor: el("insp-stroke-color"),
    inspStrokeClear: el("insp-stroke-clear"),
    inspOpacity: el("insp-opacity"),
    inspOpacityVal: el("insp-opacity-val"),
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
    if (!select) return;
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
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      uppercase: false,
      letter_spacing: 0,
      bg_color: "",
      stroke_color: "",
      stroke_width: 0,
      opacity: 1.0,
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
      requestAnimationFrame(() => {
        recomputeScale();
        renderBoxes();
      });
    };
  }

  function loadExisting(record) {
    state.variables = JSON.parse(JSON.stringify(record.variables));
    state.variables.forEach((v) => {
      v.bold = Boolean(v.bold);
      v.italic = Boolean(v.italic);
      v.underline = Boolean(v.underline);
      v.strikethrough = Boolean(v.strikethrough);
      v.uppercase = Boolean(v.uppercase);
      v.letter_spacing = Number(v.letter_spacing) || 0;
      v.line_height = Number(v.line_height) || 1.2;
      v.bg_color = v.bg_color || "";
      v.stroke_color = v.stroke_color || "";
      v.stroke_width = Number(v.stroke_width) || 0;
      v.opacity = v.opacity !== undefined ? Number(v.opacity) : 1.0;
    });
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
      requestAnimationFrame(() => {
        recomputeScale();
        renderBoxes();
      });
    };
    if (els.video.readyState >= 1) finish();
    else els.video.onloadedmetadata = finish;
  }

  function recomputeScale() {
    const displayed = els.video.clientWidth || els.canvasWrap.clientWidth;
    state.scale = displayed / state.naturalWidth;
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

  function applyBoxStyles(box, textDiv, v) {
    box.style.left = v.x * state.scale + "px";
    box.style.top = v.y * state.scale + "px";
    box.style.width = v.width * state.scale + "px";
    box.style.fontFamily = `"${fontFamilyFor(v.font)}"`;
    box.style.fontSize = Math.max(6, v.font_size * state.scale) + "px";
    box.style.color = v.color;
    box.style.textAlign = v.align;
    box.style.fontWeight = v.bold ? "bold" : "normal";
    box.style.fontStyle = v.italic ? "italic" : "normal";

    const deco = [];
    if (v.underline) deco.push("underline");
    if (v.strikethrough) deco.push("line-through");
    box.style.textDecoration = deco.length ? deco.join(" ") : "none";

    box.style.textTransform = v.uppercase ? "uppercase" : "none";
    box.style.lineHeight = v.line_height || 1.2;
    box.style.letterSpacing = ((v.letter_spacing || 0) * state.scale) + "px";
    box.style.opacity = v.opacity !== undefined ? v.opacity : 1.0;

    if (textDiv) {
      if (v.bg_color) {
        textDiv.style.backgroundColor = v.bg_color;
        textDiv.style.padding = "2px 6px";
        textDiv.style.borderRadius = "4px";
      } else {
        textDiv.style.backgroundColor = "transparent";
        textDiv.style.padding = "0";
        textDiv.style.borderRadius = "0";
      }

      if (v.stroke_color && v.stroke_width > 0) {
        const sw = Math.max(0.5, v.stroke_width * state.scale);
        textDiv.style.webkitTextStroke = `${sw}px ${v.stroke_color}`;
        textDiv.style.paintOrder = "stroke fill";
      } else {
        textDiv.style.webkitTextStroke = "";
        textDiv.style.paintOrder = "";
      }
    }
  }

  function renderBoxes() {
    els.boxesLayer.innerHTML = "";
    state.variables.forEach((v, i) => {
      const box = document.createElement("div");
      const visible = i === state.selectedIndex || isActive(v, state.currentTime);
      box.className = "var-box" + (i === state.selectedIndex ? " selected" : "");
      box.style.display = visible ? "" : "none";

      const textDiv = document.createElement("div");
      textDiv.className = "var-box-text";
      textDiv.textContent = v.default_text || v.label;
      box.appendChild(textDiv);

      applyBoxStyles(box, textDiv, v);

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
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); textDiv.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); textDiv.blur(); }
      });

      els.boxesLayer.appendChild(box);
    });
  }

  function renderVarList() {
    els.varList.innerHTML = "";
    if (!state.variables.length) {
      els.varList.innerHTML = '<p class="muted small">No text yet.</p>';
      syncTimeFields();
      syncLabelField();
      syncInspectorProps();
      return;
    }
    state.variables.forEach((v, i) => {
      const item = document.createElement("div");
      item.className = "var-list-item" + (i === state.selectedIndex ? " selected" : "");
      const color = /^#[0-9a-fA-F]{3,8}$/.test(v.color || "") ? v.color : "#ffffff";
      item.innerHTML = `<span class="swatch" style="background:${color}"></span><code>${escapeHtml(v.label)}</code><span class="muted small">${v.start.toFixed(1)}–${v.end.toFixed(1)}s</span><button type="button" class="var-list-delete" title="Delete">✕</button>`;
      item.addEventListener("click", (e) => {
        if (e.target.closest(".var-list-delete")) return;
        commitActiveEdit();
        seekTo(v.start);
        selectVariable(i);
        positionToolbar(i);
        showToolbar();
      });
      item.querySelector(".var-list-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteVariable(i);
      });
      els.varList.appendChild(item);
    });
    syncTimeFields();
    syncLabelField();
    syncInspectorProps();
  }

  function renderTimeline() {
    renderRuler();
    renderTracks();
    updatePlayhead();
  }

  function pxPerSec() {
    const totalW = Math.max(els.scroll.clientWidth, 400);
    const dur = Math.max(state.duration, 1);
    return Math.max(40, (totalW - 20) / dur);
  }

  function renderRuler() {
    const dur = state.duration || 10;
    const pps = pxPerSec();
    const totalW = dur * pps;
    els.ruler.style.width = totalW + "px";
    els.tracks.style.width = totalW + "px";
    els.ruler.innerHTML = "";

    const step = dur > 60 ? 10 : dur > 20 ? 5 : dur > 5 ? 1 : 0.5;
    for (let t = 0; t <= dur + 0.001; t += step) {
      const tick = document.createElement("div");
      tick.className = "timeline-tick";
      tick.style.left = t * pps + "px";
      const lbl = document.createElement("span");
      lbl.textContent = fmt(t);
      tick.appendChild(lbl);
      els.ruler.appendChild(tick);
    }
  }

  function renderTracks() {
    els.tracks.innerHTML = "";
    const pps = pxPerSec();
    state.variables.forEach((v, i) => {
      const row = document.createElement("div");
      row.className = "timeline-row" + (i === state.selectedIndex ? " selected" : "");

      const bar = document.createElement("div");
      bar.className = "timeline-bar";
      const left = v.start * pps;
      const width = Math.max(8, (v.end - v.start) * pps);
      bar.style.left = left + "px";
      bar.style.width = width + "px";

      const labelSpan = document.createElement("span");
      labelSpan.className = "timeline-bar-label";
      labelSpan.textContent = v.label;
      bar.appendChild(labelSpan);

      const hLeft = document.createElement("div");
      hLeft.className = "timeline-bar-handle handle-left";
      const hRight = document.createElement("div");
      hRight.className = "timeline-bar-handle handle-right";
      bar.appendChild(hLeft);
      bar.appendChild(hRight);

      bar.addEventListener("mousedown", (e) => onBarMouseDown(e, i));
      hLeft.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        startBarTrim(e, i, "start");
      });
      hRight.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        startBarTrim(e, i, "end");
      });

      row.appendChild(bar);
      els.tracks.appendChild(row);
    });
  }

  function updatePlayhead() {
    const pps = pxPerSec();
    els.playhead.style.left = state.currentTime * pps + "px";
  }

  function updateReadout() {
    els.readout.textContent = `${fmt(state.currentTime)} / ${fmt(state.duration)}`;
  }

  function seekTo(time) {
    state.currentTime = Math.max(0, Math.min(state.duration, time));
    els.video.currentTime = state.currentTime;
    updatePlayhead();
    updateReadout();
    updateSelectionClasses();
    if (state.selectedIndex !== null) positionToolbar(state.selectedIndex);
  }

  function syncTimeFields() {
    const v = currentSelected();
    els.timeFields.hidden = !v;
    if (!v) return;
    if (document.activeElement !== els.fieldStart) els.fieldStart.value = v.start.toFixed(2);
    if (document.activeElement !== els.fieldEnd) els.fieldEnd.value = v.end.toFixed(2);
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
    syncLabelField();
    syncInspectorProps();
  }

  function deselectAll() {
    state.selectedIndex = null;
    updateSelectionClasses();
    hideToolbar();
    syncTimeFields();
    syncLabelField();
    syncInspectorProps();
  }

  function syncLabelField() {
    const v = currentSelected();
    if (!els.labelFields) return;
    els.labelFields.hidden = !v;
    if (!v || document.activeElement === els.fieldLabel) return;
    els.fieldLabel.value = v.label;
  }

  function applyLabel() {
    const v = currentSelected();
    if (!v) return;
    const next = els.fieldLabel.value.trim();
    const labelRe = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
    if (!labelRe.test(next)) {
      showStatus("Variable name must start with a letter and use only letters, numbers, or underscores.", "error");
      els.fieldLabel.value = v.label;
      return;
    }
    if (state.variables.some((other, idx) => idx !== state.selectedIndex && other.label === next)) {
      showStatus(`Variable name "${next}" is already used.`, "error");
      els.fieldLabel.value = v.label;
      return;
    }
    if (v.default_text === v.label) v.default_text = next;
    v.label = next;
    const box = els.boxesLayer.children[state.selectedIndex];
    if (box) {
      const tag = box.querySelector(".box-label-tag");
      if (tag) tag.textContent = next;
      const textDiv = box.querySelector(".var-box-text");
      if (textDiv && !textDiv.isContentEditable) textDiv.textContent = v.default_text;
    }
    renderVarList();
    renderTimeline();
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
    syncInspectorProps();
  }

  function commitActiveEdit() {
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains("var-box-text") && active.isContentEditable) {
      active.blur();
    }
    if (els.fieldLabel && document.activeElement === els.fieldLabel) els.fieldLabel.blur();
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
    if (els.inspFont) populateFontSelect(els.inspFont);

    function updateFont(val) {
      const v = currentSelected();
      if (!v) return;
      v.font = val;
      if (els.tbFont) els.tbFont.value = val;
      if (els.inspFont) els.inspFont.value = val;
      refreshBoxStyle(state.selectedIndex);
    }
    els.tbFont.addEventListener("change", () => updateFont(els.tbFont.value));
    if (els.inspFont) els.inspFont.addEventListener("change", () => updateFont(els.inspFont.value));

    function updateSize(val) {
      const v = currentSelected();
      if (!v) return;
      v.font_size = Number(val) || 1;
      if (els.tbSize) els.tbSize.value = v.font_size;
      if (els.inspSize) els.inspSize.value = v.font_size;
      refreshBoxStyle(state.selectedIndex);
      renderVarList();
    }
    els.tbSize.addEventListener("input", () => updateSize(els.tbSize.value));
    if (els.inspSize) els.inspSize.addEventListener("input", () => updateSize(els.inspSize.value));

    function updateColor(val) {
      const v = currentSelected();
      if (!v) return;
      v.color = val;
      if (els.tbColor) els.tbColor.value = val;
      if (els.inspColor) els.inspColor.value = val;
      if (els.inspColorText) els.inspColorText.textContent = val;
      refreshBoxStyle(state.selectedIndex);
      renderVarList();
    }
    els.tbColor.addEventListener("input", () => updateColor(els.tbColor.value));
    if (els.inspColor) els.inspColor.addEventListener("input", () => updateColor(els.inspColor.value));

    // Format toggles
    function toggleProp(prop, tbBtn, inspBtn) {
      const v = currentSelected();
      if (!v) return;
      v[prop] = !v[prop];
      if (tbBtn) tbBtn.classList.toggle("active", Boolean(v[prop]));
      if (inspBtn) inspBtn.classList.toggle("active", Boolean(v[prop]));
      refreshBoxStyle(state.selectedIndex);
    }

    if (els.tbBold) els.tbBold.addEventListener("click", () => toggleProp("bold", els.tbBold, els.inspBold));
    if (els.inspBold) els.inspBold.addEventListener("click", () => toggleProp("bold", els.tbBold, els.inspBold));

    if (els.tbItalic) els.tbItalic.addEventListener("click", () => toggleProp("italic", els.tbItalic, els.inspItalic));
    if (els.inspItalic) els.inspItalic.addEventListener("click", () => toggleProp("italic", els.tbItalic, els.inspItalic));

    if (els.tbUnderline) els.tbUnderline.addEventListener("click", () => toggleProp("underline", els.tbUnderline, els.inspUnderline));
    if (els.inspUnderline) els.inspUnderline.addEventListener("click", () => toggleProp("underline", els.tbUnderline, els.inspUnderline));

    if (els.tbStrike) els.tbStrike.addEventListener("click", () => toggleProp("strikethrough", els.tbStrike, els.inspStrike));
    if (els.inspStrike) els.inspStrike.addEventListener("click", () => toggleProp("strikethrough", els.tbStrike, els.inspStrike));

    if (els.tbCase) els.tbCase.addEventListener("click", () => toggleProp("uppercase", els.tbCase, els.inspCase));
    if (els.inspCase) els.inspCase.addEventListener("click", () => toggleProp("uppercase", els.tbCase, els.inspCase));

    // Align
    function setAlign(align) {
      const v = currentSelected();
      if (!v) return;
      v.align = align;
      refreshBoxStyle(state.selectedIndex);
      updateAlignButtons(v.align);
    }
    els.toolbar.querySelectorAll(".tb-align-btn").forEach((btn) => {
      btn.addEventListener("click", () => setAlign(btn.dataset.align));
    });
    if (els.propsPanel) {
      els.propsPanel.querySelectorAll(".insp-align-btn").forEach((btn) => {
        btn.addEventListener("click", () => setAlign(btn.dataset.align));
      });
    }

    // More options popup
    if (els.tbMore) {
      els.tbMore.addEventListener("click", (e) => {
        e.stopPropagation();
        if (els.tbMorePanel) els.tbMorePanel.hidden = !els.tbMorePanel.hidden;
      });
    }
    if (els.tbMorePanel) {
      els.tbMorePanel.addEventListener("mousedown", (e) => e.stopPropagation());
    }

    // Line height
    function updateLineHeight(val) {
      const v = currentSelected();
      if (!v) return;
      v.line_height = Math.max(0.5, Math.min(4.0, parseFloat(val) || 1.2));
      if (els.tbLineHeight) els.tbLineHeight.value = v.line_height;
      if (els.inspLineHeight) els.inspLineHeight.value = v.line_height;
      refreshBoxStyle(state.selectedIndex);
    }
    if (els.tbLineHeight) els.tbLineHeight.addEventListener("input", () => updateLineHeight(els.tbLineHeight.value));
    if (els.inspLineHeight) els.inspLineHeight.addEventListener("input", () => updateLineHeight(els.inspLineHeight.value));

    // Letter spacing
    function updateLetterSpacing(val) {
      const v = currentSelected();
      if (!v) return;
      v.letter_spacing = parseFloat(val) || 0;
      if (els.tbLetterSpacing) els.tbLetterSpacing.value = v.letter_spacing;
      if (els.inspLetterSpacing) els.inspLetterSpacing.value = v.letter_spacing;
      refreshBoxStyle(state.selectedIndex);
    }
    if (els.tbLetterSpacing) els.tbLetterSpacing.addEventListener("input", () => updateLetterSpacing(els.tbLetterSpacing.value));
    if (els.inspLetterSpacing) els.inspLetterSpacing.addEventListener("input", () => updateLetterSpacing(els.inspLetterSpacing.value));

    // Background color
    function updateBgColor(val) {
      const v = currentSelected();
      if (!v) return;
      v.bg_color = val;
      if (els.tbBgColor) els.tbBgColor.value = val || "#ffffff";
      if (els.inspBgColor) els.inspBgColor.value = val || "#ffffff";
      refreshBoxStyle(state.selectedIndex);
    }
    if (els.tbBgColor) els.tbBgColor.addEventListener("input", () => updateBgColor(els.tbBgColor.value));
    if (els.inspBgColor) els.inspBgColor.addEventListener("input", () => updateBgColor(els.inspBgColor.value));
    if (els.tbBgClear) els.tbBgClear.addEventListener("click", () => updateBgColor(""));
    if (els.inspBgClear) els.inspBgClear.addEventListener("click", () => updateBgColor(""));

    // Stroke width and color
    function updateStrokeWidth(val) {
      const v = currentSelected();
      if (!v) return;
      v.stroke_width = Math.max(0, parseFloat(val) || 0);
      if (v.stroke_width > 0 && !v.stroke_color) v.stroke_color = "#000000";
      if (els.tbStrokeWidth) els.tbStrokeWidth.value = v.stroke_width;
      if (els.inspStrokeWidth) els.inspStrokeWidth.value = v.stroke_width;
      refreshBoxStyle(state.selectedIndex);
    }
    function updateStrokeColor(val) {
      const v = currentSelected();
      if (!v) return;
      v.stroke_color = val;
      if (v.stroke_width === 0) v.stroke_width = 1;
      if (els.tbStrokeColor) els.tbStrokeColor.value = val;
      if (els.inspStrokeColor) els.inspStrokeColor.value = val;
      if (els.tbStrokeWidth) els.tbStrokeWidth.value = v.stroke_width;
      if (els.inspStrokeWidth) els.inspStrokeWidth.value = v.stroke_width;
      refreshBoxStyle(state.selectedIndex);
    }
    function clearStroke() {
      const v = currentSelected();
      if (!v) return;
      v.stroke_width = 0;
      v.stroke_color = "";
      if (els.tbStrokeWidth) els.tbStrokeWidth.value = 0;
      if (els.inspStrokeWidth) els.inspStrokeWidth.value = 0;
      refreshBoxStyle(state.selectedIndex);
    }
    if (els.tbStrokeWidth) els.tbStrokeWidth.addEventListener("input", () => updateStrokeWidth(els.tbStrokeWidth.value));
    if (els.inspStrokeWidth) els.inspStrokeWidth.addEventListener("input", () => updateStrokeWidth(els.inspStrokeWidth.value));
    if (els.tbStrokeColor) els.tbStrokeColor.addEventListener("input", () => updateStrokeColor(els.tbStrokeColor.value));
    if (els.inspStrokeColor) els.inspStrokeColor.addEventListener("input", () => updateStrokeColor(els.inspStrokeColor.value));
    if (els.tbStrokeClear) els.tbStrokeClear.addEventListener("click", clearStroke);
    if (els.inspStrokeClear) els.inspStrokeClear.addEventListener("click", clearStroke);

    // Opacity
    function updateOpacity(val) {
      const v = currentSelected();
      if (!v) return;
      const pct = parseInt(val, 10) || 100;
      v.opacity = Math.max(0.05, Math.min(1.0, pct / 100));
      if (els.tbOpacity) els.tbOpacity.value = pct;
      if (els.tbOpacityVal) els.tbOpacityVal.textContent = pct + "%";
      if (els.inspOpacity) els.inspOpacity.value = pct;
      if (els.inspOpacityVal) els.inspOpacityVal.textContent = pct + "%";
      refreshBoxStyle(state.selectedIndex);
    }
    if (els.tbOpacity) els.tbOpacity.addEventListener("input", () => updateOpacity(els.tbOpacity.value));
    if (els.inspOpacity) els.inspOpacity.addEventListener("input", () => updateOpacity(els.inspOpacity.value));

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
    const textDiv = box.querySelector(".var-box-text");
    applyBoxStyles(box, textDiv, v);
    positionToolbar(i);
    syncInspectorProps();
  }

  function updateAlignButtons(align) {
    els.toolbar.querySelectorAll(".tb-align-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.align === align);
    });
    if (els.propsPanel) {
      els.propsPanel.querySelectorAll(".insp-align-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.align === align);
      });
    }
  }

  function syncInspectorProps() {
    const v = currentSelected();
    if (!els.propsPanel) return;
    if (!v) {
      els.propsPanel.hidden = true;
      return;
    }
    els.propsPanel.hidden = false;
    if (els.inspFont) els.inspFont.value = v.font;
    if (els.inspSize) els.inspSize.value = v.font_size;
    if (els.inspColor) els.inspColor.value = v.color;
    if (els.inspColorText) els.inspColorText.textContent = v.color;

    if (els.inspBold) els.inspBold.classList.toggle("active", Boolean(v.bold));
    if (els.inspItalic) els.inspItalic.classList.toggle("active", Boolean(v.italic));
    if (els.inspUnderline) els.inspUnderline.classList.toggle("active", Boolean(v.underline));
    if (els.inspStrike) els.inspStrike.classList.toggle("active", Boolean(v.strikethrough));
    if (els.inspCase) els.inspCase.classList.toggle("active", Boolean(v.uppercase));

    updateAlignButtons(v.align);

    if (els.inspLineHeight) els.inspLineHeight.value = v.line_height || 1.2;
    if (els.inspLetterSpacing) els.inspLetterSpacing.value = v.letter_spacing || 0;
    if (els.inspBgColor) els.inspBgColor.value = v.bg_color || "#ffffff";
    if (els.inspStrokeWidth) els.inspStrokeWidth.value = v.stroke_width || 0;
    if (els.inspStrokeColor) els.inspStrokeColor.value = v.stroke_color || "#000000";

    const pct = Math.round((v.opacity !== undefined ? v.opacity : 1.0) * 100);
    if (els.inspOpacity) els.inspOpacity.value = pct;
    if (els.inspOpacityVal) els.inspOpacityVal.textContent = pct + "%";
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

    if (els.tbBold) els.tbBold.classList.toggle("active", Boolean(v.bold));
    if (els.tbItalic) els.tbItalic.classList.toggle("active", Boolean(v.italic));
    if (els.tbUnderline) els.tbUnderline.classList.toggle("active", Boolean(v.underline));
    if (els.tbStrike) els.tbStrike.classList.toggle("active", Boolean(v.strikethrough));
    if (els.tbCase) els.tbCase.classList.toggle("active", Boolean(v.uppercase));

    if (els.tbLineHeight) els.tbLineHeight.value = v.line_height || 1.2;
    if (els.tbLetterSpacing) els.tbLetterSpacing.value = v.letter_spacing || 0;
    if (els.tbBgColor) els.tbBgColor.value = v.bg_color || "#ffffff";
    if (els.tbStrokeWidth) els.tbStrokeWidth.value = v.stroke_width || 0;
    if (els.tbStrokeColor) els.tbStrokeColor.value = v.stroke_color || "#000000";

    const pct = Math.round((v.opacity !== undefined ? v.opacity : 1.0) * 100);
    if (els.tbOpacity) els.tbOpacity.value = pct;
    if (els.tbOpacityVal) els.tbOpacityVal.textContent = pct + "%";

    updateAlignButtons(v.align);
    positionToolbar(state.selectedIndex);
    els.toolbar.hidden = false;
    syncInspectorProps();
  }

  function hideToolbar() {
    els.toolbar.hidden = true;
    if (els.tbMorePanel) els.tbMorePanel.hidden = true;
    if (state.selectedIndex === null && els.propsPanel) els.propsPanel.hidden = true;
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
      let newLeft = startLeft + dx;
      let newTop = startTop + dy;
      newLeft = Math.max(0, Math.min(newLeft, els.canvasWrap.clientWidth - box.offsetWidth));
      newTop = Math.max(0, Math.min(newTop, els.canvasWrap.clientHeight - box.offsetHeight));
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
      const dx = ev.clientX - startX;
      let newWidth = Math.max(20, startWidth + dx);
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

  function onBarMouseDown(e, i) {
    e.preventDefault();
    commitActiveEdit();
    selectVariable(i);
    hideToolbar();
    const v = state.variables[i];
    const startX = e.clientX;
    const startT = v.start;
    const span = v.end - v.start;
    const pps = pxPerSec();
    let moved = false;
    function onMove(ev) {
      const dt = (ev.clientX - startX) / pps;
      if (Math.abs(dt) > 0.02) moved = true;
      let newStart = Math.max(0, Math.min(startT + dt, state.duration - span));
      let newEnd = newStart + span;
      v.start = round3(newStart);
      v.end = round3(newEnd);
      renderTimeline();
      syncTimeFields();
      updateSelectionClasses();
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!moved) {
        seekTo(v.start);
        showToolbar();
      }
      renderVarList();
      renderBoxes();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function startBarTrim(e, i, edge) {
    e.preventDefault();
    commitActiveEdit();
    selectVariable(i);
    hideToolbar();
    const v = state.variables[i];
    const startX = e.clientX;
    const origStart = v.start;
    const origEnd = v.end;
    const pps = pxPerSec();
    function onMove(ev) {
      const dt = (ev.clientX - startX) / pps;
      if (edge === "start") {
        let nextStart = Math.max(0, Math.min(origStart + dt, v.end - MIN_SPAN));
        v.start = round3(nextStart);
      } else {
        let nextEnd = Math.min(state.duration, Math.max(origEnd + dt, v.start + MIN_SPAN));
        v.end = round3(nextEnd);
      }
      renderTimeline();
      syncTimeFields();
      updateSelectionClasses();
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      renderVarList();
      renderBoxes();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function setupTimelineScrub() {
    function scrub(e) {
      const rect = els.ruler.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pps = pxPerSec();
      seekTo(x / pps);
    }
    els.ruler.addEventListener("mousedown", (e) => {
      scrub(e);
      function onMove(ev) { scrub(ev); }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function setupPlayback() {
    els.playBtn.addEventListener("click", () => {
      if (els.video.paused) {
        if (state.currentTime >= (state.duration - 0.05)) seekTo(0);
        els.video.play();
        els.playBtn.textContent = "Pause";
      } else {
        els.video.pause();
        els.playBtn.textContent = "Play";
      }
    });
    els.video.addEventListener("timeupdate", () => {
      state.currentTime = els.video.currentTime;
      updatePlayhead();
      updateReadout();
      updateSelectionClasses();
      if (state.selectedIndex !== null) positionToolbar(state.selectedIndex);
    });
    els.video.addEventListener("ended", () => {
      els.playBtn.textContent = "Play";
    });
  }

  function addVariableAt(xNatural, yNatural) {
    const v = makeVariable(xNatural, yNatural);
    state.variables.push(v);
    const idx = state.variables.length - 1;
    renderAll();
    selectVariable(idx);
    enterTextEditMode(idx);
  }

  function addVariableCentered() {
    const width = Math.max(80, Math.round(state.naturalWidth * 0.5));
    const x = (state.naturalWidth - width) / 2;
    const step = state.naturalHeight * 0.12;
    const y = state.naturalHeight * 0.3 + (state.variables.length % 5) * step;
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
      showStatus("Please upload a video file.", "error");
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
        showStatus(`Invalid label "${v.label}". Use letters/numbers/underscore, starting with a letter.`, "error");
        return false;
      }
      if (seen.has(v.label)) {
        showStatus(`Duplicate label "${v.label}". Text labels must be unique.`, "error");
        return false;
      }
      seen.add(v.label);
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
        els.saveBtn.textContent = "Saved ✓";
        showStatus("Video template saved.", "ok");
        setTimeout(() => (els.saveBtn.textContent = "Save video"), 1500);
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

  function init() {
    injectFontFaces();
    bindToolbarEvents();
    setupTimelineScrub();
    setupPlayback();

    els.addVarBtn.addEventListener("click", () => {
      commitActiveEdit();
      addVariableCentered();
    });

    els.canvasWrap.addEventListener("dblclick", (e) => {
      if (e.target.closest(".var-box")) return;
      if (!state.naturalWidth) return;
      const rect = els.canvasWrap.getBoundingClientRect();
      const xDisplay = e.clientX - rect.left;
      const yDisplay = e.clientY - rect.top;
      commitActiveEdit();
      addVariableAt(xDisplay / state.scale, yDisplay / state.scale);
    });

    els.canvasWrap.addEventListener("mousedown", (e) => {
      if (e.target.closest(".var-box") || e.target.closest(".text-toolbar")) return;
      commitActiveEdit();
      deselectAll();
    });

    els.saveBtn.addEventListener("click", save);
    if (els.fieldLabel) {
      els.fieldLabel.addEventListener("change", applyLabel);
      els.fieldLabel.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          els.fieldLabel.blur();
        }
      });
    }

    if (window.INITIAL_VIDEO) {
      loadExisting(window.INITIAL_VIDEO);
    } else {
      setupUpload();
    }
  }

  init();
})();
