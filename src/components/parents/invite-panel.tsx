"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card } from "@/ui";
import type { ParentTexts } from "./error-state";
import { IslandText } from "./island-text";

const COPIED_RESET_MS = 3000;

/** Copies with the async Clipboard API, falling back to a hidden textarea where it is blocked. */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.insetBlockStart = "0";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }
}

/** A freshly issued code, shown once, with a copy button and a polite confirmation. */
export function InvitePanel({ code, t }: { code: string; t: ParentTexts }) {
  const parents = t.parents;
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const copied = result === "copied";
  useEffect(() => {
    if (result === null) return;
    const timer = setTimeout(() => setResult(null), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [result]);

  return (
    <Card className="flex flex-col gap-3 p-5">
      <p>
        <IslandText template={parents.inviteShow} token="code">
          <span
            data-testid="invite-code"
            className="font-mono text-xl font-semibold tracking-wider"
          >
            {code}
          </span>
        </IslandText>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          aria-label={parents.inviteCopy}
          onClick={async () => setResult((await copyText(code)) ? "copied" : "failed")}
        >
          {copied ? (
            <Check aria-hidden className="size-4" strokeWidth={1.75} />
          ) : (
            <Copy aria-hidden className="size-4" strokeWidth={1.75} />
          )}
          {parents.inviteCopy}
        </Button>
        <span
          role="status"
          className={result === "failed" ? "text-sm text-destructive" : "text-sm text-success"}
        >
          {copied ? parents.inviteCopied : null}
          {result === "failed" ? parents.inviteCopyFailed : null}
        </span>
      </div>
    </Card>
  );
}
