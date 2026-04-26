import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();
const port = Number(process.env.PORT ?? 3001);
const deepseekBaseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
const deepseekChatUrl = `${deepseekBaseUrl}/chat/completions`;
const chatDataFile = path.resolve(process.cwd(), process.env.CHATBOT_DATA_FILE ?? "data/chat-history.json");
const allowedModels = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
const allowedRoles = new Set(["system", "user", "assistant"]);

type ChatRole = "system" | "user" | "assistant";
type ChatModel = "deepseek-v4-flash" | "deepseek-v4-pro";

interface ClientMessage {
  role: ChatRole;
  content: string;
}

interface StoredMessage {
  id: string;
  role: ChatRole;
  content: string;
  reasoningContent?: string;
  createdAt: string;
  editedAt?: string;
}

interface StoredConversation {
  id: string;
  title: string;
  model: ChatModel;
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
}

interface StoredChatState {
  activeConversationId: string;
  conversations: StoredConversation[];
}

interface ChatRequestBody {
  model?: string;
  messages?: ClientMessage[];
}

app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/chat/state", async (_req, res) => {
  try {
    const state = await readStoredChatState();
    res.json(state ?? { activeConversationId: "", conversations: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    res.status(500).json({ error: `读取本地对话记录失败：${message}` });
  }
});

app.put("/api/chat/state", async (req, res) => {
  const state = normalizeStoredChatState(req.body);
  if (!state) {
    res.status(400).json({ error: "对话记录格式无效，无法保存。" });
    return;
  }

  try {
    await writeStoredChatState(state);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    res.status(500).json({ error: `保存本地对话记录失败：${message}` });
  }
});

app.post("/api/chat/stream", async (req: Request<object, object, ChatRequestBody>, res: Response) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "缺少 DEEPSEEK_API_KEY，请在 chatbot/.env 中配置后重启服务。" });
    return;
  }

  const { model, messages } = req.body;
  if (!model || !allowedModels.has(model)) {
    res.status(400).json({ error: "模型无效，请选择 deepseek-v4-flash 或 deepseek-v4-pro。" });
    return;
  }

  const normalizedMessages = normalizeMessages(messages);
  if (!normalizedMessages.length) {
    res.status(400).json({ error: "消息不能为空。" });
    return;
  }

  const controller = new AbortController();
  let clientDisconnected = false;

  res.on("close", () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      controller.abort();
    }
  });

  try {
    const requestBody: Record<string, unknown> = {
      model,
      messages: normalizedMessages,
      stream: true
    };

    if (model === "deepseek-v4-pro") {
      requestBody.thinking = { type: "enabled" };
      requestBody.reasoning_effort = "high";
    } else {
      requestBody.temperature = 0.7;
    }

    const upstream = await fetch(deepseekChatUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      res.status(upstream.status).json({
        error: buildDeepseekError(upstream.status, detail)
      });
      return;
    }

    if (!upstream.body) {
      res.status(502).json({ error: "DeepSeek 没有返回可读取的数据流。" });
      return;
    }

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    await pipeDeepseekStream(upstream.body, res);
    res.end();
  } catch (error) {
    if (controller.signal.aborted) {
      if (clientDisconnected) {
        return;
      }

      if (!res.headersSent) {
        res.status(499).json({ error: "请求已取消。" });
      } else {
        res.end();
      }
      return;
    }

    const message = error instanceof Error ? error.message : "未知错误";
    if (!res.headersSent) {
      res.status(502).json({ error: `DeepSeek 请求失败：${message}` });
    } else {
      writeStreamEvent(res, "error", `DeepSeek 请求中断：${message}`);
      res.end();
    }
  }
});

const staticDir = path.resolve(process.cwd(), "dist/client");
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`DeepSeek chatbot server listening on http://127.0.0.1:${port}`);
  console.log(`Chat history JSON: ${chatDataFile}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用。请先停止旧的 chatbot dev server，或在 .env 中设置 PORT=其他端口。`);
    process.exit(1);
  }

  throw error;
});

