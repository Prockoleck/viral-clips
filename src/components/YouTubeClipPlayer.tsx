"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

let apiReady = false;
let apiPromise: Promise<void> | null = null;

function loadYTApi(): Promise<void> {
  if (apiReady) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    if (typeof window === "undefined") return resolve();

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      apiReady = true;
      resolve();
    };
  });
  return apiPromise;
}

type Props = {
  videoId: string;
  start: number;
  end: number;
};

export default function YouTubeClipPlayer({ videoId, start, end }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let destroyed = false;

    loadYTApi().then(() => {
      if (destroyed || !containerRef.current) return;

      const divId = `yt-${videoId}-${Math.random().toString(36).slice(2, 8)}`;
      containerRef.current.id = divId;

      playerRef.current = new window.YT.Player(divId, {
        videoId,
        playerVars: {
          start: Math.floor(start),
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            if (destroyed) return;
            const player = playerRef.current;
            if (player && player.seekTo) {
              player.seekTo(start, true);
            }
          },
          onStateChange: (e: any) => {
            if (destroyed) return;
            if (e.data === window.YT.PlayerState.PLAYING) {
              clearInterval(timerRef.current!);
              timerRef.current = setInterval(() => {
                if (destroyed) return;
                const player = playerRef.current;
                if (player && player.getCurrentTime) {
                  const currentTime = player.getCurrentTime();
                  if (currentTime >= end) {
                    player.pauseVideo();
                    clearInterval(timerRef.current!);
                    player.seekTo(start, true);
                  }
                }
              }, 250);
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (playerRef.current && playerRef.current.destroy) {
        try { playerRef.current.destroy(); } catch {}
      }
    };
  }, [videoId, start, end]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
