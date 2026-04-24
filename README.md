# Deep Research Web UI

[English | [中文](README_zh.md)]

This is a web UI for https://github.com/dzhng/deep-research, with several improvements and fixes.

Features:

- 🚀 **Safe & Secure**: Everything (config, API requests, ...) stays in your browser locally
- 🕙 **Realtime feedback**: Stream AI responses and reflect on the UI in real-time
- 🌳 **Search visualization**: Shows the research process using a tree structure. Supports searching in different languages
- 📄 **Export as PDF**: Export the final research report as Markdown / PDF
- 🤖 **Supports more models**: Uses plain prompts instead of newer, less widely supported features like Structured Outputs. This ensures to work with more providers that haven't caught up with the latest OpenAI capabilities.
- 🐳 **Docker support**: Deploy in your environment in one-line command
- 🔧 **Server Mode**: Deploy with environment variables, no need for users to configure API keys

Currently available providers:

- AI: OpenAI compatible, SiliconFlow, Infiniai, DeepSeek, OpenRouter, Ollama and more
- Web Search: Tavily (1000 free credits / month), Firecrawl (cloud / self-hosted)

Please give a 🌟 Star if you like this project!

## Sponsor

<a href="https://www.swiftproxy.net/?ref=anotiawang">
<img width="415" alt="image" src="https://github.com/user-attachments/assets/df889a5f-c4fc-4209-b49d-9c7dc8b9c3ca" />
</a>

**Unlock Reliable Proxy Services with Swiftproxy**

With Swiftproxy, you can access high-performance, secure proxies to enhance your web automation, privacy, and data collection efforts. Our services are trusted by developers and businesses to scale scraping tasks and ensure a safe online experience. Get started today at Swiftproxy.net. Use the coupon `GHB5` to get 10% off!

---

<video width="500" src="https://github.com/user-attachments/assets/8f9baa43-a74e-4613-aebb-1bcc29a686f0" controls></video>

## Recent updates

25/07/24

- Added: Research history management - Export/import individual history records, delete all records

25/07/23

- Added: Server Mode - Deploy with environment variables, users don't need to configure API keys

25/06/26

- Added: Provider 302.AI support

25/04/06

- Added: Use Google PSE for web search

25/03/09

- Added: InifiniAI support
- Improved LLM prompts
- Improved error handling
- Improved: Try to fetch model list even when no API key is provided

25/02/27

- Added: Citations in research report
- Improved: Chinese output layout
- Improved: Increased max width and breadth in the form
- Fixed: Text overflow issues for web search node details
- Fixed: general UI style issues

25/02/24

- Added: Fullscreen mode for the search flow. This helps you to focus on the search process better.
- Changed: "Export PDF" now uses the browser's native print ability. This fixes layout issues and emilinates font problems.
- Fixed: "Context Size" setting are not correctly applied

25/02/22

- Added: NL/Dutch translation
- Added: Retry failed nodes in web search
- Fixed: Web search node sometimes shows empty label and duplicated learnings
- Fixed: Firecrawl now limits scrape content format to `Markdown`

25/02/18 - 25/02/20

- Added: "advanced search" and "search topic" support for Tavily
- Added: custom endpoint support for Firecrawl
- Fixed: overall bug fixes, less "invalid JSON structure" errors

25/02/17

- Added: set rate limits for web search
- Added: set context length for AI model

25/02/16

- Refactored the search visualization using VueFlow
- Style & bug fixes

<details>
<summary>Older updates</summary>

25/02/15

- Added AI providers DeepSeek, OpenRouter and Ollama; Added web search provider Firecrawl
- Supported checking project updates
- Supported regenerating reports
- General fixes

25/02/14

- Supported reasoning models like DeepSeek R1
- Improved compatibility with more models & error handling

25/02/13

- Significantly reduced bundle size
- Supported searching in different languages
- Added Docker support
- Fixed "export as PDF" issues
</details>

## How to use

Live demo: <a href="https://deep-research.ataw.top" target="_blank">https://deep-research.ataw.top</a>

### Self hosted

#### Server Mode (Recommended)
Deploy with environment variables - users don't need to configure API keys:

**Using Docker with environment variables:**

```bash
docker run -p 3000:3000 \
  -e NUXT_PUBLIC_SERVER_MODE=true \
  -e NUXT_AI_API_KEY=your-ai-api-key \
  -e NUXT_WEB_SEARCH_API_KEY=your-search-api-key \
  -e NUXT_PUBLIC_AI_PROVIDER=openai-compatible \
  -e NUXT_PUBLIC_AI_MODEL=gpt-4o-mini \
  -e NUXT_PUBLIC_WEB_SEARCH_PROVIDER=tavily \
  anotia/deep-research-web:latest
```

