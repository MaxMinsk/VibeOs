# VibeOs

AI-операционная система: рабочий стол в стиле macOS в браузере, где **каждое
приложение — это HTML, сгенерированный на лету** локальным Claude Code. Окна — это
iframe'ы, которые можно двигать, ресайзить, сворачивать и закрывать.

См. [`architecture.md`](./architecture.md) и [`plan.md`](./plan.md).
Разбор похожего проекта — [`analysis-caffeinum-vibeos.md`](./analysis-caffeinum-vibeos.md).

## Стек

- **shell/** — рабочий стол: Vanilla TypeScript + Vite (window manager, dock, menu bar).
- **server/** — Agent Bridge: Node + Fastify (мост к Claude Code через Agent SDK).

## Запуск (dev)

```bash
npm install          # ставит зависимости всех workspaces
npm run dev          # поднимает shell (Vite) и server параллельно
```

- Shell:  http://localhost:5173
- Server: http://localhost:8787  (проверка: `GET /health`)

По отдельности:

```bash
npm run dev:shell
npm run dev:server
```

## Статус

Текущий этап: **M0 — скелет проекта** (статичный рабочий стол + server `/health`).
Прогресс по этапам — в [`plan.md`](./plan.md).
