#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
pdm_require systemctl
pdm_require uv
pdm_uv="$(command -v uv)"
pdm_python - "$pdm_root" "$pdm_uv" "$UV_PROJECT_ENVIRONMENT" <<'PY'
from pathlib import Path
import os
import sys
root, uv, venv = sys.argv[1:]
home=Path.home()
unit_dir = Path(os.environ.get('XDG_CONFIG_HOME') or home/'.config')/'systemd/user'
unit_dir.mkdir(parents=True, exist_ok=True)
def quote(value):
    return '"'+str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%')+'"'
unit=f'''[Unit]
Description=Personal Deadline Management local workspace
After=network.target

[Service]
WorkingDirectory={quote(root)}
Environment={quote('UV_PROJECT_ENVIRONMENT='+venv)}
ExecStart={quote(uv)} run --frozen --no-sync pdm
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
'''
(unit_dir/'personal-deadline-management.service').write_text(unit)
PY
systemctl --user daemon-reload
systemctl --user enable --now personal-deadline-management.service
