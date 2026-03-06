import os
from datetime import datetime
from typing import Literal, Any

def export(project_name: str, format: Literal["COCO"] = "COCO", type: Literal["rect", "mask"] = "rect"):
    project_dir = os.path.join(".", "data", project_name)
    time_str = datetime.now().strftime("%Y%m%d%H%M%S")
    out_dir = os.path.join(".", "output", f"{project_name} {time_str}")

    try:
        os.makedirs(out_dir)
        if format == "COCO":
            if type == "rect":
                pass
            elif type == "mask":
                pass
    except Exception as e:
        return False, str(e), None

    return True, None, project_dir
    