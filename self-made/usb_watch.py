"""
Watch for USB devices that connect or disconnect after the script starts.

The script takes a snapshot of currently present USB devices and then reports
only changes (connections/disconnections) that happen afterwards.
Requires PowerShell and the Get-PnpDevice cmdlet (available on Windows 10+).
"""

import json
import subprocess
import sys
import time


POLL_SECONDS = 1.0


def fetch_usb_devices():
    """Return a dict mapping instance id -> friendly name for present USB devices."""
    ps_command = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "@(Get-PnpDevice -PresentOnly "
        "| Where-Object { $_.InstanceId -like 'USB*' } "
        "| Select-Object InstanceId, FriendlyName)"
        " | ConvertTo-Json -Depth 2"
    )

    # Use bytes + manual decode to avoid UnicodeDecodeError on localized consoles.
    result = subprocess.run(
        ["powershell", "-NoLogo", "-NoProfile", "-Command", ps_command],
        capture_output=True,
        text=False,
    )

    if result.returncode != 0:
        stderr_text = (result.stderr or b"").decode("utf-8", errors="replace").strip()
        raise RuntimeError(stderr_text or "PowerShell command failed")

    output = (result.stdout or b"").decode("utf-8", errors="replace").strip() or "[]"
    data = json.loads(output)

    if isinstance(data, dict):  # Convert single-object JSON to a list for uniformity.
        data = [data]

    devices = {}
    for item in data:
        instance_id = item.get("InstanceId")
        if not instance_id:
            continue
        friendly = item.get("FriendlyName") or "(unknown USB device)"
        devices[instance_id] = friendly

    return devices


def main():
    print("Monitoring USB devices... (press Ctrl+C to stop)")
    baseline = fetch_usb_devices()
    print(f"Ignoring {len(baseline)} device(s) already present.")
    previous = baseline

    try:
        while True:
            time.sleep(POLL_SECONDS)
            try:
                current = fetch_usb_devices()
            except Exception as exc:  # Keep running even if a read fails.
                print(f"Error reading USB devices: {exc}", file=sys.stderr)
                continue

            added = current.keys() - previous.keys()
            removed = previous.keys() - current.keys()

            for instance_id in sorted(added):
                print(f"[connected] {current[instance_id]} ({instance_id})")

            for instance_id in sorted(removed):
                name = previous.get(instance_id, "(unknown USB device)")
                print(f"[disconnected] {name} ({instance_id})")

            previous = current
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
