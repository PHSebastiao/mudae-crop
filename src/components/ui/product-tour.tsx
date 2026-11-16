import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

/**
 * The onboarding tour: a spotlight over a target element plus a small card
 * that walks through the steps. It is app-agnostic — a step names a CSS
 * selector, the card follows it — so it lives beside the other primitives
 * under `components/ui` instead of inside a screen.
 *
 * It is a port of the shadcn-style `product-tour` component to this app's
 * plain CSS: the behaviour is unchanged, the Tailwind classes became the
 * `.tour-*` rules in `src/styles.css`, and the two icons come from
 * `lucide-react`.
 */

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto' | 'center';

export type TourStep = {
  /** A CSS selector for the element to spotlight; omit for a centered step. */
  target?: string;
  title: string;
  content: ReactNode;
  placement?: TourPlacement;
  padding?: number;
  /**
   * Lets the user click and type in the spotlighted element while the tour is
   * open. The scrim is cut around the target instead of covering it, so an
   * input, a file picker or a button can be used from inside the step.
   */
  interactive?: boolean;
};

export type TourProps = {
  steps: TourStep[];
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  index?: number;
  onIndexChange?: (index: number) => void;
  onFinish?: () => void;
  onSkip?: () => void;
  showProgress?: boolean;
  clickToNext?: boolean;
  className?: string;
};

type Rect = { top: number; left: number; width: number; height: number };

const SPRING = { type: 'spring' as const, stiffness: 320, damping: 32, mass: 0.7 };

/** The elements the card's Tab trap and an interactive step can focus. */
const FOCUSABLE = 'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])';

/** A text field keeps Enter and the arrow keys for itself. */
function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    !!element &&
    (element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT' ||
      element.isContentEditable)
  );
}

