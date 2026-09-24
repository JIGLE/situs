/**
 * Ambient module declarations for packages that don't ship proper TypeScript types
 * under moduleResolution: "bundler".
 *
 * next-auth v4 ships types for the root module but not for sub-paths like
 * next-auth/react and next-auth/next. framer-motion has types but the bundler
 * resolution mode doesn't always pick them up from "exports".
 *
 * next-intl is deliberately absent. Its stubs here typed every translator as
 * `(key: string) => string`, so no key was ever checked; its own types resolve
 * fine, and types/next-intl.d.ts types the keys against messages/en.json.
 * tests/translation-keys.typecheck.ts fails the type-check if a stub comes back.
 */

declare module "next-auth/react" {
  import type { Session } from "next-auth";
  import type { ReactNode } from "react";

  interface SessionProviderProps {
    children: ReactNode;
    session?: Session | null;
    refetchInterval?: number;
    refetchOnWindowFocus?: boolean;
    refetchWhenOffline?: false;
  }

  export function SessionProvider(props: SessionProviderProps): JSX.Element;
  export function useSession(): {
    data: Session | null;
    status: "loading" | "authenticated" | "unauthenticated";
    update: (data?: unknown) => Promise<Session | null>;
  };
  export function signIn(
    provider?: string,
    options?: Record<string, unknown>,
    authorizationParams?: Record<string, string>,
  ): Promise<unknown>;
  export function signOut(options?: { callbackUrl?: string; redirect?: boolean }): Promise<void>;
  export function getCsrfToken(): Promise<string>;
  export function getProviders(): Promise<Record<string, unknown> | null>;
}

declare module "next-auth/next" {
  import type { NextAuthOptions, Session } from "next-auth";

  export function getServerSession(
    ...args: [NextAuthOptions] | [unknown, unknown, NextAuthOptions]
  ): Promise<Session | null>;
  export default function NextAuth(options: NextAuthOptions): unknown;
}

declare module "framer-motion" {
  import type { ComponentType, HTMLAttributes, SVGAttributes, ReactNode } from "react";

  type MotionProps = HTMLAttributes<HTMLElement> & {
    initial?: Record<string, unknown> | string | boolean;
    animate?: Record<string, unknown> | string;
    exit?: Record<string, unknown> | string;
    transition?: Record<string, unknown>;
    variants?: Record<string, unknown>;
    whileHover?: Record<string, unknown>;
    whileTap?: Record<string, unknown>;
    whileInView?: Record<string, unknown>;
    viewport?: Record<string, unknown>;
    layout?: boolean | string;
    layoutId?: string;
    drag?: boolean | "x" | "y";
    dragConstraints?: Record<string, unknown>;
    style?: React.CSSProperties;
    className?: string;
    key?: string | number;
    children?: ReactNode;
    [key: string]: unknown;
  };

  type MotionComponent = ComponentType<MotionProps>;

  export const motion: {
    div: MotionComponent;
    span: MotionComponent;
    p: MotionComponent;
    button: MotionComponent;
    a: MotionComponent;
    ul: MotionComponent;
    li: MotionComponent;
    img: MotionComponent;
    section: MotionComponent;
    header: MotionComponent;
    footer: MotionComponent;
    nav: MotionComponent;
    main: MotionComponent;
    article: MotionComponent;
    aside: MotionComponent;
    form: MotionComponent;
    input: MotionComponent;
    label: MotionComponent;
    h1: MotionComponent;
    h2: MotionComponent;
    h3: MotionComponent;
    h4: MotionComponent;
    path: ComponentType<SVGAttributes<SVGPathElement> & MotionProps>;
    svg: ComponentType<SVGAttributes<SVGSVGElement> & MotionProps>;
    circle: ComponentType<SVGAttributes<SVGCircleElement> & MotionProps>;
    [key: string]: MotionComponent;
  };

  export function AnimatePresence(props: {
    children?: ReactNode;
    mode?: "sync" | "wait" | "popLayout";
    initial?: boolean;
    onExitComplete?: () => void;
    custom?: unknown;
  }): JSX.Element;

  export function useMotionValue(initial: number): {
    get: () => number;
    set: (v: number) => void;
  };
  export function useTransform(value: unknown, input: number[], output: number[]): unknown;
  export function useSpring(value: unknown, config?: Record<string, unknown>): unknown;
  export function useAnimation(): unknown;
  export function useInView(ref: unknown, options?: Record<string, unknown>): boolean;
  export function useReducedMotion(): boolean | null;
}

declare module "jspdf" {
  class jsPDF {
    constructor(options?: Record<string, unknown>);
    text(text: string | string[], x: number, y: number, options?: Record<string, unknown>): jsPDF;
    setFontSize(size: number): jsPDF;
    setFont(fontName: string, fontStyle?: string): jsPDF;
    addPage(format?: string, orientation?: string): jsPDF;
    save(filename: string): jsPDF;
    output(type: string): string | ArrayBuffer;
    internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
    line(x1: number, y1: number, x2: number, y2: number): jsPDF;
    setDrawColor(r: number, g?: number, b?: number): jsPDF;
    setLineWidth(width: number): jsPDF;
    setTextColor(r: number, g?: number, b?: number): jsPDF;
    splitTextToSize(text: string, maxWidth: number): string[];
  }
  export default jsPDF;
}

// NOTE: Stripe's own types (node_modules/stripe) are complete and correct as of
// v22 — do NOT re-declare `declare module "stripe"` here. A replacement stub used
// to live here; under Stripe v22's ESM `export default` layout it shadowed the
// real types (Checkout/Subscription/billingPortal resolved to `unknown`). Any
// project-specific field additions must be written as an *augmentation*
// (`import "stripe"` first, then `declare module "stripe"`), never a replacement.
