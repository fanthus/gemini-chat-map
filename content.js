// content.js

// ============================
// 可配置常量区域（方便未来适配 DOM 变更）
// ============================
const GEMINI_CHAT_MAP_CONFIG = {
  SIDEBAR_ID: 'gemini-chat-map-sidebar',
  SIDEBAR_LIST_ID: 'gemini-chat-map-sidebar-list',
  SIDEBAR_ITEM_CLASS: 'gemini-chat-map-sidebar-item',
  HIGHLIGHT_CLASS: 'gemini-chat-map-highlight',
  HIGHLIGHT_DURATION_MS: 1500,
  MAX_PREVIEW_LENGTH: 80,

  // 可能的对话容器选择器（尽量使用结构/属性，而非类名）
  CHAT_CONTAINER_SELECTORS: [
    '[data-test-id="conversation-container"]',
    'main[role="main"]',
    'main'
  ],

  // 用户消息 data-test-id 候选列表（当前 DOM 未使用，留空以避免误判）
  USER_MESSAGE_TEST_IDS: [],

  // Gemini 目前用户消息 DOM 结构（基于 <user-query> 组件）的结构性选择器
  // 若后续 DOM 有调整，只需要改这里即可
  USER_MESSAGE_FALLBACK_SELECTORS: [
    // 只使用最外层 <user-query> 作为一条用户消息的根节点，避免内部结构变化导致重复
    'user-query'
  ]
};

const USER_MESSAGE_SELECTOR = [
  ...GEMINI_CHAT_MAP_CONFIG.USER_MESSAGE_TEST_IDS.map(
    id => `[data-test-id="${id}"]`
  ),
  ...GEMINI_CHAT_MAP_CONFIG.USER_MESSAGE_FALLBACK_SELECTORS
].join(',');

// ============================
// 状态管理
// ============================
let sidebarEnabled = true;
let sidebarRoot = null;
let sidebarList = null;
let mutationObserver = null;

// 用于从 sidebar item 映射到 DOM 元素
const messageEntries = []; // { id: number, element: HTMLElement }

// ============================
// 初始化入口
// ============================
function safeInitGeminiChatMap() {
  try {
    initGeminiChatMap();
  } catch (e) {
    // 避免打断页面逻辑，只在控制台简单输出
    console.warn('[Gemini Chat Map] 初始化失败:', e);
  }
}

function initGeminiChatMap() {
  if (!sidebarEnabled) return;

  // 若已初始化过，直接返回
  if (document.getElementById(GEMINI_CHAT_MAP_CONFIG.SIDEBAR_ID)) {
    return;
  }

  createSidebar();
  scanExistingUserMessages();
  setupMutationObserver();
  setupMessageListenerForToggle();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInitGeminiChatMap);
} else {
  safeInitGeminiChatMap();
}

// ============================
// DOM 工具函数
// ============================
function findChatContainer() {
  for (const selector of GEMINI_CHAT_MAP_CONFIG.CHAT_CONTAINER_SELECTORS) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  // 兜底：使用 body
  return document.body || document.documentElement;
}

function isUserMessageElement(el) {
  if (!(el instanceof HTMLElement)) return false;

  // <user-query> 自定义元素
  if (el.tagName && el.tagName.toLowerCase() === 'user-query') {
    return true;
  }

  // 外层用户气泡容器
  if (el.classList && el.classList.contains('user-query-container')) {
    return true;
  }

  // 优先检查 data-test-id
  const testId = el.getAttribute('data-test-id');
  if (testId && GEMINI_CHAT_MAP_CONFIG.USER_MESSAGE_TEST_IDS.includes(testId)) {
    return true;
  }

  // 若本身不是，则看其后代是否匹配用户消息选择器
  if (el.matches && el.matches(USER_MESSAGE_SELECTOR)) return true;
  if (el.querySelector && el.querySelector(USER_MESSAGE_SELECTOR)) return true;

  return false;
}

function findUserMessageRootFromNode(node) {
  if (!(node instanceof HTMLElement)) return null;

  if (isUserMessageElement(node)) return node;

  // 优先提升到最外层的 <user-query>，保证滚动和高亮的是整块气泡
  const userQueryAncestor = node.closest && node.closest('user-query');
  if (userQueryAncestor) return userQueryAncestor;

  // 向上寻找最近的用户消息节点
  const closestBySelector = node.closest && node.closest(USER_MESSAGE_SELECTOR);
  if (closestBySelector) return closestBySelector;

  // 再检查其内部是否包含用户消息
  const nested = node.querySelector && node.querySelector(USER_MESSAGE_SELECTOR);
  if (nested) return nested;

  return null;
}

// 从用户消息元素中提取文本
function extractUserMessageText(el) {
  if (!el) return '';
  const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= GEMINI_CHAT_MAP_CONFIG.MAX_PREVIEW_LENGTH) return raw;
  return raw.slice(0, GEMINI_CHAT_MAP_CONFIG.MAX_PREVIEW_LENGTH) + '…';
}

