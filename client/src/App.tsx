import {
  Bot,
  BrainCircuit,
  Check,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Globe2,
  MessageSquare,
  PanelLeft,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Upload,
  User,
  X
} from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  type ChatModelMetadata,
  type ChatMessage,
  type ChatModel,
  type Conversation,
  type StoredChatState,
  type TokenUsage,
  type WebSearchContext,
  type WebSearchIntensity
} from "./types";
import {
  createConversation,
  hasStoredConversations,
  loadChatState,
  loadJsonChatState,
  makeId,
  nowIso,
  saveChatState,
  saveJsonChatState
} from "./storage";

interface GenerationState {
  conversationId: string;
  messageId: string;
  webSearchEnabled: boolean;
  webSearchIntensity: WebSearchIntensity;
  deepThinkingEnabled: boolean;
}

type StreamEvent =
  | {
      type: "reasoning" | "content" | "error";
      content: string;
    }
  | {
      type: "usage";
      usage: TokenUsage;
    }
  | {
      type: "search_results";
      search: WebSearchContext;
    }
  | {
      type: "search_status";
      status: "searching";
    };

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 160;

interface TokenSummary {
  estimatedContextTokens: number;
  contextLimitTokens: number;
}

interface ComposerInputProps {
  resetKey: string;
  isGenerating: boolean;
  onSubmitMessage: (content: string) => void | Promise<void>;
  onStopGeneration: () => void;
}

function buildMarkdownComponents(search?: WebSearchContext): Components {
  const sourceUrls = new Set(search?.results.map((result) => result.url) ?? []);

  return {
    a({ children, className, href, ...props }) {
      const text = extractText(children).trim();
      const isCitation = Boolean(href && sourceUrls.has(href) && /^\[\d+\]$/.test(text));
      const mergedClassName = [className, isCitation ? "citation-link" : ""].filter(Boolean).join(" ") || undefined;
      const sourceTitle = isCitation && href ? getSourceTitleByUrl(search, href) : undefined;

      return (
        <a
          {...props}
          className={mergedClassName}
          href={href}
          target="_blank"
          rel="noreferrer"
          title={sourceTitle ?? props.title}
        >
          {children}
        </a>
      );
    },
    pre({ children }) {
      return <CodeBlock>{children}</CodeBlock>;
    },
    code({ children, className, ...props }) {
      return (
        <code className={className ? `markdown-code ${className}` : "markdown-code"} {...props}>
          {children}
        </code>
      );
    }
  };
}

const markdownComponents = buildMarkdownComponents();

function MarkdownContent({ content, search }: { content: string; search?: WebSearchContext }) {
  const components = useMemo(() => buildMarkdownComponents(search), [search]);
  const linkedContent = useMemo(() => linkifySearchCitations(content, search), [content, search]);

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
      {linkedContent}
    </ReactMarkdown>
  );
}

const reasoningMarkdownComponents: Components = {
  a({ children, ...props }) {
    return (
      <a {...props} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  ...markdownComponents
};

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = extractText(children);

  async function copyCode() {
    if (!code) {
      return;
    }

    await copyText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="code-block">
      <button className="copy-code-button" type="button" onClick={() => void copyCode()}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "已复制" : "复制"}
      </button>
      <pre className="markdown-pre">{children}</pre>
    </div>
  );
}

