import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import type { VariantProps } from "class-variance-authority";
import { createContext, useContext, type ComponentProps } from "react";
import { toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

const Ctx = createContext<VariantProps<typeof toggleVariants>>({ size: "default", variant: "default" });

export function ToggleGroup({ className, variant, size, children, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Root data-slot="toggle-group" className={cn("flex items-center gap-0.5", className)} {...props}>
      <Ctx.Provider value={{ variant, size }}>{children}</Ctx.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

export function ToggleGroupItem({ className, variant, size, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const ctx = useContext(Ctx);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleVariants({ variant: ctx.variant || variant, size: ctx.size || size }), className)}
      {...props}
    />
  );
}
