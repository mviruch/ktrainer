import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-[3px] text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdict cursor-pointer",
  {
    variants: {
      variant: {
        default: "border border-line bg-raise text-chalk hover:border-faint",
        primary: "border border-verdict bg-verdict font-semibold text-white hover:brightness-110",
        ghost: "border border-line bg-transparent text-dim hover:border-faint hover:text-chalk",
        buy: "border-0 bg-up font-semibold text-white hover:brightness-110",
        sell: "border-0 bg-down font-semibold text-white hover:brightness-110",
        text: "bg-transparent text-dim hover:text-chalk",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-10 px-4 text-sm",
        wide: "h-9 w-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
