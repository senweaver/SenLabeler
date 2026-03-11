import os
import json
from datetime import datetime
from typing import Literal, Any
from utils import load_annotations
import random
import shutil
import yaml


def export(project_name: str, format: Literal["YAML"] = "YAML", type: Literal["rect", "mask"] = "rect", ratio: float = 0.8) -> tuple[bool, str | None, str | None]:
    """
    导出标注数据到指定格式。
    
    Args:
        project_name: 项目名称
        format: 导出格式，目前支持 YAML
        type: 标注类型，rect 为矩形框，mask 为分割掩码
        ratio: 训练集占比
        
    Returns:
        tuple: (成功标志, 错误信息, 输出目录路径)
    """
    project_dir = os.path.join(".", "data", project_name)
    
    if not os.path.exists(project_dir):
        return False, f"项目目录不存在: {project_dir}", None
    
    time_str = datetime.now().strftime("%Y%m%d%H%M%S")
    out_dir = os.path.join(".", "output", f"{project_name}_{time_str}")
    
    try:
        os.makedirs(os.path.join(out_dir, "images", "train"), exist_ok=True)
        os.makedirs(os.path.join(out_dir, "images", "val"), exist_ok=True)
        os.makedirs(os.path.join(out_dir, "labels", "train"), exist_ok=True)
        os.makedirs(os.path.join(out_dir, "labels", "val"), exist_ok=True)
        
        if format == "YAML":
            return _export_yaml(project_name, project_dir, out_dir, type, ratio)
        else:
            return False, f"不支持的导出格式: {format}", None
            
    except Exception as e:
        return False, str(e), None


def _export_yaml(project_name, project_dir: str, out_dir: str, type: Literal["rect", "mask"], ratio: float) -> tuple[bool, str | None, str | None]:
    images_train_dir = os.path.join(out_dir, "images", "train")
    images_val_dir = os.path.join(out_dir, "images", "val")
    labels_train_dir = os.path.join(out_dir, "labels", "train")
    labels_val_dir = os.path.join(out_dir, "labels", "val")

    # 读取配置文件
    config_path = os.path.join(project_dir, "config.json")
    if not os.path.exists(config_path):
        return False, f"配置文件不存在: {config_path}", None
    
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)
    
    # 解析类别
    classes = config.get("classes", [])
    categories = []
    for category, _ in classes:
        if category not in categories:
            categories.append(category)
    
    # 遍历图片目录
    images_dir = os.path.join(project_dir, "images")
    if not os.path.exists(images_dir):
        return False, f"图片目录不存在: {images_dir}", None
    
    # 获取所有图片文件
    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    valid_image_files = []
    for filename in os.listdir(images_dir):
        filenname_base, ext = os.path.splitext(filename)
        if ext.lower() not in image_extensions:
            continue

        image_path = os.path.join(images_dir, filename)
        annotation_path = os.path.join(images_dir, filenname_base + ".txt")
        if not os.path.exists(annotation_path) or not os.path.exists(image_path):
            continue

        valid_image_files.append((filenname_base, image_path, annotation_path))
    
    # 分配训练集和验证集
    total_files_count = len(valid_image_files)
    train_file_count = int(round(total_files_count * ratio))
    val_file_count = total_files_count - train_file_count
    train_files = []
    val_files = []

    for paths in valid_image_files:
        if ((random.random() <= ratio) and len(train_files) < train_file_count) or len(val_files) >= val_file_count:
            train_files.append(paths)
        else:
            val_files.append(paths)
    
    # 复制文件和保存标注
    for filenname_base, image_path, annotation_path in train_files:
        shutil.copy(image_path, images_train_dir)
        annotations = load_annotations(annotation_path)
        if type == "rect":
            annotations_str = _convert_to_rect_str(annotations, categories)
        elif type == "mask":
            # todo: 导出遮罩
            annotations_str = _convert_to_mask_str(annotations, categories)

        annotation_path = os.path.join(labels_train_dir, filenname_base + ".txt")
        with open(annotation_path, "w") as annotation_file:
            annotation_file.write(annotations_str)

    for filenname_base, image_path, annotation_path in val_files:
        shutil.copy(image_path, images_val_dir)
        annotations = load_annotations(annotation_path)
        if type == "rect":
            annotations_str = _convert_to_rect_str(annotations, categories)
        elif type == "mask":
            # todo: 导出遮罩
            annotations_str = _convert_to_mask_str(annotations, categories)
        
        annotation_path = os.path.join(labels_val_dir, filenname_base + ".txt")
        with open(annotation_path, "w") as annotation_file:
            annotation_file.write(annotations_str)
    
    # 导出YAML文件
    data = {
        "path": project_name,
        "train": "images/train",
        "val": "images/val",
        "test": None,
        "names": {i: v for i, v in enumerate(categories)},
    }

    yaml_path = os.path.join(out_dir, project_name + ".yaml")
    with open(yaml_path, "w") as f:
        yaml.safe_dump(data, f)
    
    return True, None, out_dir

def _convert_to_rect_str(annotations, categories: list[Any]) -> str:
    ret = ""
    for annotation in annotations:
        mode = annotation.get('mode')
        name = annotation.get('class')
        points = annotation.get('points')

        if name in categories:
            index = categories.index(name)
        else:
            categories.append(name)
            index = len(categories) - 1

        if mode == "R" or mode == "M":
            ret += f"{index} {points[0][0]} {points[0][1]} {points[1][0]} {points[1][1]}\n"
        elif mode == "P":
            xmin, ymin = points[0]
            xmax, ymax = xmin, ymin
            for x, y in points[1:]:
                xmin = min(xmin, x)
                ymin = min(ymin, y)
                xmax = max(xmax, x)
                ymax = max(ymax, y)
            ret += f"{index} {xmin} {ymin} {xmax} {ymax}\n"

    return ret

def _convert_to_mask_str(annotations, categories: list[Any]) -> str:
    ret = ""
    for annotation in annotations:
        mode = annotation.get('mode')
        name = annotation.get('class')
        points = annotation.get('points')

        if name not in categories:
            index = categories.index(name)
        else:
            categories.append(name)
            index = len(categories) - 1

        polygon_points = []

        if mode == "R" or mode == "M":
            x1, y1 = points[0]
            x2, y2 = points[1]
            polygon_points = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
        elif mode == "P":
            polygon_points = points
        
        polygon_points_str = " ".join([f"{x} {y}" for x, y in polygon_points])
        ret += f"{index} {polygon_points_str}\n"

    return ret

