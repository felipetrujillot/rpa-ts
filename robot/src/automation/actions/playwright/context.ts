import type { AutomationContext } from "../../core/types";

export type PlaywrightOpenTabPayload = {
  url?: string;
};

export type PlaywrightCloseTabPayload = {
  tabId?: string;
};

export type PlaywrightSwitchTabPayload = {
  tabId: string;
};

export type PlaywrightClickPayload = {
  selector: string;
  tabId?: string;
  frameSelector?: string;
  button?: "left" | "right" | "middle";
  double?: boolean;
};

export type PlaywrightTypePayload = {
  selector: string;
  text: string;
  tabId?: string;
  frameSelector?: string;
  clearFirst?: boolean;
  delayMs?: number;
};

export type PlaywrightSelectPayload = {
  selector: string;
  value: string;
  tabId?: string;
  frameSelector?: string;
};

export type PlaywrightUploadPayload = {
  selector: string;
  filePath: string;
  tabId?: string;
  frameSelector?: string;
};

export type PlaywrightDownloadPayload = {
  triggerSelector?: string;
  url?: string;
  saveAs?: string;
  tabId?: string;
  timeoutMs?: number;
};

export type PlaywrightScreenshotPayload = {
  path?: string;
  selector?: string;
  fullPage?: boolean;
  tabId?: string;
};

export type PlaywrightEvaluatePayload = {
  expression: string;
  tabId?: string;
};

export type PlaywrightIframePayload = {
  frameSelector: string;
  action: "click" | "type" | "waitForElement";
  selector: string;
  text?: string;
  timeoutMs?: number;
  tabId?: string;
};

export type PlaywrightPopupPayload = {
  triggerSelector?: string;
  urlContains?: string;
  timeoutMs?: number;
  tabId?: string;
};

export type PlaywrightCookiesPayload = {
  operation: "get" | "set" | "clear";
  name?: string;
  value?: string;
  url?: string;
  domain?: string;
  path?: string;
  tabId?: string;
};

export type PlaywrightLocalStoragePayload = {
  operation: "get" | "set" | "remove" | "clear";
  key?: string;
  value?: string;
  tabId?: string;
};

export type PlaywrightWaitForElementPayload = {
  selector: string;
  state?: "attached" | "visible" | "hidden" | "detached";
  timeoutMs?: number;
  tabId?: string;
  frameSelector?: string;
};

export type PlaywrightNetworkPayload = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: string;
  body?: string;
  tabId?: string;
  timeoutMs?: number;
};

export type PlaywrightAppContext = {
  connected: boolean;
  openTab: (payload: PlaywrightOpenTabPayload) => Promise<unknown>;
  closeTab: (payload: PlaywrightCloseTabPayload) => Promise<unknown>;
  switchTab: (payload: PlaywrightSwitchTabPayload) => Promise<unknown>;
  click: (payload: PlaywrightClickPayload) => Promise<unknown>;
  type: (payload: PlaywrightTypePayload) => Promise<unknown>;
  select: (payload: PlaywrightSelectPayload) => Promise<unknown>;
  upload: (payload: PlaywrightUploadPayload) => Promise<unknown>;
  download: (payload: PlaywrightDownloadPayload) => Promise<unknown>;
  screenshot: (payload: PlaywrightScreenshotPayload) => Promise<unknown>;
  evaluate: (payload: PlaywrightEvaluatePayload) => Promise<unknown>;
  iframe: (payload: PlaywrightIframePayload) => Promise<unknown>;
  popup: (payload: PlaywrightPopupPayload) => Promise<unknown>;
  cookies: (payload: PlaywrightCookiesPayload) => Promise<unknown>;
  localStorage: (payload: PlaywrightLocalStoragePayload) => Promise<unknown>;
  waitForElement: (
    payload: PlaywrightWaitForElementPayload,
  ) => Promise<unknown>;
  network: (payload: PlaywrightNetworkPayload) => Promise<unknown>;
};

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === "function";

export const getPlaywrightContext = (
  context: AutomationContext,
): PlaywrightAppContext | null => {
  const appContext = context.appContexts?.playwright;

  if (!appContext || typeof appContext !== "object") {
    return null;
  }

  const candidate = appContext as Partial<PlaywrightAppContext>;

  if (
    !isFunction(candidate.openTab) ||
    !isFunction(candidate.closeTab) ||
    !isFunction(candidate.switchTab) ||
    !isFunction(candidate.click) ||
    !isFunction(candidate.type) ||
    !isFunction(candidate.select) ||
    !isFunction(candidate.upload) ||
    !isFunction(candidate.download) ||
    !isFunction(candidate.screenshot) ||
    !isFunction(candidate.evaluate) ||
    !isFunction(candidate.iframe) ||
    !isFunction(candidate.popup) ||
    !isFunction(candidate.cookies) ||
    !isFunction(candidate.localStorage) ||
    !isFunction(candidate.waitForElement) ||
    !isFunction(candidate.network)
  ) {
    return null;
  }

  return {
    connected: Boolean(candidate.connected),
    openTab: candidate.openTab,
    closeTab: candidate.closeTab,
    switchTab: candidate.switchTab,
    click: candidate.click,
    type: candidate.type,
    select: candidate.select,
    upload: candidate.upload,
    download: candidate.download,
    screenshot: candidate.screenshot,
    evaluate: candidate.evaluate,
    iframe: candidate.iframe,
    popup: candidate.popup,
    cookies: candidate.cookies,
    localStorage: candidate.localStorage,
    waitForElement: candidate.waitForElement,
    network: candidate.network,
  };
};

export const getPlaywrightAvailability = (context: AutomationContext) => {
  const playwright = getPlaywrightContext(context);

  if (!playwright?.connected) {
    return {
      available: false,
      unavailableReason: "Playwright app is not connected yet.",
    };
  }

  return { available: true };
};
