一个 DeepSeek Harness 的会话内页面查找插件：在当前页面查找文字，统计命中数量，高亮全部匹配并在匹配项之间跳转，不修改页面 DOM。

![查找栏预览](docs/preview.svg)

## 功能

- 打开：`Ctrl+F` / `Cmd+F`，或点编辑器工具行的「搜索」按钮。
- 查找：即输即搜，显示 `当前/总数`，无匹配显示无结果。
- 跳转：`Enter` / `↓` 下一个，`Shift+Enter` / `↑` 上一个，首尾循环。
- 匹配：`Aa` 区分大小写，`ab` 全词匹配，两个开关都记住选择。
- 关闭：`Esc` 或关闭按钮，焦点离开查找栏后 `Esc` 仍有效。
- 复位：关闭时恢复打开查找栏前的滚动位置。
- 刷新：流式输出、展开工具卡、切换会话时自动重扫。
- 定位：居中于会话正文上方，随窗口、侧栏和右侧面板调整。
- 配色：主题色高亮，跟随亮 / 暗主题。

## 安装

纯 JavaScript 编写，无第三方依赖，无构建步骤。要求 DSH 0.2 以上，开发与验证版本 0.2.2-rc.1。

- 桌面端：设置 → 插件，填入 `github:waddlechef/dsh-session-page-search`。安装后通常立即生效，未生效则重启 DSH。
- 网页端：`dsh plugin --profile <profile> add github:waddlechef/dsh-session-page-search`

## 卸载

- 桌面端：设置 → 插件 中移除。
- 网页端：`dsh plugin --profile <profile> remove dsh-session-page-search`

## 使用

查找范围是当前页面**已渲染**的内容，包含会话正文、工具输出、侧栏和弹窗。隐藏元素和折叠未渲染的内容不在范围内，展开后才会被搜到。单次扫描最多 2000 条匹配，达到上限时计数显示 `+`。

## License

[MIT](./LICENSE)
