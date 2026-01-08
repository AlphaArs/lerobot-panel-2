import cv2

from lerobot.cameras.opencv.configuration_opencv import OpenCVCameraConfig
from lerobot.cameras.opencv.camera_opencv import OpenCVCamera
from lerobot.cameras.configs import ColorMode, Cv2Rotation

config = OpenCVCameraConfig(
    index_or_path=4,
    fps=30,
    width=1920,
    height=1080,
    color_mode=ColorMode.RGB,
    rotation=Cv2Rotation.NO_ROTATION
)

camera = OpenCVCamera(config)
camera.connect()

print("Press 'q' to quit.")

try:
    while True:
        frame = camera.async_read(timeout_ms=200)
        if frame is None:
            continue

        # OpenCV expects BGR, lerobot gives RGB
        frame_bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

        cv2.imshow("LeRobot Camera", frame_bgr)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

except KeyboardInterrupt:
    print("Stopped by user.")

finally:
    camera.disconnect()
    cv2.destroyAllWindows()
