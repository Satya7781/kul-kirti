const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

function loadFamilyTree() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read("public/js/family-tree.js"), sandbox);
  return sandbox.window.FamilyTree;
}

test("visual hierarchy follows verified relationships and keeps daughters as leaves", () => {
  const FamilyTree = loadFamilyTree();
  const people = [
    { id: "root", full_name: "मूल", member_type: "root", birth_order: 0, public_id: "pub-root" },
    { id: "son", full_name: "पुत्र", member_type: "son", birth_order: 1, public_id: "pub-son" },
    { id: "daughter", full_name: "पुत्री", member_type: "daughter", birth_order: 2, public_id: "pub-daughter" },
    { id: "grandson", full_name: "पौत्र", member_type: "son", birth_order: 1 },
    { id: "orphan", full_name: "अन्य", member_type: "son", birth_order: 0 },
  ];
  const relationships = [
    { parent_id: "root", child_id: "son" },
    { parent_id: "root", child_id: "daughter" },
    { parent_id: "son", child_id: "grandson" },
    { parent_id: "daughter", child_id: "orphan" },
    { parent_id: "grandson", child_id: "root" },
  ];

  const nodes = FamilyTree.buildNodesFromVisual(people, relationships, {
    rootId: "root",
    profileUrl: person => `/person/${person.public_id || person.id}`,
  });

  assert.equal(nodes[0].id, "root");
  assert.equal(nodes[0].children.map(node => node.name).join("|"), "पुत्र|पुत्री");
  assert.equal(nodes[0].children[0].children.map(node => node.name).join("|"), "पौत्र");
  assert.equal(nodes[0].children[1].children.length, 0);
  assert.equal(nodes[0].children[0].profileUrl, "/person/pub-son");
  assert.equal(nodes.some(node => node.id === "orphan"), true);
});

test("editor hierarchy uses parentId links but never expands daughters", () => {
  const FamilyTree = loadFamilyTree();
  const members = [
    { clientId: "r", name: "मूल", memberType: "root", birthOrder: 0 },
    { clientId: "d", name: "पुत्री", memberType: "daughter", parentId: "r", birthOrder: 1 },
    { clientId: "x", name: "गलत शाखा", memberType: "son", parentId: "d", birthOrder: 0 },
    { clientId: "s", name: "पुत्र", memberType: "son", parentId: "r", birthOrder: 2 },
  ];

  const [root] = FamilyTree.buildNodesFromParentMap(members);
  assert.equal(root.children.map(node => node.name).join("|"), "पुत्री|पुत्र");
  assert.equal(root.children[0].children.length, 0);
  assert.equal(root.children[1].children.length, 0);
  assert.equal(root.children[1].wifeName, "");
  assert.equal(root.children[1].wifeGotra, "");
  assert.equal(root.children[0].marriedGotra, "");
});

test("verified visual payload carries optional spouse and married gotras into nodes", () => {
  const FamilyTree = loadFamilyTree();
  const [node] = FamilyTree.buildNodesFromVisual([
    { id: "r", full_name: "मूल", member_type: "root", wife_name: "माता", wife_gotra: "गेहलोत" },
    { id: "d", full_name: "पुत्री", member_type: "daughter", married_gotra: "जैन" },
  ], [
    { parent_id: "r", child_id: "d", relation_type: "biological" },
  ]);
  assert.equal(node.wifeGotra, "गेहलोत");
  assert.equal(node.children[0].marriedGotra, "जैन");
});

test("both tree pages and the build check load the shared renderer", () => {
  for (const page of ["vanshawali.html", "vanshawali-create.html"]) {
    assert.match(read(page), /\/public\/js\/family-tree\.js/);
  }
  assert.match(read("scripts/build-check.js"), /"public\/js\/family-tree\.js"/);
  assert.match(read("vanshawali.html"), /genealogy\.treeHint/);
  assert.match(read("locales/hi.json"), /"treeHint"/);
  assert.match(read("locales/en.json"), /"treeHint"/);
});

