import * as React from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

/**
 * ResponsiveDialog
 * ─────────────────
 * Renders a centered Dialog on desktop (>= md) and a bottom Drawer/sheet on
 * mobile (< md, same breakpoint as BottomNav/AppSidebar). Same content,
 * same open/onOpenChange contract — swap `Dialog`+`DialogContent` for this
 * in any form/confirmation surface to get mobile-appropriate placement for
 * free.
 *
 * Why this exists: every dialog in the app (51+ call sites at last count)
 * rendered as a small vertically-centered card on every viewport size,
 * including phones. On mobile that puts the dialog's action buttons far
 * from the thumb's natural reach and fights the on-screen keyboard, which
 * shrinks the visible viewport from the bottom up. A bottom sheet keeps the
 * header anchored, the body independently scrollable, and the footer
 * pinned just above the keyboard/home-indicator — the platform-native
 * pattern for this and the reason `vaul` (the Drawer component's engine)
 * was already a project dependency, just never wired up anywhere.
 *
 * The body slot scrolls independently of the header/footer so long forms
 * never lose access to their primary action button, which was the root
 * cause of the correction-request dialog being unreachable on small
 * screens (see CorrectionRequestDialog.tsx).
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Extra classes merged onto the content container (Dialog or Drawer). */
  className?: string;
  /** Set false for flows that must be confirmed/cancelled explicitly (mirrors AlertDialog). */
  dismissible?: boolean;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={dismissible}>
        <DrawerContent
          className={cn(
            'max-h-[92dvh] flex flex-col overflow-hidden',
            // Bottom safe-area inset keeps the footer clear of the home
            // indicator / gesture bar on notched phones (requires
            // viewport-fit=cover in index.html, added alongside this).
            'pb-[env(safe-area-inset-bottom)]',
            className,
          )}
        >
          <DrawerHeader className="text-left shrink-0">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>

          <div className="overflow-y-auto px-4 flex-1 min-h-0">
            {children}
          </div>

          {footer && (
            <DrawerFooter className="pt-3 shrink-0 border-t mt-2">
              {footer}
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[85vh] flex flex-col overflow-hidden', className)}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0 -mx-1 px-1">
          {children}
        </div>

        {footer && <DialogFooter className="shrink-0 pt-2">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/**
 * ResponsiveAlertDialog
 * ─────────────────────
 * Same idea as ResponsiveDialog, but for confirmation-style flows that
 * shouldn't be dismissible by tapping the backdrop or hitting Escape
 * (destructive actions, "this needs a reason" overrides, etc.) — the
 * scenarios AlertDialog exists for as distinct from Dialog.
 *
 * Because AlertDialogAction/AlertDialogCancel are tied to the AlertDialog
 * primitive's own context, they can't be reused inside the mobile Drawer
 * branch. Pass plain `Button`s in `footer` instead and wire their onClick
 * handlers explicitly (see DerivedMeterOverrideDialog.tsx) — you lose
 * nothing: AlertDialogAction never auto-closed here either, since these
 * dialogs already close by the caller flipping the controlled `open` prop
 * once `onConfirm` resolves.
 *
 * The mobile Drawer is rendered non-dismissible (no swipe-to-dismiss, no
 * backdrop tap) so it keeps the same "must choose Cancel or Confirm"
 * guarantee AlertDialog provides on desktop.
 */
export function ResponsiveAlertDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  preventEscapeClose = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Block Escape from dismissing — for flows that must be resolved via an explicit footer action. */
  preventEscapeClose?: boolean;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
        <DrawerContent
          className={cn(
            'max-h-[92dvh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]',
            className,
          )}
        >
          <DrawerHeader className="text-left shrink-0">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>

          <div className="overflow-y-auto px-4 flex-1 min-h-0">
            {children}
          </div>

          {footer && (
            <DrawerFooter className="pt-3 shrink-0 border-t mt-2">
              {footer}
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className={cn('max-h-[85vh] flex flex-col overflow-hidden', className)}
        onEscapeKeyDown={preventEscapeClose ? (e) => e.preventDefault() : undefined}
      >
        <AlertDialogHeader className="shrink-0">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0 -mx-1 px-1">
          {children}
        </div>

        {footer && <AlertDialogFooter className="shrink-0 pt-2">{footer}</AlertDialogFooter>}
      </AlertDialogContent>
    </AlertDialog>
  );
}
