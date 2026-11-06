const PLUGIN_ID = "move-to-collection@local.openai";
const MENU_REGISTRATION_ID = "move-to-collection-context-menu";
const RECENT_COUNT = 5;

let registeredMenuID = null;

function log(message) {
  try {
    Zotero.debug(`[Move to Collection] ${message}`);
  }
  catch (_) {}
}

function install() {
  log("Installed");
}

async function startup({ id, version, rootURI }) {
  log(`Starting ${version}`);

  registeredMenuID = Zotero.MenuManager.registerMenu({
    menuID: MENU_REGISTRATION_ID,
    pluginID: PLUGIN_ID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        // The label is assigned dynamically in onShowing so we can localize it
        // without bundling/registration of a Fluent localization file.
        onShowing: (event, context) => {
          let state = getMoveState(context);
          context.setVisible(!!state);

          let menuElem = context.menuElem;
          if (!menuElem) return;
          menuElem.setAttribute("label", labels().moveTo);

          if (!state) return;

          let popup = menuElem.querySelector("menupopup");
          if (!popup) return;

          // MenuManager initializes its declared submenu items first. We then
          // replace that placeholder content with the live Collection tree.
          popup.addEventListener("popupshowing", ev => {
            if (ev.target !== ev.currentTarget) return;
            buildDynamicPopup(popup, state);
          }, { once: true });
        },
        // MenuManager requires submenus to contain at least one declared menu.
        // This placeholder is replaced when the submenu is opened.
        menus: [
          {
            menuType: "menuitem"
          }
        ]
      }
    ]
  });

  if (!registeredMenuID) {
    throw new Error("Move to Collection: failed to register context menu");
  }
}

function onMainWindowLoad({ window }) {
  // No per-window DOM injection is needed. Zotero.MenuManager handles windows.
}

function onMainWindowUnload({ window }) {
  // No per-window cleanup is needed.
}

function shutdown() {
  log("Shutting down");
  if (registeredMenuID) {
    try {
      Zotero.MenuManager.unregisterMenu(registeredMenuID);
    }
    catch (e) {
      Zotero.logError(e);
    }
    registeredMenuID = null;
  }
}

function uninstall() {
  log("Uninstalled");
}

function isChineseLocale() {
  let locale = "";
  try {
    locale = Zotero.locale || Services.locale?.appLocaleAsBCP47 || "";
  }
  catch (_) {}
  return /^zh(?:-|$)/i.test(locale);
}

function labels() {
  if (isChineseLocale()) {
    return {
      moveTo: "移动到分类",
      moveHere: name => `移动到“${name}”`,
      chooseSource: "先选择要移出的来源分类",
      source: (name, count) => `从“${name}”移出（${count} 篇）`,
      unfiled: count => `未分类文献（${count} 篇）`,
      empty: "没有可用的目标分类"
    };
  }
  return {
    moveTo: "Move to Collection",
    moveHere: name => `Move to “${name}”`,
    chooseSource: "Choose the source collection first",
    source: (name, count) => `From: ${name} (${count})`,
    unfiled: count => `Unfiled Items (${count})`,
    empty: "No available destination collections"
  };
}

function getMoveState(context) {
  try {
    let rows = context.collectionTreeRows || [];
    if (rows.length !== 1) return null;

    let row = rows[0];
    let inCollection = !!row?.isCollection?.();
    let inLibrary = !!row?.isLibrary?.();
    if (!inCollection && !inLibrary) return null;
    if (row.editable === false) return null;

    let source = inCollection ? row.ref : null;
    let libraryID = row.ref?.libraryID;
    if (!libraryID || (inCollection && !source?.id)) return null;

    let items = context.items || [];
    if (!items.length) return null;

    // Match Zotero's normal Collection semantics: move actual top-level items,
    // not child attachments/notes/annotations via an implicit parent conversion.
    if (!items.every(item => item && item.isTopLevelItem && item.isTopLevelItem())) {
      return null;
    }
    if (!items.every(item => !item.deleted && item.libraryID === libraryID)) {
      return null;
    }

    return {
      source,
      items: items.slice(),
      libraryID,
      chooseSource: inLibrary,
      window: context.menuElem?.ownerDocument?.defaultView || null
    };
  }
  catch (e) {
    Zotero.logError(e);
    return null;
  }
}