test("admin verification review exposes a connected box-tree preview", () => {
  const adminPage = read("admin.html");
  const adminJs = read("public/js/admin-console.js");
  const adminCss = read("public/css/admin-console.css");

  assert.match(adminPage, /\/public\/js\/family-tree\.js/);
  assert.match(adminJs, /"verification-preview": \["verification", "view"\]/);
  assert.match(adminJs, /"verification-preview", id\)/);
  assert.match(adminJs, /FamilyTree\.buildNodesFromParentMap\(state\.treeDraft\)/);
  assert.match(adminJs, /FamilyTree\.createView\(\{/);
  assert.match(adminJs, /admin-tree-preview__canvas/);
  assert.match(adminCss, /\.admin-tree-preview__canvas/);
  assert.match(read("pages.css"), /\.family-tree-node__main/);
});

test("editable box tree exposes a pencil that opens the member editor", () => {
  function fakeElement(tag) {
    return {
      tagName: tag, children: [], style: {}, dataset: {}, listeners: {}, attrs: {},
      classList: {
        names: [],
        add(name) { this.names.push(name); },
        contains(name) { return this.names.includes(name); },
      },
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      appendChild(child) { this.children.push(child); return child; },
      set innerHTML(value) { this._html = value; },
      get innerHTML() { return this._html || ""; },
      querySelector() { return null; },
    };
  }
  const sandbox = { window: {}, document: { createElement: fakeElement } };
  vm.createContext(sandbox);
  vm.runInContext(read("public/js/family-tree.js"), sandbox);
  const FamilyTree = sandbox.window.FamilyTree;
  const nodes = FamilyTree.buildNodesFromParentMap([
    { clientId: "r", name: "मूल", memberType: "root", village: "गांव", birthOrder: 0 },
    { clientId: "s", name: "पुत्र", memberType: "son", parentId: "r", village: "गांव", birthOrder: 1 },
  ]);
  let edited = null;
  const inner = fakeElement("div");
  const view = FamilyTree.createView({
    inner, nodes, expanded: ["r"], editable: true, onEdit: node => { edited = node.id; },
  });
  view.render();

  const cards = inner.children;
  const rootCard = cards.find(card => card.dataset.treeNodeId === "r");
  assert.equal(cards.length, 2);
  assert.ok(rootCard);
  const pencil = rootCard.children.find(child => child.className === "family-tree-node__edit");
  assert.ok(pencil, "editable box has an edit affordance");
  pencil.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(edited, "r");
  assert.match(inner.innerHTML, /<path d="M /, "connectors are still rendered in edit mode");
  assert.ok(rootCard.classList.contains("family-tree-node--editable"));

  const readonly = fakeElement("div");
  FamilyTree.createView({ inner: readonly, nodes, expanded: ["r"] }).render();
  assert.equal(readonly.children.some(card => card.children.some(child => child.className === "family-tree-node__edit")), false);
});

test("admin box editor saves the edited revision with verified re-check intent", () => {
  const adminJs = read("public/js/admin-console.js");
  const adminCss = read("public/css/admin-console.css");
  assert.match(adminJs, /"tree-box-edit": \["trees", "edit"\]/);
  assert.match(adminJs, /onEdit: node => openTreeMemberEditor\(node\.id\)/);
  assert.match(adminJs, /currentRevision: state\.treeDraft/);
  assert.match(adminJs, /revisionIntent: meta\.status === "verified"/);
  assert.match(adminJs, /\}, "PATCH"\);/);
  assert.match(adminJs, /admin-tree-edit-name/);
  assert.match(adminJs, /admin-tree-edit-parent/);
  assert.match(adminJs, /admin-tree-edit-add-daughter/);
  assert.match(adminCss, /\.admin-tree-preview\.is-editable \.admin-tree-preview__body/);
  assert.match(adminCss, /\.admin-tree-editor__fields/);
  assert.match(read("pages.css"), /\.family-tree-node__edit/);
});

test("public child query supplies birth order and expandability metadata", () => {
  const source = read("lib/genealogy.js");
  assert.match(source, /p\.wife_name,\s*p\.wife_gotra, p\.married_gotra, p\.member_type,\s*p\.birth_order/);
  assert.match(source, /AS child_count/);
  assert.match(source, /ORDER BY p\.birth_order NULLS LAST, p\.full_name/);
});
