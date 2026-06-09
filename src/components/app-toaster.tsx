"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      richColors
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "border-white/10 bg-[#111111] text-white shadow-2xl",
          title: "text-sm font-bold",
          description: "text-zinc-400",
          actionButton: "bg-[#a7f600] text-black",
          cancelButton: "bg-white/10 text-white",
        },
      }}
    />
  );
}
