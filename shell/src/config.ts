// Central config for the shell.

export const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  "http://localhost:8787";
