import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useLocation } from 'react-router-dom';

/**
 * PageTurnTransition — wraps a captured route element or page content in a soft cross-fade
 * when the route changes.
 *
 * Design notes:
 *  - Default AnimatePresence mode (NOT "wait"): the incoming page mounts while
 *    the outgoing page exits, so there's no blank gap to read as a failed load.
 *  - Both pages briefly co-occupy the same grid cell (grid-area: 1/1) so layout
 *    doesn't jump during the overlap.
 *  - Opacity + a 4px lift only — no rotateY, no conflicting directions.
 *  - `initial={false}` on AnimatePresence suppresses the first-mount animation.
 *  - `prefers-reduced-motion` → render children directly, no motion.
 *  - Route callers pass useOutlet()'s element, rather than a live <Outlet>,
 *    so outgoing content keeps its own page while the new route enters.
 */
export default function PageTurnTransition({ children }) {
  const location = useLocation();
  const reduce = useReducedMotion();

  if (reduce) {
    return <>{children}</>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <AnimatePresence initial={false}>
        <motion.div
          // Key on pathname only. Changing search params (e.g. ?tab=…) MUST NOT
          // unmount the outlet — ChapterHub handles its own tab fade, and
          // remounting the whole page on every tab click caused every useApi
          // hook inside to re-fire (the "duplicate API calls on navigation"
          // bug from 40a33be).
          key={location.pathname}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          style={{ gridArea: '1 / 1' }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
