(function () {
  "use strict";

  const form = document.getElementById("preview-form");
  const result = document.getElementById("result");
  const curlSnippet = document.getElementById("curl-snippet");
  const shortUrlSnippet = document.getElementById("short-url-snippet");
  const rpcSnippet = document.getElementById("rpc-snippet");

  function currentValues() {
    const formData = new FormData(form);
    const values = {};
    window.VIDEO.variables.forEach((v) => {
      const typed = formData.get(v.label);
      values[v.label] = typed == null ? v.default_text : String(typed);
    });
    return values;
  }

  function renderSnippet() {
    const values = currentValues();
    const payload = { values };
    curlSnippet.textContent =
`curl -X POST "${window.API_URL}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload)}'`;
    const params = new URLSearchParams(values);
    shortUrlSnippet.textContent = `${window.SHORT_URL}?${params.toString()}`;
    const rpc = {
      jsonrpc: "2.0",
      id: 1,
      method: "Template_Video_New",
      params: {
        templateID: window.VIDEO.id,
        name: window.VIDEO.name,
        description: "",
        data: values,
      },
    };
    rpcSnippet.textContent =
`curl -X POST "${window.RPC_URL}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(rpc)}'`;
  }

  form.addEventListener("input", renderSnippet);

  async function rpc(method, params) {
    const res = await fetch(window.RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      throw new Error((body.error && body.error.message) || `Request failed (${res.status})`);
    }
    return body.result;
  }

  function showVideo(url) {
    result.innerHTML = "";
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    video.className = "result-video";
    result.appendChild(video);
    const actions = document.createElement("div");
    actions.className = "result-actions";
    const download = document.createElement("a");
    download.className = "btn btn-sm";
    download.href = url;
    download.download = "render.mp4";
    download.textContent = "Download mp4";
    actions.appendChild(download);
    result.appendChild(actions);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    result.innerHTML = "<p class='muted'>Starting render…</p>";
    try {
      const created = await rpc("Template_Video_New", {
        templateID: window.VIDEO.id,
        name: window.VIDEO.name,
        description: "",
        data: currentValues(),
      });
      if (created.status && created.status.code === "error") {
        throw new Error(created.status.message || "Render failed");
      }
      if (created.status && created.status.code === "done" && created.url) {
        showVideo(created.url);
        return;
      }
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = `Processing video ${created.id}. This page will play it when the file is stored.`;
      result.innerHTML = "";
      result.appendChild(note);
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const current = await rpc("Video_Get", { id: created.id });
        const code = current.status && current.status.code;
        if (code === "done" && current.url) {
          showVideo(current.url);
          return;
        }
        if (code === "error") throw new Error(current.status.message || "Render failed");
        note.textContent = `Processing video ${created.id}…`;
      }
      throw new Error(`Still processing. Ask Video_Get for id ${created.id}.`);
    } catch (err) {
      result.innerHTML = "";
      const message = document.createElement("p");
      message.className = "save-status status-error";
      message.textContent = err.message;
      result.appendChild(message);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const node = document.getElementById(btn.getAttribute("data-copy"));
      const previous = btn.textContent;
      try {
        await navigator.clipboard.writeText(node.textContent);
        btn.textContent = "Copied";
      } catch (err) {
        btn.textContent = "Copy failed";
      }
      setTimeout(() => { btn.textContent = previous; }, 1500);
    });
  });

  renderSnippet();
})();
