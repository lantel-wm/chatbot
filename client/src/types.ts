export type ChatModel = "deepseek-v4-flash" | "deepseek-v4-pro";
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  reasoningContent?: string;
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

export const DEFAULT_MODEL: ChatModel = "deepseek-v4-flash";
