"use client";

import { useEffect, useRef, useState } from "react";

interface LiveImageProps {
  /** Candidate stream URLs (see liveCandidates). On error we rotate to the next one. */
  srcs: string[];
  className?: string;
  alt?: string;
  fit?: "cover" | "contain";
  /** false = don't open a connection yet (e.g. persona still queued) */
  active?: boolean;
  placeholder?: string;
}

/**
 * <img> for an MJPEG stream. Browsers render multipart/x-mixed-replace natively; if the
 * connection fails we re-attach to the next candidate URL after a short delay.
 */
export function LiveImage({ srcs, className = "", alt = "", fit = "cover", active = true, placeholder = "waiting for feed" }: LiveImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [ok, setOk] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const retry = () => {
    setOk(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAttempt((n) => n + 1), 1500);
  };

  const src = srcs.length ? srcs[attempt % srcs.length] : "";
  const url = src ? `${src}${src.includes("?") ? "&" : "?"}n=${Math.floor(attempt / srcs.length)}` : "";
  return (
    <>
      {active && url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt={alt}
          data-live
          onLoad={() => setOk(true)}
          onError={retry}
          className={`${className} ${fit === "cover" ? "object-cover" : "object-contain"} transition-opacity duration-500 ${ok ? "opacity-100" : "opacity-0"}`}
          draggable={false}
        />
      )}
      {!(active && ok) && (
        <div className="absolute inset-0 grid place-items-center bg-panel2">
          <div className="shimmer h-full w-full opacity-60" />
          <span className="absolute eyebrow">{active ? placeholder : "sandbox queued"}</span>
        </div>
      )}
    </>
  );
}
