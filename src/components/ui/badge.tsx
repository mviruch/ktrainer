import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[2px] px-1.5 py-px text-[11px] font-medium leading-[16px]", {
  variants: {
    variant: {
      default: "bg-hov text-fg-2",
      up: "bg-up/20 text-up",
      down: "bg-down/20 text-down",
      pending: "bg-pending/20 text-pending",
      brand: "bg-brand/12 text-[#7DA2FF]",
      outline: "border border-line-strong text-fg-2",
      count: "h-4 min-w-4 justify-center rounded-full bg-brand px-1 py-0 font-mono text-[10px] font-bold text-white",
      kbd: "rounded-[3px] bg-white/10 px-1 py-0 font-mono text-[10px] font-normal text-inherit opacity-80",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, asChild = false, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
