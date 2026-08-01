"use client";

import { useCallback, useRef, useState } from "react";

type KeyResponse = { enabled: boolean; key?: string; reason?: string };

/**
 * Live mic → Deepgram streaming STT.
 *
 * Three gotchas baked in, each worth ~20 minutes if you hit them cold:
 *  1. MediaRecorder must start INSIDE socket.onopen — chunks sent before the
 *     socket is open are silently dropped.
 *  2. Browser auth is the WebSocket subprotocol ["token", key], not a header.
 *  3. getUserMedia requires HTTPS or localhost.
 */
export function useLiveTranscript() {
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    socketRef.current?.close();
    recorderRef.current = null;
    streamRef.current = null;
    socketRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    const res = (await fetch("/api/deepgram/key").then((r) =>
      r.json()
    )) as KeyResponse;

    if (!res.enabled || !res.key) {
      setAvailable(false);
      return false;
    }
    setAvailable(true);
    setTranscript("");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const socket = new WebSocket(
      "wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&interim_results=true&punctuate=true",
      ["token", res.key]
    );
    socketRef.current = socket;

    socket.onopen = () => {
      // Recorder starts here, not before — see gotcha 1.
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      rec.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          socket.send(e.data);
        }
      });
      rec.start(250);
      recorderRef.current = rec;
      setListening(true);
    };

    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string);
        const alt = data?.channel?.alternatives?.[0];
        const text: string = alt?.transcript ?? "";
        if (!text) return;
        if (data.is_final) {
          setTranscript((t) => (t ? `${t} ${text}` : text));
          setInterim("");
        } else {
          setInterim(text);
        }
      } catch {
        /* ignore keepalives */
      }
    };

    socket.onerror = () => stop();
    return true;
  }, [stop]);

  return { transcript, interim, listening, available, start, stop };
}

/** Deepgram TTS with a browser speechSynthesis fallback. */
export async function speak(text: string): Promise<void> {
  try {
    const res = await fetch("/api/deepgram/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      await audio.play();
      return;
    }
  } catch {
    /* fall through */
  }

  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  }
}
