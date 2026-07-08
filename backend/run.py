import os

import uvicorn

if __name__ == "__main__":
    on_fly = os.getenv("FLY_APP_NAME") is not None
    # fly.toml's http_service.internal_port is 8080 (set by Fly's own "Launch"
    # flow, which may regenerate this file) — match it there. Keep 8000
    # locally to match vite.config.ts's dev proxy target and CLAUDE.md.
    # $PORT still overrides either default if needed.
    default_port = 8080 if on_fly else 8000
    port = int(os.getenv("PORT", default_port))
    # Disable auto-reload on Fly: the watcher would otherwise treat writes to
    # data/*.json (tile manifest, portfolio, projects) as code changes and
    # restart the server mid-request.
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=not on_fly)
