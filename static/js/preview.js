(function () {
  "use strict";

  const form = document.getElementById("preview-form");
  const result = document.getElementById("result");
  const curlSnippet = document.getElementById("curl-snippet");
  const shortUrlSnippet = document.getElementById("short-url-snippet");

  function buildValuesSample() {
    const values = {};
    window.TEMPLATE.variables.forEach((v) => (values[v.label] = v.default_text));
    return values;
  }

  function buildShortUrl(values) {
    const params = new URLSearchParams(values);
    return `${window.SHORT_URL}?${params.toString()}`;
  }

  function renderSnippet() {
    const values = buildValuesSample();
    const payload = { values, format: "png" };
    const json = JSON.stringify(payload, null, 2);
    curlSnippet.textContent =
`curl -X POST "${window.API_URL}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload)}' \\
  --output result.png

# JSON body:
${json}`;

    const shortUrl = buildShortUrl(values);
    shortUrlSnippet.textContent =
`${shortUrl}

<img src="${shortUrl}">`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const values = {};
    window.TEMPLATE.variables.forEach((v) => {
      values[v.label] = formData.get(v.label) || "";
    });
    const format = formData.get("format") || "png";

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
      result.appendChild(img);
    } catch (err) {
      result.innerHTML = `<p style="color:#d73a49">${err.message}</p>`;
    }
  });

  renderSnippet();
})();
