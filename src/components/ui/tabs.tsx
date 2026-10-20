import * as TabsPrimitive from "@radix-ui/react-tabs";
import { createContext, useContext, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Variant = "underline" | "segmented";
const Ctx = createContext<Variant>("underline");

export function Tabs(props: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...props} />;
}

/** underline: 下单面板 / 指标弹窗（2px accent 下划线）。segmented: 统计弹窗（bg-panel 容器 + 选中 bg-hover）。 */
export function TabsList({ className, variant = "underline", children, ...props }: ComponentProps<typeof TabsPrimitive.List> & { variant?: Variant }) {
  return (
    <TabsPrimitive.List
      className={cn(
        variant === "segmented" ? "inline-flex h-8 items-center gap-0.5 rounded-[4px] bg-panel p-0.5" : "mb-2.5 flex gap-[18px] border-b border-line",
        className,
      )}
      {...props}
    >
      <Ctx.Provider value={variant}>{children}</Ctx.Provider>
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = useContext(Ctx);
  return (
    <TabsPrimitive.Trigger
      className={cn(
        variant === "segmented"
          ? "h-7 cursor-pointer rounded-[3px] px-3 text-[12px] text-fg-2 hover:text-chalk data-[state=active]:bg-hov data-[state=active]:font-medium data-[state=active]:text-chalk"
          : "-mb-px cursor-pointer border-b-2 border-transparent py-1.5 text-[13px] text-dim data-[state=active]:border-verdict data-[state=active]:font-semibold data-[state=active]:text-chalk",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />;
}
