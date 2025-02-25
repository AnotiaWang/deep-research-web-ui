# Deep Research Web

本项目是 https://github.com/dzhng/deep-research 的可视化版本，并做了一些改进。

特色：

- 🚀 **隐私安全**：所有配置和 API 请求均在浏览器端完成
- 🕙 **实时反馈**：流式传输 AI 响应并在界面实时展示
- 🌳 **搜索可视化**：使用树状结构展示研究过程，支持使用英文搜索词
- 📄 **支持导出 PDF**：将最终研究报告导出为 Markdown 和 PDF 格式
- 🤖 **多模型支持**：底层使用纯提示词而非结构化输出等新特性，兼容更多大模型供应商

当前支持的供应商：


- AI 服务：OpenAI compatible, SiliconFlow, DeepSeek, OpenRouter, Ollama 等
- 联网搜索服务：Tavily (每月 1000 次免费搜索), Firecrawl（支持自部署）

喜欢本项目请点 ⭐ 收藏！

 <video width="500" src="https://github.com/user-attachments/assets/8f9baa43-a74e-4613-aebb-1bcc29a686f0" controls></video>

## 近期更新

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

25/02/15

- AI 提供商支持 DeepSeek，OpenRouter 和 Ollama，联网搜索支持 Firecrawl
- 支持检查项目更新
- 支持重新生成报告
- 一般性优化和改进

<details>
<summary>早期更新</summary>

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

### 自托管部署

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