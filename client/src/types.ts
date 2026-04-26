export type ChatModel = "deepseek-v4-flash" | "deepseek-v4-pro";
export type ChatRole = "system" | "user" | "assistant";
export type WebSearchIntensity = "light" | "standard" | "deep";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

export interface WebSearchContext {
  provider: "searxng";
  query: string;
  searchedAt: string;
  results: WebSearchResult[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  reasoningContent?: string;
  search?: WebSearchContext;
  usage?: TokenUsage;
  createdAt: string;
  editedAt?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: ChatModel;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatState {
  activeConversationId: string;
  conversations: Conversation[];
}

export const MODEL_OPTIONS: Array<{ id: ChatModel; label: string; description: string }> = [
  {
    id: "deepseek-v4-flash",
    label: "V4 Flash",
    description: "快速、经济"
  },
  {
    id: "deepseek-v4-pro",
    label: "V4 Pro",
    description: "更强推理"
  }
];

export const WEB_SEARCH_INTENSITY_OPTIONS: Array<{
  id: WebSearchIntensity;
  label: string;
  description: string;
}> = [
  {
    id: "light",
    label: "轻",
    description: "最多 2 次搜索"
  },
  {
    id: "standard",
    label: "中",
    description: "最多 6 次搜索"
  },
  {
    id: "deep",
    label: "深",
    description: "不限制搜索次数"
  }
];

export const DEFAULT_MODEL: ChatModel = "deepseek-v4-flash";
