import cv2
from cv2_enumerate_cameras import enumerate_cameras

def dump(backend, name):
    print(f"\n=== {name} ===")
    cams = list(enumerate_cameras(backend))
    if not cams:
        print("No cameras found.")
        return
    for c in cams:
        print(f"index={c.index}  name={c.name}")
        print(f"  vid={c.vid} pid={c.pid}")
        print(f"  path={c.path}\n")

dump(cv2.CAP_MSMF, "CAP_MSMF")
dump(cv2.CAP_DSHOW, "CAP_DSHOW")
