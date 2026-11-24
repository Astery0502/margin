# 让首次连接多一步，让日常阅读留在浏览器

2026 年 11 月 24 日，基于[同类应用调研](openai-subscription-in-extensions.md)验证 Margin 的另一种交付方式。目标是用户可以先阅读、先写草稿，到实际需要模型时才连接自己的 OpenAI 订阅。

## 推荐的首版体验

在 macOS 的 Chrome 或 Edge 上，沿用现有侧栏和浮窗，增加一个按需启动的本机组件 Margin Connect。已有扩展的用户第一次选段写好问题后，点击“连接 OpenAI”，打开一次连接组件安装包，再到 OpenAI 确认账户和订阅权限。组件就绪后，正在进行的连接流程自动继续。授权完成后返回原标签和草稿，发送仍由用户决定。以后授权有效时，直接选段提问；授权失效时重新登录，组件保留。浏览器用原生消息启动组件，经标准输入输出通信。用户无须管理端口、终端命令、后台服务或第二个应用窗口。[Chrome 原生消息](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

现有扩展继续管理原文、草稿、讨论与任务。建议把回环登录回调、令牌刷新与撤销、带凭据的模型请求移到本机，扩展只收账户展示状态、模型列表和流式事件。新安装组件的作用就是让这几项职责有受支持的运行位置。macOS 钥匙串是正式凭据存储的候选，需实测签名、升级、重启后的访问提示。[OpenAI 注册流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) · [OpenAI 会话要求](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) · [Apple 钥匙串服务](https://developer.apple.com/documentation/security/keychain-services)

## 两个入口可共用同一组件

| 用户从哪里来 | 首次使用的动作 | 证据 |
| --- | --- | --- |
| Chrome 或 Edge 扩展商店 | 先使用阅读器。首次连接时，由扩展引导打开一次本机安装包并进入 OpenAI 授权。 | 本轮验证了安装入口执行后，已打开的 Edge 扩展能在同一流程中发现组件。公开安装包的下载、公证和系统确认界面还需试装。 |
| Margin 官网 | 提供一个 Margin 安装包，登记本机组件，并按浏览器支持的分发方式引导用户启用已发布的商店扩展，然后连接 OpenAI。用户无需自行搜索和配对两个产品。 | Chrome 在 macOS 上要求使用商店来源，用户仍需确认启用；Edge 有相应分发机制，也可能受组织策略限制。需为实际商店 ID 验证浏览器何时提示，并提供直接打开商店页的后备入口。[Chrome 分发说明](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions) · [Edge 分发说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/alternate-distribution-options) |

若重点转为 Safari，Apple 支持在一个 macOS 应用中分发 Safari 扩展，用户取得一个应用包后启用扩展。它值得作为 Mac 专用渠道单独评估。现有 Margin 的原生侧栏和离屏任务宿主依赖 Chromium，这条路线需要重新验证阅读界面、录音和任务寿命。[Safari 扩展分发](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension) · [与原生应用通信](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)

## 哪些环节已经验证

工程原型保存在本地分支 `prototype/low-friction-companion`，提交 `158c47f`，目录 `extension/providers/prototype/`。其中 `connection-demo.html` 可直接打开，预览四个连接场景。工程探针在 macOS 26.7.1、Edge 158、隔离浏览器配置和 Margin 实际构建的副本中运行。

- 在真实浮窗写下问题，进入连接页。安装前浏览器报告组件缺失；调用临时应用包的安装入口后，同一次连接自动发现组件并打开测试授权页。单靠窗口焦点事件不够可靠，原型在本次连接期间限时检测。
- 原生宿主只接受测试扩展的来源，经标准输入输出收发消息；登录时由宿主在回环地址短暂监听。关闭测试授权页、拒绝、再次同意均已验证。返回原标签时草稿仍在，模型请求数为零。
- 点击发送后，本机宿主向本地模型夹具发出一次请求。扩展在第二段响应尚未释放时已经显示第一段。浏览器重启后能识别模拟会话，退出后模拟记录被删除。四个交互演示场景也已在窄窗口逐步走通。

正式产品仍需两次不同的验收。先从真实下载渠道试装签名、公证的安装包，验证首次发现、升级和卸载。再用 Margin 自己的应用身份和真实 OpenAI 订阅跑通首次授权、模型请求、刷新与退出。本轮使用本地授权与模型夹具，未登记用户日常浏览器、读取真实账户或更改生产授权入口。[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution/)