function getAllCollections(libraryID) {
  try {
    // true = include descendants/subcollections
    return Zotero.Collections.getByLibrary(libraryID, true) || [];
  }
  catch (e) {
    Zotero.logError(e);
    return [];
  }
}

function compareNames(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function getCollectionPathLabel(collection) {
  let names = [];
  let current = collection;
  let guard = new Set();

  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    names.unshift(current.name || "");
    if (!current.parentID) break;
    current = Zotero.Collections.get(current.parentID);
  }
  return names.join(" › ");
}

function clearPopup(popup) {
  while (popup.firstChild) {
    popup.firstChild.remove();
  }
}

function createMenuItem(doc, label, onCommand, disabled = false) {
  let item = doc.createXULElement("menuitem");
  item.setAttribute("label", label);
  if (disabled) item.setAttribute("disabled", "true");

  if (onCommand) {
    item.addEventListener("command", async event => {
      event.stopPropagation();
      try {
        await onCommand();
      }
      catch (e) {
        Zotero.logError(e);
      }
    });
  }
  return item;
}

function createSeparator(doc) {
  return doc.createXULElement("menuseparator");
}

function makeCollectionNode(doc, collection, childrenMap, state) {
  let children = (childrenMap.get(collection.id) || []).slice().sort(compareNames);
  let move = () => moveItems(state, collection);

  if (!children.length) {
    return createMenuItem(doc, collection.name, move);
  }

  let menu = doc.createXULElement("menu");
  menu.setAttribute("label", collection.name);
  let popup = doc.createXULElement("menupopup");

  // A collection with subcollections is itself also a valid destination.
  popup.appendChild(createMenuItem(doc, labels().moveHere(collection.name), move));
  popup.appendChild(createSeparator(doc));

  for (let child of children) {
    popup.appendChild(makeCollectionNode(doc, child, childrenMap, state));
  }

  menu.appendChild(popup);
  return menu;
}

function buildDynamicPopup(popup, state) {
  if (state.chooseSource) {
    buildSourcePopup(popup, state);
    return;
  }
  clearPopup(popup);
  let doc = popup.ownerDocument;

  // 重新读取来源；没有来源时仅处理未分类文献。
  let source = state.source ? Zotero.Collections.get(state.source.id) : null;
  if (state.source && (!source || source.deleted)) {
    popup.appendChild(createMenuItem(doc, labels().empty, null, true));
    return;
  }
  state.source = source;

  let all = getAllCollections(state.libraryID)
    .filter(collection => collection && !collection.deleted && collection.id !== source?.id);

  if (!all.length) {
    popup.appendChild(createMenuItem(doc, labels().empty, null, true));
    return;
  }

  // Recently used collections appear at the top, like Zotero's native
  // "Add to Collection" menu introduced in Zotero 10.0.2.
  let recent = [];
  try {
    recent = (Zotero.Collections.getRecent(state.libraryID) || [])
      .filter(collection =>
        collection
        && collection.libraryID === state.libraryID
        && !collection.deleted
        && collection.id !== source?.id
      )
      .slice(0, RECENT_COUNT);
  }
  catch (e) {
    Zotero.logError(e);
  }

  for (let collection of recent) {
    popup.appendChild(createMenuItem(
      doc,
      getCollectionPathLabel(collection),
      () => moveItems(state, collection)
    ));
  }
  if (recent.length) {
    popup.appendChild(createSeparator(doc));
  }

  let childrenMap = new Map();
  let allIDs = new Set(all.map(collection => collection.id));
  for (let collection of all) {
    let parentID = collection.parentID || 0;
    if (!childrenMap.has(parentID)) childrenMap.set(parentID, []);
    childrenMap.get(parentID).push(collection);
  }

  // Normally roots are top-level collections. If the current source Collection
  // is excluded from the destination tree, its direct children are promoted so
  // they remain reachable as move targets.
  let roots = all.filter(collection =>
    !collection.parentID
    || collection.parentID === source?.id
    || !allIDs.has(collection.parentID)
  ).sort(compareNames);

  for (let collection of roots) {
    popup.appendChild(makeCollectionNode(doc, collection, childrenMap, state));
  }
}

