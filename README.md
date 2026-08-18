# Reasoning Effort Bridge / 思考强度桥

A DeepSeek Harness (DSH) host plugin that gives third-party (`llm-pi-ai`)
models a selectable thinking-effort row in the composer's model menu —
**Off / Low / Medium / High / Xhigh / Max** — the same experience official
DeepSeek models already have.

一个 DeepSeek Harness（DSH）宿主插件：为第三方（`llm-pi-ai`）模型在输入框的
模型菜单中补齐思考强度选择（Off/Low/Medium/High/Xhigh/Max），与官方模型
体验一致。

## How it works / 工作原理

DSH only renders the effort row when a model reports reasoning metadata.
Official `llm-deepseek` models carry a built-in level table; third-party
`llm-pi-ai` models report levels only when their profile entry declares
`reasoningEfforts` — which hand-added gateway routes never do. The bridge
watches the `llm-pi-ai` settings namespace and fills the default six-level map
into every model that currently reports **no** reasoning metadata (probed via
`llm.resolveModelInfo` — the exact condition under which the menu hides the
row):

DSH 只在模型上报 reasoning 元数据时渲染强度行。官方模型内置档位表；第三方
模型只有显式声明 `reasoningEfforts` 才会上报——手工添加的网关路由没有该
字段。本插件监听 `llm-pi-ai` 设置命名空间，对**当前完全没有** reasoning
元数据的模型（以 `llm.resolveModelInfo` 探测，与菜单隐藏强度行同判据）
补写默认六档表：

```yaml
reasoningEfforts:
  off: none      # the wire spelling; same as pi-ai's own gpt-5.1+ catalog
  low: low
  medium: medium
  high: high
  xhigh: xhigh
  max: max
```

Selecting a level dispatches a real request parameter (`reasoning.effort` on
openai-responses, `reasoning_effort` on openai-completions); unsupported
levels keep being refused before any network I/O. There is no fake UI.

选择档位后真实分发到网络请求；不支持的档位依旧在发起请求前被拒绝——不存
在假 UI。

## Guarantees / 保证

- Only fills **absent** fields: user-declared maps and `reasoningEfforts: false`
  opt-outs are never overwritten; models whose pi-ai catalog entry already
  carries its own levels are untouched (the catalog stays authoritative).
  只填缺失字段：用户已声明的档位表与显式 `false` 退出一律不覆盖；目录自带
  档位的模型不补。
- Writes only the **user layer** through `settings.update()` with an
  `expectedRevision` optimistic lock — concurrent edits win over the bridge.
  只写用户层，带乐观锁；并发用户编辑优先。
- Idempotent and loop-free: its own write re-triggers the watcher, which finds
  nothing left to fill. 幂等无循环。
- Bridged protocols: `openai-responses`, `openai-completions`,
  `azure-openai-responses`, `openai-codex-responses`, `anthropic-messages`.
  Others are intentionally skipped. 其余协议有意跳过。

## Install / 安装

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
# then restart `dsh web` and hard-refresh the browser (Ctrl+Shift+R)
```

## Uninstall / 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

The maps already written into `settings.yaml` are user data and stay; set
`reasoningEfforts: false` on a model to stop offering levels for it.

See [BUILD-INSTALL.md](BUILD-INSTALL.md) for details and troubleshooting.

## License

MIT
