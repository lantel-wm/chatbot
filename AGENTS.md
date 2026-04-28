# Chatbot Deployment Notes

## Scope

This repository is a standalone local DeepSeek web chatbot.

- Frontend: Vite + React + TypeScript under `client/`
- Backend: Node/Express local proxy under `server/`
- Local chat history: JSON file configured by `CHATBOT_DATA_FILE`
- Optional Web Search: local SearXNG container

## Prerequisites

- Node.js with npm. Prefer current LTS or newer.
- A DeepSeek API key.
- Docker Desktop or Docker Engine only if using local Web Search.

## Setup

Install dependencies and create local configuration:

```bash
npm install
cp .env.example .env
```

Minimum `.env`:

```bash
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_CONTEXT_TOKENS=1000000
PORT=3001
CHATBOT_DATA_FILE=data/chat-history.json
```

Optional per-model context overrides:

```bash
DEEPSEEK_V4_FLASH_CONTEXT_TOKENS=1000000
DEEPSEEK_V4_PRO_CONTEXT_TOKENS=1000000
```

The frontend reads model context length from the backend `/api/models` endpoint. The backend first calls DeepSeek `/models`; if the official response does not include context metadata, it falls back to the `.env` context values above. Keep context-length logic in the backend and do not hard-code it in frontend code.

## Development

```bash
npm run dev
```

Default local URLs:

```text
API:  http://127.0.0.1:3001
Web:  http://127.0.0.1:5173
```

If Vite port `5173` is in use, Vite will choose the next available frontend port. If API port `3001` is in use, stop the old server or set another `PORT` in `.env`.

## Production-Style Local Run

```bash
npm run build
npm start
```

## Local Data

Chat history is stored in:

```text
data/chat-history.json
```

Do not commit personal runtime files:

- `.env`
- `data/chat-history.json`
- `searxng/.env`
- `searxng/cache/`

## Optional Web Search

Web Search uses a local SearXNG container bound to localhost. Start Docker first, then run:

```bash
npm run search:up
```

Verify SearXNG and the chatbot proxy:

```bash
curl 'http://127.0.0.1:8888/search?q=test&format=json'
curl http://127.0.0.1:3001/api/search/health
```

Stop SearXNG:

```bash
npm run search:down
```

Useful Web Search settings:

```bash
SEARXNG_BASE_URL=http://127.0.0.1:8888
SEARXNG_ENGINE_CANDIDATES=bing,qwant,mojeek,wikipedia,reuters,wikinews,brave,duckduckgo,startpage,google
SEARXNG_ENGINE_PROBE_QUERY=OpenAI
SEARXNG_ENGINE_PROBE_TTL_MS=600000
WEB_SEARCH_MAX_RESULTS=5
WEB_SEARCH_TIMEOUT_MS=8000
WEB_SEARCH_DELAY_MS=1500
```

`SEARXNG_ENGINE_CANDIDATES` is a probe candidate pool, not a fixed active engine list. The backend probes engines before search, passes only currently available engines to SearXNG, and caches probe results by `SEARXNG_ENGINE_PROBE_TTL_MS`. `WEB_SEARCH_DELAY_MS` serializes and throttles SearXNG requests to reduce upstream rate-limit or CAPTCHA risk.

Current Web Search behavior:

- The UI exposes a manual `智能搜索` permission switch.
- When enabled, the backend lets DeepSeek decide whether to call the local `web_search` tool.
- The frontend sends high/unlimited search intensity by default.
- The backend saves only query/title/URL/snippet source metadata with the assistant message.

### SearXNG Proxy

If search engines return empty results, CAPTCHA, `403`, `429`, or connection errors, configure SearXNG's outbound proxy in `searxng/settings.yml` under `outgoing.proxies`.

Before deployment, check the proxy URL already present in `searxng/settings.yml`. It may be a local-machine example such as `http://192.168.x.x:1087`; replace it with an address that is reachable from the SearXNG Docker container on the target machine.

Example for a host-machine HTTP proxy on macOS / Windows Docker Desktop:

```yaml
outgoing:
  request_timeout: 10.0
  extra_proxy_timeout: 10
  proxies:
    "all://":
      - http://host.docker.internal:7890
```

Example for a SOCKS proxy:

```yaml
outgoing:
  request_timeout: 10.0
  extra_proxy_timeout: 10
  proxies:
    "all://":
      - socks5h://host.docker.internal:1080
```

Important details:

- Do not use `127.0.0.1` for a proxy running on the host machine; inside Docker it means the SearXNG container itself.
- On macOS and Windows Docker Desktop, use `host.docker.internal:<proxy-port>`.
- On Linux Docker, either bind the proxy to a reachable LAN / bridge address, or add Docker host gateway mapping in `searxng/docker-compose.yml`:

```yaml
services:
  searxng:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Then use `http://host.docker.internal:<proxy-port>` or `socks5h://host.docker.internal:<proxy-port>` in `settings.yml`.

After changing proxy settings, restart SearXNG and verify:

```bash
npm run search:down
npm run search:up
curl 'http://127.0.0.1:8888/search?q=test&format=json'
curl http://127.0.0.1:3001/api/search/health
```

Official reference: SearXNG `outgoing.proxies` supports one or more proxy URLs under protocol keys such as `"all://"`; multiple proxies are load-balanced round-robin.

## Validation

Run before handing off changes:

```bash
npm run typecheck
npm run build
```
