(function () {
  "use strict";

  const host = document.getElementById("samiti-directory");
  const empty = document.getElementById("samiti-empty");
  if (!host) return;

  let members = [];

  function t(key, fallback) {
    try {
      const value = window.I18n && typeof window.I18n.t === "function" ? window.I18n.t(key) : "";
      return value && value !== key ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function photo(member, className) {
    if (!member.photoUrl) {
      return `<span class="samiti-avatar samiti-avatar--empty" aria-hidden="true">${esc((member.name || "?").slice(0, 1))}</span>`;
    }
    return `<img class="${className}" src="${esc(member.photoUrl)}" alt="${esc(member.name)}" loading="lazy" />`;
  }

  function card(member, featured) {
    return `<article class="samiti-card${featured ? " samiti-card--president" : ""}">
      ${photo(member, "samiti-card-photo")}
      <div class="samiti-card-body">
        <p class="samiti-card-position">${esc(member.position || t("samiti.member", "Member"))}</p>
        <h3>${esc(member.name)}</h3>
      </div>
    </article>`;
  }

  function render() {
    if (!members.length) {
      host.hidden = true;
      host.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    const president = members.find(member => member.isPresident);
    const others = members.filter(member => !member.isPresident);
    host.innerHTML = `
      ${president ? `<section class="samiti-president">
        <p class="eyebrow">${t("samiti.president", "President")}</p>
        ${card(president, true)}
      </section>` : ""}
      ${others.length ? `<section class="samiti-members">
        <h2>${t("samiti.members", "Other members")}</h2>
        <div class="samiti-grid">${others.map(member => card(member, false)).join("")}</div>
      </section>` : ""}`;
    host.hidden = false;
    if (empty) empty.hidden = true;
  }

  async function load() {
    try {
      const response = await fetch("/api/samiti", { credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      members = Array.isArray(data.members) ? data.members : [];
      render();
    } catch (_) {
      host.hidden = true;
      if (empty && !empty.dataset.error) {
        const message = empty.querySelector("p");
        if (message) message.textContent = t("samiti.loadError", "The directory could not be loaded. Please try again later.");
        empty.dataset.error = "1";
      }
    }
  }

  document.addEventListener("languagechange", render);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load, { once: true });
  } else {
    load();
  }
})();
