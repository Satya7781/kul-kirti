/**
 * Kul-Kirti — vanshawali-explorer.js
 * =====================================
 * Public Genealogy Explorer + Interactive Family Tree Renderer
 *
 * Three URL-driven views on vanshawali.html:
 *   default         → Home: gotra directory + village directory
 *   ?gotra=ID       → Gotra detail with members and branches
 *   ?person=PUBID   → Person profile + expandable SVG family tree
 */

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC GENEALOGY EXPLORER
   ═══════════════════════════════════════════════════════════════════════════ */

(function initGenealogyExplorer() {
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  /* DOM handles */
  const homeView           = document.querySelector("#vw-home-view");
  const gotraDirectory     = document.querySelector("#gotra-directory");
  const villageGrid        = document.querySelector("#village-directory");
  const gotraDetailSection = document.querySelector("#gotra-detail-section");
  const gotraDetailContent = document.querySelector("#gotra-detail-content");
  const personSection      = document.querySelector("#person-profile-section");
  const personContent      = document.querySelector("#person-profile-content");
  const searchForm         = document.querySelector("#genealogy-search-form");
  const searchInput        = document.querySelector("#genealogy-search-input");
  const searchResults      = document.querySelector("#genealogy-search-results");

  /* Not on vanshawali.html */
  if (!homeView && !gotraDetailSection && !personSection) return;

  const params  = new URLSearchParams(location.search);
  const gotraId = params.get("gotra");
  const personId = params.get("person");

  /* ── Route ─────────────────────────────────────────────────────────────── */
  if (personId) {
    if (homeView) homeView.hidden = true;
    _loadPersonProfile(personId);
  } else if (gotraId) {
    if (homeView) homeView.hidden = true;
    _loadGotraDetail(gotraId);
  } else {
    _loadGotraDirectory();
    _loadVillageDirectory();
  }

  /* ── Search ─────────────────────────────────────────────────────────────── */
  searchForm?.addEventListener("submit", e => {
    e.preventDefault();
    _searchPeople(searchInput?.value?.trim() || "");
  });

  async function _searchPeople(query) {
    if (!searchResults) return;
    if (!query || query.length < 2) { searchResults.innerHTML = ""; return; }
    searchResults.innerHTML = `<div class="empty-state"><p>${I18n.t("common.loading")}</p></div>`;
    try {
      const res = await fetch(`/api/genealogy/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { people } = await res.json();
      if (!people.length) {
        searchResults.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.searchNoResults")}</p></div>`;
        return;
      }
      searchResults.innerHTML =
        `<p class="result-summary">${I18n.t("genealogy.searchResults", { n: people.length })}</p>` +
        people.map(p => {
          const meta = [p.birthYear, p.village].filter(Boolean).join(" · ");
          return `<div class="person-search-card">
            <div><h4>${escapeHtml(p.fullName)}</h4><div class="person-meta">${escapeHtml(meta)}</div></div>
            <a class="result-tag" href="/vanshawali.html?person=${p.publicId}">${I18n.t("genealogy.viewProfile")}</a>
          </div>`;
        }).join("");
    } catch (err) {
      searchResults.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  }

  /* ── Gotra directory ──────────────────────────────────────────────────── */
  async function _loadGotraDirectory() {
    if (!gotraDirectory) return;
    try {
      const res = await fetch("/api/genealogy/gotras");
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { gotras } = await res.json();
      if (!gotras.length) {
        gotraDirectory.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.noGotras")}</p></div>`;
        return;
      }
      gotraDirectory.innerHTML = gotras.map(g => `
        <a class="gotra-dir-card" href="/vanshawali.html?gotra=${g.id}">
          <h3>${escapeHtml(g.name)}</h3>
          <div class="gotra-meta">
            <span><b>${g.personCount || 0}</b> ${I18n.t("genealogy.gotraPersons")}</span>
            <span><b>${g.branchCount || 0}</b> ${I18n.t("genealogy.gotraBranches")}</span>
          </div>
          ${g.historicalDetails
            ? `<p class="gotra-desc">${escapeHtml(g.historicalDetails.slice(0, 150))}${g.historicalDetails.length > 150 ? "…" : ""}</p>`
            : ""}
          <span class="gotra-link">${I18n.t("genealogy.viewDetail")} →</span>
        </a>`).join("");
    } catch (err) {
      gotraDirectory.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  }

  /* ── Village directory ────────────────────────────────────────────────── */
  async function _loadVillageDirectory() {
    if (!villageGrid) return;
    try {
      const res = await fetch("/api/vanshawali/villages");
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { villages } = await res.json();
      if (!villages.length) {
        villageGrid.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.noVillages")}</p></div>`;
        return;
      }
      villageGrid.innerHTML = villages.map(v => `
        <div class="village-card">
          <h4>${escapeHtml(v.village)}</h4>
          <div class="village-meta">${escapeHtml([v.district, v.state].filter(Boolean).join(" · "))}</div>
          <div class="village-count">${v.personCount}</div>
          <div class="village-meta">${I18n.t("genealogy.villagePeople")}</div>
        </div>`).join("");
    } catch (err) {
      villageGrid.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  }

  /* ── Gotra detail ─────────────────────────────────────────────────────── */
  async function _loadGotraDetail(id) {
    if (!gotraDetailContent) return;
    gotraDetailSection.hidden = false;
    gotraDetailContent.innerHTML = `<div class="empty-state"><p>${I18n.t("common.loading")}</p></div>`;
    try {
      const res = await fetch(`/api/genealogy/gotras/${id}`);
      if (!res.ok) throw new Error(I18n.t("common.error"));
      const { gotra, branches, roots } = await res.json();

      /* Fetch linked members (needs auth in prod — falls back gracefully) */
      let membersList = [];
      try {
        const mr = await fetch(`/api/admin/gotras/${id}/members`);
        if (mr.ok) membersList = (await mr.json()).members || [];
      } catch (_) { /* not logged in — that's fine for public view */ }

      const rootCards = roots.length
        ? roots.map(r => `
            <div class="gotra-member-card">
              <a href="/vanshawali.html?person=${encodeURIComponent(r.publicId)}">${escapeHtml(r.fullName)}</a>
              <div class="gmc-meta">${escapeHtml(`${r.birthYear || ""}${r.deathYear ? " – " + r.deathYear : ""}${r.village ? " · " + r.village : ""}`)}</div>
            </div>`).join("")
        : `<p class="rel-empty">${I18n.t("genealogy.noRoots")}</p>`;

      const memberCards = membersList
        .filter(m => m.publicId)   /* only show linked members publicly */
        .map(m => `
          <div class="gotra-member-card">
            <a href="/vanshawali.html?person=${encodeURIComponent(m.publicId)}">${escapeHtml(m.personName)}</a>
            <div class="gmc-meta">${escapeHtml(`${m.relationOrRole ? m.relationOrRole + " · " : ""}${[m.village, m.district, m.state].filter(Boolean).join(", ")}`)}</div>
          </div>`)
        .join("");

      gotraDetailContent.innerHTML = `
        <div class="gotra-detail-card">
          <h2>${escapeHtml(gotra.name)}</h2>
          ${gotra.originPlace
            ? `<p style="color:var(--muted);font-size:14px;margin-bottom:12px">${escapeHtml(`${gotra.originPlace}${gotra.originPeriod ? " · " + gotra.originPeriod : ""}`)}</p>`
            : ""}
          <div class="gotra-stats">
            <div class="gotra-stat"><b>${membersList.length || roots.length}</b><span>सदस्य</span></div>
            <div class="gotra-stat"><b>${branches.length}</b><span>${I18n.t("genealogy.branches")}</span></div>
          </div>
          ${gotra.historicalDetails
            ? `<div class="gotra-detail-section"><h3>इतिहास</h3><p style="color:var(--muted);font-size:15px;line-height:1.8">${escapeHtml(gotra.historicalDetails)}</p></div>`
            : ""}
          <div class="gotra-detail-section">
            <h3>${I18n.t("genealogy.roots")}</h3>
            <div class="gotra-member-grid">${rootCards}</div>
          </div>
          ${memberCards
            ? `<div class="gotra-detail-section"><h3>सभी सदस्य</h3><div class="gotra-member-grid">${memberCards}</div></div>`
            : ""}
          <div class="gotra-detail-section">
            <h3>${I18n.t("genealogy.branches")}</h3>
            ${branches.length
              ? `<div class="rel-list">${branches.map(b => `<div class="rel-item">${escapeHtml(b.name)}${b.description ? ` <span class="rel-meta">${escapeHtml(b.description)}</span>` : ""}</div>`).join("")}</div>`
              : `<p class="rel-empty">${I18n.t("genealogy.noBranches")}</p>`}
          </div>
        </div>`;
    } catch (err) {
      gotraDetailContent.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  }

  /* ── Person profile ───────────────────────────────────────────────────── */
  async function _loadPersonProfile(pubId) {
    if (!personContent) return;
    personSection.hidden = false;
    personContent.innerHTML = `<div class="empty-state"><p>${I18n.t("common.loading")}</p></div>`;
    try {
      const res = await fetch(`/api/genealogy/people/${pubId}`);
      if (!res.ok) {
        personContent.innerHTML = `<div class="empty-state"><p>${I18n.t("genealogy.restrictedProfile")}</p></div>`;
        return;
      }
      const data = await res.json();

      if (data.restricted) {
        personContent.innerHTML = `
          <div class="person-profile-card">
            <div class="person-profile-header">
              <div class="person-profile-avatar">${escapeHtml((data.person.fullName || "?").charAt(0))}</div>
              <div class="person-profile-info">
                <h2>${escapeHtml(data.person.fullName)}</h2>
                <p style="color:var(--muted)">${I18n.t("genealogy.restrictedProfile")}</p>
              </div>
            </div>
          </div>`;
        return;
      }

      const p = data.person;
      const tags = [];
      if (p.generation) tags.push(`<span class="tag gen">${I18n.t("genealogy.generation")} ${p.generation}</span>`);
      tags.push(`<span class="tag ${p.isLiving ? "living" : "deceased"}">${p.isLiving ? I18n.t("genealogy.living") : I18n.t("genealogy.deceased")}</span>`);
      (data.gotras || []).forEach(g => tags.push(`<span class="tag gotra">${escapeHtml(g.name)}</span>`));

      const shareUrl = `${location.origin}/vanshawali.html?person=${p.publicId}`;

      function relList(items, emptyKey) {
        if (!items?.length) return `<p class="rel-empty">${I18n.t("genealogy." + emptyKey)}</p>`;
        return `<div class="rel-list">${items.map(r => {
          const pid = r.publicId || r.public_id;
          const name = r.fullName || r.full_name || "?";
          const meta = [r.birthYear, r.deathYear ? "– " + r.deathYear : "", r.village].filter(Boolean).join(" ");
          return `<div class="rel-item">
            ${pid ? `<a href="/vanshawali.html?person=${encodeURIComponent(pid)}">${escapeHtml(name)}</a>` : `<span>${escapeHtml(name)}</span>`}
            <span class="rel-meta">${escapeHtml(meta)}</span>
          </div>`;
        }).join("")}</div>`;
      }

      function ancestorPath(items) {
        if (!items?.length) return `<p class="rel-empty">${I18n.t("genealogy.noAncestors")}</p>`;
        return `<div class="ancestor-path">${items.map(a => {
          const pid = a.publicId || a.public_id;
          return `<div class="path-item">
            <span class="path-gen">${I18n.t("genealogy.generation")} ${(p.generation || 1) - (a.depth || 1)}</span>
            ${pid ? `<a href="/vanshawali.html?person=${encodeURIComponent(pid)}">${escapeHtml(a.fullName)}</a>` : `<span>${escapeHtml(a.fullName)}</span>`}
            <span class="path-meta">${escapeHtml(`${a.birthYear || ""}${a.deathYear ? " – " + a.deathYear : ""}`)}</span>
          </div>`;
        }).join("")}</div>`;
      }

      function descendantPath(items) {
        if (!items?.length) return `<p class="rel-empty">${I18n.t("genealogy.noDescendants")}</p>`;
        return `<div class="descendant-path">${items.map(d => {
          const pid = d.publicId || d.public_id;
          return `<div class="path-item">
            <span class="path-gen">${I18n.t("genealogy.generation")} ${(p.generation || 1) + (d.depth || 1)}</span>
            ${pid ? `<a href="/vanshawali.html?person=${encodeURIComponent(pid)}">${escapeHtml(d.fullName)}</a>` : `<span>${escapeHtml(d.fullName)}</span>`}
            <span class="path-meta">${escapeHtml(`${d.birthYear || ""}${d.deathYear ? " – " + d.deathYear : ""}`)}</span>
          </div>`;
        }).join("")}</div>`;
      }

      personContent.innerHTML = `
        <div class="person-profile-card">
          <div class="person-profile-header">
            <div class="person-profile-avatar">${(p.fullName || "?").charAt(0)}</div>
            <div class="person-profile-info">
              <h2>${p.fullName}</h2>
              <p style="color:var(--muted);font-size:14px">
                ${[p.birthYear, p.deathYear ? "– " + p.deathYear : "", p.village].filter(Boolean).join(" · ")}
              </p>
              <div class="person-tags">${tags.join("")}</div>
              <button class="profile-share-btn" style="margin-top:10px"
                onclick="navigator.clipboard?.writeText('${shareUrl}').then(()=>{this.textContent='✓ कॉपी हो गया';setTimeout(()=>{this.textContent='🔗 प्रोफ़ाइल शेयर करें'},2000)}).catch(()=>{})">
                🔗 प्रोफ़ाइल शेयर करें
              </button>
            </div>
          </div>
          ${p.biography ? `<p style="color:var(--muted);font-size:15px;line-height:1.8;margin-bottom:24px">${p.biography}</p>` : ""}
          <div class="rel-section"><h3>${I18n.t("genealogy.parents")}</h3>${relList(data.parents, "noParents")}</div>
          <div class="rel-section"><h3>${I18n.t("genealogy.children")}</h3>${relList(data.children, "noChildren")}</div>
          <div class="rel-section"><h3>${I18n.t("genealogy.siblings")}</h3>${relList(data.siblings, "noSiblings")}</div>
          <div class="rel-section">
            <h3>${I18n.t("genealogy.ancestors")}${data.ancestors?.length ? ` <span style="font-size:12px;font-weight:400;color:var(--muted)">(${data.ancestors.length})</span>` : ""}</h3>
            ${ancestorPath(data.ancestors)}
          </div>
          <div class="rel-section">
            <h3>${I18n.t("genealogy.descendants")}${data.descendants?.length ? ` <span style="font-size:12px;font-weight:400;color:var(--muted)">(${data.descendants.length})</span>` : ""}</h3>
            ${descendantPath(data.descendants)}
          </div>
        </div>`;

      /* Kick off the SVG tree renderer */
      _initFamilyTree(pubId, p.fullName, p.village);

    } catch (err) {
      personContent.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  }

}());

/* ═══════════════════════════════════════════════════════════════════════════
   INTERACTIVE FAMILY TREE RENDERER
   ───────────────────────────────────────────────────────────────────────────
   Renders an SVG-connected card tree for a given person.
   Called by _loadPersonProfile above.
   ═══════════════════════════════════════════════════════════════════════════ */

function _initFamilyTree(rootPubId, rootName, rootVillage) {
  const treeSection    = document.querySelector("#person-tree-section");
  const canvas         = document.querySelector("#family-tree-canvas");
  const svgEl          = document.querySelector("#tree-svg");
  const nodesLayer     = document.querySelector("#tree-nodes-layer");
  const expandAllBtn   = document.querySelector("#tree-expand-all");
  const collapseAllBtn = document.querySelector("#tree-collapse-all");
  const printBtn       = document.querySelector("#tree-print");
  if (!treeSection || !canvas || !nodesLayer) return;

  const NODE_W = 170;
  const NODE_H = 68;
  const H_GAP  = 24;
  const V_GAP  = 80;

  const expanded = new Set();
  let rootNode   = null;

  /* Fetch tree data for a person */
  async function _fetch(pubId) {
    try {
      const r = await fetch(`/api/genealogy/people/${pubId}/tree`);
      return r.ok ? (await r.json()).tree : null;
    } catch (_) { return null; }
  }

  /* Calculate total pixel width a subtree needs */
  function _width(node) {
    const kids = expanded.has(node._pid) ? (node.children || []) : [];
    if (!kids.length) return NODE_W + H_GAP;
    return kids.reduce((s, c) => s + _width(c), 0);
  }

  /* Assign x,y positions to every node recursively */
  const laid = [];
  function _layout(node, depth, leftPx) {
    const kids   = expanded.has(node._pid) ? (node.children || []) : [];
    const totalW = _width(node);
    const nodeX  = leftPx + (totalW - NODE_W - H_GAP) / 2;

    laid.push({ ...node, _depth: depth, _x: Math.max(0, nodeX), _y: depth * (NODE_H + V_GAP) + 20 });

    let cl = leftPx;
    for (const c of kids) { _layout(c, depth + 1, cl); cl += _width(c); }
  }

  /* Full render pass */
  function render() {
    laid.length = 0;
    _layout(rootNode, 0, 0);

    const totalW = laid.reduce((m, n) => Math.max(m, n._x + NODE_W + H_GAP), NODE_W + H_GAP);
    const totalH = laid.reduce((m, n) => Math.max(m, n._y + NODE_H + 20), NODE_H + 40);

    canvas.style.minWidth  = totalW + "px";
    canvas.style.minHeight = totalH + "px";
    svgEl.setAttribute("width",  totalW);
    svgEl.setAttribute("height", totalH);
    svgEl.innerHTML     = "";
    nodesLayer.innerHTML = "";
    nodesLayer.style.width  = totalW + "px";
    nodesLayer.style.height = totalH + "px";

    /* SVG connector lines (curved bezier parent→child) */
    const laidMap = new Map(laid.map(n => [n._pid, n]));
    laid.forEach(parent => {
      if (!expanded.has(parent._pid)) return;
      (parent.children || []).forEach(child => {
        const cn = laidMap.get(child._pid);
        if (!cn) return;
        const x1 = parent._x + NODE_W / 2, y1 = parent._y + NODE_H;
        const x2 = cn._x + NODE_W / 2,     y2 = cn._y;
        const my = (y1 + y2) / 2;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`);
        path.setAttribute("stroke", "#c49a45");
        path.setAttribute("stroke-width", "1.5");
        path.setAttribute("fill", "none");
        path.setAttribute("opacity", "0.65");
        svgEl.appendChild(path);
      });
    });

    /* Node cards */
    laid.forEach(node => {
      const card = document.createElement("div");
      card.className = "tree-node-card" + (node._depth === 0 ? " selected" : "");
      card.style.cssText = `left:${node._x}px;top:${node._y}px;width:${NODE_W}px`;

      const hasKids = (node.children || []).length > 0;
      const isOpen  = expanded.has(node._pid);
      const gen     = node._depth === 0
        ? I18n.t("genealogy.treeRoot")
        : `${I18n.t("genealogy.generation")} ${node._depth + 1}`;

      card.innerHTML = `
        <div class="node-name">${node._name || "?"}</div>
        <div class="node-meta">${node._village || ""}</div>
        <span class="node-gen">${gen}</span>
        ${hasKids ? `<button class="node-expand-btn">${isOpen ? "−" : "+"}</button>` : ""}
      `;

      /* Click card → navigate (except root) */
      card.addEventListener("click", e => {
        if (e.target.classList.contains("node-expand-btn")) return;
        if (node._pid && node._pid !== rootPubId) {
          window.location.href = `/vanshawali.html?person=${node._pid}`;
        }
      });

      /* Expand/collapse button */
      const btn = card.querySelector(".node-expand-btn");
      if (btn) {
        btn.addEventListener("click", async e => {
          e.stopPropagation();
          if (expanded.has(node._pid)) {
            expanded.delete(node._pid);
            render();
          } else {
            expanded.add(node._pid);
            /* Lazy load children if not fetched yet */
            if (!(node.children || []).length) {
              btn.textContent = "…";
              btn.disabled    = true;
              const tree = await _fetch(node._pid);
              node.children = (tree?.children || []).map(c => ({
                _pid:     c.publicId || c.public_id,
                _name:    c.fullName || c.full_name,
                _village: c.village || "",
                children: [],
              }));
              btn.disabled = false;
              if (!node.children.length) { expanded.delete(node._pid); render(); return; }
            }
            render();
          }
        });
      }

      nodesLayer.appendChild(card);
    });
  }

  /* Bootstrap */
  (async function boot() {
    treeSection.hidden = false;
    nodesLayer.innerHTML = `<div style="padding:20px;color:var(--muted);font-size:13px">${I18n.t("genealogy.treeLoading")}</div>`;

    const tree = await _fetch(rootPubId);
    rootNode = {
      _pid:     rootPubId,
      _name:    tree?.person?.fullName || tree?.person?.full_name || rootName || "?",
      _village: tree?.person?.village  || rootVillage || "",
      children: (tree?.children || []).map(c => ({
        _pid:     c.publicId || c.public_id,
        _name:    c.fullName || c.full_name,
        _village: c.village || "",
        children: [],
      })),
    };
    render();
  }());

  /* Control buttons */
  expandAllBtn?.addEventListener("click", () => {
    laid.forEach(n => { if ((n.children || []).length) expanded.add(n._pid); });
    render();
  });
  collapseAllBtn?.addEventListener("click", () => { expanded.clear(); render(); });
  printBtn?.addEventListener("click", () => window.print());
}
