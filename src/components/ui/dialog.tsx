import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <DialogPrimitive.Content
        className={cn(
          "dlg fixed left-1/2 top-1/2 z-40 max-h-[86vh] w-[min(560px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[8px] border border-line-strong bg-elevated p-0 pb-1 text-chalk shadow-dialog",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="dlg-x absolute top-3.5 right-4 z-[2] grid size-6 cursor-pointer place-items-center rounded-[4px] text-fg-2 hover:bg-hov hover:text-chalk">
          <X className="size-4" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("dlg-h sticky top-0 z-[1] mb-4 border-b border-line bg-elevated px-5 py-4 pr-12", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-[15px] leading-5 font-medium", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("mt-1 text-[12px] leading-[18px] text-fg-2", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("dlg-f mt-5 -mb-1 flex flex-wrap justify-end gap-2 border-t border-line px-5 pt-3 pb-4", className)} {...props} />;
}
