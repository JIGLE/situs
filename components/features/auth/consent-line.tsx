import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils/utils";

/**
 * "By continuing you accept the Terms and the Privacy Policy", the usual place for the two links on
 * a sign-in screen. The links are the same two pages Settings links to (`LegalLinks`). Each is a
 * 47px tap target inside the sentence, pulled back with a negative margin so the lines stay close.
 */
export function ConsentLine({ className }: { className?: string }): React.ReactElement {
  const t = useTranslations("auth");
  const link =
    "-my-3.5 inline-block py-3.5 text-[var(--color-foreground)] underline underline-offset-4 hover:opacity-80";

  return (
    <p
      className={cn(
        "text-center text-xs leading-relaxed text-[var(--color-muted-foreground)]",
        className,
      )}
    >
      {t.rich("consent", {
        terms: (chunks) => (
          <Link href="/terms" className={link}>
            {chunks}
          </Link>
        ),
        privacy: (chunks) => (
          <Link href="/privacy" className={link}>
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
