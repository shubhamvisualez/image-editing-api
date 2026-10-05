(function () {
  "use strict";

  const BASE = window.APP_BASE || "";

  const state = {
    variables: [],
    selectedIndex: null,
    editingIndex: null,
    scale: 1,
    naturalWidth: 0,
    naturalHeight: 0,
    imageFile: null,
  };

  const el = (id) => document.getElementById(id);
  const els = {
    uploadZone: el("upload-zone"),
    imageInput: el("image-input"),
    canvasWrap: el("canvas-wrap"),
    baseImage: el("base-image"),
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
  };

  function fontFamilyFor(slug) {
    return `tpl-font-${slug}`;
  }

  // Native alert()/confirm() dialogs are suppressed in some embedded
  // browser contexts (including this app's own preview pane), which makes
  // failures look like nothing happened. Show feedback inline instead.
  let statusTimer = null;
  function showStatus(message, kind) {
    if (statusTimer) clearTimeout(statusTimer);
    els.saveStatus.textContent = message;
    els.saveStatus.className = "save-status " + (kind === "error" ? "status-error" : "status-ok");
    els.saveStatus.hidden = false;
    statusTimer = setTimeout(() => {
      els.saveStatus.hidden = true;
    }, 5000);
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
      return `<option value="${slug}" style="font-family:'${fontFamilyFor(slug)}'">${f.name}</option>`;
    }).join("");
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
    const width = Math.max(60, Math.round(state.naturalWidth * 0.45));
    const fontSize = Math.max(12, Math.round(state.naturalHeight * 0.06));
    return {
      label,
      x: Math.round(xNatural),
      y: Math.round(yNatural),
      width,
      font_size: fontSize,
      color: "#000000",
      align: "left",
      font: window.FONTS.length ? window.FONTS[0].file.replace(/\.ttf$/, "") : "roboto",
      default_text: label,
      line_height: 1.2,
    };
  }

  // ---------------------------------------------------------- image load ----

  function setupUpload() {
    els.imageInput.addEventListener("change", (e) => {
      if (e.target.files[0]) loadImageFile(e.target.files[0]);
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
      if (e.dataTransfer.files[0]) loadImageFile(e.dataTransfer.files[0]);
    });
  }

  function loadImageFile(file) {
    if (!file.type.startsWith("image/")) {
      showStatus("Please choose an image file.", "error");
      return;
    }
    state.imageFile = file;
    const url = URL.createObjectURL(file);
    els.baseImage.src = url;
    els.baseImage.onload = () => {
      state.naturalWidth = els.baseImage.naturalWidth;
      state.naturalHeight = els.baseImage.naturalHeight;
      els.uploadZone.hidden = true;
      els.canvasWrap.hidden = false;
      els.addVarBtn.disabled = false;
      recomputeScale();
      renderAll();
    };
  }

  function loadExistingTemplate(tpl) {
    state.variables = JSON.parse(JSON.stringify(tpl.variables));
    state.naturalWidth = tpl.width;
    state.naturalHeight = tpl.height;
    els.addVarBtn.disabled = false;
    const finish = () => {
      recomputeScale();
      renderAll();
    };
    if (els.baseImage.complete && els.baseImage.naturalWidth) finish();
    else els.baseImage.onload = finish;
  }

  function recomputeScale() {
    state.scale = els.canvasWrap.clientWidth / state.naturalWidth;
  }

  window.addEventListener("resize", () => {
    if (!state.naturalWidth) return;
    recomputeScale();
    renderBoxes();
    hideToolbar();
  });

  // -------------------------------------------------------------- render ----

  function renderAll() {
    renderBoxes();
    renderVarList();
    hideToolbar();
  }

  function renderBoxes() {
    els.boxesLayer.innerHTML = "";
    state.variables.forEach((v, i) => {
      const box = document.createElement("div");
      box.className = "var-box" + (i === state.selectedIndex ? " selected" : "");
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
      return;
    }
    state.variables.forEach((v, i) => {
      const item = document.createElement("div");
      item.className = "var-list-item" + (i === state.selectedIndex ? " selected" : "");
      const color = /^#[0-9a-fA-F]{3,8}$/.test(v.color || "") ? v.color : "#111111";
      item.innerHTML = `<span class="swatch" style="background:${color}"></span><code>${escapeHtml(v.label)}</code><span class="muted small">${v.font_size}px</span><button type="button" class="var-list-delete" title="Delete">✕</button>`;
      item.addEventListener("click", (e) => {
        if (e.target.closest(".var-list-delete")) return;
        commitActiveEdit();
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
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function selectVariable(i) {
    state.selectedIndex = i;
    updateSelectionClasses();
  }

  function deselectAll() {
    state.selectedIndex = null;
    updateSelectionClasses();
    hideToolbar();
  }

  // Toggles the "selected" class on existing box/list elements without
  // rebuilding the DOM — rebuilding mid-drag would detach the element the
  // drag handler is actively moving.
  function updateSelectionClasses() {
    Array.from(els.boxesLayer.children).forEach((box, i) => {
      box.classList.toggle("selected", i === state.selectedIndex);
    });
    Array.from(els.varList.children).forEach((item, i) => {
      item.classList.toggle("selected", i === state.selectedIndex);
    });
  }

  function deleteVariable(i) {
    commitActiveEdit();
    state.variables.splice(i, 1);
    state.selectedIndex = null;
    renderBoxes();
    renderVarList();
    hideToolbar();
  }

  // ---------------------------------------------------------- text editing ----

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
    document.execCommand && window.getSelection().selectAllChildren(tag);

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
        showStatus(`Label "${newLabel}" is already used by another text box.`, "error");
        tag.textContent = oldLabel;
        return;
      }
      v.label = newLabel;
      tag.textContent = newLabel;
      renderVarList();
    }
    function onKeydown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        tag.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        tag.textContent = oldLabel;
        tag.blur();
      }
    }
    tag.addEventListener("blur", commit);
    tag.addEventListener("keydown", onKeydown);
  }

  // ------------------------------------------------------------- toolbar ----

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
      renderVarList();
    });
    els.tbColor.addEventListener("input", () => {
      const v = currentSelected();
      if (!v) return;
      v.color = els.tbColor.value;
      refreshBoxStyle(state.selectedIndex);
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
    if (!box) return;
    const wrapW = els.canvasWrap.clientWidth;
    const boxLeft = parseFloat(box.style.left) || 0;
    const boxTop = parseFloat(box.style.top) || 0;
    const boxWidth = parseFloat(box.style.width) || box.offsetWidth;

    els.toolbar.hidden = false; // must be visible to measure
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

  // ---------------------------------------------------------- drag/resize ----

  function onBoxMouseDown(e, i, box, textDiv) {
    if (textDiv.isContentEditable && document.activeElement === textDiv) {
      // already editing this text box — let the browser place the cursor
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
      if (!moved && wasSelected) {
        enterTextEditMode(i);
      } else {
        showToolbar();
      }
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

  // -------------------------------------------------------------- add text ----

  function addVariableAt(xNatural, yNatural) {
    const v = makeVariable(xNatural, yNatural);
    state.variables.push(v);
    const idx = state.variables.length - 1;
    renderBoxes();
    renderVarList();
    selectVariable(idx);
    enterTextEditMode(idx);
  }

  function addVariableCentered() {
    const width = Math.max(60, Math.round(state.naturalWidth * 0.45));
    const x = (state.naturalWidth - width) / 2;
    // stagger successive additions vertically so they don't stack exactly
    // on top of each other and become impossible to grab individually
    const step = state.naturalHeight * 0.12;
    const y = state.naturalHeight * 0.3 + (state.variables.length % 5) * step;
    addVariableAt(Math.max(0, x), Math.max(0, Math.min(y, state.naturalHeight - 40)));
  }

  // ------------------------------------------------------------------ save ----

  function validate() {
    const name = els.tplName.value.trim();
    if (!name) {
      showStatus("Please give the template a name.", "error");
      els.tplName.focus();
      return false;
    }
    if (!window.IS_EDIT && !state.imageFile) {
      showStatus("Please upload an image.", "error");
      return false;
    }
    if (!state.variables.length) {
      showStatus("Add at least one text box before saving.", "error");
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
        showStatus(`Duplicate label "${v.label}". Labels must be unique.`, "error");
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
        const res = await fetch(`${BASE}/api/templates/${window.TEMPLATE_ID}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, variables: state.variables }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        els.saveBtn.textContent = "Saved ✓";
        showStatus("Template saved.", "ok");
        setTimeout(() => (els.saveBtn.textContent = "Save template"), 1500);
      } else {
        const form = new FormData();
        form.append("name", name);
        form.append("variables", JSON.stringify(state.variables));
        form.append("image", state.imageFile);
        const res = await fetch(`${BASE}/api/templates`, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Save failed");
        window.location.href = `${BASE}/templates/${data.id}/preview`;
        return;
      }
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      els.saveBtn.disabled = false;
      if (els.saveBtn.textContent === "Saving...") els.saveBtn.textContent = "Save template";
    }
  }

  // ------------------------------------------------------------------ init ----

  function init() {
    injectFontFaces();
    bindToolbarEvents();

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

    if (window.INITIAL_TEMPLATE) {
      loadExistingTemplate(window.INITIAL_TEMPLATE);
    } else {
      setupUpload();
    }
  }

  init();
})();