function SearchSources({ search }: { search: WebSearchContext }) {
  return (
    <details className="sources-panel">
      <summary>
        <Globe2 size={15} />
        Web 来源
        <span>{search.results.length ? `${search.results.length} 条` : "无结果"}</span>
      </summary>
      <div className="sources-query">Query: {search.query}</div>
      {search.results.length ? (
        <div className="source-list">
          {search.results.map((result, index) => (
            <a className="source-card" key={`${result.url}-${index}`} href={result.url} target="_blank" rel="noreferrer">
              <div className="source-index">{index + 1}</div>
              <div className="source-content">
                <div className="source-title">
                  <span>{result.title}</span>
                  <ExternalLink size={13} />
                </div>
                <p>{result.snippet}</p>
                <span className="source-url">{formatSourceHost(result.url, result.engine)}</span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="source-empty">SearXNG 没有返回结果。</p>
      )}
    </details>
  );
}

function ContextHud({ summary }: { summary: TokenSummary }) {
  const usedPercent = getContextUsagePercent(summary);
  const tone = getContextUsageTone(usedPercent);
  const roundedPercent = Math.round(usedPercent);

  return (
    <div
      className={`context-hud ${tone}`}
      title="当前上下文为本地估算，不包含历史思考过程；单次回复用量显示在对应回复上。"
      aria-label="上下文使用量"
    >
      <span
        className="context-hud-ring"
        aria-hidden="true"
        style={{ "--context-used": `${Math.max(1, roundedPercent)}%` } as React.CSSProperties}
      />
      <span className="context-hud-label">上下文</span>
      <span className="context-hud-value">{roundedPercent}%</span>
    </div>
  );
}

const ComposerInput = memo(function ComposerInput({
  resetKey,
  isGenerating,
  onSubmitMessage,
  onStopGeneration
}: ComposerInputProps) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft("");
  }, [resetKey]);

  function submitDraft(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || isGenerating) {
      return;
    }

    setDraft("");
    void onSubmitMessage(content);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      submitDraft();
    }
  }

  return (
    <form className="composer" onSubmit={submitDraft}>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="给 Chatbot 发送消息"
        rows={1}
        disabled={isGenerating}
      />
      {isGenerating ? (
        <button className="send-button stop" type="button" title="停止生成" onClick={onStopGeneration}>
          <Square size={18} />
        </button>
      ) : (
        <button className="send-button" type="submit" title="发送" disabled={!draft.trim()}>
          <Send size={18} />
        </button>
      )}
    </form>
  );
});

