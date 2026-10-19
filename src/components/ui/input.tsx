import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-[3px] border border-line bg-ink px-2 text-right font-mono text-[13px] text-chalk outline-none focus:border-verdict",
        className,
      )}
      {...props}
    />
  );
}
