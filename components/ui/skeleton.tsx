import { motion } from "framer-motion";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
}

export function Skeleton({ className = "", variant = "text", width, height }: SkeletonProps) {
  // One background, not three. This carried `bg-[var(--color-surface)]`, a Tailwind
  // `bg-gradient-to-r from-zinc-700…`, AND `.animate-shimmer`'s own gradient — the unlayered rule
  // won, so the zinc stops never rendered and the hardcoded palette was dead weight that also
  // ignored the theme. `--color-muted` is the raised-surface token, so the placeholder is legible
  // against the canvas in both themes; the shimmer sweeps over it rather than replacing it.
  const baseClasses = "bg-[var(--color-muted)] animate-shimmer";

  const variantClasses = {
    text: "h-4 rounded",
    circular: "rounded-full",
    rectangular: "rounded-lg",
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === "number" ? `${width}px` : width;
  if (height) style.height = typeof height === "number" ? `${height}px` : height;

  return <div className={`${baseClasses} ${variantClasses[variant]} ${className}`} style={style} />;
}

interface SkeletonCardProps {
  lines?: number;
  showAvatar?: boolean;
  className?: string;
}

export function SkeletonCard({ lines = 3, showAvatar = false, className = "" }: SkeletonCardProps) {
  return (
    <motion.div
      className={`p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] ${className}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3 mb-3">
        {showAvatar && <Skeleton variant="circular" width={40} height={40} />}
        <div className="flex-1">
          <Skeleton variant="text" className="h-5 w-3/4 mb-1" />
          <Skeleton variant="text" className="h-4 w-1/2" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          className="mb-2"
          style={{ width: `${Math.random() * 40 + 60}%` }}
        />
      ))}
    </motion.div>
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function TableSkeleton({ rows = 5, columns = 4, className = "" }: TableSkeletonProps) {
  return (
    <motion.div
      className={`space-y-3 ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex gap-4 pb-2 border-b border-[var(--color-border)]">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} variant="text" className="h-4 flex-1" />
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <motion.div
          key={rowIndex}
          className="flex gap-4 py-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: rowIndex * 0.1 }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              variant="text"
              className="h-4 flex-1"
              style={{ width: `${Math.random() * 30 + 50}%` }}
            />
          ))}
        </motion.div>
      ))}
    </motion.div>
  );
}
