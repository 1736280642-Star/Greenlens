"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export function DashboardDetailDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="cc-detail-dialog-overlay"/>
      <Dialog.Content className="cc-detail-dialog-content" onCloseAutoFocus={(event) => {
        if (!returnFocusRef?.current) return;
        event.preventDefault();
        returnFocusRef.current.focus();
      }}>
        <Dialog.Title className="cc-dialog-sr-only">{title}</Dialog.Title>
        <Dialog.Description className="cc-dialog-sr-only">{description}</Dialog.Description>
        <Dialog.Close className="cc-detail-dialog-close" aria-label="关闭完整视图" title="关闭完整视图"><X/></Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
