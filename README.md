# LeRobot panel (Electron + Next.js + FastAPI)

All-in-one workspace for managing SO101 robots: map COM ports, create robots, calibrate joints, and trigger leader→follower teleoperation. The stack uses:

- **Electron** (`electron/main.js`) to wrap the web UI.
- **Next.js** frontend (`frontend/`) for the setup flow and robot dashboard.
- **FastAPI** backend (`backend/`) for persistence, COM monitoring, and command hooks into `lerobot`.
- Local storage at `data/robots.json` for robots and calibration metadata.

## Project layout
- `backend/` – FastAPI app (`uvicorn backend.main:app`) with COM polling, REST API, and command runners.
- `frontend/` – Next.js app router UI. `NEXT_PUBLIC_API_BASE` defaults to `http://localhost:8000`.
- `electron/` – Minimal Electron shell pointing at the Next.js dev server.
- `data/robots.json` – persisted robots + calibration entries. Deleting a robot also clears its calibration.

## Setup
1) **Install everything (JS deps)**  
   From repo root run:
   ```powershell
   npm install
   ```
   This installs root tooling plus runs frontend/electron installs for you.

2) **Install backend (Python)**  
   Create/activate your venv, then:
   ```powershell
   npm run install:backend   # wraps: python -m pip install -r backend/requirements.with-lerobot.txt
   ```
   - If you do not want the vendored `./lerobot`, use `backend/requirements.txt` instead.
   - COM detection uses `pyserial` and polls every ~2s. Status is `online` when the stored COM port is present.
   - Calibration/teleop commands default to **dry-run** unless the `lerobot` package is importable. Set `LEROBOT_DRY_RUN=0` to force real execution.

3) **Run all dev services from root**
   ```powershell
   npm run dev
   ```
   - Starts FastAPI on `:8000`, Next.js on `:3000`, and then Electron after the frontend is ready.
   - Make sure your Python venv is active (so `python` points to the env with dependencies) before launching. The backend now runs from the repo root (`python -m uvicorn backend.main:app`), so it can import the `backend` package cleanly.
   - For backend-only or frontend-only, use `npm run dev:backend` or `npm run dev:frontend` (Electron: `npm run dev:electron`).

## Using the UI
- **Add robot wizard**: refresh COM list, plug/unplug to spot the right port, pick model (SO101) and role (leader/follower), then name it. The backend stores name, model, role, and COM for later commands.
- **Robots page**: shows status (online/offline via COM presence), calibration flag, and actions to calibrate, inspect, or delete (deletes calibration too).
- **Calibration flow**: if a calibration exists you'll be asked to override. Otherwise you land on the calibration modal: set arm to neutral → start → adjust joint min/current/max → “End & save”. Backend endpoint: `POST /robots/{id}/calibration`.
- **Teleoperation**: on a calibrated leader, pick a calibrated follower of the same model. If the follower lacks calibration you'll get a warning. Starting teleop prompts you to align poses; “Stop” clears the active session marker. Backend endpoint: `POST /teleop/start`.

## API overview (FastAPI)
- `GET /health` – basic check.
- `GET /ports` – snapshot of detected COM ports `{port: description}`.
- `GET /robots` / `POST /robots` – list/create robots (name, model, role, com_port).
- `GET /robots/{id}` / `DELETE /robots/{id}` – fetch or remove (also clears calibration).
- `POST /robots/{id}/calibration/start` – runs `lerobot.scripts.lerobot_calibrate` with `--robot/--teleop` flags based on role. Honors `override` flag.
- `POST /robots/{id}/calibration` – save joint ranges.
- `GET /robots/{id}/calibration` – fetch saved calibration.
- `POST /teleop/start` – validates leader/follower calibration and model match, then calls the teleop hook (placeholder for now).

## Command wiring
- Calibration command built as:
  - Follower: `python -m lerobot.scripts.lerobot_calibrate --robot.type=so101_follower --robot.port=COM13 --robot.id=<name>`
  - Leader: `python -m lerobot.scripts.lerobot_calibrate --teleop.type=so101_leader --teleop.port=COM14 --teleop.id=<name>`
- If a local `lerobot/src` exists inside this repo, it is added to `PYTHONPATH` automatically. Editable install via `pip install -r backend/requirements.with-lerobot.txt`.

## Notes
- Status relies on COM presence; for USB plug/unplug feedback hit “Refresh COM list”.
- Teleop hook currently returns a success message; swap `run_teleop` in `backend/commands.py` with your real command when ready.
- Everything uses ASCII text; adjust styling in `frontend/src/app/globals.css` and interactions in `frontend/src/app/page.tsx`.
