# DeepSeek Chatbot

轻量本地 Web Chatbot，对话历史保存为项目本地 JSON，后端同时作为 DeepSeek API 的本地代理。

## 运行

```bash
cd /Users/zhaozhiyu/Projects/caster/chatbot
npm install
cp .env.example .env
```

在 `.env` 写入：

```bash
DEEPSEEK_API_KEY=sk-...
PORT=3001
CHATBOT_DATA_FILE=data/chat-history.json
SEARXNG_BASE_URL=http://127.0.0.1:8888
WEB_SEARCH_MAX_RESULTS=5
WEB_SEARCH_TIMEOUT_MS=8000
```

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

停止搜索服务：

```bash
npm run search:down
```

如果需要改 SearXNG 端口，复制并编辑 `searxng/.env.example`：

```bash
cp searxng/.env.example searxng/.env
```

页面输入框上方的 `Web` 开关只影响当前发送或重新生成的一轮。开启后，后端会先让 DeepSeek 按 tool calling 协议调用 `web_search` 工具，由模型生成搜索 query；本地 SearXNG 执行检索后再把工具结果回传给 DeepSeek，直到模型给出最终回答。`轻 / 中 / 深` 三档分别限制最多 2 / 6 / 不限次数的实际搜索；达到有限强度上限时会基于已有来源收口，不再直接报错。聊天记录只保存搜索 query、来源标题、链接和摘要。

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
/Users/zhaozhiyu/Projects/caster/chatbot/data/chat-history.json
```

浏览器 `localStorage` 只作为缓存和旧数据迁移兜底使用。

## 构建

```bash
npm run build
npm start
```