export default function App() {
  const initialState = useMemo(() => loadChatState(), []);
  const [conversations, setConversations] = useState<Conversation[]>(initialState.conversations);
  const [activeConversationId, setActiveConversationId] = useState(initialState.activeConversationId);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(true);
  const [modelMetadata, setModelMetadata] = useState<ChatModelMetadata[]>([]);
  const [searching, setSearching] = useState(false);
  const [jsonPersistenceReady, setJsonPersistenceReady] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const messagesScrollRef = useRef<HTMLElement | null>(null);
  const shouldFollowOutputRef = useRef(true);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0];

  const sortedConversations = useMemo(
    () =>
      [...conversations].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      ),
    [conversations]
  );

  const isGenerating = generation !== null;
  const activeContextLimitTokens = getModelContextLimitTokens(modelMetadata, activeConversation?.model);
  const tokenSummary = useMemo(
    () => buildTokenSummary(activeConversation, activeContextLimitTokens),
    [activeConversation, activeContextLimitTokens]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadModelMetadata() {
      try {
        const response = await fetch("/api/models");
        if (!response.ok) {
          throw new Error(await readErrorResponse(response));
        }
        const metadata = normalizeModelMetadataResponse(await response.json());
        if (!cancelled) {
          setModelMetadata(metadata);
        }
      } catch (errorValue) {
        const message = errorValue instanceof Error ? errorValue.message : "读取模型信息失败。";
        console.warn(message);
      }
    }

    void loadModelMetadata();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrateFromJson() {
      try {
        const jsonState = await loadJsonChatState();
        if (cancelled) {
          return;
        }

        if (jsonState) {
          setConversations(jsonState.conversations);
          setActiveConversationId(jsonState.activeConversationId);
          saveChatState(jsonState);
          return;
        }

        if (hasStoredConversations(initialState)) {
          await saveJsonChatState(initialState);
        }
      } catch (errorValue) {
        const message = errorValue instanceof Error ? errorValue.message : "读取本地 JSON 记录失败。";
        console.warn(message);
      } finally {
        if (!cancelled) {
          setJsonPersistenceReady(true);
        }
      }
    }

    void hydrateFromJson();
    return () => {
      cancelled = true;
    };
  }, [initialState]);

  useEffect(() => {
    const state = { activeConversationId, conversations };
    saveChatState(state);

    if (!jsonPersistenceReady) {
      return undefined;
    }

    const saveTimer = window.setTimeout(() => {
      void saveJsonChatState(state).catch((errorValue) => {
        const message = errorValue instanceof Error ? errorValue.message : "保存本地 JSON 记录失败。";
        console.warn(message);
      });
    }, 350);

    return () => window.clearTimeout(saveTimer);
  }, [activeConversationId, conversations, jsonPersistenceReady]);

  useEffect(() => {
    if (!activeConversation && conversations[0]) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversation, conversations]);

  useEffect(() => {
    shouldFollowOutputRef.current = true;
    window.requestAnimationFrame(() => scrollMessagesToBottom("auto"));
  }, [activeConversationId]);

  useEffect(() => {
    if (!shouldFollowOutputRef.current) {
      return;
    }

    window.requestAnimationFrame(() => scrollMessagesToBottom(isGenerating ? "auto" : "smooth"));
  }, [activeConversation?.messages, isGenerating]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function startNewConversation() {
    const conversation = createConversation();
    conversation.model = activeConversation?.model ?? DEFAULT_MODEL;
    shouldFollowOutputRef.current = true;
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setIsSidebarOpen(false);
    setError(null);
  }

  function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setIsSidebarOpen(false);
  }

  function toggleSidebar() {
    if (window.matchMedia("(max-width: 640px)").matches) {
      setIsSidebarOpen((open) => !open);
      return;
    }

    setIsSidebarCollapsed((collapsed) => !collapsed);
  }

  function handleMessagesScroll() {
    const element = messagesScrollRef.current;
    if (!element) {
      return;
    }

    shouldFollowOutputRef.current = isScrolledNearBottom(element);
  }

  function scrollMessagesToBottom(behavior: ScrollBehavior) {
    const element = messagesScrollRef.current;
    if (!element) {
      return;
    }

    element.scrollTo({
      top: element.scrollHeight,
      behavior
    });
  }

  function deleteConversation(conversationId: string) {
    if (isGenerating) {
      return;
    }

    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      return;
    }

    const confirmed = window.confirm(`删除“${conversation.title}”？`);
    if (!confirmed) {
      return;
    }

    if (conversations.length === 1) {
      const replacement = createConversation();
      setConversations([replacement]);
      setActiveConversationId(replacement.id);
      return;
    }

    const nextConversations = conversations.filter((item) => item.id !== conversationId);
    setConversations(nextConversations);
    if (conversationId === activeConversationId) {
      setActiveConversationId(nextConversations[0].id);
    }
  }

  function beginRename(conversation: Conversation) {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title);
  }

  function commitRename(conversationId: string) {
    const nextTitle = renameDraft.trim() || "新对话";
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, title: nextTitle, updatedAt: nowIso() }
          : conversation
      )
    );
    setRenamingId(null);
    setRenameDraft("");
  }

  function updateActiveModel(model: ChatModel) {
    if (!activeConversation || isGenerating) {
      return;
    }

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id ? { ...conversation, model, updatedAt: nowIso() } : conversation
      )
    );
  }

  function exportChatData() {
    const payload: StoredChatState = {
      activeConversationId,
      conversations
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `deepseek-chat-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importChatData(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<StoredChatState>;
      const imported = normalizeImportedConversations(parsed);

      if (!imported.length) {
        throw new Error("导入文件里没有可用的对话记录。");
      }

      const existingIds = new Set(conversations.map((conversation) => conversation.id));
      const incoming = imported.map((conversation) => {
        if (!existingIds.has(conversation.id)) {
          existingIds.add(conversation.id);
          return conversation;
        }

        const importedCopy = {
          ...conversation,
          id: makeId(),
          title: `${conversation.title}（导入）`,
          updatedAt: nowIso()
        };
        existingIds.add(importedCopy.id);
        return importedCopy;
      });

      setConversations([...incoming, ...conversations]);
      setActiveConversationId(incoming[0].id);
      setError(null);
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : "导入失败。";
      setError(message);
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }

  async function submitMessage(content: string) {
    if (!content || !activeConversation || isGenerating) {
      return;
    }

    setError(null);

    const timestamp = nowIso();
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content,
      createdAt: timestamp
    };
    const nextMessages = [...activeConversation.messages, userMessage];
    const title = activeConversation.messages.length ? activeConversation.title : buildTitle(content);

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, title, messages: nextMessages, updatedAt: timestamp }
          : conversation
      )
    );

    await requestAssistant(
      activeConversation.id,
      nextMessages,
      activeConversation.model,
      deepThinkingEnabled,
      webSearchEnabled
    );
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  function beginEditMessage(message: ChatMessage) {
    if (isGenerating || message.role !== "user") {
      return;
    }

    setEditingMessageId(message.id);
    setMessageDraft(message.content);
  }

  function cancelEditMessage() {
    setEditingMessageId(null);
    setMessageDraft("");
  }

  async function saveEditedMessage(messageId: string) {
    if (!activeConversation || isGenerating) {
      return;
    }

    const content = messageDraft.trim();
    if (!content) {
      return;
    }

    const messageIndex = activeConversation.messages.findIndex((message) => message.id === messageId);
    const target = activeConversation.messages[messageIndex];
    if (messageIndex < 0 || target.role !== "user") {
      return;
    }

    const timestamp = nowIso();
    const nextMessages = [
      ...activeConversation.messages.slice(0, messageIndex),
      {
        ...target,
        content,
        editedAt: timestamp
      }
    ];
    const nextTitle = messageIndex === 0 ? buildTitle(content) : activeConversation.title;

    setEditingMessageId(null);
    setMessageDraft("");
    setError(null);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              title: nextTitle,
              messages: nextMessages,
              updatedAt: timestamp
            }
          : conversation
      )
    );

    await requestAssistant(
      activeConversation.id,
      nextMessages,
      activeConversation.model,
      deepThinkingEnabled,
      webSearchEnabled
    );
  }

  async function regenerateReply(messageId: string) {
    if (!activeConversation || isGenerating) {
      return;
    }

    const messageIndex = activeConversation.messages.findIndex((message) => message.id === messageId);
    const target = activeConversation.messages[messageIndex];
    if (messageIndex < 0 || target.role !== "assistant") {
      return;
    }

    const messages = activeConversation.messages.slice(0, messageIndex);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return;
    }

    const timestamp = nowIso();
    setError(null);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, messages, updatedAt: timestamp }
          : conversation
      )
    );

    await requestAssistant(
      activeConversation.id,
      messages,
      activeConversation.model,
      deepThinkingEnabled,
      webSearchEnabled
    );
  }

  async function requestAssistant(
    conversationId: string,
    messages: ChatMessage[],
    model: ChatModel,
    useDeepThinking: boolean,
    useWebSearch: boolean
  ) {
    const assistantMessage: ChatMessage = {
      id: makeId(),
      role: "assistant",
      content: "",
      createdAt: nowIso()
    };
    const controller = new AbortController();
    abortRef.current = controller;
    shouldFollowOutputRef.current = true;
    setGeneration({
      conversationId,
      messageId: assistantMessage.id,
      webSearchEnabled: useWebSearch,
      webSearchIntensity: "deep",
      deepThinkingEnabled: useDeepThinking
    });
    setSearching(false);
    appendAssistantPlaceholder(conversationId, assistantMessage);

    let responseText = "";
    let reasoningText = "";
    let searchContext: WebSearchContext | undefined;

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: messages.map(({ role, content }) => ({ role, content })),
          thinking: { enabled: useDeepThinking },
          webSearch: { enabled: useWebSearch, intensity: "deep" }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }

      if (!response.body) {
        throw new Error("DeepSeek 响应没有可读取的数据流。");
      }

      await readChatStream(response.body, (event) => {
        if (event.type === "search_status") {
          setSearching(event.status === "searching");
          return;
        }

        if (event.type === "search_results") {
          searchContext = event.search;
          setSearching(false);
          updateAssistantSearch(conversationId, assistantMessage.id, event.search);
          return;
        }

        if (event.type === "reasoning") {
          setSearching(false);
          reasoningText += event.content;
          updateAssistantMessage(conversationId, assistantMessage.id, responseText, reasoningText);
          return;
        }

        if (event.type === "content") {
          setSearching(false);
          responseText += event.content;
          updateAssistantMessage(conversationId, assistantMessage.id, responseText, reasoningText);
          return;
        }

        if (event.type === "usage") {
          updateAssistantUsage(conversationId, assistantMessage.id, event.usage);
          return;
        }

        throw new Error(event.content);
      });

      if (!responseText.trim()) {
        updateAssistantMessage(conversationId, assistantMessage.id, "DeepSeek 没有返回内容。", reasoningText);
      }
    } catch (errorValue) {
      const isAbort = errorValue instanceof DOMException && errorValue.name === "AbortError";
      if (isAbort) {
        updateAssistantMessage(conversationId, assistantMessage.id, responseText || "已停止生成。", reasoningText);
      } else {
        const message = errorValue instanceof Error ? errorValue.message : "未知错误";
        setError(message);
        updateAssistantMessage(conversationId, assistantMessage.id, `请求失败：${message}`, reasoningText);
        if (searchContext) {
          updateAssistantSearch(conversationId, assistantMessage.id, searchContext);
        }
      }
    } finally {
      abortRef.current = null;
      setSearching(false);
      setGeneration(null);
    }
  }

  function appendAssistantPlaceholder(conversationId: string, assistantMessage: ChatMessage) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: [...conversation.messages, assistantMessage],
              updatedAt: assistantMessage.createdAt
            }
          : conversation
      )
    );
  }

  function updateAssistantMessage(
    conversationId: string,
    messageId: string,
    content: string,
    reasoningContent?: string
  ) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId ? { ...message, content, reasoningContent } : message
              ),
              updatedAt: nowIso()
            }
          : conversation
      )
    );
  }

  function updateAssistantSearch(conversationId: string, messageId: string, search: WebSearchContext) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId ? { ...message, search } : message
              ),
              updatedAt: nowIso()
            }
          : conversation
      )
    );
  }

  function updateAssistantUsage(conversationId: string, messageId: string, usage: TokenUsage) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId ? { ...message, usage } : message
              ),
              updatedAt: nowIso()
            }
          : conversation
      )
    );
  }

  return (
    <div
      className={`app-shell ${isSidebarOpen ? "is-sidebar-open" : ""} ${
        isSidebarCollapsed ? "is-sidebar-collapsed" : ""
      }`}
    >
      <aside className="sidebar" aria-label="会话">
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-mark">
              <Bot size={18} />
            </span>
            <span>Chatbot</span>
          </div>
          <button className="icon-button" type="button" title="新建对话" onClick={startNewConversation}>
            <Plus size={18} />
          </button>
        </div>

        <div className="conversation-list">
          {sortedConversations.map((conversation) => (
            <div
              className={`conversation-row ${conversation.id === activeConversationId ? "is-active" : ""}`}
              key={conversation.id}
            >
              <button
                className="conversation-main"
                type="button"
                onClick={() => selectConversation(conversation.id)}
                title={conversation.title}
              >
                <MessageSquare size={16} />
                {renamingId === conversation.id ? (
                  <input
                    className="rename-input"
                    value={renameDraft}
                    autoFocus
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => commitRename(conversation.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitRename(conversation.id);
                      }
                      if (event.key === "Escape") {
                        setRenamingId(null);
                        setRenameDraft("");
                      }
                    }}
                  />
                ) : (
                  <span>{conversation.title}</span>
                )}
              </button>
              <div className="conversation-actions">
                <button
                  className="icon-button subtle"
                  type="button"
                  title="重命名"
                  onClick={() => beginRename(conversation)}
                  disabled={isGenerating}
                >
                  <Edit3 size={15} />
                </button>
                <button
                  className="icon-button subtle danger"
                  type="button"
                  title="删除"
                  onClick={() => deleteConversation(conversation.id)}
                  disabled={isGenerating}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="data-button" type="button" onClick={exportChatData}>
            <Download size={15} />
            导出
          </button>
          <button className="data-button" type="button" onClick={() => importInputRef.current?.click()}>
            <Upload size={15} />
            导入
          </button>
          <input
            ref={importInputRef}
            className="hidden-file-input"
            type="file"
            accept="application/json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                void importChatData(file);
              }
            }}
          />
        </div>
      </aside>
      <button
        className="sidebar-backdrop"
        type="button"
        aria-label="关闭会话栏"
        onClick={() => setIsSidebarOpen(false)}
      />

      <main className="chat-pane">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="topbar-icon"
              type="button"
              title="打开或关闭会话栏"
              onClick={toggleSidebar}
            >
              <PanelLeft size={18} />
            </button>
            <div>
              <h1>{activeConversation?.title ?? "新对话"}</h1>
              <p>{activeConversation?.messages.length ?? 0} 条消息</p>
            </div>
          </div>

          <div className="topbar-controls">
            <label className="model-select">
              <span>模型</span>
              <select
                aria-label="模型选择"
                value={activeConversation?.model ?? DEFAULT_MODEL}
                onChange={(event) => updateActiveModel(event.currentTarget.value as ChatModel)}
                disabled={isGenerating}
              >
                {MODEL_OPTIONS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="icon-button subtle" type="button" title="关闭" onClick={() => setError(null)}>
              <X size={16} />
            </button>
          </div>
        ) : null}

        <section className="messages" aria-live="polite" ref={messagesScrollRef} onScroll={handleMessagesScroll}>
          {activeConversation?.messages.length ? (
            activeConversation.messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="avatar" aria-hidden="true">
                  {message.role === "assistant" ? <Bot size={18} /> : <User size={17} />}
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    <span>{message.role === "assistant" ? "Chatbot" : "你"}</span>
                    {message.search ? <span className="search-badge">已联网</span> : null}
                    {message.role === "assistant" && message.usage ? (
                      <span className="usage-badge">{formatUsageSummary(message.usage)}</span>
                    ) : null}
                    {message.editedAt ? <span>已编辑</span> : null}
                    {generation?.messageId === message.id ? <span>生成中</span> : null}
                  </div>

                  {editingMessageId === message.id ? (
                    <div className="edit-panel">
                      <textarea
                        value={messageDraft}
                        onChange={(event) => setMessageDraft(event.target.value)}
                        autoFocus
                      />
                      <div className="edit-actions">
                        <button className="secondary-button" type="button" onClick={cancelEditMessage}>
                          <X size={16} />
                          取消
                        </button>
                        <button className="primary-button" type="button" onClick={() => void saveEditedMessage(message.id)}>
                          <Check size={16} />
                          保存并重新生成
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {message.role === "assistant" && message.reasoningContent ? (
                        <details className="reasoning-panel" open={generation?.messageId === message.id}>
                          <summary>思考过程</summary>
                          <div className="reasoning-content">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeSanitize]}
                              components={reasoningMarkdownComponents}
                            >
                              {message.reasoningContent}
                            </ReactMarkdown>
                          </div>
                        </details>
                      ) : null}
                      <div className="markdown-body">
                        {message.content ? (
                          <MarkdownContent
                            content={message.content}
                            search={message.role === "assistant" ? message.search : undefined}
                          />
                        ) : (
                          <span className="typing-cursor">
                            {generation?.messageId === message.id && searching
                              ? "正在搜索网页..."
                              : message.reasoningContent
                                ? "正在整理回答..."
                                : "正在生成..."}
                          </span>
                        )}
                      </div>
                      {message.role === "assistant" && message.search ? <SearchSources search={message.search} /> : null}
                    </>
                  )}

                  {message.role === "assistant" && editingMessageId !== message.id ? (
                    <div className="message-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void regenerateReply(message.id)}
                        disabled={isGenerating || !canRegenerateReply(activeConversation, message.id)}
                      >
                        <RefreshCw size={15} />
                        重新生成
                      </button>
                    </div>
                  ) : null}

                  {message.role === "user" && editingMessageId !== message.id ? (
                    <div className="message-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => beginEditMessage(message)}
                        disabled={isGenerating}
                      >
                        <Edit3 size={15} />
                        编辑
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <Bot size={30} />
              <h2>开始一个新对话</h2>
              <p>选择模型后发送第一条消息。</p>
            </div>
          )}
        </section>

        <footer className="composer-wrap">
          <div className="composer-panel">
            <div className="composer-tools">
              <ContextHud summary={tokenSummary} />
              <button
                className={`tool-toggle ${deepThinkingEnabled ? "is-active" : ""}`}
                type="button"
                onClick={() => setDeepThinkingEnabled((enabled) => !enabled)}
                disabled={isGenerating}
                title="启用 DeepSeek 深度思考输出"
                aria-pressed={deepThinkingEnabled}
              >
                <BrainCircuit size={16} />
                深度思考
              </button>
              <button
                className={`tool-toggle ${webSearchEnabled ? "is-active" : ""}`}
                type="button"
                onClick={() => setWebSearchEnabled((enabled) => !enabled)}
                disabled={isGenerating}
                title="允许模型在需要时使用本地 SearXNG 搜索，默认高强度无限搜索"
                aria-pressed={webSearchEnabled}
              >
                <Globe2 size={16} />
                智能搜索
              </button>
            </div>
            <ComposerInput
              resetKey={activeConversation?.id ?? ""}
              isGenerating={isGenerating}
              onSubmitMessage={submitMessage}
              onStopGeneration={stopGeneration}
            />
          </div>
        </footer>
      </main>
    </div>
  );
}

function buildTitle(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 32) : "新对话";
}

function canRegenerateReply(conversation: Conversation | undefined, messageId: string): boolean {
  if (!conversation?.messages.length) {
    return false;
  }

  const messageIndex = conversation.messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0 || conversation.messages[messageIndex].role !== "assistant") {
    return false;
  }

  return conversation.messages[messageIndex - 1]?.role === "user";
}

function getModelContextLimitTokens(metadata: ChatModelMetadata[], model?: ChatModel): number {
  if (!model) {
    return 0;
  }

  return metadata.find((entry) => entry.id === model)?.contextLengthTokens ?? 0;
}

function buildTokenSummary(conversation: Conversation | undefined, contextLimitTokens: number): TokenSummary {
  const estimatedContextTokens = estimateConversationContextTokens(conversation);
  return {
    estimatedContextTokens,
    contextLimitTokens
  };
}

function estimateConversationContextTokens(conversation?: Conversation): number {
  if (!conversation) {
    return 0;
  }

  return conversation.messages.reduce((total, message) => {
    // The backend sends role/content only for chat history. Reasoning text and source cards are not resent next turn.
    return total + 4 + estimateTextTokens(message.role) + estimateTextTokens(message.content);
  }, 3);
}

function estimateTextTokens(value: string): number {
  let tokens = 0;
  let asciiRunLength = 0;

  for (const char of value) {
    if (/[\x00-\x7F]/.test(char)) {
      asciiRunLength += 1;
      continue;
    }

    if (asciiRunLength) {
      tokens += Math.ceil(asciiRunLength / 4);
      asciiRunLength = 0;
    }
    tokens += /\s/.test(char) ? 0 : 1;
  }

  if (asciiRunLength) {
    tokens += Math.ceil(asciiRunLength / 4);
  }

  return tokens;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${trimNumber(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${trimNumber(value / 1_000)}K`;
  }
  return String(Math.round(value));
}

