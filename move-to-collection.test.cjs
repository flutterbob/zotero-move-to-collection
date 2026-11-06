const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const collections = new Map();
  const items = new Map();
  const errors = [];
  const recent = [];
  const context = vm.createContext({
    Zotero: {
      locale: 'en-US', debug() {}, logError(error) { errors.push(error); },
      Collections: {
        get(id) { return collections.get(id); },
        getByLibrary(libraryID) {
          return [...collections.values()].filter(c => c.libraryID === libraryID && !c.deleted);
        },
        getRecent() { return []; }, addToRecent(collection) { recent.push(collection.id); }
      },
      Items: { get(ids) { return ids.map(id => items.get(id)); } },
      DB: { async executeTransaction(run) { await run(); } }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'bootstrap.js'), 'utf8'), context);
  function collection(id, name, parentID = null, libraryID = 1) {
    const value = { id, name, parentID, libraryID, hasItem(item) { return item.memberships.has(id); } };
    collections.set(id, value);
    return value;
  }
  function item(id, memberships, options = {}) {
    const value = {
      id, libraryID: 1, memberships: new Set(memberships), saves: [],
      isTopLevelItem() { return !options.child; },
      getCollections() { return [...this.memberships]; },
      addToCollection(id) { this.memberships.add(id); },
      removeFromCollection(id) { this.memberships.delete(id); },
      async save(options) { this.saves.push(options); }, ...options
    };
    items.set(id, value);
    return value;
  }
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.handlers = {}; this.ownerDocument = doc; }
    setAttribute(name, value) { this.attributes[name] = value; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    get firstChild() { return this.children[0]; }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    addEventListener(name, run) { this.handlers[name] = run; }
    async emit(name) { await this.handlers[name]?.({ target: this, currentTarget: this, stopPropagation() {} }); }
  }
  const doc = { createXULElement(tag) { return new Node(tag); } };
  function state(selected, inLibrary = true, source = null) {
    return context.getMoveState({
      collectionTreeRows: [{ isCollection: () => !inLibrary, isLibrary: () => inLibrary, editable: true, ref: inLibrary ? { libraryID: 1 } : source }],
      items: selected
    });
  }
  return { context, collection, item, items, collections, errors, recent, state, popup: () => new Node('menupopup') };
}

test('My Library 可显示菜单，子附件和跨库选择被排除', () => {
  const f = fixture(); const article = f.item(1, []);
  assert.equal(f.state([article]).chooseSource, true);
  assert.equal(f.state([f.item(2, [], { child: true })]), null);
  assert.equal(f.state([f.item(3, [], { libraryID: 2 })]), null);
  assert.equal(f.state([f.item(4, [], { deleted: true })]), null);
});

test('资料库菜单按来源分组，并只移动属于所选来源的文献', async () => {
  const f = fixture(); f.collection(10, 'Source A'); f.collection(20, 'Source B'); f.collection(30, 'Destination');
  const a = f.item(1, [10, 20]); const b = f.item(2, [20]); const popup = f.popup();
  f.context.buildDynamicPopup(popup, f.state([a, b]));
  assert.equal(popup.children[0].attributes.label, 'Choose the source collection first');
  const source = popup.children.find(n => n.attributes.label === 'From: Source A (1)');
  const targets = source.children[0]; await targets.emit('popupshowing');
  assert.ok(!targets.children.some(n => n.attributes.label === 'Source A'));
  await targets.children.find(n => n.attributes.label === 'Destination').emit('command');
  assert.deepEqual([...a.memberships].sort(), [20, 30]);
  assert.deepEqual([...b.memberships], [20]);
  assert.equal(b.saves.length, 0);
  assert.equal(a.saves[0].skipDateModifiedUpdate, true);
  assert.deepEqual(f.errors, []);
});

