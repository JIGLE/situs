"use client";

/**
 * SwipeableListItem — mobile swipe gestures on list rows.
 *
 * Drag right  → reveals left action (primary, e.g. "Open")
 * Drag left   → reveals right action (destructive, e.g. "Delete")
 *
 * Fires the callback once the drag threshold is crossed, then springs
 * back to center via dragSnapToOrigin. On desktop the row behaves exactly as before.
 */

import { useRef, useState } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { cn } from "@/lib/utils/utils";

export interface SwipeAction {
  icon: React.ReactNode;
  label: string;
  className?: string;
  onAction: () => void;
}

interface SwipeableListItemProps {
  children: React.ReactNode;
  /** Action revealed when the user drags RIGHT (positive x). */
  startAction?: SwipeAction;
  /** Action revealed when the user drags LEFT (negative x). */
  endAction?: SwipeAction;
  /** Drag distance (px) before the action fires. Default: 80 */
  threshold?: number;
  className?: string;
  disabled?: boolean;
}

const DRAG_ELASTIC = 0.2;

export function SwipeableListItem({
  children,
  startAction,
  endAction,
  threshold = 80,
  className,
  disabled = false,
}: SwipeableListItemProps) {
  const x = useMotionValue(0);
  const [dragging, setDragging] = useState(false);
  const fired = useRef(false);

  // All useTransform calls at top level — hooks must not be conditional.
  const startOpacity = useTransform(x, [0, threshold], [0, 1]);
  const startScale = useTransform(x, [0, threshold], [0.6, 1]);
  const endOpacity = useTransform(x, [-threshold, 0], [1, 0]);
  const endScale = useTransform(x, [-threshold, 0], [1, 0.6]);

  const handleDragEnd = () => {
    setDragging(false);
    const current = x.get();

    if (startAction && current >= threshold && !fired.current) {
      fired.current = true;
      startAction.onAction();
      return;
    }

    if (endAction && current <= -threshold && !fired.current) {
      fired.current = true;
      endAction.onAction();
      return;
    }

    fired.current = false;
  };

  // Keyboard equivalent for swipe actions (WCAG 2.1.1)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" && startAction) {
      e.preventDefault();
      startAction.onAction();
    } else if (
      (e.key === "ArrowLeft" || e.key === "Delete" || e.key === "Backspace") &&
      endAction
    ) {
      e.preventDefault();
      endAction.onAction();
    }
  };

  if (disabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={cn("relative overflow-hidden touch-pan-y", className)}>
      {startAction && (
        <motion.div
          // framer-motion v12 / TS 5.9 type incompatibility: MotionValues not assignable to MotionStyle
          style={{ opacity: startOpacity } as unknown as React.CSSProperties}
          className={cn(
            "absolute inset-y-0 left-0 flex items-center justify-start pl-4 min-w-[80px]",
            startAction.className ?? "bg-accent-primary",
          )}
          aria-hidden="true"
        >
          <motion.div
            style={{ scale: startScale } as unknown as React.CSSProperties}
            className="flex flex-col items-center gap-1"
          >
            <span className="text-white">{startAction.icon}</span>
            <span className="text-label font-medium text-white/90 uppercase tracking-wide">
              {startAction.label}
            </span>
          </motion.div>
        </motion.div>
      )}

      {endAction && (
        <motion.div
          style={{ opacity: endOpacity } as unknown as React.CSSProperties}
          className={cn(
            "absolute inset-y-0 right-0 flex items-center justify-end pr-4 min-w-[80px]",
            endAction.className ?? "bg-destructive",
          )}
          aria-hidden="true"
        >
          <motion.div
            style={{ scale: endScale } as unknown as React.CSSProperties}
            className="flex flex-col items-center gap-1"
          >
            <span className="text-white">{endAction.icon}</span>
            <span className="text-label font-medium text-white/90 uppercase tracking-wide">
              {endAction.label}
            </span>
          </motion.div>
        </motion.div>
      )}

      <motion.div
        style={{ x } as unknown as React.CSSProperties}
        drag="x"
        dragSnapToOrigin
        dragConstraints={{
          left: endAction ? -threshold * 1.5 : 0,
          right: startAction ? threshold * 1.5 : 0,
        }}
        dragElastic={DRAG_ELASTIC}
        onDragStart={() => {
          setDragging(true);
          fired.current = false;
        }}
        onDragEnd={handleDragEnd}
        onClick={dragging ? (e) => e.stopPropagation() : undefined}
        onKeyDown={handleKeyDown}
        tabIndex={startAction || endAction ? 0 : undefined}
        aria-keyshortcuts={
          startAction && endAction
            ? "ArrowRight ArrowLeft"
            : startAction
              ? "ArrowRight"
              : endAction
                ? "ArrowLeft"
                : undefined
        }
        className="relative z-10 cursor-grab active:cursor-grabbing select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {children}
      </motion.div>
    </div>
  );
}
