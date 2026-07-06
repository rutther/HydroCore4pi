import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEPS = ROOT.parent / ".tmp_pydeps_hydrocore31"

sys.path[:0] = [str(DEPS), str(ROOT)]

from backend.app import app


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
