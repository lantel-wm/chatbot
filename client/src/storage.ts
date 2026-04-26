import { DEFAULT_MODEL, type Conversation, type StoredChatState } from "./types";

const STORAGE_KEY = "caster.deepseek.chatbot.v1";

export function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createConversation(title = "新对话"): Conversation {
  const timestamp = nowIso();
  return {
    id: makeId(),
    title,
    model: DEFAULT_MODEL,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function loadChatState(): StoredChatState {
  const fallback = createConversation();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { activeConversationId: fallback.id, conversations: [fallback] };
    }

    const parsed = JSON.parse(raw) as StoredChatState;
    if (!Array.isArray(parsed.conversations) || !parsed.conversations.length) {
      return { activeConversationId: fallback.id, conversations: [fallback] };
    }

    const activeConversationId =
      parsed.conversations.some((conversation) => conversation.id === parsed.activeConversationId)
        ? parsed.activeConversationId
        : parsed.conversations[0].id;

    return {
      activeConversationId,
      conversations: parsed.conversations
    };
  } catch {
    return { activeConversationId: fallback.id, conversations: [fallback] };
  }
}

export function saveChatState(state: StoredChatState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function loadJsonChatState(): Promise<StoredChatState | null> {
  const response = await fetch("/api/chat/state");
  if (!response.ok) {
    throw new Error(await readPersistenceError(response));
  }

  const parsed = (await response.json()) as StoredChatState;
  const normalized = normalizeStoredChatState(parsed);
  return hasStoredConversations(normalized) ? normalized : null;
}

export async function saveJsonChatState(state: StoredChatState): Promise<void> {
  const response = await fetch("/api/chat/state", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(state)
  });

  if (!response.ok) {
    throw new Error(await readPersistenceError(response));
  }
}

export function hasStoredConversations(state: StoredChatState): boolean {
  return state.conversations.some((conversation) => {
    return conversation.messages.length > 0 || conversation.title !== "新对话";
  });
}

export function normalizeStoredChatState(state: StoredChatState): StoredChatState {
  const conversations = Array.isArray(state.conversations) ? state.conversations : [];
  const activeConversationId = conversations.some((conversation) => conversation.id === state.activeConversationId)
    ? state.activeConversationId
    : conversations[0]?.id ?? "";

  return {
    activeConversationId,
    conversations
  };
}

async function readPersistenceError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `本地记录请求失败：HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? text;
  } catch {
    return text;
  }
}
