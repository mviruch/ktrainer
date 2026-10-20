import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-brand [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** secondary look kept as default so existing call sites stay neutral */
        default: "bg-elevated text-chalk hover:bg-hov",
        secondary: "bg-elevated text-chalk hover:bg-hov",
        primary: "bg-brand font-medium text-white hover:brightness-110",
        ghost: "bg-transparent text-fg-2 hover:bg-hov hover:text-chalk",
        outline: "border border-line-strong bg-transparent text-chalk hover:bg-hov",
        danger: "border border-danger/50 bg-transparent text-danger hover:bg-danger/10",
        destructive: "bg-danger font-medium text-white hover:brightness-110",
        buy: "bg-up font-bold text-white hover:brightness-110",
        sell: "bg-down font-bold text-white hover:brightness-110",
        text: "bg-transparent px-1 text-fg-2 hover:text-chalk",
        link: "bg-transparent px-1 text-brand hover:brightness-125",
      },
      size: {
        default: "h-8 px-3.5",
        sm: "h-7 px-2.5",
        xs: "h-6 px-2 text-[11px]",
        lg: "h-10 px-4 text-[13px]",
        wide: "h-9 w-full",
        icon: "size-8 p-0 [&_svg]:size-4",
        "icon-sm": "size-[22px] p-0 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
