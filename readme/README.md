# FastAPI server (template) — Smart Vision

This template places a FastAPI server inside `server/` so you can keep your `Smart/` frontend folder
in the same repository (monorepo). Use Render's *Root Directory* setting to point a Web Service
at the `server/` folder, or add a `render.yaml` (example included) to configure services as code.

Quick start:
1. Put this template into your repository root (alongside the `Smart/` folder).
2. Commit & push to GitHub.
3. In Render Dashboard create a new **Web Service**, select this repo, set **Root Directory** to `server`.
4. Build Command: `pip install -r requirements.txt`
5. Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

See Render docs: https://render.com/docs/deploy-fastapi and Monorepo support for details.
