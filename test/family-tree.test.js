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
  assert.match(adminJs, /FamilyTree\.buildNodesFromParentMap\(members \|\| \[\]\)/);
  assert.match(adminJs, /FamilyTree\.createView\(\{/);
  assert.match(adminJs, /admin-tree-preview__canvas/);
  assert.match(adminCss, /\.admin-tree-preview__canvas/);
  assert.match(read("pages.css"), /\.family-tree-node__main/);
});

test("public child query supplies birth order and expandability metadata", () => {
  const source = read("lib/genealogy.js");
  assert.match(source, /p\.wife_name,\s*p\.member_type,\s*p\.birth_order/);
  assert.match(source, /AS child_count/);
  assert.match(source, /ORDER BY p\.birth_order NULLS LAST, p\.full_name/);
});
