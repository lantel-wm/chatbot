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
```

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
