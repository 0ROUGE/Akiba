"use client";

import { useT } from "@/components/language-provider";
import { LANGS } from "@/lib/i18n";

// Small EN | SW toggle for the logged-out pages.
export function LanguageSwitcher() {
  const { lang, setLang } = useT();
  return (
    <div className="flex items-center gap-1 text-xs font-medium" role="group" aria-label="Language">
      {LANGS.map((code, i) => (
        <span key={code} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground">|</span>}
          <button
            type="button"
            onClick={() => setLang(code)}
            aria-pressed={lang === code}
            className={lang === code ? "text-primary" : "text-muted-foreground hover:text-foreground"}
          >
            {code.toUpperCase()}
          </button>
        </span>
      ))}
    </div>
  );
}
