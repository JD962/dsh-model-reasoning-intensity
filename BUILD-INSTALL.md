# Reasoning Effort Bridge（思考强度桥）— 安装 / 卸载指南

一个 DSH（DeepSeek Harness）宿主插件：为第三方（`llm-pi-ai`）模型补齐默认
`reasoningEfforts`，让输入框的模型菜单出现思考强度选择
（Off/Low/Medium/High/Xhigh/Max），与官方 llm-deepseek 模型的体验一致。

- 作者：jd962
- 许可证：MIT
- 包名：`@jd962/dsh-reasoning-effort-bridge`（仅宿主包，无浏览器半件）

## 背景：为什么第三方模型没有思考强度

输入框模型菜单的"思考强度"行只在模型上报 reasoning 元数据时渲染。官方
`llm-deepseek` 适配器内置档位表；第三方 `llm-pi-ai` 模型只有在配置节
`llm-pi-ai.providers.<路由>.models[].reasoningEfforts` **显式声明**时才上报。
手工添加的第三方网关（如 poke-api）默认没有该字段 → 强度行不出现。

本插件在唯一诚实的接缝上补齐：监听设置与适配器变化，对**完全没有** reasoning
元数据的模型（`llm.resolveModelInfo` 探测，即 UI 隐藏强度行的同一判据），
把默认六档写入用户层：

```yaml
reasoningEfforts:
  off: none      # wire 值；pi-ai 官方目录 gpt-5.1+ 同款拼写
  low: low
  medium: medium
  high: high
  xhigh: xhigh
  max: max
```

选择档位后真实分发到网络请求（openai-responses → `reasoning.effort`、
openai-completions → `reasoning_effort`）；未声明档位仍会在发起请求前被
`UNSUPPORTED_REASONING_EFFORT` 拒绝——不存在假 UI。

## 安全与幂等规则

- 只填**缺失**字段：用户已声明的档位表 / `reasoningEfforts: false`（显式
  退出版本控制）永不覆盖；pi-ai 目录自带档位的模型（如 claude-opus 的
  xhigh/max）不补，目录保持权威。
- 只写**用户层**（`settings.describe()` 的 `user` 快照），组合 base 层里的
  路由不碰；写入走 `settings.update()` 整数组重建 + `expectedRevision`
  乐观锁，并发用户编辑触发 `SETTINGS_CONFLICT` 拒绝而非覆盖。
- 写入经过 llm-pi-ai 自己的 schema 与 serviceability 校验；插件自身的写入
  触发的 `settings/updated` 再跑一轮发现无事可做——无循环。
- 档位显示名为 Off/Low/Medium/High/Xhigh/Max（`off` 的 wire 值就是 `none`，
  语义等同"无思考"；与 pi-ai 对官方 OpenAI 目录模型的行为一致）。

## 一键安装

```powershell
powershell -ExecutionPolicy Bypass -File "D:\DSH\pj\reasoning-effort-bridge\install.ps1"
```

脚本做两件事（均幂等，可重复执行）：

1. 复制宿主包到 `%USERPROFILE%\.dsh\profiles\node_modules\@jd962\dsh-reasoning-effort-bridge`。
2. 向 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` **文本追加**一个
   顶层 insert 条目（绝不重写/重排已有内容——其他插件的补丁与注释逐字节保留）。

> 参数可自定义：`-DshHome`（默认 `%USERPROFILE%\.dsh`）、`-SourceDir`（默认本目录）。
> 与 subagent-pro 等已装插件共存：追加式合并，互不影响。
> 无需 apiproxy 白名单补丁（不注册新设置命名空间）、无需改 DSH 源码、无客户端包。

## 重启 + 验证

```powershell
dsh web
```

浏览器硬刷新（Ctrl+Shift+R）后：

- 输入框模型菜单 → 任意第三方模型（gpt-5.5 / glm-5.3 / claude / gemini …）
  出现「思考强度」行，六档可选；选中即生效（请求体真实携带）。
- `settings.yaml` 的 `llm-pi-ai.providers.poke-api.models[]` 每个模型多出
  `reasoningEfforts` 六档表。
- 已有自己的档位表或显式 `false` 的模型行为不变。

## 一键卸载

```powershell
powershell -ExecutionPolicy Bypass -File "D:\DSH\pj\reasoning-effort-bridge\uninstall.ps1"
```

脚本从 `cordis.patch.yml` 移除本插件条目（其他条目逐字节保留）并删除包。
已写入 `settings.yaml` 的 `reasoningEfforts` 是用户数据，保留不动；想让某个
模型不再提供档位，删除它的表或改为 `reasoningEfforts: false`。

## 故障排查

- 强度行没出现：重启 `dsh web` 后看终端日志
  `reasoning-effort-bridge: filled default reasoning efforts for N model entries`；
  若无，查 `settings.yaml` 是否已有该模型的表、路由协议是否在支持列表
  （openai-responses / openai-completions / azure-openai-responses /
  openai-codex-responses / anthropic-messages；其余协议有意跳过）。
- 终端出现 `filling reasoningEfforts was refused`：写入被 llm-pi-ai 校验拒绝
  （错误详情在下一行）；通常是手工编辑产生了不合法配置，修复后事件会自动重试。

## 产物清单

```
reasoning-effort-bridge/
├── host/                        # 宿主包（补齐逻辑）
│   ├── package.json
│   └── lib/index.js
├── test/
│   └── build-fill-patch.smoke.mjs   # 纯函数单测：node test/build-fill-patch.smoke.mjs
├── profile-cordis.append.yml    # 追加到 profile 补丁的固定块
├── install.ps1                  # 一键安装
├── uninstall.ps1                # 一键卸载
└── BUILD-INSTALL.md             # 本文件
```