function normalizeMessages(messages: unknown): ClientMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message): message is ClientMessage => {
      if (!message || typeof message !== "object") {
        return false;
      }
      const candidate = message as Partial<ClientMessage>;
      return (
        typeof candidate.role === "string" &&
        allowedRoles.has(candidate.role) &&
        typeof candidate.content === "string" &&
        candidate.content.trim().length > 0
      );
    })
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

async function readStoredChatState(): Promise<StoredChatState | null> {
  try {
    const raw = await fsp.readFile(chatDataFile, "utf8");
    return normalizeStoredChatState(JSON.parse(raw));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeStoredChatState(state: StoredChatState): Promise<void> {
  await fsp.mkdir(path.dirname(chatDataFile), { recursive: true });
  const tempFile = `${chatDataFile}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fsp.rename(tempFile, chatDataFile);
}

function normalizeStoredChatState(value: unknown): StoredChatState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredChatState>;
  if (!Array.isArray(candidate.conversations)) {
    return null;
  }

  const conversations = candidate.conversations
    .map(normalizeStoredConversation)
    .filter((conversation): conversation is StoredConversation => Boolean(conversation));

  const activeConversationId =
    typeof candidate.activeConversationId === "string" &&
    conversations.some((conversation) => conversation.id === candidate.activeConversationId)
      ? candidate.activeConversationId
      : conversations[0]?.id ?? "";

  return { activeConversationId, conversations };
}

function normalizeStoredConversation(value: unknown): StoredConversation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredConversation>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    !candidate.model ||
    !allowedModels.has(candidate.model) ||
    !Array.isArray(candidate.messages) ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    title: candidate.title,
    model: candidate.model,
    messages: candidate.messages
      .map(normalizeStoredMessage)
      .filter((message): message is StoredMessage => Boolean(message)),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

function normalizeStoredMessage(value: unknown): StoredMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredMessage>;
  if (
    typeof candidate.id !== "string" ||
    !candidate.role ||
    !allowedRoles.has(candidate.role) ||
    typeof candidate.content !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    role: candidate.role,
    content: candidate.content,
    reasoningContent: typeof candidate.reasoningContent === "string" ? candidate.reasoningContent : undefined,
    createdAt: candidate.createdAt,
    editedAt: typeof candidate.editedAt === "string" ? candidate.editedAt : undefined
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function pipeDeepseekStream(body: ReadableStream<Uint8Array>, res: Response): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      writeDeepseekLine(line, res);
    }
  }

  buffer += decoder.decode();
  if (buffer) {
    for (const line of buffer.split(/\r?\n/)) {
      writeDeepseekLine(line, res);
    }
  }
}

function writeDeepseekLine(line: string, res: Response): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return;
  }

  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") {
    return;
  }

  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{
        delta?: { reasoning_content?: string; content?: string };
        message?: { reasoning_content?: string; content?: string };
      }>;
    };
    const reasoningContent =
      parsed.choices?.[0]?.delta?.reasoning_content ?? parsed.choices?.[0]?.message?.reasoning_content ?? "";
    const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? "";
    if (reasoningContent) {
      writeStreamEvent(res, "reasoning", reasoningContent);
    }
    if (content) {
      writeStreamEvent(res, "content", content);
    }
  } catch {
    // Ignore malformed SSE fragments and keep the stream alive.
  }
}

function writeStreamEvent(res: Response, type: "reasoning" | "content" | "error", content: string): void {
  res.write(`${JSON.stringify({ type, content })}\n`);
}

function buildDeepseekError(status: number, detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) {
    return `DeepSeek 返回 HTTP ${status}。`;
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string }; message?: string };
    const message = parsed.error?.message ?? parsed.message;
    return message ? `DeepSeek 返回 HTTP ${status}：${message}` : `DeepSeek 返回 HTTP ${status}。`;
  } catch {
    return `DeepSeek 返回 HTTP ${status}：${trimmed.slice(0, 400)}`;
  }
}
