/**
 * Kul-Kirti — family-tree.js
 * ==========================
 * Shared interactive family-tree renderer.
 *
 * Every tree view (public person tree, verified tree detail, and the token
 * editor preview) uses this module so the same genealogy produces the same
 * boxes, connectors and expand/collapse behaviour.
 *
 * Public API (window.FamilyTree):
 *   createView(options)              → view instance
 *   buildNodesFromVisual(...)        → root nodes from /visual payloads
 *   buildNodesFromParentMap(...)     → root nodes from editor drafts
 */

(function (window) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const DEFAULT_LABELS = {
    connections: "वंश वृक्ष में सदस्यों के बीच संबंध रेखाएँ",
    wife: "पत्नी",
    village: "गांव",
    profile: "प्रोफ़ाइल",
    viewProfile: "प्रोफ़ाइल देखें",
    root: "मूल व्यक्ति",
    loading: "लोड हो रहा है...",
    children: n => `${n} संतान`,
    generation: n => `पीढ़ी ${n}`,
    expand: "शाखाएँ फैलाएँ",
    collapse: "शाखाएँ संक्षिप्त करें",
  };

  const DEFAULT_OPTIONS = {
    nodeWidth: 190,
    nodeHeight: 92,
    hGap: 28,
    vGap: 78,
    padding: 24,
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function compareByBirthOrder(a, b) {
    const ao = a.birthOrder ?? a.birth_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.birthOrder ?? b.birth_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    const an = a.name || a.full_name || a.fullName || "";
    const bn = b.name || b.full_name || b.fullName || "";
    return String(an).localeCompare(String(bn), "hi");
  }

  /**
   * Build a single-parent hierarchy from a verified-tree visual payload.
   * person_relationships remains the source of truth: a child is attached
   * only when both ends of the relationship are present in the payload.
   */
  function buildNodesFromVisual(people, relationships, options = {}) {
    const source = Array.isArray(people) ? people : [];
    const byId = new Map(source.map(p => [p.id, p]));
    const childrenByParent = new Map();
    const parentOf = new Map();

    (Array.isArray(relationships) ? relationships : []).forEach(rel => {
      const parentId = rel.parent_id ?? rel.parentId;
      const childId = rel.child_id ?? rel.childId;
      if (!byId.has(parentId) || !byId.has(childId) || parentId === childId) return;
      if (options.rootId && childId === options.rootId) return;
      if ((byId.get(parentId).member_type || byId.get(parentId).memberType) === "daughter") return;
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      const list = childrenByParent.get(parentId);
      if (!list.some(id => id === childId)) list.push(childId);
      if (!parentOf.has(childId)) parentOf.set(childId, parentId);
    });

    function toNode(person, ancestors) {
      const childIds = (childrenByParent.get(person.id) || [])
        .filter(id => !ancestors.has(id));
      const children = childIds
        .map(id => byId.get(id))
        .filter(Boolean)
        .sort(compareByBirthOrder)
        .map(child => {
          const next = new Set(ancestors);
          next.add(person.id);
          return toNode(child, next);
        });

      return {
        id: person.id,
        name: person.full_name || person.fullName || "?",
        wifeName: person.wife_name || person.wifeName || "",
        village: person.village || "",
        memberType: person.member_type || person.memberType || "son",
        birthOrder: person.birth_order ?? person.birthOrder ?? null,
        publicId: person.public_id || person.publicId || null,
        profileUrl: options.profileUrl ? options.profileUrl(person) : null,
        childCount: childIds.length,
        children,
      };
    }

    const roots = source.filter(person =>
      !parentOf.has(person.id) || !byId.has(parentOf.get(person.id))
    );
    if (options.rootId) {
      roots.sort((a, b) => {
        if (a.id === options.rootId) return -1;
        if (b.id === options.rootId) return 1;
        return compareByBirthOrder(a, b);
      });
    } else {
      roots.sort(compareByBirthOrder);
    }
    return roots.map(person => toNode(person, new Set()));
  }

  /** Build a hierarchy from editor members that use parentId/clientId. */
  function buildNodesFromParentMap(members, options = {}) {
    const source = Array.isArray(members) ? members : [];
    const byId = new Map(source.map(m => [m.clientId || m.id, m]));
    const childrenByParent = new Map();

    source.forEach(member => {
      const id = member.clientId || member.id;
      const parentId = member.parentId;
      if (!parentId || !byId.has(parentId) || parentId === id) return;
      if (byId.get(parentId).memberType === "daughter") return;
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(id);
    });

    function toNode(member, ancestors) {
      const childIds = (childrenByParent.get(member.clientId || member.id) || [])
        .filter(id => !ancestors.has(id));
      const children = childIds
        .map(id => byId.get(id))
        .filter(Boolean)
        .sort(compareByBirthOrder)
        .map(child => {
          const next = new Set(ancestors);
          next.add(member.clientId || member.id);
          return toNode(child, next);
        });

      return {
        id: member.clientId || member.id,
        name: member.name || "?",
        wifeName: member.wifeName || "",
        village: member.village || "",
        memberType: member.memberType || "son",
        birthOrder: member.birthOrder ?? null,
        publicId: member.publicId || null,
        profileUrl: options.profileUrl ? options.profileUrl(member) : null,
        childCount: childIds.length,
        children,
      };
    }

    const roots = source.filter(member =>
      !member.parentId || !byId.has(member.parentId)
    );
    return roots.sort(compareByBirthOrder).map(member => toNode(member, new Set()));
  }

  function createView(options = {}) {
    const inner = options.inner;
    if (!inner) return null;

    const cfg = {
      ...DEFAULT_OPTIONS,
      ...options,
      labels: { ...DEFAULT_LABELS, ...(options.labels || {}) },
    };

    const state = {
      roots: Array.isArray(options.nodes) ? options.nodes : [],
      expanded: options.expanded instanceof Set ? options.expanded : new Set(options.expanded || []),
      loading: new Set(),
      zoom: Number(options.zoom) > 0 ? Number(options.zoom) : 1,
      size: { width: 0, height: 0 },
    };

    function childrenOf(node) {
      if (!node || node.memberType === "daughter") return [];
      return Array.isArray(node.children) ? node.children : [];
    }

    function hasChildren(node) {
      if (!node || node.memberType === "daughter") return false;
      return Boolean(node.hasChildren) || childrenOf(node).length > 0;
    }

    function allNodes() {
      const found = [];
      const seen = new Set();
      function visit(node) {
        if (!node || seen.has(node.id)) return;
        seen.add(node.id);
        found.push(node);
        childrenOf(node).forEach(visit);
      }
      state.roots.forEach(visit);
      return found;
    }

    function layout() {
      const positions = new Map();
      let cursor = cfg.padding;
      let maxDepth = 0;

      function place(node, depth, ancestors) {
        maxDepth = Math.max(maxDepth, depth);
        const kids = state.expanded.has(node.id) && !ancestors.has(node.id)
          ? childrenOf(node).filter(child => !ancestors.has(child.id))
          : [];

        let x;
        if (!kids.length) {
          x = cursor;
          cursor += cfg.nodeWidth + cfg.hGap;
        } else {
          const nextAncestors = new Set(ancestors);
          nextAncestors.add(node.id);
          const centres = kids.map(child => place(child, depth + 1, nextAncestors));
          x = (centres[0] + centres[centres.length - 1]) / 2;
        }

        positions.set(node.id, {
          node,
          x,
          y: cfg.padding + depth * (cfg.nodeHeight + cfg.vGap),
          depth,
          kids,
        });
        return x;
      }

      state.roots.forEach(root => place(root, 0, new Set()));

      return {
        positions,
        width: Math.max(cursor - cfg.hGap + cfg.padding, cfg.nodeWidth + cfg.padding * 2),
        height: cfg.padding * 2 + (maxDepth + 1) * cfg.nodeHeight + maxDepth * cfg.vGap,
      };
    }

    function connectorPaths(positions) {
      const paths = [];
      positions.forEach(pos => {
        if (!pos.kids.length) return;
        const kids = pos.kids.map(child => positions.get(child.id)).filter(Boolean);
        if (!kids.length) return;

        const parentX = pos.x + cfg.nodeWidth / 2;
        const parentBottom = pos.y + cfg.nodeHeight;
        const childTop = kids[0].y;
        const branchY = parentBottom + Math.max(18, (childTop - parentBottom) / 2);
        const childCentres = kids.map(kid => kid.x + cfg.nodeWidth / 2);

        paths.push(`M ${parentX} ${parentBottom} V ${branchY}`);
        paths.push(`M ${Math.min(...childCentres)} ${branchY} H ${Math.max(...childCentres)}`);
        childCentres.forEach(x => paths.push(`M ${x} ${branchY} V ${childTop}`));
      });
      return paths;
    }

    function createCard(pos) {
      const node = pos.node;
      const daughter = node.memberType === "daughter";
      const expandable = hasChildren(node) || Boolean(!node.childrenLoaded && options.loadChildren);
      const open = state.expanded.has(node.id);
      const loading = state.loading.has(node.id);
      const childCount = Number(node.childCount || childrenOf(node).length || 0);

      const card = document.createElement("div");
      card.className = "family-tree-node family-tree-node--" +
        (daughter ? "daughter" : (node.memberType || "son"));
      if (pos.depth === 0) card.classList.add("family-tree-node--root");
      if (open) card.classList.add("is-open");
      card.style.left = `${pos.x}px`;
      card.style.top = `${pos.y}px`;
      card.style.width = `${cfg.nodeWidth}px`;
      card.dataset.treeNodeId = String(node.id);

      const main = document.createElement("button");
      main.type = "button";
      main.className = "family-tree-node__main";
      if (expandable) main.setAttribute("aria-expanded", String(open));
      else main.setAttribute("aria-disabled", "true");

      const meta = daughter ? "" :
        `<span class="family-tree-node__meta">${cfg.labels.wife}: ${escapeHtml(node.wifeName || "—")}</span>` +
        `<span class="family-tree-node__meta">${cfg.labels.village}: ${escapeHtml(node.village || "—")}</span>`;

      main.innerHTML =
        `<span class="family-tree-node__name">${escapeHtml(node.name || "?")}</span>` +
        meta +
        `<span class="family-tree-node__footer">` +
          `<span class="family-tree-node__kind">${
            escapeHtml(pos.depth === 0 ? cfg.labels.root : cfg.labels.generation(pos.depth + 1))
          }</span>` +
          (expandable && childCount
            ? `<span class="family-tree-node__count">${escapeHtml(cfg.labels.children(childCount))}</span>`
            : "") +
          (expandable
            ? `<span class="family-tree-node__toggle" aria-hidden="true">${
                loading ? "…" : open ? "−" : "+"
              }</span>`
            : "") +
        `</span>`;

      main.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        activate(node, expandable);
      });
      card.appendChild(main);

      if (node.profileUrl) {
        const profile = document.createElement("a");
        profile.className = "family-tree-node__profile";
        profile.href = node.profileUrl;
        profile.textContent = "↗";
        profile.setAttribute("aria-label", `${cfg.labels.viewProfile}: ${node.name || ""}`);
        profile.addEventListener("click", event => event.stopPropagation());
        card.appendChild(profile);
      }

      return card;
    }

    function render(focusId) {
      const { positions, width, height } = layout();
      state.size = { width, height };
      inner.style.width = `${width}px`;
      inner.style.height = `${height}px`;
      inner.style.transform = `scale(${state.zoom})`;
      inner.innerHTML =
        `<span class="visually-hidden">${escapeHtml(cfg.labels.connections)}</span>` +
        `<svg class="family-tree-svg" width="${width}" height="${height}" ` +
          `viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">` +
          `<title>${escapeHtml(cfg.labels.connections)}</title>` +
          `<g class="family-tree-links" fill="none" stroke="currentColor" stroke-width="2">` +
            connectorPaths(positions).map(d => `<path d="${d}" />`).join("") +
          `</g>` +
        `</svg>`;

      positions.forEach(pos => inner.appendChild(createCard(pos)));

      if (focusId) {
        const focusNode = inner.querySelector(
          `[data-tree-node-id="${window.CSS && window.CSS.escape ? window.CSS.escape(String(focusId)) : String(focusId)}"]`
        );
        focusNode?.scrollIntoView({ block: "center", inline: "center" });
      }
      return { ...state.size };
    }

    async function loadMissingChildren(node) {
      if (node.childrenLoaded || typeof options.loadChildren !== "function") return;
      if (state.loading.has(node.id)) return;
      state.loading.add(node.id);
      render();
      try {
        const children = await options.loadChildren(node) || [];
        node.children = Array.isArray(children) ? children : [];
        node.childrenLoaded = true;
        node.hasChildren = node.children.length > 0;
      } catch (_) {
        node.childrenLoaded = false;
      } finally {
        state.loading.delete(node.id);
      }
    }

    async function toggle(node) {
      if (!node) return;
      if (state.expanded.has(node.id)) {
        state.expanded.delete(node.id);
        render();
        return;
      }
      await loadMissingChildren(node);
      if (hasChildren(node)) state.expanded.add(node.id);
      render();
    }

    async function activate(node, expandable) {
      if (expandable) {
        await toggle(node);
        return;
      }
      if (node?.profileUrl) {
        if (typeof options.onOpen === "function") options.onOpen(node);
        else window.location.href = node.profileUrl;
      }
    }

    async function expandAll() {
      const seen = new Set();
      async function visit(node) {
        if (!node || seen.has(node.id) || node.memberType === "daughter") return;
        seen.add(node.id);
        if (!node.childrenLoaded && typeof options.loadChildren === "function") {
          await loadMissingChildren(node);
        }
        if (hasChildren(node)) {
          state.expanded.add(node.id);
          for (const child of childrenOf(node)) await visit(child);
        }
      }
      for (const root of state.roots) await visit(root);
      render();
    }

    function collapseAll(keepRoots = true) {
      state.expanded.clear();
      if (keepRoots) {
        state.roots.forEach(root => {
          if (hasChildren(root)) state.expanded.add(root.id);
        });
      }
      render();
    }

    function setNodes(nodes, nextExpanded) {
      state.roots = Array.isArray(nodes) ? nodes : [];
      if (nextExpanded instanceof Set) state.expanded = nextExpanded;
      else if (Array.isArray(nextExpanded)) state.expanded = new Set(nextExpanded);
      render();
    }

    function setZoom(zoom) {
      state.zoom = Math.min(2, Math.max(0.4, Number(zoom) || 1));
      inner.style.transform = `scale(${state.zoom})`;
      return state.zoom;
    }

    function zoomBy(delta) {
      return setZoom(state.zoom + delta);
    }

    function fit(canvasWidth) {
      const usable = Math.max(200, Number(canvasWidth) - 40);
      return setZoom(Math.min(1, usable / (state.size.width || cfg.nodeWidth)));
    }

    return {
      state,
      render,
      expandAll,
      collapseAll,
      expand: toggle,
      collapse: node => {
        if (!node) return;
        state.expanded.delete(node.id);
        render();
      },
      setNodes,
      setZoom,
      zoomBy,
      fit,
      getSize: () => ({ ...state.size }),
    };
  }

  window.FamilyTree = {
    createView,
    buildNodesFromVisual,
    buildNodesFromParentMap,
    escapeHtml,
  };
})(window);
