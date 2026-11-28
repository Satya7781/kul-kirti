const test = require("node:test");
const assert = require("node:assert/strict");
const vsh = require("../lib/vanshawali");

const son = (id, parentId, over = {}) => ({
  clientId: id, parentId, memberType: "son", name: `पुत्र ${id}`,
  wifeName: "पत्नी", village: "गांव", ...over,
});
const daughter = (id, parentId, over = {}) => ({
  clientId: id, parentId, memberType: "daughter", name: `पुत्री ${id}`, ...over,
});
const root = (id = "r", over = {}) => ({
  clientId: id, parentId: null, memberType: "root", name: "मूल पूर्वज",
  wifeName: "माता", village: "गांव", ...over,
});

test("normalizeName is case, whitespace and punctuation insensitive (Devanagari aware)", () => {
  assert.equal(vsh.normalizeName("  गेहलोत   गोत्र  "), "गेहलोत गोत्र");
  assert.equal(vsh.normalizeName("Gehlot-Gotra"), "gehlot gotra");
  assert.equal(vsh.normalizeName("GEHLOT  GOTRA"), "gehlot gotra");
  assert.equal(vsh.normalizeName("गेहलोत, गोत्र!"), "गेहलोत गोत्र");
});

test("valid tree: root, multiple sons, grandchildren and daughter leaves", () => {
  const members = [
    root(), son("s1", "r"), daughter("d1", "r"),
    son("s1a", "s1"), daughter("d2", "s1"), son("s2", "r"),
  ];
  const result = vsh.validateTreeMembers(members);
  assert.equal(result.valid, true, result.error);
  assert.equal(result.members.length, 6);
});

test("entry order does not matter", () => {
  const members = [son("s1a", "s1"), daughter("d1", "r"), son("s1", "r"), root()];
  assert.equal(vsh.validateTreeMembers(members).valid, true);
});

test("daughter is name-only and cannot have descendants", () => {
  const extra = vsh.validateTreeMembers([root(), daughter("d1", "r", { wifeName: "पत्नी" })]);
  assert.equal(extra.valid, false);
  assert.equal(extra.error, "daughter_extra_fields");

  const child = vsh.validateTreeMembers([root(), daughter("d1", "r"), son("s1", "d1")]);
  assert.equal(child.valid, false);
  assert.equal(child.error, "daughter_has_descendant");
});

test("root/son require name and village; wife details are optional", () => {
  const unmarried = vsh.validateTreeMembers([root("r", { wifeName: "" }), son("s1", "r", { wifeName: "" })]);
  assert.equal(unmarried.valid, true, unmarried.error);
  assert.equal(vsh.validateTreeMembers([root(), son("s1", "r", { name: "" }) ]).error, "missing_name");
  assert.equal(vsh.validateTreeMembers([root("r", { village: "" }) ]).error, "missing_village");
});

test("wife gotra and a daughter's married gotra are preserved when supplied", () => {
  const result = vsh.validateTreeMembers([
    root("r", { wifeName: "माता", wifeGotra: "गेहलोत" }),
    daughter("d1", "r", { marriedGotra: "जैन" }),
  ]);
  assert.equal(result.valid, true, result.error);
  assert.equal(result.members[0].wifeGotra, "गेहलोत");
  assert.equal(result.members[1].marriedGotra, "जैन");
});

test("structural integrity: one root, valid parents, no cycles, no unreachable members", () => {
  assert.equal(vsh.validateTreeMembers([]).error, "empty_tree");
  assert.equal(vsh.validateTreeMembers([root(), root("r2")]).error, "multiple_roots");
  assert.equal(vsh.validateTreeMembers([son("s", null)]).error, "missing_root");
  assert.equal(vsh.validateTreeMembers([root("r", { parentId: "x" })]).error, "root_has_parent");
  assert.equal(vsh.validateTreeMembers([root(), son("s", "missing")]).error, "invalid_parent");
  assert.equal(vsh.validateTreeMembers([root(), son("s", "s")]).error, "self_parenting");
  assert.equal(vsh.validateTreeMembers([root(), son("a", "b"), son("b", "a")]).error, "circular_genealogy");
  assert.equal(vsh.validateTreeMembers([root(), son("s", "orphan"), son("orphan", "other")]).error, "invalid_parent");
});

test("duplicate member ids are rejected", () => {
  const result = vsh.validateTreeMembers([root(), son("s", "r"), son("s", "r")]);
  assert.equal(result.valid, false);
  assert.equal(result.error, "duplicate_member_id");
});

test("corrupted revision entries are rejected without throwing", () => {
  assert.equal(vsh.validateTreeMembers([root(), null]).error, "missing_name");
  assert.equal(vsh.validateTreeMembers([null, root()]).error, "missing_name");
  assert.equal(vsh.validateTreeMembers([42]).error, "missing_root");
});

test("no hardcoded generation limit — 40 levels of sons are accepted", () => {
  const members = [root()];
  let parent = "r";
  for (let i = 1; i <= 40; i++) {
    const id = `s${i}`;
    members.push(son(id, parent));
    parent = id;
  }
  const result = vsh.validateTreeMembers(members);
  assert.equal(result.valid, true, result.error);
  assert.equal(result.members.length, 41);
});

test("canHaveChildren only allows root and sons", () => {
  assert.equal(vsh.canHaveChildren("root"), true);
  assert.equal(vsh.canHaveChildren("son"), true);
  assert.equal(vsh.canHaveChildren("daughter"), false);
});
