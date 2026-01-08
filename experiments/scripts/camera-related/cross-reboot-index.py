import json
import re
import subprocess
from pathlib import Path

import cv2
from cv2_enumerate_cameras import enumerate_cameras

CONFIG_PATH = Path("saved_camera.json")

GUID_RE = re.compile(
    r"^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$"
)

USB_PATH_RE = re.compile(r"(?:^|\\\\\?\\)usb#([^#]+)#([^#]+)#", re.IGNORECASE)


def run_ps(cmd: str) -> str:
    return subprocess.check_output(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
        text=True,
        encoding="utf-8",
        errors="replace",
    ).strip()


def dshow_path_to_instance_id(path: str) -> str:
    if not path:
        raise ValueError("Empty DirectShow path")

    m = USB_PATH_RE.search(path.strip())
    if not m:
        # fallback if string doesn't include the \\?\ prefix
        m = re.search(r"usb#([^#]+)#([^#]+)#", path.strip(), re.IGNORECASE)
    if not m:
        raise ValueError(f"Could not parse USB instance tokens from: {path}")

    part1, part2 = m.group(1), m.group(2)
    return f"USB\\{part1}\\{part2}".upper()


def container_id_from_instance_id(instance_id: str) -> str:
    if not instance_id or instance_id.lower() == "none":
        raise RuntimeError(f"Invalid InstanceId: {instance_id}")

    ps = (
        "(Get-ItemProperty -Path "
        f"'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\{instance_id}' "
        "-Name ContainerID).ContainerID"
    )
    out = run_ps(ps).strip()

    if not out:
        raise RuntimeError(f"No ContainerID found in registry for {instance_id}")
    if not GUID_RE.match(out):
        raise RuntimeError(f"ContainerID was not a GUID (got): {out}")

    return out


def cameras():
    """Return list of cameras from cv2_enumerate_cameras (CAP_DSHOW)."""
    return [
        {
            "index": int(c.index),
            "name": str(c.name),
            "vid": int(c.vid) if c.vid is not None else None,
            "pid": int(c.pid) if c.pid is not None else None,
            "path": str(c.path) if c.path else "",
        }
        for c in enumerate_cameras(cv2.CAP_DSHOW)
    ]


def enrich(cam: dict) -> dict:
    """Add instance_id + container_id if possible (best effort)."""
    path = cam.get("path", "")
    cam = {**cam, "instance_id": None, "container_id": None}
    if not path:
        return cam

    try:
        iid = dshow_path_to_instance_id(path)
        cid = container_id_from_instance_id(iid)
        cam["instance_id"] = iid
        cam["container_id"] = cid
    except Exception:
        pass

    return cam


def list_cams():
    cams = [enrich(c) for c in cameras()]
    if not cams:
        print("No cameras found.")
        return

    print("\n=== Cameras (CAP_DSHOW) ===\n")
    for c in cams:
        print(f"index={c['index']}  name={c['name']}")
        print(f"  vid={c['vid']} pid={c['pid']}")
        print(f"  path={c['path']}")
        if c["container_id"]:
            print(f"  instance_id={c['instance_id']}")
            print(f"  container_id={c['container_id']}")
        else:
            print("  container_id=(unavailable)")
        print()


def save_cam():
    cams = [enrich(c) for c in cameras()]
    if not cams:
        print("No cameras found.")
        return

    print("\nPick the camera you want to SAVE by OpenCV index.")
    print("Tip: if two cameras look identical, temporarily cover one lens.\n")

    for c in cams:
        print(f"index={c['index']}  name={c['name']}")
        print(f"  vid={c['vid']} pid={c['pid']}")
        print(f"  container_id={c['container_id']}")
        print()

    try:
        idx = int(input("Enter index to save: ").strip())
    except ValueError:
        print("Invalid index.")
        return

    cam = next((c for c in cams if c["index"] == idx), None)
    if not cam:
        print(f"Index {idx} not found.")
        return

    if not cam["container_id"]:
        print("This camera did not produce a ContainerID. Cannot save robustly.")
        print("Most common reasons:")
        print("- Path is not a USB DirectShow path")
        print("- Registry lookup failed")
        print("- Device is exposed differently by the driver")
        return

    payload = {
        "saved_name": cam["name"],
        "saved_vid": cam["vid"],
        "saved_pid": cam["pid"],
        "saved_container_id": cam["container_id"],
    }
    CONFIG_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("\n✅ Saved camera:")
    print(json.dumps(payload, indent=2))
    print(f"\nSaved to: {CONFIG_PATH.resolve()}\n")


def resolve_index():
    if not CONFIG_PATH.exists():
        print(f"No {CONFIG_PATH} found. Save a camera first.")
        return None

    saved = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    saved_container = str(saved.get("saved_container_id", "")).strip().lower()

    for cam in (enrich(c) for c in cameras()):
        cid = cam.get("container_id")
        if cid and cid.strip().lower() == saved_container:
            return cam["index"]

    return None


def retrieve_index():
    idx = resolve_index()
    if idx is None:
        print("\n❌ Could not find the saved camera right now.")
        print("Reasons:")
        print("- Camera unplugged/off")
        print("- Windows removed device record / driver reset")
        print("- Device enumerates without a usable USB DirectShow path")
        print()
        return
    print(f"\n✅ Saved camera resolves to OpenCV index: {idx}\n")


def main():
    actions = {
        "1": list_cams,
        "2": save_cam,
        "3": retrieve_index,
        "4": lambda: None,
    }

    while True:
        print("Choose an action:")
        print("  1) List cameras")
        print("  2) Save a camera (by current index)")
        print("  3) Retrieve OpenCV index from saved camera")
        print("  4) Exit")
        choice = input("> ").strip()

        if choice == "4":
            return
        (actions.get(choice) or (lambda: print("Invalid choice.\n")))()


if __name__ == "__main__":
    main()
