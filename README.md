# Move to Collection for Zotero 10

An independent fork of **[jh-chen0/zotero-move-to-collection](https://github.com/jh-chen0/zotero-move-to-collection)**, originally created by **[jh-chen0](https://github.com/jh-chen0)**. The upstream MIT license and original commit history are preserved.

This fork adds **source-aware moves from My Library**: choose which collection to remove an item from, then choose its destination. All other collection memberships are preserved. This is a fork release, not an official release from the original author.

## 这个分支增加了什么

原插件已经支持在普通 collection 中右键移动文献。本分支在此基础上增加：

- 在 **My Library** 中显示 **Move to Collection／移动到分类**。
- 先选择来源分类，再选择目标分类，保留其他分类归属。
- 来源菜单显示完整分类路径和匹配的所选文献数量。
- 所选文献全部未分类时，直接显示目标分类。
- 混合选择已分类和未分类文献时，分别提供来源分类和未分类分组。
- 执行前重新核对来源归属，跳过已删除、已离开来源分类或已被归类的相关文献。

原插件的嵌套分类、最近使用目标、批量操作、中英文菜单及同库移动功能继续保留。

## 使用方法

### 在 My Library 中移动

1. 在左侧选择 **My Library**。
2. 选中一篇或多篇文献的主条目。
3. 右键 → **Move to Collection**。
4. 展开 **From: 来源分类（数量）**。
5. 选择目标分类；如果目标有子分类，可点 **Move to “目标名称”** 选择父分类本身。

例如，一篇文献同时属于 `00 Inbox` 和 `02 Reference › Topics › InSAR`：

```text
My Library
└─ 右键文献
   └─ Move to Collection
      └─ From: 00 Inbox (1)
         └─ 01 Papers
            └─ P04 · GBA Inundation
```

操作后，这篇文献从 `00 Inbox` 移除，并加入 `P04 · GBA Inundation`；它在 `InSAR` 中的归属保留。文献始终仍可在 `My Library` 中找到。

### 未分类文献

- 全部所选文献均未分类：直接选择目标分类。
- 同时选中已分类和未分类文献：通过 **Unfiled Items／未分类文献** 分组选择目标，仅处理其中未分类的文献。

### 在普通 collection 中移动

选中文献 → 右键 **Move to Collection** → 选择目标，来源直接使用当前 collection。

### 批量选择的范围

在 `My Library` 中多选文献时，某个来源旁的数量表示所选文献中属于该来源的数量。选择这个来源后，**只移动匹配的文献**，不会把不属于该来源的其他所选文献一起加入目标。

插件处理顶层文献条目，不单独移动子附件、子笔记或批注；不跨资料库移动。文献的 PDF、笔记、标签及其他分类归属保留。

## 构建与安装

需要 macOS/Linux、Python 3 和 `zip`：

```bash
bash build.sh
```

生成的安装包：

```text
dist/move-to-collection-0.1.1.xpi
```

在 Zotero 中打开 **Tools → Plugins → 齿轮菜单 → Install Plugin From File…**，选择该 `.xpi` 文件。如果菜单没有立即刷新，重新启用插件或重启 Zotero。

本分支保留上游插件 ID，因此安装时会更新同 ID 的旧版本。

## 测试与兼容性

- 声明兼容 Zotero **10.0.***。
- 已在 **macOS + Zotero 10.0.7** 中确认 `My Library → Move to Collection → 来源分类 → 目标分类` 菜单可显示。
- 10 项单元测试覆盖来源筛选、保留其他分类、批量选择、未分类文献、过期来源关系、跨库限制、已删除条目、已有目标归属及中文菜单。
- 单元测试使用模拟的 Zotero 接口；尚未对其他系统及 Zotero 版本进行实机验证。

使用支持 `node:test` 的 Node.js 运行测试：

```bash
node --test move-to-collection.test.cjs
```

## 工程结构

```text
bootstrap.js                    插件逻辑
manifest.json                   版本、插件 ID 与兼容范围
move-to-collection.test.cjs      单元测试
build.sh                        上游构建脚本
CHANGELOG.md                    版本记录
LICENSE                         上游 MIT 许可证，原样保留
```

## 原作者与许可证

感谢 **jh-chen0** 提供原始插件及其基于 `Zotero.MenuManager` 的实现。

- 原工程：[jh-chen0/zotero-move-to-collection](https://github.com/jh-chen0/zotero-move-to-collection)
- 本分支基于上游提交：[`9d129130b1587bcdf317411b6ef23c8f1de2249e`](https://github.com/jh-chen0/zotero-move-to-collection/commit/9d129130b1587bcdf317411b6ef23c8f1de2249e)
- 许可证：[MIT](LICENSE)，保留上游版权及许可声明。

本分支的主要修改集中在 `My Library` 的来源选择、未分类处理、执行前校验、测试及文档；原始插件的作者归属保持不变。
