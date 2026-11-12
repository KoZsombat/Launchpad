import type { Response } from "express";

export function openSse(res: Response): void {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
}

export function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function startSseHeartbeat(res: Response): () => void {
  const timer = setInterval(() => {
    res.write(": ping\n\n");
  }, 15_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