function formatUsageSummary(usage: TokenUsage): string {
  return `输入 ${formatTokenCount(usage.promptTokens)} / 输出 ${formatTokenCount(usage.completionTokens)}`;
}

function trimNumber(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function getContextUsagePercent(summary: TokenSummary): number {
  if (!summary.contextLimitTokens) {
    return 0;
  }
  return Math.min(100, Math.max(0, (summary.estimatedContextTokens / summary.contextLimitTokens) * 100));
}

function getContextUsageTone(percent: number): "is-calm" | "is-warn" | "is-danger" {
  if (percent >= 90) {
    return "is-danger";
  }
  if (percent >= 70) {
    return "is-warn";
  }
  return "is-calm";
}

function normalizeImportedConversations(value: Partial<StoredChatState>): Conversation[] {
  if (!Array.isArray(value.conversations)) {
    return [];
  }

  return value.conversations
    .filter((conversation): conversation is Conversation => {
      return (
        typeof conversation?.id === "string" &&
        typeof conversation.title === "string" &&
        (conversation.model === "deepseek-v4-flash" || conversation.model === "deepseek-v4-pro") &&
        Array.isArray(conversation.messages) &&
        typeof conversation.createdAt === "string" &&
        typeof conversation.updatedAt === "string"
      );
    })
    .map((conversation) => ({
      ...conversation,
      messages: conversation.messages.filter((message) => {
        return (
          typeof message?.id === "string" &&
          (message.role === "system" || message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string" &&
          typeof message.createdAt === "string"
        );
      })
    }));
}

function normalizeModelMetadataResponse(value: unknown): ChatModelMetadata[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const models = (value as { models?: unknown }).models;
  if (!Array.isArray(models)) {
    return [];
  }

  return models.filter((model): model is ChatModelMetadata => {
    if (!model || typeof model !== "object") {
      return false;
    }

    const candidate = model as Partial<ChatModelMetadata>;
    return (
      (candidate.id === "deepseek-v4-flash" || candidate.id === "deepseek-v4-pro") &&
      typeof candidate.object === "string" &&
      typeof candidate.ownedBy === "string" &&
      typeof candidate.contextLengthTokens === "number" &&
      Number.isFinite(candidate.contextLengthTokens) &&
      candidate.contextLengthTokens > 0
    );
  });
}

async function readErrorResponse(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `请求失败：HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? text;
  } catch {
    return text;
  }
}

async function readChatStream(body: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void): Promise<void> {
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
      handleStreamLine(line, onEvent);
    }
  }

  buffer += decoder.decode();
  if (buffer) {
    for (const line of buffer.split(/\r?\n/)) {
      handleStreamLine(line, onEvent);
    }
  }
}

function handleStreamLine(line: string, onEvent: (event: StreamEvent) => void): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const parsed = JSON.parse(trimmed) as {
    type?: string;
    content?: unknown;
    search?: unknown;
    status?: unknown;
    usage?: unknown;
  };
  if (
    (parsed.type === "reasoning" || parsed.type === "content" || parsed.type === "error") &&
    typeof parsed.content === "string"
  ) {
    onEvent({ type: parsed.type, content: parsed.content });
    return;
  }

  if (parsed.type === "search_results" && isWebSearchContext(parsed.search)) {
    onEvent({ type: "search_results", search: parsed.search });
    return;
  }

  if (parsed.type === "search_status" && parsed.status === "searching") {
    onEvent({ type: "search_status", status: "searching" });
    return;
  }

  if (parsed.type === "usage" && isTokenUsage(parsed.usage)) {
    onEvent({ type: "usage", usage: parsed.usage });
  }
}

function isWebSearchContext(value: unknown): value is WebSearchContext {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WebSearchContext>;
  return (
    candidate.provider === "searxng" &&
    typeof candidate.query === "string" &&
    typeof candidate.searchedAt === "string" &&
    Array.isArray(candidate.results)
  );
}

function isTokenUsage(value: unknown): value is TokenUsage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TokenUsage>;
  return (
    typeof candidate.promptTokens === "number" &&
    typeof candidate.completionTokens === "number" &&
    typeof candidate.totalTokens === "number"
  );
}

function isScrolledNearBottom(element: HTMLElement): boolean {
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
}

function formatSourceHost(url: string, engine?: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return engine ? `${host} · ${engine}` : host;
  } catch {
    return engine ?? url;
  }
}

function getSourceTitleByUrl(search: WebSearchContext | undefined, url: string): string | undefined {
  const source = search?.results.find((result) => result.url === url);
  if (!source) {
    return undefined;
  }

  return `打开来源：${source.title}`;
}

function linkifySearchCitations(content: string, search?: WebSearchContext): string {
  if (!search?.results.length) {
    return content;
  }

  return content
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part) => {
      if (part.startsWith("`")) {
        return part;
      }

      return part.replace(/(?<!\[)\[(\d+)\](?!\()/g, (match, rawIndex: string) => {
        const index = Number.parseInt(rawIndex, 10);
        if (!Number.isFinite(index) || index < 1) {
          return match;
        }

        const source = search.results[index - 1];
        if (!source) {
          return `[${index}]`;
        }

        return `[[${index}]](<${source.url}>)`;
      });
    })
    .join("");
}

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }

  if (node && typeof node === "object" && "props" in node) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }

  return "";
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