export function Tour({
  steps,
  open,
  onOpenChange,
  index: controlledIndex,
  onIndexChange,
  onFinish,
  onSkip,
  showProgress = true,
  clickToNext = false,
  className,
}: TourProps) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [indexState, setIndexState] = useState(0);
  const index = controlledIndex ?? indexState;
  const setIndex = useCallback(
    (i: number) => {
      onIndexChange?.(i);
      setIndexState(i);
    },
    [onIndexChange],
  );

  const cardRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ w: 320, h: 168 });
  const [vp, setVp] = useState({ w: 1024, h: 768 });

  useEffect(() => setMounted(true), []);

  const step = steps[index];
  const count = steps.length;
  const isFirst = index === 0;
  const isLast = index === count - 1;
  const pad = step?.padding ?? 8;

  const finish = useCallback(() => {
    onFinish?.();
    onOpenChange?.(false);
    setIndexState(0);
  }, [onFinish, onOpenChange]);

  const skip = useCallback(() => {
    onSkip?.();
    onOpenChange?.(false);
    setIndexState(0);
  }, [onSkip, onOpenChange]);

  const next = useCallback(() => {
    if (isLast) finish();
    else setIndex(index + 1);
  }, [isLast, finish, index, setIndex]);

  const back = useCallback(() => {
    if (!isFirst) setIndex(index - 1);
  }, [isFirst, index, setIndex]);

  // Follow the target while it moves: a panel scroll, a window resize or a
  // layout change between steps all re-measure from the live element. The
  // effect keys off the selector, not the step object, so a caller passing a
  // fresh steps array on every render cannot restart it in a loop.
  const target = step?.target;
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setVp((previous) => (previous.w === w && previous.h === h ? previous : { w, h }));
      if (!target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(target) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    const el = target ? (document.querySelector(target) as HTMLElement | null) : null;
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center', inline: 'center' });

    measure();
    // The smooth scroll settles after a beat; measure again once it has.
    const settle = window.setTimeout(measure, reduce ? 0 : 320);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, index, target, reduce]);

  // The card's own height decides where it fits, so it is measured after paint
  // and again whenever the step's copy changes.
  useLayoutEffect(() => {
    if (cardRef.current) {
      const r = cardRef.current.getBoundingClientRect();
      setCardSize({ w: r.width, h: r.height });
    }
  }, [index, open, rect]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = isTextEntry(e.target);
      if (e.key === 'Escape') {
        e.preventDefault();
        skip();
      } else if (!typing && (e.key === 'ArrowRight' || e.key === 'Enter')) {
        e.preventDefault();
        next();
      } else if (!typing && e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      } else if (e.key === 'Tab') {
        const focusables = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, next, back, skip]);

  // The tour owns the keyboard while it is open: focus starts on Next, moves
  // with the step, and goes back to whatever opened it once the tour closes.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      // An interactive step hands the focus to the field it wants used; the
      // rest of the tour starts on Next so Enter keeps moving forward.
      if (step?.interactive) {
        const root = target ? document.querySelector<HTMLElement>(target) : null;
        const focusable =
          root && root.matches(FOCUSABLE) ? root : root?.querySelector<HTMLElement>(FOCUSABLE);
        focusable?.focus();
        return;
      }
      cardRef.current?.querySelector<HTMLElement>('[data-tour-primary]')?.focus();
    }, 40);
    return () => window.clearTimeout(t);
  }, [open, index, step?.interactive, target]);

  if (!mounted || !open || !step) return null;

  const gap = 14;
  let place: TourPlacement = step.placement ?? 'auto';
  if (!rect) place = 'center';
  if (place === 'auto' && rect) {
    if (rect.top + rect.height + gap + cardSize.h < vp.h) place = 'bottom';
    else if (rect.top - gap - cardSize.h > 0) place = 'top';
    else if (rect.left + rect.width + gap + cardSize.w < vp.w) place = 'right';
    else place = 'left';
  }

  let left = vp.w / 2 - cardSize.w / 2;
  let top = vp.h / 2 - cardSize.h / 2;
  if (rect) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (place === 'bottom') {
      left = cx - cardSize.w / 2;
      top = rect.top + rect.height + gap + pad;
    } else if (place === 'top') {
      left = cx - cardSize.w / 2;
      top = rect.top - gap - pad - cardSize.h;
    } else if (place === 'right') {
      left = rect.left + rect.width + gap + pad;
      top = cy - cardSize.h / 2;
    } else if (place === 'left') {
      left = rect.left - gap - pad - cardSize.w;
      top = cy - cardSize.h / 2;
    }
  }
  // Keep the card inside the window even when the target sits at an edge.
  left = Math.min(Math.max(12, left), vp.w - 12 - cardSize.w);
  top = Math.min(Math.max(12, top), vp.h - 12 - cardSize.h);

  const spot = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  return createPortal(
    <div className={className ? `tour-root ${className}` : 'tour-root'}>
      <AnimatePresence>
        <motion.div
          key="tour-layer"
          className="tour-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-label={typeof step.title === 'string' ? step.title : 'Tour do app'}
        >
          {spot ? (
            <>
              {/* The scrim is four panels around the hole, so an interactive
                  step leaves the target clickable instead of covering it. */}
              <motion.div
                className="tour-scrim-panel"
                aria-hidden
                initial={false}
                animate={{ top: 0, left: 0, width: vp.w, height: Math.max(0, spot.top) }}
                transition={reduce ? { duration: 0 } : SPRING}
                onClick={() => clickToNext && next()}
              />
              <motion.div
                className="tour-scrim-panel"
                aria-hidden
                initial={false}
                animate={{
                  top: spot.top + spot.height,
                  left: 0,
                  width: vp.w,
                  height: Math.max(0, vp.h - spot.top - spot.height),
                }}
                transition={reduce ? { duration: 0 } : SPRING}
                onClick={() => clickToNext && next()}
              />
              <motion.div
                className="tour-scrim-panel"
                aria-hidden
                initial={false}
                animate={{
                  top: spot.top,
                  left: 0,
                  width: Math.max(0, spot.left),
                  height: spot.height,
                }}
                transition={reduce ? { duration: 0 } : SPRING}
                onClick={() => clickToNext && next()}
              />
              <motion.div
                className="tour-scrim-panel"
                aria-hidden
                initial={false}
                animate={{
                  top: spot.top,
                  left: spot.left + spot.width,
                  width: Math.max(0, vp.w - spot.left - spot.width),
                  height: spot.height,
                }}
                transition={reduce ? { duration: 0 } : SPRING}
                onClick={() => clickToNext && next()}
              />
              <motion.div
                className="tour-spotlight"
                aria-hidden
                initial={false}
                animate={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
                transition={reduce ? { duration: 0 } : SPRING}
              >
                <span className="tour-spotlight-ring" />
              </motion.div>
              {!step.interactive && (
                <div
                  className="tour-hole-blocker"
                  style={spot}
                  aria-hidden
                  onClick={() => clickToNext && next()}
                />
              )}
            </>
          ) : (
            <motion.div
              className="tour-backdrop-fill"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => clickToNext && next()}
            />
          )}

          <motion.div
            ref={cardRef}
            className="tour-card"
            initial={reduce ? false : { opacity: 0, scale: 0.96, left, top }}
            animate={{ opacity: 1, scale: 1, left, top }}
            transition={reduce ? { duration: 0 } : SPRING}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tour-head">
              <h3 className="tour-title">{step.title}</h3>
              <button
                type="button"
                onClick={skip}
                aria-label="Fechar o tour"
                className="tour-close"
              >
                <X size={16} aria-hidden />
              </button>
            </div>

            <div className="tour-content">{step.content}</div>

            <div className="tour-foot">
              {showProgress ? (
                <div className="tour-progress" aria-hidden>
                  {steps.map((_, i) => (
                    <span key={i} className={`tour-dot${i === index ? ' is-current' : ''}`} />
                  ))}
                </div>
              ) : (
                <span className="tour-count">
                  {index + 1} / {count}
                </span>
              )}

              <div className="tour-actions">
                {!isFirst && (
                  <button type="button" onClick={back} className="tour-back">
                    <ArrowLeft size={14} aria-hidden />
                    Voltar
                  </button>
                )}
                <button type="button" data-tour-primary onClick={next} className="tour-next">
                  {isLast ? 'Concluir' : 'Avançar'}
                  {!isLast && <ArrowRight size={14} aria-hidden />}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}

/**
 * The open/index state of a tour. `storageKey` is optional: this app keeps the
 * "already seen" flag in Settings instead, so the hook is used bare.
 */
export function useTour(storageKey?: string) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const seen = useCallback(() => {
    if (!storageKey) return false;
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  }, [storageKey]);

  const start = useCallback(() => {
    setIndex(0);
    setOpen(true);
  }, []);

  const markSeen = useCallback(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      return;
    }
  }, [storageKey]);

  return { open, setOpen, index, setIndex, start, seen, markSeen };
}
