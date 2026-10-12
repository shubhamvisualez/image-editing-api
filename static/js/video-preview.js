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
  -d '${JSON.stringify(payload)}' \\
  --output result.mp4`;
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    result.innerHTML = "<p class='muted'>Rendering video… this can take a little while.</p>";
    try {
      const res = await fetch(window.API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: currentValues() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Render failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
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
      video.play().catch(() => {});
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
