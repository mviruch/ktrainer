import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const toggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-[3px] text-[12px] text-fg-2 transition-colors hover:bg-hov hover:text-chalk disabled:pointer-events-none disabled:opacity-40 data-[state=on]:bg-hov data-[state=on]:font-medium data-[state=on]:text-chalk focus-visible:outline-1 focus-visible:outline-brand",
  {
    variants: {
      variant: { default: "bg-transparent", outline: "border border-line-strong bg-transparent" },
      size: { default: "h-6 px-2", sm: "h-6 px-1.5", lg: "h-7 px-2.5" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Toggle({ className, variant, size, ...props }: ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />;
}
