"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { CaptchaConfig } from "@/server/auth/captcha";
import { Alert } from "@/ui";

export type { CaptchaConfig };

/** Field the forms read on the server (`captcha_token`); the fake provider fills it with this value. */
const TOKEN_FIELD = "captcha_token";
const FAKE_TOKEN = "fake-ok";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** Turnstile's `flexible` size needs 300px; narrower containers (a 320px phone) get `compact`. */
const FLEXIBLE_MIN_WIDTH = 300;

type TurnstileTheme = "light" | "dark" | "auto";

type TurnstileOptions = {
  sitekey: string;
  language: string;
  theme: TurnstileTheme;
  size: "flexible" | "compact";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | undefined;

/** Loads Cloudflare's script once, and only when the turnstile provider is rendered. */
function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing"));
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function currentTheme(): TurnstileTheme {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "auto";
}

/** Follows `<html data-theme>` (set by the theme toggle); no attribute means follow the system. */
function useTheme(): TurnstileTheme {
  // The theme only feeds the widget options (never the markup), so reading it lazily is safe.
  const [theme, setTheme] = useState<TurnstileTheme>(() =>
    typeof document === "undefined" ? "auto" : currentTheme(),
  );
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

type CaptchaProps = {
  config: CaptchaConfig;
  locale: Locale;
  /** Accessible name of the widget group, from the dictionary. */
  label: string;
  /** Shown when Cloudflare's script cannot load (blocked, offline). */
  failedMessage: string;
  /** Changes after every submit: the widget is rendered again because a token works only once. */
  resetKey?: unknown;
};

type WidgetSize = TurnstileOptions["size"];

/** Compact below 300px, flexible above; follows the container as the window or layout resizes. */
function useWidgetSize(element: RefObject<HTMLElement | null>): WidgetSize | undefined {
  const [size, setSize] = useState<WidgetSize>();
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const update = (width: number) => setSize(width < FLEXIBLE_MIN_WIDTH ? "compact" : "flexible");
    update(target.clientWidth);
    const observer = new ResizeObserver(([entry]) => entry && update(entry.contentRect.width));
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

function TurnstileWidget({
  siteKey,
  locale,
  label,
  failedMessage,
  resetKey,
}: CaptchaProps & { siteKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const size = useWidgetSize(container);
  const [token, setToken] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey only forces a fresh widget and token
  useEffect(() => {
    const element = container.current;
    if (!element || !size) return;
    let widgetId: string | undefined;
    let cancelled = false;
    setToken("");
    setLoadFailed(false);
    loadTurnstile()
      .then((api) => {
        if (cancelled) return;
        widgetId = api.render(element, {
          sitekey: siteKey,
          language: locale,
          theme,
          size,
          callback: setToken,
          "expired-callback": () => setToken(""),
          "error-callback": () => setToken(""),
        });
      })
      .catch(() => {
        setToken("");
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, locale, theme, size, resetKey]);

  return (
    <fieldset className="m-0 min-h-captcha min-w-0 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div ref={container} />
      {loadFailed ? <Alert tone="danger">{failedMessage}</Alert> : null}
      <input type="hidden" name={TOKEN_FIELD} value={token} readOnly />
    </fieldset>
  );
}

/**
 * The captcha for a form. Turnstile renders Cloudflare's widget (explicit render, language = the
 * page locale, theme = `data-theme`, re-rendered when either changes and after every submit);
 * the fake provider (demo and tests) renders only a hidden field that always passes.
 */
export function Captcha({ config, locale, label, failedMessage, resetKey }: CaptchaProps) {
  if (config.provider === "turnstile") {
    return (
      <TurnstileWidget
        config={config}
        siteKey={config.siteKey}
        locale={locale}
        label={label}
        failedMessage={failedMessage}
        resetKey={resetKey}
      />
    );
  }
  return <input type="hidden" name={TOKEN_FIELD} defaultValue={FAKE_TOKEN} />;
}
