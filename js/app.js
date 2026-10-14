(() => {
  "use strict";

  const { API_KEY, API_BASE, APOD_BASE } = window.NASA_CONFIG;
  const $ = (selector) => document.querySelector(selector);

  const state = {
    apod: null,
    apodRange: [],
    neos: [],
    flares: [],
    storms: [],
    loadedAt: null
  };

  const pad = n => String(n).padStart(2, "0");
  const dateISO = d => {
    const x = new Date(d);
    return `${x.getUTCFullYear()}-${pad(x.getUTCMonth()+1)}-${pad(x.getUTCDate())}`;
  };

  function rangeDates(days = 7) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return { start: dateISO(start), end: dateISO(end) };
  }

  function donkiRange(days = 30) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    return { start: dateISO(start), end: dateISO(end) };
  }

  async function getJSON(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function nasa(path, params = {}) {
    const url = new URL(`${API_BASE}${path}`);
    Object.entries({ ...params, api_key: API_KEY }).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return getJSON(url);
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 3500);
  }

  function formatNumber(value, digits = 2) {
    return Number(value).toLocaleString("ru-RU", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function cleanRichText(value = "") {
    // Новый APOD endpoint может возвращать explanation/credit как HTML.
    // Преобразуем HTML в обычный читаемый текст и убираем лишние пробелы.
    const temp = document.createElement("div");
    temp.innerHTML = String(value);
    return (temp.textContent || temp.innerText || "")
      .replace(/\\s+/g, " ")
      .trim();
  }

  function renderApod(item) {
    if (!item) return;
    state.apod = item;
    $("#apodTitle").textContent = cleanRichText(item.title) || "Astronomy Picture of the Day";
    $("#apodDate").textContent = item.date ? new Date(`${item.date}T00:00:00Z`).toLocaleDateString("ru-RU") : "—";
    $("#apodExplanation").textContent = cleanRichText(item.explanation) || "Описание недоступно.";
    $("#apodCredit").textContent = item.credit ? `CREDIT: ${cleanRichText(item.credit)}` : "NASA / APOD";

    const media = $("#apodMedia");
    if (item.media_type === "video") {
      media.innerHTML = `<a class="video-placeholder" href="${escapeHTML(item.url || "#")}" target="_blank" rel="noreferrer">
        <span>▶</span><strong>Открыть видео APOD</strong>
      </a>`;
    } else {
      const src = item.hdurl || item.url;
      media.innerHTML = `<img src="${escapeHTML(src || "")}" alt="${escapeHTML(item.alt || item.title || "NASA APOD")}" loading="eager">`;
    }
  }

  function renderGallery(items) {
    const gallery = $("#apodGallery");
    gallery.innerHTML = items.slice(0, 6).map((item, index) => {
      const src = item.hdurl || item.url || "";
      return `<article class="gallery-card" style="--i:${index}">
        <div class="gallery-image">${item.media_type === "video"
          ? `<div class="video-mini">▶</div>`
          : `<img src="${escapeHTML(src)}" alt="${escapeHTML(item.alt || item.title || "NASA image")}" loading="lazy">`
        }</div>
        <div class="gallery-copy">
          <span>${escapeHTML(item.date || "")}</span>
          <h3>${escapeHTML(item.title || "Untitled")}</h3>
        </div>
      </article>`;
    }).join("");
  }

  function renderNEOs(data) {
    const objects = Object.values(data.near_earth_objects || {})
      .flat()
      .sort((a, b) => {
        const da = a.close_approach_data?.[0]?.close_approach_date_full || "";
        const db = b.close_approach_data?.[0]?.close_approach_date_full || "";
        return da.localeCompare(db);
      });

    state.neos = objects;
    const total = Object.values(data.near_earth_objects || {}).flat().length;
    $("#neoCount").textContent = total;
    $("#neoRange").textContent = `${data.start_date || "—"} → ${data.end_date || "—"}`;

    const rows = objects.slice(0, 9).map(obj => {
      const approach = obj.close_approach_data?.[0];
      const missKm = Number(approach?.miss_distance?.kilometers || 0);
      const velocity = Number(approach?.relative_velocity?.kilometers_per_hour || 0);
      const diameter = obj.estimated_diameter?.meters?.estimated_diameter_max || 0;
      const hazardous = obj.is_potentially_hazardous_asteroid;
      return `<tr>
        <td><strong>${escapeHTML(obj.name || obj.id)}</strong><small>${escapeHTML(obj.id || "")}</small></td>
        <td>${approach?.close_approach_date || "—"}</td>
        <td>${missKm ? `${formatNumber(missKm / 1e6)} M km` : "—"}</td>
        <td>${velocity ? `${formatNumber(velocity)} km/h` : "—"}</td>
        <td>${diameter ? `${formatNumber(diameter)} m` : "—"}</td>
        <td><span class="risk ${hazardous ? "warn" : "safe"}">${hazardous ? "WATCH" : "SAFE"}</span></td>
      </tr>`;
    }).join("");

    $("#neoTable").innerHTML = rows || `<tr><td colspan="6" class="loading-row">Нет данных за выбранный период.</td></tr>`;
  }

  function renderFlares(items) {
    state.flares = items;
    $("#flareCount").textContent = items.length;
    const counts = {};
    items.forEach(item => {
      const day = item.beginTime?.slice(0, 10);
      if (day) counts[day] = (counts[day] || 0) + 1;
    });

    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      days.push(dateISO(d));
    }
    const max = Math.max(1, ...days.map(d => counts[d] || 0));

    $("#flareChart").innerHTML = days.map(day => {
      const count = counts[day] || 0;
      const height = Math.max(7, Math.round((count / max) * 100));
      return `<div class="bar-wrap" title="${day}: ${count}">
        <div class="bar" style="height:${height}%"></div>
        <span>${day.slice(8)}</span>
      </div>`;
    }).join("");
  }

  function renderEvents() {
    const events = [
      ...state.flares.map(x => ({ type: "FLR", time: x.beginTime, title: `Solar flare ${x.classType || ""}` })),
      ...state.storms.map(x => ({ type: "GST", time: x.startTime, title: "Geomagnetic storm" }))
    ].filter(x => x.time).sort((a,b) => b.time.localeCompare(a.time)).slice(0, 8);

    $("#eventsList").innerHTML = events.length ? events.map(e => `
      <div class="event-row">
        <span class="event-tag ${e.type.toLowerCase()}">${e.type}</span>
        <div><strong>${escapeHTML(e.title)}</strong><small>${new Date(e.time).toLocaleString("ru-RU")}</small></div>
        <span class="event-arrow">↗</span>
      </div>
    `).join("") : `<div class="empty">За период событий не найдено.</div>`;
  }

  async function loadAPOD() {
    // Новый NASA endpoint APOD: api.nasa.gov proxy/WordPress source.
    const today = dateISO(new Date());
    const data = await getJSON(`${APOD_BASE}?date=${today}&api_key=${encodeURIComponent(API_KEY)}`);
    const item = Array.isArray(data) ? data[0] : data;
    renderApod(item);

    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 5);
    const range = await getJSON(
      `${APOD_BASE}?start_date=${dateISO(start)}&end_date=${today}&api_key=${encodeURIComponent(API_KEY)}`
    );
    const items = Array.isArray(range) ? range : [range];
    state.apodRange = items.sort((a,b) => String(b.date).localeCompare(String(a.date)));
    renderGallery(state.apodRange);
  }

  async function loadNEOs() {
    const { start, end } = rangeDates(7);
    const data = await nasa("/neo/rest/v1/feed", { start_date: start, end_date: end });
    renderNEOs(data);
  }

  async function loadWeather() {
    const { start, end } = donkiRange(30);

    // Не используем Promise.all: если один DONKI endpoint временно
    // недоступен, остальные данные всё равно должны отрисоваться.
    const [flareResult, stormResult] = await Promise.allSettled([
      nasa("/DONKI/FLR", { startDate: start, endDate: end }),
      nasa("/DONKI/GST", { startDate: start, endDate: end })
    ]);

    const flares = flareResult.status === "fulfilled" && Array.isArray(flareResult.value)
      ? flareResult.value : [];
    const storms = stormResult.status === "fulfilled" && Array.isArray(stormResult.value)
      ? stormResult.value : [];

    state.storms = storms;
    renderFlares(flares);
    $("#stormCount").textContent = storms.length;
    renderEvents();

    const chart = $("#flareChart");
    if (!flares.length) {
      chart.innerHTML = `<div class="solar-empty">
        <strong>NO FLARE EVENTS RECEIVED</strong>
        <span>DONKI не вернул события за последние 30 дней.</span>
      </div>`;
    }
  }

  async function loadAll() {
    $("#apiStatus").textContent = "SYNC";
    $("#apiStatus").classList.add("syncing");
    const results = await Promise.allSettled([loadAPOD(), loadNEOs(), loadWeather()]);
    const failed = results.filter(r => r.status === "rejected");
    state.loadedAt = new Date();

    $("#apiStatus").textContent = failed.length ? "PARTIAL" : "ONLINE";
    $("#apiStatus").classList.toggle("error", failed.length > 0);
    $("#lastUpdate").textContent = `обновлено ${state.loadedAt.toLocaleTimeString("ru-RU")}`;

    if (failed.length) {
      console.error(failed);
      showToast("Некоторые NASA-данные не загрузились. Проверь API key и соединение.");
    }
  }

  function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString("ru-RU", { hour12: false, timeZone: "UTC" });
    $("#clock").textContent = time;
    $("#footerTime").textContent = `${now.toISOString().replace("T", " ").slice(0, 19)} UTC`;
  }

  async function searchNASAImages(query) {
    const input = $("#imageSearchInput");
    const results = $("#imageSearchResults");
    const status = $("#imageSearchStatus");
    const cleanQuery = query.trim();

    if (!cleanQuery) {
      status.textContent = "Введите запрос для поиска.";
      status.classList.add("error");
      input.focus();
      return;
    }

    status.classList.remove("error");
    status.textContent = `SEARCHING NASA LIBRARY // "${cleanQuery}"`;
    results.innerHTML = `<div class="search-loading">Поиск в NASA Image and Video Library…</div>`;

    try {
      const url = new URL("https://images-api.nasa.gov/search");
      url.searchParams.set("q", cleanQuery);
      url.searchParams.set("media_type", "image");
      url.searchParams.set("page_size", "12");

      const data = await getJSON(url.toString());
      const items = data?.collection?.items || [];

      if (!items.length) {
        results.innerHTML = `<div class="search-empty">По запросу «${escapeHTML(cleanQuery)}» ничего не найдено.</div>`;
        status.textContent = "NO RESULTS";
        return;
      }

      results.innerHTML = items.map(item => {
        const meta = item.data?.[0] || {};
        const preview = item.links?.find(link => link.rel === "preview")?.href
          || item.links?.[0]?.href;
        const nasaId = meta.nasa_id || "";
        const title = meta.title || "NASA image";
        const date = meta.date_created ? meta.date_created.slice(0, 10) : "";
        const page = `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`;

        return `<article class="image-result">
          <div class="image-result-media">
            <img src="${escapeHTML(preview || "")}" alt="${escapeHTML(title)}" loading="lazy">
          </div>
          <div class="image-result-copy">
            <span>${escapeHTML(date || "NASA")}</span>
            <h3>${escapeHTML(title)}</h3>
            <a href="${escapeHTML(page)}" target="_blank" rel="noreferrer">VIEW IN NASA LIBRARY ↗</a>
          </div>
        </article>`;
      }).join("");

      status.textContent = `${items.length} RESULTS // NASA IMAGE LIBRARY`;
    } catch (error) {
      console.error(error);
      status.textContent = "NASA IMAGE LIBRARY TEMPORARILY UNAVAILABLE";
      status.classList.add("error");
      results.innerHTML = `<div class="search-empty">Не удалось выполнить поиск. Проверь соединение с NASA Image API.</div>`;
    }
  }

  function initImageSearch() {
    const form = $("#imageSearchForm");
    if (!form) return;

    form.addEventListener("submit", event => {
      event.preventDefault();
      searchNASAImages($("#imageSearchInput").value);
    });

    document.querySelectorAll(".search-tags button").forEach(button => {
      button.addEventListener("click", () => {
        $("#imageSearchInput").value = button.dataset.query;
        searchNASAImages(button.dataset.query);
      });
    });

    // Стартовый запрос, чтобы блок не выглядел пустым.
    searchNASAImages("space");
  }

  function initNav() {
    document.querySelectorAll(".nav-item").forEach(button => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
        button.classList.add("active");
        const target = document.getElementById(button.dataset.section);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  $("#refreshBtn").addEventListener("click", async () => {
    $("#refreshBtn").classList.add("spinning");
    await loadAll();
    setTimeout(() => $("#refreshBtn").classList.remove("spinning"), 500);
  });

  initNav();
  initImageSearch();
  updateClock();
  setInterval(updateClock, 1000);
  loadAll();
})();
