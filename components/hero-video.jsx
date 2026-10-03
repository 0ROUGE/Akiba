"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";

/**
 * Full-bleed looping hero video.
 * - Starts muted (autoplay requires it) with a hover-revealed unmute control
 *   on desktop, tap-revealed on touch devices.
 * - A soft white scrim brightens while the page is actively scrolling and
 *   clears a moment after it stops — a subtle cue that content moves, not a
 *   permanent vignette.
 */
export function HeroVideo({ className = "" }) {
  const videoRef = useRef(null);
  const scrollTimeout = useRef(null);
  const [hovering, setHovering] = useState(false);
  const [muted, setMuted] = useState(true);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolling(true);
      clearTimeout(scrollTimeout.current);
      scrollTimeout.current = setTimeout(() => setScrolling(false), 450);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(scrollTimeout.current);
    };
  }, []);

  function toggleMute() {
    setMuted((m) => {
      if (videoRef.current) videoRef.current.muted = !m;
      return !m;
    });
  }

  const controlsVisible = hovering;

  return (
    <div
      className={`group relative h-full w-full overflow-hidden ${className}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => setHovering((h) => !h)}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        src="/media/hero.mp4"
        poster="/media/hero-poster.jpg"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
      />

      {/* Scroll-reactive scrim — clears when idle */}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-white"
        animate={{ opacity: scrolling ? 0.12 : 0 }}
        transition={{ duration: 0.4 }}
      />

      {/* Permanent light bottom gradient so overlaid text/controls stay legible */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />

      <AnimatePresence>
        {controlsVisible && (
          <motion.button
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            aria-label={muted ? "Unmute video" : "Mute video"}
            className="absolute bottom-5 right-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-ink shadow-soft backdrop-blur"
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
