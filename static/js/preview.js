(function () {
  "use strict";

  const form = document.getElementById("preview-form");
  const result = document.getElementById("result");
  const curlSnippet = document.getElementById("curl-snippet");
  const shortUrlSnippet = document.getElementById("short-url-snippet");

  function currentValues() {
    const formData = new FormData(form);
    const values = {};
    window.TEMPLATE.variables.forEach((v) => {
      const typed = formData.get(v.label);
      values[v.label] = typed == null ? v.default_text : String(typed);
    });
    return values;
  }

  function currentFormat() {
    return new FormData(form).get("format") || "png";
  }

  function renderSnippet() {
    const values = currentValues();
    const format = currentFormat();
    const payload = { values, format };
    curlSnippet.textContent =
`curl -X POST "${window.API_URL}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload)}' \\
  --output result.${format === "jpg" ? "jpg" : "png"}`;

    const params = new URLSearchParams(values);
    if (format !== "png") params.set("format", format);
    const shortUrl = `${window.SHORT_URL}?${params.toString()}`;
    shortUrlSnippet.textContent = shortUrl;
  }

  form.addEventListener("input", renderSnippet);
  form.addEventListener("change", renderSnippet);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = currentValues();
    const format = currentFormat();

    result.innerHTML = "<p class='muted'>Rendering…</p>";
    try {
      const res = await fetch(window.API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, format }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Render failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      result.innerHTML = "";
      const img = document.createElement("img");
      img.src = url;
      img.alt = "Rendered template";
      result.appendChild(img);

      const actions = document.createElement("div");
      actions.className = "result-actions";
      const download = document.createElement("a");
      download.className = "btn btn-sm";
      download.href = url;
      download.download = `render.${format === "jpg" ? "jpg" : "png"}`;
      download.textContent = "Download";
      actions.appendChild(download);
      result.appendChild(actions);
    } catch (err) {
      result.innerHTML = "";
      const message = document.createElement("p");
      message.className = "save-status status-error";
      message.textContent = err.message;
      result.appendChild(message);
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
