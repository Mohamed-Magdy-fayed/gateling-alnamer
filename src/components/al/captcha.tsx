"use client";

import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { CaptchaConfig } from "@/server/auth/captcha";

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
  const [theme, setTheme] = useState<TurnstileTheme>("auto");
  useEffect(() => {
    setTheme(currentTheme());
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
  /** Changes after every submit: the widget is rendered again because a token works only once. */
  resetKey?: unknown;
};

function TurnstileWidget({ siteKey, locale, label, resetKey }: CaptchaProps & { siteKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const [token, setToken] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey only forces a fresh widget and token
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let widgetId: string | undefined;
    let cancelled = false;
    setToken("");
    loadTurnstile()
      .then((api) => {
        if (cancelled) return;
        widgetId = api.render(element, {
          sitekey: siteKey,
          language: locale,
          theme,
          size: element.clientWidth < FLEXIBLE_MIN_WIDTH ? "compact" : "flexible",
          callback: setToken,
          "expired-callback": () => setToken(""),
          "error-callback": () => setToken(""),
        });
      })
      .catch(() => setToken(""));
    return () => {
      cancelled = true;
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, locale, theme, resetKey]);

  return (
    <fieldset className="m-0 min-h-[65px] min-w-0 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div ref={container} />
      <input type="hidden" name={TOKEN_FIELD} value={token} readOnly />
    </fieldset>
  );
}

/**
 * The captcha for a form. Turnstile renders Cloudflare's widget (explicit render, language = the
 * page locale, theme = `data-theme`, re-rendered when either changes and after every submit);
 * the fake provider (demo and tests) renders only a hidden field that always passes.
 */
export function Captcha({ config, locale, label, resetKey }: CaptchaProps) {
  if (config.provider === "turnstile") {
    return (
      <TurnstileWidget
        config={config}
        siteKey={config.siteKey}
        locale={locale}
        label={label}
        resetKey={resetKey}
      />
    );
  }
  return <input type="hidden" name={TOKEN_FIELD} defaultValue={FAKE_TOKEN} />;
}
