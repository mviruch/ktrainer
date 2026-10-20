import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AlertDialog(props: ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root {...props} />;
}
export function AlertDialogContent({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <AlertDialogPrimitive.Content
        className={cn("dlg fixed left-1/2 top-1/2 z-40 w-[min(400px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[8px] border border-line-strong bg-elevated text-chalk shadow-dialog", className)}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}
export function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("dlg-h flex min-h-13 flex-col justify-center border-b border-line px-5 py-3", className)} {...props} />;
}
export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("dlg-f flex justify-end gap-2 border-t border-line px-5 pt-3 pb-4", className)} {...props} />;
}
export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title className={cn("text-[15px] font-medium", className)} {...props} />;
}
export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description className={cn("px-5 py-4 text-[12px] leading-[20px] text-fg-2", className)} {...props} />;
}
export function AlertDialogAction({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return <AlertDialogPrimitive.Action className={cn(buttonVariants({ variant: "primary" }), className)} {...props} />;
}
export function AlertDialogCancel({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: "secondary" }), className)} {...props} />;
}
