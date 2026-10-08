"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { KE_DIAL_CODE, extractNationalNumber } from "@/lib/phone";

// Inline SVG instead of the 🇰🇪 emoji: Windows doesn't render flag emoji (it
// shows the letters "KE"), so an SVG is the only way every device sees a flag.
function KenyaFlag({ className }) {
  return (
    <svg viewBox="0 0 30 20" className={className} role="img" aria-label="Kenya flag">
      <rect y="0" width="30" height="5.5" fill="#000000" />
      <rect y="5.5" width="30" height="1.5" fill="#FFFFFF" />
      <rect y="7" width="30" height="6" fill="#BB0000" />
      <rect y="13" width="30" height="1.5" fill="#FFFFFF" />
      <rect y="14.5" width="30" height="5.5" fill="#006600" />
      <line x1="10" y1="3.5" x2="20" y2="16.5" stroke="#FFFFFF" strokeWidth="0.8" />
      <line x1="20" y1="3.5" x2="10" y2="16.5" stroke="#FFFFFF" strokeWidth="0.8" />
      <ellipse cx="15" cy="10" rx="3.2" ry="5" fill="#BB0000" stroke="#FFFFFF" strokeWidth="0.6" />
      <ellipse cx="15" cy="10" rx="1.1" ry="3.4" fill="#000000" />
    </svg>
  );
}

// Kenya flag + fixed "+254" prefix, then only the 9 national digits are
// editable. `value` / `onChange` work with the national digits (e.g.
// "712345678"). Pasting "0712…", "+254712…" or "254712…" is cleaned up
// automatically, so nobody can end up with "+2540712…".
export const PhoneInput = forwardRef(function PhoneInput(
  { value, onChange, className, invalid = false, ...props },
  ref
) {
  function handleChange(e) {
    onChange?.(extractNationalNumber(e.target.value));
  }

  function handlePaste(e) {
    const text = e.clipboardData?.getData("text");
    if (!text) return;
    e.preventDefault();
    onChange?.(extractNationalNumber(text));
  }

  return (
    <div
      className={cn(
        "flex h-12 w-full overflow-hidden rounded-xl border bg-background transition-shadow focus-within:ring-2 focus-within:ring-primary",
        invalid ? "border-danger" : "border-border",
        className
      )}
    >
      <span className="flex shrink-0 select-none items-center gap-2 border-r border-border bg-muted px-3 text-[15px] font-medium">
        <KenyaFlag className="h-4 w-6 rounded-[2px]" />
        {KE_DIAL_CODE}
      </span>
      <input
        ref={ref}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="712 345 678"
        pattern="[17][0-9]{8}"
        title="Enter the 9 digits after +254, e.g. 712345678"
        value={value ?? ""}
        onChange={handleChange}
        onPaste={handlePaste}
        aria-invalid={invalid || undefined}
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] placeholder:text-muted-foreground focus-visible:outline-none"
        {...props}
      />
    </div>
  );
});
