"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const MIN_VISIBLE_MS = 850;
const EXIT_MS = 280;

export function AppBootLoader() {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);
  const startRef = useRef<number>(0);
  const closedRef = useRef(false);

  useEffect(() => {
    startRef.current = performance.now();

    let hideTimer: number | undefined;
    let exitTimer: number | undefined;

    const close = () => {
      if (closedRef.current) return;
      closedRef.current = true;
      const elapsed = performance.now() - startRef.current;
      const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);

      hideTimer = window.setTimeout(() => {
        setExiting(true);
        exitTimer = window.setTimeout(() => {
          setVisible(false);
        }, EXIT_MS);
      }, wait);
    };

    if (document.readyState === "complete") {
      close();
    } else {
      window.addEventListener("load", close, { once: true });
      // Safety fallback when load event is delayed.
      hideTimer = window.setTimeout(close, 1500);
    }

    return () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      if (exitTimer) window.clearTimeout(exitTimer);
      window.removeEventListener("load", close);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`app-loader app-loader--overlay ${exiting ? "app-loader--exit" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Loading CRC Reporting"
    >
      <div className="app-loader__blur" />
      <div className="app-loader__glow app-loader__glow--primary" />
      <div className="app-loader__glow app-loader__glow--secondary" />
      <div className="app-loader__content">
        <div className="app-loader__logo-shell">
          <Image
            src="/icons/crc-logo.svg"
            alt="CRC logo"
            width={108}
            height={108}
            priority
            className="app-loader__logo"
          />
        </div>
        <p className="app-loader__title">CRC Reporting</p>
        <p className="app-loader__subtitle">Opening secure workspace...</p>
      </div>
    </div>
  );
}

