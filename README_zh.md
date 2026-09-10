# Deep Research Web

Deep Research Web 能把一个研究问题变成一份带引用的报告：自动规划搜索、浏览网页、核验证据来源，并支持查看与定向补查每一条引用——可以完全在浏览器中运行，也可以自托管部署并使用你自己的 API 密钥。

特色：

- 🚀 **隐私安全**：在客户端模式下，配置和 API 请求均在浏览器端完成
- 🕙 **实时反馈**：流式传输 AI 响应并在界面实时展示
- 🌳 **搜索可视化**：使用树状结构展示研究过程，支持使用多种语言搜索
- 📄 **支持导出 PDF**：将最终研究报告导出为 Markdown 和 PDF 格式
- 🤖 **多模型支持**：底层使用纯提示词而非结构化输出等新特性，兼容更多大模型供应商
- 🐳 **Docker 支持**：使用一行命令部署到你的环境中
- 🔧 **服务端模式**：通过环境变量部署，用户无需配置 API 密钥
- 🔎 **证据核验与定向补查**：点击报告引用查看来源摘录，针对结论补查并更新相关段落，原报告保留在历史记录中
- 🎯 **聚焦搜索**：将查询词与时间、来源条件分开，检查结果相关性，证据不足时最多改写重查一次
- 📖 **按需精读全文**：当摘要不足以验证结论时，自动抓取来源网页全文提取原文证据，整个研究流程共享统一的请求与篇幅预算

当前支持的供应商：

- AI 服务：OpenAI compatible, SiliconFlow, InfiniAI, DeepSeek, OpenRouter, Requesty, Ollama, LiteLLM 等
- 联网搜索服务：Tavily (每月 1000 次免费搜索), Firecrawl（支持自部署）, fastCRW（支持自部署）, Google PSE, You.com（免密钥可用）

喜欢本项目请点 ⭐ 收藏！

<video width="500" src="https://github.com/user-attachments/assets/8f9baa43-a74e-4613-aebb-1bcc29a686f0" controls></video>

## 使用指南

### 查看证据并补查

1. 完成研究后，点击报告中的 `[1]` 等引用，或点击「查看证据与补查」。
2. 在证据面板中查看结论、来源、检索时间和摘录。新摘录只有与检索内容匹配成功才会保存；搜索摘要与网页正文会分别标记。摘录匹配不代表结论已经获得充分证明，仍需结合上下文判断。
3. 输入需要核查的问题，例如「查找官方最新价格，并核对适用条件」，点击「补查并更新报告」。补查最多生成两个搜索方向、执行一轮搜索，只更新引用该结论的 Markdown 块；表格和列表按整块处理。
4. 补查成功后，新证据和更新后的报告另存为一条历史记录，原记录保持不变。失败、取消或未找到可匹配摘录时，保留原报告。

客户端模式与服务端模式均支持此流程。旧历史记录仍可加载；没有保存摘录的结论会明确提示。历史记录仍保存在浏览器中，建议导出重要研究。

在线演示：<a href="https://deep-research.ataw.top" target="_blank">https://deep-research.ataw.top</a>

### 部署模式

- **客户端模式**：用户在浏览器中自行填写 API 密钥。适合 EdgeOne Pages 或 `pnpm generate` 这类静态部署。
- **服务端模式**：API 密钥通过服务端环境变量配置，用户无需在界面中填写密钥。该模式需要 Docker 镜像等 SSR/Nitro 运行环境，不适用于纯静态部署。

### 自托管部署

#### 服务端模式（推荐）
通过环境变量部署，用户无需配置 API 密钥。请在可以运行 Nuxt 服务端的环境中使用该模式：

**使用 Docker 和环境变量：**

```bash
docker run -p 3000:3000 \
  -e NUXT_PUBLIC_SERVER_MODE=true \
  -e NUXT_AI_API_KEY=你的AI-API密钥 \
  -e NUXT_WEB_SEARCH_API_KEY=你的搜索API密钥 \
  -e NUXT_PUBLIC_AI_PROVIDER=openai-compatible \
  -e NUXT_PUBLIC_AI_MODEL=gpt-4o-mini \
  -e NUXT_PUBLIC_WEB_SEARCH_PROVIDER=tavily \
  anotia/deep-research-web:latest
```

**使用 Docker 和 .env 文件：**

```bash
# 复制 .env.example 并填入配置
cp .env.example .env
docker run -p 3000:3000 --env-file .env anotia/deep-research-web:latest
```

#### 客户端模式（传统）
用户需要在浏览器中自行配置 API 密钥。静态部署请使用该模式：

