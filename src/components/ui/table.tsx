import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-[12px]", className)} {...props} />
    </div>
  );
}
export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("sticky top-0 z-[1] bg-elevated [&_tr]:border-b [&_tr]:border-line", className)} {...props} />;
}
export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}
export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("h-[30px] border-b border-line transition-colors hover:bg-hov/50", className)} {...props} />;
}
export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return <th className={cn("h-[30px] px-2 text-left align-middle text-[11px] font-normal whitespace-nowrap text-fg-3", className)} {...props} />;
}
export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-2 align-middle whitespace-nowrap", className)} {...props} />;
}