// 在资料库视图中按来源分组，不把某个分类以外的所选文献一并移动。
function buildSourcePopup(popup, state) {
  clearPopup(popup);
  let doc = popup.ownerDocument;
  let items = Zotero.Items.get(state.items.map(item => item.id))
    .filter(item => item && !item.deleted && item.isTopLevelItem()
      && item.libraryID === state.libraryID);
  let collections = getAllCollections(state.libraryID)
    .filter(collection => collection && !collection.deleted);
  let choices = collections.map(source => ({
    source,
    items: items.filter(item => item.getCollections().includes(source.id))
  })).filter(choice => choice.items.length)
    .sort((a, b) => compareNames(
      { name: getCollectionPathLabel(a.source) },
      { name: getCollectionPathLabel(b.source) }
    ));
  let unfiled = items.filter(item => !item.getCollections().length);

  // 全部未分类时直接显示目标分类，不要求选择不存在的来源。
  if (!choices.length && unfiled.length) {
    buildDynamicPopup(popup, {
      ...state, source: null, items: unfiled, chooseSource: false, unfiledOnly: true
    });
    return;
  }
  if (!choices.length) {
    popup.appendChild(createMenuItem(doc, labels().empty, null, true));
    return;
  }
  popup.appendChild(createMenuItem(doc, labels().chooseSource, null, true));
  function appendSource(label, source, selected, unfiledOnly = false) {
    let menu = doc.createXULElement("menu");
    menu.setAttribute("label", label);
    let destinations = doc.createXULElement("menupopup");
    let nextState = {
      ...state, source, items: selected, chooseSource: false,
      requireSourceMembership: !!source, unfiledOnly
    };
    destinations.addEventListener("popupshowing", event => {
      if (event.target === event.currentTarget) buildDynamicPopup(destinations, nextState);
    });
    // 预填菜单项，使原生子菜单在首次展开前可用。
    destinations.appendChild(createMenuItem(doc, labels().empty, null, true));
    menu.appendChild(destinations);
    popup.appendChild(menu);
  }
  for (let choice of choices) {
    appendSource(
      labels().source(getCollectionPathLabel(choice.source), choice.items.length),
      choice.source, choice.items
    );
  }
  if (unfiled.length) {
    popup.appendChild(createSeparator(doc));
    appendSource(labels().unfiled(unfiled.length), null, unfiled, true);
  }
}

async function moveItems(state, target) {
  let source = state.source ? Zotero.Collections.get(state.source.id) : null;
  let destination = Zotero.Collections.get(target.id);
  if (!destination || destination.deleted) return;
  if (state.source && (!source || source.deleted)) return;
  if (source?.id === destination.id) return;
  if (destination.libraryID !== state.libraryID || (source && source.libraryID !== state.libraryID)) {
    throw new Error("Move to Collection: source and destination must be in the same library");
  }

  // Reload items so the operation uses the latest object state.
  let itemIDs = state.items.map(item => item.id);
  let items = Zotero.Items.get(itemIDs).filter(Boolean);
  if (!items.length) return;

  await Zotero.DB.executeTransaction(async () => {
    for (let item of items) {
      if (item.deleted || item.libraryID !== state.libraryID || !item.isTopLevelItem()) continue;
      // 菜单展开后来源关系可能变化，执行时再次核对，避免处理无关文献。
      if (state.requireSourceMembership && !source.hasItem(item)) continue;
      if (state.unfiledOnly && item.getCollections().length) continue;

      if (!destination.hasItem(item)) {
        item.addToCollection(destination.id);
      }
      if (source && source.hasItem(item)) {
        item.removeFromCollection(source.id);
      }

      // Collection membership changes should not alter bibliographic modified time.
      await item.save({
        skipDateModifiedUpdate: true,
        skipSelect: true
      });
    }
  });

  try {
    Zotero.Collections.addToRecent(destination);
  }
  catch (e) {
    Zotero.logError(e);
  }
}