test('全部未分类时直接显示目标分类', async () => {
  const f = fixture(); f.collection(10, 'Destination'); const item = f.item(1, []); const popup = f.popup();
  f.context.buildDynamicPopup(popup, f.state([item]));
  assert.equal(popup.children[0].attributes.label, 'Destination');
  await popup.children[0].emit('command');
  assert.deepEqual([...item.memberships], [10]);
});

test('混合选择的未分类分组仅添加未分类文献', async () => {
  const f = fixture(); f.collection(10, 'Source'); f.collection(20, 'Destination');
  const filed = f.item(1, [10]); const unfiled = f.item(2, []); const popup = f.popup();
  f.context.buildDynamicPopup(popup, f.state([filed, unfiled]));
  const targets = popup.children.find(n => n.attributes.label === 'Unfiled Items (1)').children[0];
  await targets.emit('popupshowing');
  await targets.children.find(n => n.attributes.label === 'Destination').emit('command');
  assert.deepEqual([...filed.memberships], [10]);
  assert.deepEqual([...unfiled.memberships], [20]);
});

test('执行前重新检查来源归属，避免移动已离开该来源的文献', async () => {
  const f = fixture(); const source = f.collection(10, 'Source'); const target = f.collection(20, 'Destination');
  const item = f.item(1, [30]);
  await f.context.moveItems({ source, libraryID: 1, items: [item], requireSourceMembership: true }, target);
  assert.deepEqual([...item.memberships], [30]); assert.equal(item.saves.length, 0);
});

test('未分类文献在菜单展开后被归类时，不再自动添加到目标', async () => {
  const f = fixture(); const target = f.collection(20, 'Destination'); const item = f.item(1, [30]);
  await f.context.moveItems({ source: null, libraryID: 1, items: [item], unfiledOnly: true }, target);
  assert.deepEqual([...item.memberships], [30]); assert.equal(item.saves.length, 0);
});

test('普通 collection 的直接移动保留其他分类和保存选项', async () => {
  const f = fixture(); const source = f.collection(10, 'Source'); const target = f.collection(20, 'Destination');
  const item = f.item(1, [10, 30]); const state = f.state([item], false, source);
  assert.equal(state.chooseSource, false); await f.context.moveItems(state, target);
  assert.deepEqual([...item.memberships].sort(), [20, 30]);
  assert.equal(item.saves[0].skipSelect, true); assert.equal(item.saves[0].skipDateModifiedUpdate, true);
});

test('跨库、已删除目标和已删除文献不会被移动', async () => {
  const f = fixture(); const source = f.collection(10, 'Source'); const otherLibrary = f.collection(20, 'Other Library', null, 2);
  const item = f.item(1, [10]); const state = { source, libraryID: 1, items: [item] };
  await assert.rejects(f.context.moveItems(state, otherLibrary), /same library/);
  const target = f.collection(30, 'Destination'); target.deleted = true;
  await f.context.moveItems(state, target); assert.deepEqual([...item.memberships], [10]);
  target.deleted = false; item.deleted = true;
  await f.context.moveItems(state, target); assert.deepEqual([...item.memberships], [10]);
});

test('目标已有文献时只移除指定来源，不产生重复归属', async () => {
  const f = fixture(); const source = f.collection(10, 'Source'); const target = f.collection(20, 'Destination'); const item = f.item(1, [10, 20, 30]);
  await f.context.moveItems({ source, libraryID: 1, items: [item] }, target);
  assert.deepEqual([...item.memberships], [20, 30]);
});

test('嵌套来源显示完整路径，中文界面使用中文提示', () => {
  const f = fixture(); f.context.Zotero.locale = 'zh-CN'; f.collection(10, 'Papers'); f.collection(20, 'Paper A', 10); f.collection(30, 'Destination');
  const item = f.item(1, [20]); const popup = f.popup(); f.context.buildDynamicPopup(popup, f.state([item]));
  assert.ok(popup.children.some(n => n.attributes.label === '从“Papers › Paper A”移出（1 篇）'));
});
