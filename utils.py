import os
from pycocotools import mask as mask_utils
from typing import Any
import numpy as np

def load_annotations(file_path: str) -> list[dict[str, Any]]:
    annotation = []

    if os.path.exists(file_path):
        with open(file_path, "r") as f:
            for line in f:
                line = line.strip()
                if line == "":
                    continue

                [mode, class_name, data] = line.split(" ", 2)
                if mode == 'R': # 矩形区域
                    [x1, y1, x2, y2] = data.split(" ")
                    annotation.append({
                        "mode": "R",
                        "class": class_name,
                        "points": [(float(x1), float(y1)), (float(x2), float(y2))]
                    })
                if mode == 'P': # 多边形区域
                    coords = [float(x) for x in data.split(" ")]
                    annotation.append({
                        "mode": "P",
                        "class": class_name,
                        "points": [(x, y) for x, y in zip(coords[0::2], coords[1::2])]
                    })
                elif mode == 'M': # 遮罩
                    [x1, y1, x2, y2, width, height, compressed] = data.split(" ")
                    mask_arr = mask_utils.decode({"counts": compressed, "size": [int(height), int(width)]})
                    encoded = rle_encode(mask_arr)
                    
                    annotation.append({
                        "mode": "M",
                        "class": class_name,
                        "points": [(float(x1), float(y1)), (float(x2), float(y2))],
                        "mask": {"counts": encoded, "size": [int(height), int(width)]}
                    })
    return annotation

def save_annotations(file_path: str, annotations: list[dict[str, Any]]):
    text = ""
    for annotation in annotations:
        if annotation['mode'] == 'R':
            text += f"R {annotation['class']} {annotation['points'][0][0]} {annotation['points'][0][1]} {annotation['points'][1][0]} {annotation['points'][1][1]}\n"
        if annotation['mode'] == 'P':
            points_str = " ".join([f"{x} {y}" for x, y in annotation['points']])
            text += f"R {annotation['class']} {points_str}\n"
        elif annotation['mode'] == 'M':
            mask = annotation['mask']
            decoded = rle_decode(mask['counts'], mask['size'][1], mask['size'][0])
            decoded = np.asfortranarray(decoded)
            compressed = mask_utils.encode(decoded)
            counts = compressed['counts'].decode()

            text += f"M {annotation['class']} {annotation['points'][0][0]} {annotation['points'][0][1]} {annotation['points'][1][0]} {annotation['points'][1][1]} {mask['size'][1]} {mask['size'][0]} {counts}\n"
    
    with open(file_path, "w") as f:
        f.write(text)

def rle_encode(mask: np.ndarray) -> list[int]:
    array = mask.flatten(order='F')
    change_pos = np.where(array[:-1] != array[1:])[0] + 1
    positions = np.concatenate(([0], change_pos, [len(array)]))
    counts = np.diff(positions)
    if array[0] == 1:
        counts = np.insert(counts, 0, 0)
        
    return counts.tolist()

def rle_decode(encoded: list[int], width: int, height: int) -> np.ndarray:
    values = np.resize(np.array([0, 1], dtype=np.uint8), len(encoded))
    mask_arr = np.repeat(values, encoded)

    mask_arr = np.reshape(mask_arr, (height, width), order='F')
    mask_arr = np.ascontiguousarray(mask_arr)
    
    return mask_arr