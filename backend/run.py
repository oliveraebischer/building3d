import os

import uvicorn

if __name__ == "__main__":
    # Disable auto-reload when running on Fly.io (FLY_APP_NAME is set there):
    # the watcher would otherwise treat writes to data/*.json (tile manifest,
    # portfolio, projects) as code changes and restart the server mid-request.
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=os.getenv("FLY_APP_NAME") is None)
