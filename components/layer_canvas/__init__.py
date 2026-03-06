"""Layer Canvas Component - Multi-layer canvas with background image, rectangles and masks."""

import gradio as gr
from pathlib import Path
from typing import Optional, List, Dict, Any, Union
from dataclasses import dataclass
from PIL import Image
import numpy as np
from gradio import processing_utils
import json

_STATIC_DIR = Path(__file__).parent / "static"

_COLOR_PALETTE = [
    "#FF0000",
    "#2196F3",
    "#4CAF50",
    "#FF9800",
    "#9C27B0",
    "#00BCD4",
    "#E91E63",
    "#8BC34A",
]

def _load_image(image: str | Path | Image.Image | np.ndarray) -> Image.Image:
    if isinstance(image, np.ndarray):
        return Image.fromarray(image)
    if isinstance(image, Image.Image):
        return image
    return Image.open(image)


def _save_image_to_cache(img: Image.Image, cache_dir: str) -> str:
    cached_path = processing_utils.save_pil_to_cache(img, cache_dir, format="webp")
    return f"/gradio_api/file={cached_path}"

class LayerCanvas(gr.HTML):
    def __init__(
        self,
        value: tuple[str | Path | Image.Image | np.ndarray, list[dict[str, Any]]] | None = None,
        *,
        height: int = 500,
        width: Optional[int] = None,
        show_controls: bool = True,
        editable: bool = True,
        min_zoom: float = 1.0,
        max_zoom: float = 10.0,
        background_color: str = "#1a1a1a",
        label: Optional[str] = None,
        **kwargs
    ):
        html_template = (_STATIC_DIR / "template.html").read_text(encoding="utf-8")
        css_template = (_STATIC_DIR / "style.css").read_text(encoding="utf-8")
        js_on_load = (_STATIC_DIR / "script.js").read_text(encoding="utf-8")
        
        has_label = label is not None
        super().__init__(
            value=value,
            label=label,
            show_label=has_label,
            container=has_label,
            html_template=html_template,
            css_template=css_template,
            js_on_load=js_on_load,
            height = height,
            width = width,
            show_controls = show_controls,
            editable = editable,
            min_zoom = min_zoom,
            max_zoom = max_zoom,
            background_color = background_color,
            **kwargs
        )
    
    def preprocess(self, payload: str) -> tuple[str | Path | Image.Image | np.ndarray, list[dict[str, Any]]] | None:
        data = json.loads(payload)
        image = data.get("image")
        layers = data.get("layers", [])

        result = []
        if self.image is None:
            return None

        width, height = self.image.size

        for annotation in self.annotations:
            if annotation.get("mode") == "M":
                result.append(annotation)
        
        for layer in layers:
            mode = layer.get("type")
            label = layer.get("name")
            data = layer.get("data")
            if (mode == "rectangle"):
                points = [
                    (data.get("x") / width, data.get("y") / height),
                    ((data.get("x") + data.get("width")) / width, (data.get("y") + data.get("height")) / height)
                    ]
                result.append({
                    "mode": "R",
                    "class": label,
                    "points": points
                })
            elif (mode == "mask"):
                points = []
                for point in data.get("points", []):
                    points.append((point.get("x") / width, point.get("y") / height))
                result.append({
                    "mode": "P",
                    "class": label,
                    "points": points
                })

        
        return (image, result)
    
    def postprocess(self, value: tuple[str | Path | Image.Image | np.ndarray, list[dict[str, Any]]] | None) -> str | None:
        if value is None:
            self.image = None
            self.annotations = []
            return None

        image_src, annotations = value
        img = _load_image(image_src)
        image_url = _save_image_to_cache(img, self.GRADIO_CACHE)
        width, height = img.size

        self.image = img
        self.annotations = annotations

        layers = []
        index = 0
        for annotation in annotations:
            if (annotation.get("mode") == "R"):
                points = annotation.get("points", [])
                layers.append({
                    "id": index,
                    "type": "rectangle",
                    "name": annotation.get("class", ""),
                    "data": {
                        "x": points[0][0] * width,
                        "y": points[0][1] * height,
                        "width": (points[1][0] - points[0][0]) * width,
                        "height": (points[1][1] - points[0][1]) * height,
                    }
                })
                index += 1
            elif (annotation.get("mode") == "P"):
                points = [{"x": x * width, "y": y * height} for x, y in annotation.get("points", [])]
                layers.append({
                    "id": index,
                    "type": "mask",
                    "name": annotation.get("class", ""),
                    "data": { "points": points }
                })
                index += 1

        result: dict[str, Any] = {"image": image_url, "layers": layers}
        return json.dumps(result)