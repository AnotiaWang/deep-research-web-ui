# Deep Research Web

本项目是 https://github.com/dzhng/deep-research 的可视化版本，并做了一些改进。

特色：

- 🚀 **隐私安全**：在客户端模式下，配置和 API 请求均在浏览器端完成
- 🕙 **实时反馈**：流式传输 AI 响应并在界面实时展示
- 🌳 **搜索可视化**：使用树状结构展示研究过程，支持使用多种语言搜索
- 📄 **支持导出 PDF**：将最终研究报告导出为 Markdown 和 PDF 格式
- 🤖 **多模型支持**：底层使用纯提示词而非结构化输出等新特性，兼容更多大模型供应商
- 🐳 **Docker 支持**：使用一行命令部署到你的环境中
- 🔧 **服务端模式**：通过环境变量部署，用户无需配置 API 密钥

当前支持的供应商：

- AI 服务：OpenAI compatible, SiliconFlow, InfiniAI, DeepSeek, OpenRouter, Ollama 等
- 联网搜索服务：Tavily (每月 1000 次免费搜索), Firecrawl（支持自部署）, fastCRW（支持自部署）, Google PSE

喜欢本项目请点 ⭐ 收藏！

<video width="500" src="https://github.com/user-attachments/assets/8f9baa43-a74e-4613-aebb-1bcc29a686f0" controls></video>

## 近期更新

25/07/24

- 新增：研究历史记录管理 - 支持导出/导入单个历史记录，一键删除所有记录

25/07/23

- 新增：服务端模式 - 通过环境变量部署，用户无需配置 API 密钥

25/06/26

- 新增：AI 供应商支持 302.AI

25/04/06

- 新增：网页搜索支持 Google PSE

25/03/09

- 新增：AI 供应商支持 InfiniAI
- 改进：AI 大模型的 prompts
- 改进：改进了重试失败时的处理
- 改进：在没有填 API key 的时候也尝试拉取模型列表

25/02/27

- 新增：研究报告中新增了来源引用信息
- 改进：改善了中文的输出格式
- 改进：在“研究主题”表单中开放了更高的“深度”和“广度”（也可以手动填入更大的值）
- 修复：修复了搜索节点详情可能出现文字溢出的问题
- 其它：界面样式改进

25/02/24

- 新增：搜索流程图支持放大到全屏。可以更方便地追踪整个搜索流程了。
- 改动：“导出 PDF”功能改为使用浏览器原生的打印能力，这样能确保排版和展示的一致，并且不再需要单独下载中文字体。
- 修复：“上下文大小”设置未生效问题

25/02/22

- 新增：荷兰语（NL）翻译
- 新增：支持重试搜索失败的节点
- 修复：网页搜索节点有时会显示空的搜索词和重复的结论内容
- 修复：Firecrawl 现在限制抓取内容格式为 `Markdown`

25/02/18 - 25/02/20

- Tavily 支持配置“高质量搜索”和“搜索领域”选项
- Firecrawl 支持自部署
- 总体稳定性改进，降低了出现“无效 JSON 结构”错误的概率

25/02/17

- 支持设置模型上下文长度
- 支持限制联网搜索的并发数

25/02/16

- 使用 VueFlow 重构了搜索可视化功能
- 一些样式和 bug 修复

<details>
<summary>早期更新</summary>

25/02/15

- AI 提供商支持 DeepSeek，OpenRouter 和 Ollama，联网搜索支持 Firecrawl
- 支持检查项目更新
- 支持重新生成报告
- 一般性优化和改进

25/02/14

- 支持 DeepSeek R1 等思维链模型
- 改进了模型兼容性，改进异常处理

25/02/13

- 大幅缩减了网页体积
- 支持配置搜索时使用的语言
- 支持 Docker 部署
- 修复“导出 PDF”不可用的问题
</details>

## 使用指南

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
| AI 服务商 | `openai-compatible`, `siliconflow`, `302-ai`, `infiniai`, `openrouter`, `deepseek`, `ollama` |
| 联网搜索服务商 | `tavily`, `firecrawl`, `crw`, `google-pse` |

说明：

- `NUXT_WEB_SEARCH_API_KEY` 支持为 Tavily 和 Google PSE 配置逗号分隔的多个密钥，例如 `key1,key2,key3`。
- Google PSE 需要同时配置 `NUXT_WEB_SEARCH_API_KEY` 和 `NUXT_PUBLIC_GOOGLE_PSE_ID`。
- Firecrawl 自部署可以通过 `NUXT_WEB_SEARCH_API_BASE` 配置接口地址。
- fastCRW（`crw`）是与 Firecrawl 兼容的网页抓取工具（单一二进制文件；可自托管或使用云服务）。默认使用云端地址 `https://fastcrw.com/api`，密钥从 `NUXT_WEB_SEARCH_API_KEY` 读取（文档中记为 `CRW_API_KEY`）；自部署可以通过 `NUXT_WEB_SEARCH_API_BASE` 配置接口地址。
- Ollama 默认 API Base 为 `http://localhost:11434/v1`。如果应用运行在 Docker 容器内，`localhost` 指向容器自身；若 Ollama 运行在宿主机或其他容器中，请将 `NUXT_AI_API_BASE` 设置为容器可访问的宿主机地址或 Docker 网络地址。

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

[![Star History Chart](https://api.star-history.com/svg?repos=AnotiaWang/deep-research-web-ui&type=Date)](https://star-history.com/#AnotiaWang/deep-research-web-ui&Date)
