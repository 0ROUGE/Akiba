"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, Volume2, VolumeX, Maximize } from "lucide-react";

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * A contained, native-aspect-ratio video player (16:9 — the source clip's
 * own dimensions) rather than a full-bleed background. Controls stay hidden
 * until the pointer is near the player, then fade in as a bottom bar —
 * play/pause, scrubber, time, mute — plus a center play button when paused.
 */
export function HeroVideo({ className = "" }) {
  const videoRef = useRef(null);
  const [hovering, setHovering] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      setProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
    };
    const onLoaded = () => setDuration(video.duration);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onLoaded);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onLoaded);
    };
  }, []);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function seek(e) {
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    video.currentTime = ratio * duration;
  }

  function toggleFullscreen() {
    videoRef.current?.requestFullscreen?.();
  }

  const controlsVisible = hovering || !playing;

  return (
    <div
      className={`group relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-soft ${className}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
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
        onClick={togglePlay}
      />

      <AnimatePresence>
        {!playing && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={togglePlay}
            aria-label="Play"
            className="absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-ink shadow-lift"
          >
            <Play size={22} className="ml-0.5" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {controlsVisible && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-8"
          >
            <div
              className="mb-2 h-1 w-full cursor-pointer rounded-full bg-white/25"
              onClick={seek}
            >
              <div className="h-full rounded-full bg-white" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex items-center gap-3 text-white">
              <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <span className="text-xs tabular-nums text-white/80">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <button onClick={toggleFullscreen} aria-label="Fullscreen" className="ml-auto">
                <Maximize size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