// ============================
// 侧边栏 UI
// ============================
function createSidebar() {
  sidebarRoot = document.createElement('div');
  sidebarRoot.id = GEMINI_CHAT_MAP_CONFIG.SIDEBAR_ID;

  const header = document.createElement('div');
  header.className = 'gemini-chat-map-sidebar-header';
  header.textContent = 'Chat Map';

  sidebarList = document.createElement('div');
  sidebarList.id = GEMINI_CHAT_MAP_CONFIG.SIDEBAR_LIST_ID;

  sidebarRoot.appendChild(header);
  sidebarRoot.appendChild(sidebarList);
  document.documentElement.appendChild(sidebarRoot);

  // 委托点击事件
  sidebarList.addEventListener('click', onSidebarItemClick);
}

function clearSidebarList() {
  if (!sidebarList) return;
  sidebarList.innerHTML = '';
}

function addSidebarItem(entryId, previewText) {
  if (!sidebarList) return;
  const item = document.createElement('button');
  item.type = 'button';
  item.className = GEMINI_CHAT_MAP_CONFIG.SIDEBAR_ITEM_CLASS;
  item.dataset.entryId = String(entryId);
  item.textContent = previewText || '(空消息)';
  sidebarList.appendChild(item);
}

function onSidebarItemClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const item = target.closest('.' + GEMINI_CHAT_MAP_CONFIG.SIDEBAR_ITEM_CLASS);
  if (!item) return;

  const entryId = Number(item.dataset.entryId);
  if (Number.isNaN(entryId)) return;

  const entry = messageEntries[entryId];
  if (!entry || !entry.element || !document.contains(entry.element)) return;

  scrollToMessageElement(entry.element);
}

// ============================
// 滚动与高亮
// ============================
let lastHighlightedElement = null;
let lastHighlightTimeoutId = null;

function scrollToMessageElement(el) {
  try {
    // 尽量把用户消息滚动到可视区域顶部附近，避免被顶部固定栏遮挡
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest'
    });

    // 轻微向上偏移一段距离（估算顶部导航高度）
    window.setTimeout(() => {
      try {
        window.scrollBy({
          top: -80,
          left: 0,
          behavior: 'smooth'
        });
      } catch {
        window.scrollBy(0, -80);
      }
    }, 250);
  } catch {
    // 某些浏览器不支持 smooth 配置，降级
    el.scrollIntoView(true);
  }

  applyTemporaryHighlight(el);
}

function applyTemporaryHighlight(el) {
  if (!(el instanceof HTMLElement)) return;

  if (lastHighlightedElement && lastHighlightedElement !== el) {
    lastHighlightedElement.classList.remove(GEMINI_CHAT_MAP_CONFIG.HIGHLIGHT_CLASS);
  }
  if (lastHighlightTimeoutId !== null) {
    clearTimeout(lastHighlightTimeoutId);
  }

  el.classList.add(GEMINI_CHAT_MAP_CONFIG.HIGHLIGHT_CLASS);
  lastHighlightedElement = el;

  lastHighlightTimeoutId = window.setTimeout(() => {
    el.classList.remove(GEMINI_CHAT_MAP_CONFIG.HIGHLIGHT_CLASS);
    lastHighlightedElement = null;
    lastHighlightTimeoutId = null;
  }, GEMINI_CHAT_MAP_CONFIG.HIGHLIGHT_DURATION_MS);
}

// ============================
// 初始扫描 & MutationObserver
// ============================
function scanExistingUserMessages() {
  const container = findChatContainer();
  if (!container) return;

  clearSidebarList();
  messageEntries.length = 0;

  const userNodes = container.querySelectorAll(USER_MESSAGE_SELECTOR);
  userNodes.forEach(node => {
    if (!(node instanceof HTMLElement)) return;

    // 在当前选择器配置下 node 本身就是 <user-query> 根节点
    const root = node;

    const preview = extractUserMessageText(root);
    if (!preview) return;

    const entryId = messageEntries.length;
    messageEntries.push({ id: entryId, element: root });
    addSidebarItem(entryId, preview);
  });
}

function setupMutationObserver() {
  if (mutationObserver) {
    mutationObserver.disconnect();
  }

  const target = findChatContainer();
  if (!target) return;

  mutationObserver = new MutationObserver(mutations => {
    if (!sidebarEnabled) return;

    let needRescan = false;
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        // 只要本次变更中出现新的 <user-query>（或其内部结构），就整体重扫一次
        const root = findUserMessageRootFromNode(node);
        if (root) {
          needRescan = true;
        }
      });
    }

    if (needRescan) {
      scanExistingUserMessages();
    }
  });

  mutationObserver.observe(target, {
    childList: true,
    subtree: true
  });
}

// ============================
// popup 切换开关消息处理
// ============================
function setupMessageListenerForToggle() {
  if (!chrome || !chrome.runtime || !chrome.runtime.onMessage) return;

  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (!message || message.type !== 'GEMINI_CHAT_MAP_TOGGLE') return;

    sidebarEnabled = Boolean(message.enabled);
    const sidebarEl = document.getElementById(GEMINI_CHAT_MAP_CONFIG.SIDEBAR_ID);

    if (!sidebarEnabled) {
      if (sidebarEl) sidebarEl.style.display = 'none';
      if (mutationObserver) mutationObserver.disconnect();
    } else {
      if (sidebarEl) {
        sidebarEl.style.display = 'flex';
      } else {
        createSidebar();
      }
      scanExistingUserMessages();
      setupMutationObserver();
    }
  });
}