**Using Docker with .env file:**

```bash
# Create .env file with your configuration
docker run -p 3000:3000 --env-file .env anotia/deep-research-web:latest
```

#### Client Mode (Traditional)
Users configure their own API keys in the browser:

One-click deploy with [EdgeOne Pages](https://edgeone.ai/products/pages):

[![Deploy with EdgeOne Pages](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?from=github&template=https://github.com/AnotiaWang/deep-research-web-ui&from=github)

Use pre-built Docker image:

```bash
docker run -p 3000:3000 --name deep-research-web -d anotia/deep-research-web:latest
```

Use self-built Docker image:

```
git clone https://github.com/AnotiaWang/deep-research-web-ui
cd deep-research-web-ui
docker build -t deep-research-web .
docker run -p 3000:3000 --name deep-research-web -d deep-research-web
```

### Environment Variables

#### Server Mode Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `NUXT_PUBLIC_SERVER_MODE` | Enable server mode | `false` |
| `NUXT_AI_API_KEY` | AI provider API key | - |
| `NUXT_AI_API_BASE` | AI provider base URL | - |
| `NUXT_WEB_SEARCH_API_KEY` | Web search API key | - |
| `NUXT_WEB_SEARCH_API_BASE` | Web search base URL | - |

#### Public Configuration (Server Mode)
| Variable | Description | Default |
|----------|-------------|---------|
| `NUXT_PUBLIC_AI_PROVIDER` | AI provider type | `openai-compatible` |
| `NUXT_PUBLIC_AI_MODEL` | AI model name | `gpt-4o-mini` |
| `NUXT_PUBLIC_AI_CONTEXT_SIZE` | Context size | `128000` |
| `NUXT_PUBLIC_WEB_SEARCH_PROVIDER` | Search provider | `tavily` |
| `NUXT_PUBLIC_WEB_SEARCH_CONCURRENCY_LIMIT` | Max concurrency | `2` |
| `NUXT_PUBLIC_WEB_SEARCH_SEARCH_LANGUAGE` | Search language | `en` |
| `NUXT_PUBLIC_TAVILY_ADVANCED_SEARCH` | Use Tavily advanced search | `false` |
| `NUXT_PUBLIC_TAVILY_SEARCH_TOPIC` | Tavily search topic | `general` |
| `NUXT_PUBLIC_GOOGLE_PSE_ID` | Google PSE ID | - |

---

## Developing

### Setup

Make sure to install dependencies:

```bash
pnpm install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
pnpm dev
```

## Production

Build the application for production:

If you want to deploy a SSR application:

```bash
pnpm build
```

If you want to deploy a static, SSG application:

```bash
pnpm generate
```

Locally preview production build:

```bash
pnpm preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## License

MIT

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=AnotiaWang/deep-research-web-ui&type=Date)](https://star-history.com/#AnotiaWang/deep-research-web-ui&Date)


## FAQ

### Q: How do I set up the server mode?

A: Server mode allows you to deploy the application with environment variables, so users don't need to configure API keys. Set the following environment variables:

```bash
export OPENAI_API_KEY=your_api_key
export TAVILY_API_KEY=your_tavily_key
```

Then start the application. Users will not need to enter API keys in the UI.

### Q: Which LLM providers are supported?

A: The application supports multiple providers:
- OpenAI compatible APIs
- SiliconFlow
- Infiniai
- DeepSeek
- OpenRouter
- Ollama (for local models)
- 302.AI

Configure your preferred provider in the settings page.

### Q: How do I use Docker to deploy?

A: Use the provided Docker configuration:

```bash
docker run -p 3000:3000 -e OPENAI_API_KEY=your_key anotiawang/deep-research-web-ui
```

### Q: Can I use this with local models via Ollama?

A: Yes! Select Ollama as your provider and configure the endpoint to your local Ollama instance (default: `http://localhost:11434`).

### Q: How does the web search work?

A: The application supports two web search providers:
- **Tavily**: 1000 free credits/month, recommended for most users
- **Firecrawl**: Cloud or self-hosted option

Configure your preferred provider in the settings.

### Q: Why is my research report empty or incomplete?

A: Common causes:
1. Invalid API key - verify your LLM provider API key
2. Rate limits - check if you've exceeded your provider's rate limits
3. Context size - ensure your model's context window is large enough
4. Web search failure - verify your search provider API key and credits

### Q: Can I export the research report as PDF?

A: Yes! Click the "Export PDF" button to save the report. The application uses your browser's native print functionality for better layout and font support.

### Q: How do I manage research history?

A: The application includes research history management. You can:
- View past research sessions
- Export/import individual history records
- Delete all records
- Regenerate reports from previous searches
