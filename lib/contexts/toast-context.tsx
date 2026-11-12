"use client";

import { createContext, useContext, useCallback, useMemo, ReactNode } from "react";
import toast, { Toaster, Toast } from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, AlertTriangle, Info } from "lucide-react";

interface ToastContextType {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Custom animated toast component
const AnimatedToast = ({
  t,
  message,
  type,
}: {
  t: Toast;
  message: string;
  type: "success" | "error" | "info" | "warning";
}) => {
  const getConfig = () => {
    switch (type) {
      case "success":
        return {
          icon: CheckCircle,
          bgColor: "var(--color-success)",
          duration: 4000,
        };
      case "error":
        return {
          icon: XCircle,
          bgColor: "var(--color-destructive)",
          duration: 8000,
        };
      case "warning":
        return {
          icon: AlertTriangle,
          bgColor: "var(--color-warning)",
          duration: 4500,
        };
      default:
        return {
          icon: Info,
          bgColor: "var(--color-info)",
          duration: 4000,
        };
    }
  };

  const config = getConfig();
  const Icon = config.icon;

  return (
    <AnimatePresence>
      <motion.div
        role={type === "error" ? "alert" : "status"}
        aria-live={type === "error" ? "assertive" : "polite"}
        aria-atomic="true"
        initial={{ x: 400, opacity: 0, scale: 0.8 }}
        animate={{ x: 0, opacity: 1, scale: 1 }}
        exit={{ x: 400, opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 30,
        }}
        className="relative max-w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-l-4 shadow-lg"
        // A solid card tinted with the tone, and the page's own text colour. This used to append a
        // hex alpha to a `var()` ("var(--color-destructive)15"), which is not a colour: the
        // background dropped out, and white text sat on whatever the page showed behind it.
        style={{
          backgroundColor: `color-mix(in srgb, ${config.bgColor} 10%, var(--color-card-solid))`,
          borderColor: `color-mix(in srgb, ${config.bgColor} 35%, var(--color-border))`,
          borderLeftColor: config.bgColor,
          color: "var(--color-foreground)",
          minWidth: "min(320px, calc(100vw - 2rem))",
        }}
      >
        {/* Progress bar */}
        <motion.div
          className="absolute bottom-0 left-0 h-1 rounded-b-lg"
          style={{ backgroundColor: config.bgColor }}
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: config.duration / 1000, ease: "linear" }}
          aria-hidden="true"
        />

        <div className="flex items-center gap-3 p-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1, type: "spring" }}
            aria-hidden="true"
            style={{ color: config.bgColor }}
          >
            <Icon className="h-5 w-5 flex-shrink-0" />
          </motion.div>

          <div className="flex-1 text-sm font-medium leading-snug">{message}</div>

          {/* The dismiss glyph carries no box of its own, so it measured 9×26 — the single
              worst touch target in the app, and the most frequent, since a toast can appear
              over any screen. The first mobile-audit run that actually reached a seeded CI
              build reported it on 23 of 52 surface-runs. Floor the hit area to 44×44 below
              `md` the way `Button` does, and centre the glyph inside it so nothing moves
              visually on desktop. */}
          <motion.button
            onClick={() => toast.dismiss(t.id)}
            className="inline-flex flex-shrink-0 items-center justify-center text-current/60 transition-colors hover:text-current max-md:min-h-11 max-md:min-w-11"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            aria-label="Close notification"
          >
            ×
          </motion.button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const success = useCallback(
    (message: string) =>
      toast.custom((t) => <AnimatedToast t={t} message={message} type="success" />, {
        duration: 4000,
      }),
    [],
  );
  const error = useCallback(
    (message: string) =>
      // An error is a sentence to read and act on: it stays longer than a confirmation.
      toast.custom((t) => <AnimatedToast t={t} message={message} type="error" />, {
        duration: 8000,
      }),
    [],
  );
  const info = useCallback(
    (message: string) =>
      toast.custom((t) => <AnimatedToast t={t} message={message} type="info" />, {
        duration: 4000,
      }),
    [],
  );
  const warning = useCallback(
    (message: string) =>
      toast.custom((t) => <AnimatedToast t={t} message={message} type="warning" />, {
        duration: 4500,
      }),
    [],
  );

  const value = useMemo(() => ({ success, error, info, warning }), [success, error, info, warning]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
        }}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
