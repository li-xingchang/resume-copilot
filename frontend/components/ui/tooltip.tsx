"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TooltipContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
}

const TooltipContext = React.createContext<TooltipContextValue>({ open: false, setOpen: () => {} });

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children, delayDuration }: { children: React.ReactNode; delayDuration?: number }) {
  const [open, setOpen] = React.useState(false);
  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-flex">{children}</div>
    </TooltipContext.Provider>
  );
}

export function TooltipTrigger({
  children,
  asChild,
}: {
  children: React.ReactNode;
  asChild?: boolean;
}) {
  const { setOpen } = React.useContext(TooltipContext);
  const child = React.Children.only(children) as React.ReactElement;
  if (asChild) {
    return React.cloneElement(child, {
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
    });
  }
  return (
    <span onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
    </span>
  );
}

export function TooltipContent({
  children,
  className,
  side = "top",
}: {
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const { open } = React.useContext(TooltipContext);
  if (!open) return null;

  const positionClass = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[side];

  return (
    <div
      className={cn(
        "absolute z-50 px-3 py-1.5 text-xs text-white bg-gray-900 rounded-md shadow-md max-w-xs",
        positionClass,
        className,
      )}
    >
      {children}
    </div>
  );
}
