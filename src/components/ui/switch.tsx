import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn("inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full bg-hov transition-colors data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-40", className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[14px]" />
    </SwitchPrimitive.Root>
  );
}
