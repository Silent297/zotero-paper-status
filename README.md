# Zotero Paper Status（论文状态）

在 Zotero 条目列表中直接查看和标记读书会论文状态，与论文总览工具共享同一份数据源 `papers_index.json`（唯一真源，双向同步）。

- **4 个自定义列**：阅读（未读 → 在读 → 已读）、意愿（未标 → 不读 → 速读 → 精读）、分享（未安排 → 已预订 → 已分享）、⭐ 星标
- **点击单元格循环切换**状态，改动即时写回 JSON，网页工具重新打开即可见
- **外部修改自动刷新**：网页工具或脚本修改 JSON 后，Zotero 侧约 3 秒内自动更新
- **自动匹配条目**：链接附件绝对路径 > 附件文件名 > 条目标题；未匹配的条目列显示空白
- **安全降级**：文件缺失或 JSON 损坏时只显示为空、拒绝写入，不会破坏数据文件
- 写入采用临时文件原子替换，且每次只改动目标字段与 `updated` 时间戳（最小 diff）

## 安装

1. 获取 `zotero-paper-status.xpi`（本仓库 Releases 页，或本地 `npm run build` 后取 `.scaffold/build/` 下的产物）
2. Zotero → 工具 → 插件 → 右上角齿轮 → **Install Plugin From File…** → 选择 xpi → 重启 Zotero

要求 Zotero 7.0 及以上（已在 Zotero 10.0.6 验证）。

## 配置

| 偏好键                                   | 说明                           | 默认值                                                    |
| ---------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `extensions.zotero.paperstatus.jsonPath` | `papers_index.json` 的完整路径 | `C:\Users\35150\Desktop\学习资料\paper\papers_index.json` |

修改方式：设置 → 高级 → 配置编辑器（Config Editor）。

## 数据格式

插件只读写 `papers_index.json` 中每篇论文的 `reading` / `intent` / `share` / `star` 字段（以及顶层 `updated`），其余字段原样保留，格式与 Python 工具一致（2 空格缩进 + 末尾换行）。

## 开发

```sh
npm install
npm start          # 热重载开发（独立 profile，不触碰真实数据）
npm test           # 在隔离测试实例中运行集成冒烟测试
npm run build      # 打包为 .scaffold/build/zotero-paper-status.xpi
```

开发与测试实例默认读写 `papers_index.COPY.json`（见 `zotero-plugin.config.ts`），不会改动真实数据文件。

## 许可

基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)，AGPL-3.0-or-later。
