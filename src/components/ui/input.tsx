import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-[4px] border border-line-strong bg-panel px-2.5 text-right font-mono text-[13px] text-chalk outline-none placeholder:text-fg-3 focus:border-brand disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