使用 [EdgeOne Pages](https://edgeone.ai/products/pages) 一键部署：

[![Deploy with EdgeOne Pages](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?from=github&template=https://github.com/AnotiaWang/deep-research-web-ui&from=github)

Docker 部署（使用现成镜像）：

```bash
docker run -p 3000:3000 --name deep-research-web -d anotia/deep-research-web:latest
```

Docker 部署（自行打包镜像）：

```bash
git clone https://github.com/AnotiaWang/deep-research-web-ui
cd deep-research-web-ui
docker build -t deep-research-web .
docker run -p 3000:3000 --name deep-research-web -d deep-research-web
```

### 环境变量配置

#### 服务端模式配置
| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `NUXT_PUBLIC_SERVER_MODE` | 启用服务端模式 | `false` |
| `NUXT_AI_API_KEY` | AI 服务商 API 密钥 | - |
| `NUXT_AI_API_BASE` | AI 服务商基础 URL | - |
| `NUXT_WEB_SEARCH_API_KEY` | 联网搜索 API 密钥 | - |
| `NUXT_WEB_SEARCH_API_BASE` | 联网搜索基础 URL | - |

#### 公共配置（服务端模式）
| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `NUXT_PUBLIC_AI_PROVIDER` | AI 服务商类型 | `openai-compatible` |
| `NUXT_PUBLIC_AI_MODEL` | AI 模型名称 | `gpt-4o-mini` |
| `NUXT_PUBLIC_AI_CONTEXT_SIZE` | 上下文大小 | `128000` |
| `NUXT_PUBLIC_WEB_SEARCH_PROVIDER` | 搜索服务商 | `tavily` |
| `NUXT_PUBLIC_WEB_SEARCH_CONCURRENCY_LIMIT` | 最大并发数 | `2` |
| `NUXT_PUBLIC_WEB_SEARCH_SEARCH_LANGUAGE` | 搜索语言 | `en` |
| `NUXT_PUBLIC_TAVILY_ADVANCED_SEARCH` | 使用 Tavily 高级搜索 | `false` |
| `NUXT_PUBLIC_TAVILY_SEARCH_TOPIC` | Tavily 搜索主题 | `general` |
| `NUXT_PUBLIC_GOOGLE_PSE_ID` | Google PSE ID | - |

#### Provider 配置值

| 类型 | 支持的值 |
|------|----------|
| AI 服务商 | `openai-compatible`, `siliconflow`, `302-ai`, `infiniai`, `openrouter`, `requesty`, `deepseek`, `ollama`, `litellm` |
| 联网搜索服务商 | `tavily`, `firecrawl`, `crw`, `google-pse`, `youcom` |

说明：

- `NUXT_WEB_SEARCH_API_KEY` 支持为 Tavily 和 Google PSE 配置逗号分隔的多个密钥，例如 `key1,key2,key3`。
- Google PSE 需要同时配置 `NUXT_WEB_SEARCH_API_KEY` 和 `NUXT_PUBLIC_GOOGLE_PSE_ID`。
- Firecrawl 自部署可以通过 `NUXT_WEB_SEARCH_API_BASE` 配置接口地址。
- fastCRW（`crw`）是与 Firecrawl 兼容的网页抓取工具（单一二进制文件；可自托管或使用云服务）。默认使用云端地址 `https://fastcrw.com/api`，密钥从 `NUXT_WEB_SEARCH_API_KEY` 读取（文档中记为 `CRW_API_KEY`）；自部署可以通过 `NUXT_WEB_SEARCH_API_BASE` 配置接口地址。
- You.com（`youcom`）从 `NUXT_WEB_SEARCH_API_KEY` 读取密钥（可选，支持逗号分隔多密钥轮询）。未设置密钥时使用免密钥端点（每日配额有限）；可在 https://you.com/platform/api-keys 获取密钥。
- Ollama 默认 API Base 为 `http://localhost:11434/v1`。如果应用运行在 Docker 容器内，`localhost` 指向容器自身；若 Ollama 运行在宿主机或其他容器中，请将 `NUXT_AI_API_BASE` 设置为容器可访问的宿主机地址或 Docker 网络地址。
- LiteLLM 默认 API Base 为 `http://localhost:4000/v1`。当代理未启用认证时，API 密钥可以留空；如果代理无法通过默认本地地址访问，请设置 `NUXT_AI_API_BASE`。
- Requesty 默认 API Base 为 `https://router.requesty.ai/v1`，模型 ID 使用 `provider/model` 格式，例如 `openai/gpt-4o`。

---

## 开发指南

### 环境配置

安装依赖：

```bash
pnpm install
```

### 开发模式

启动本地开发服务器（访问 http://localhost:3000）：

```bash
pnpm dev
```

### 生产构建

SSR 模式：

```bash
pnpm build
```

SSG 模式（静态部署）：

```bash
pnpm generate
```

本地预览生产构建：

```bash
pnpm preview
```

详见 [部署文档](https://nuxt.com/docs/getting-started/deployment)。

## 许可协议

MIT 协议

## Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=AnotiaWang/deep-research-web-ui&type=Date)](https://star-history.dera.page/#AnotiaWang/deep-research-web-ui&Date)
