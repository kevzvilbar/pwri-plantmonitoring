"""
Repo-root entry point.

The real FastAPI application lives in `backend/server.py` (see that file for
routes, middleware, and the `app` object). This file exists only so that
`python main.py` from the repo root does something meaningful instead of
printing a placeholder greeting — it delegates straight to uvicorn.

For local development you can equally well run:
    uvicorn backend.server:app --reload --port 8000
from the repo root, or `cd backend && uvicorn server:app --reload`.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))


def main() -> None:
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=bool(os.environ.get("RELOAD")),
        app_dir=os.path.join(os.path.dirname(__file__), "backend"),
    )


if __name__ == "__main__":
    main()
