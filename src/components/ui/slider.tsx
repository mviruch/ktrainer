import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Slider({ className, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn("relative flex w-full touch-none items-center select-none", className)} {...props}>
      <SliderPrimitive.Track className="relative h-0.5 w-full grow overflow-hidden rounded-full bg-hov">
        <SliderPrimitive.Range className="absolute h-full bg-verdict" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-3 cursor-grab rounded-full border-2 border-brand bg-white focus-visible:outline-1 focus-visible:outline-brand" />
    </SliderPrimitive.Root>
  );
}
