# DeepSeek Chatbot

轻量本地 Web Chatbot，对话历史保存为项目本地 JSON，后端同时作为 DeepSeek API 的本地代理。

## 运行

```bash
npm install
cp .env.example .env
```

在 `.env` 写入：

```bash
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_CONTEXT_TOKENS=1000000
PORT=3001
CHATBOT_DATA_FILE=data/chat-history.json
SEARXNG_BASE_URL=http://127.0.0.1:8888
SEARXNG_ENGINE_CANDIDATES=bing,qwant,mojeek,wikipedia,reuters,wikinews,brave,duckduckgo,startpage,google
SEARXNG_ENGINE_PROBE_QUERY=OpenAI
SEARXNG_ENGINE_PROBE_TTL_MS=600000
WEB_SEARCH_MAX_RESULTS=5
WEB_SEARCH_TIMEOUT_MS=8000
WEB_SEARCH_DELAY_MS=1500
```

前端上下文百分比来自后端 `/api/models`。后端会先读取 DeepSeek `/models`；当前官方接口只返回模型基础信息时，使用 `.env` 中的 `DEEPSEEK_CONTEXT_TOKENS`，或 `DEEPSEEK_V4_FLASH_CONTEXT_TOKENS` / `DEEPSEEK_V4_PRO_CONTEXT_TOKENS` 覆盖。

## 本地 Web Search

Web Search 使用本地 SearXNG 容器。先启动 Docker Desktop，然后运行：

```bash
npm run search:up
```

验证 SearXNG JSON API：

```bash
curl 'http://127.0.0.1:8888/search?q=test&format=json'
curl http://127.0.0.1:3001/api/search/health
```

`SEARXNG_ENGINE_CANDIDATES` 是探测候选池，不是固定使用的引擎列表。后端会在执行 Web Search 前逐个探测候选引擎，把当前可用的引擎动态传给 SearXNG；探测结果按 `SEARXNG_ENGINE_PROBE_TTL_MS` 缓存，避免每一轮都探测。也可以把候选值设为 `auto`，让后端从 SearXNG `/config` 发现候选引擎。`WEB_SEARCH_DELAY_MS` 是后端对所有 SearXNG 请求的全局串行节流间隔，默认 1500ms，用于降低连续搜索触发上游限流的概率。

如果需要让 SearXNG 通过代理访问外部搜索引擎，请按自己的环境修改 `searxng/settings.yml` 的 `outgoing.proxies`。仓库中的代理地址如 `192.168.x.x:1087` 仅是本机示例，部署到新机器时必须替换为可被 Docker 容器访问的代理地址；macOS / Windows Docker Desktop 通常使用 `host.docker.internal:<proxy-port>`。

停止搜索服务：

```bash
npm run search:down
```

如果需要改 SearXNG 端口，复制并编辑 `searxng/.env.example`：

```bash
cp searxng/.env.example searxng/.env
```

页面输入框上方的 `Web` 开关只影响当前发送或重新生成的一轮。开启后，后端会先让 DeepSeek 按 tool calling 协议调用 `web_search` 工具，由模型生成搜索 query；本地 SearXNG 执行检索后再把工具结果回传给 DeepSeek，直到模型给出最终回答。前端固定使用高强度搜索，不限制实际搜索次数；聊天记录只保存搜索 query、来源标题、链接和摘要。

启动：

```bash
npm run dev
```

访问：

```text
http://127.0.0.1:5173
```

对话历史会自动保存到：

```text
data/chat-history.json
```

浏览器 `localStorage` 只作为缓存和旧数据迁移兜底使用。

## 构建

```bash
npm run build
npm start
```
