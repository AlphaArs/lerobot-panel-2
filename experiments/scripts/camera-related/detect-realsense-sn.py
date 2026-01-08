
import pyrealsense2 as rs

ctx = rs.context()
devices = ctx.query_devices()

for dev in devices:
    print("Name:", dev.get_info(rs.camera_info.name))
    print("Serial Number:", dev.get_info(rs.camera_info.serial_number))
