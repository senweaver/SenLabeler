"""Layer Canvas Component - Multi-layer canvas with background image, rectangles and masks."""

import gradio as gr
from typing import Optional, List, Dict, Any, Union
from dataclasses import dataclass
import json

__all__ = ['LayerCanvas', 'Layer', 'RectLayer', 'MaskLayer']


@dataclass
class Layer:
    """Base layer class."""
    id: str
    name: str
    visible: bool = True
    opacity: float = 1.0
    z_index: int = 0


@dataclass  
class RectLayer(Layer):
    """Rectangle layer."""
    x: float = 0
    y: float = 0
    width: float = 100
    height: float = 100
    color: str = "#FF0000"
    stroke_color: str = "#000000"
    stroke_width: float = 2
    fill: bool = True
    border_radius: float = 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'type': 'rect',
            'id': self.id,
            'name': self.name,
            'visible': self.visible,
            'opacity': self.opacity,
            'z_index': self.z_index,
            'x': self.x,
            'y': self.y,
            'width': self.width,
            'height': self.height,
            'color': self.color,
            'strokeColor': self.stroke_color,
            'strokeWidth': self.stroke_width,
            'fill': self.fill,
            'borderRadius': self.border_radius
        }


@dataclass
class MaskLayer(Layer):
    """Mask layer - covers everything except specified regions."""
    color: str = "#000000"
    opacity: float = 0.7
    regions: List[Dict[str, Any]] = None  # List of regions to cut out (holes)
    
    def __post_init__(self):
        if self.regions is None:
            self.regions = []
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'type': 'mask',
            'id': self.id,
            'name': self.name,
            'visible': self.visible,
            'opacity': self.opacity,
            'z_index': self.z_index,
            'color': self.color,
            'regions': self.regions
        }


class LayerCanvas(gr.Component):
    """
    A multi-layer canvas component with background image support.
    
    Features:
    - Background image layer
    - Multiple rectangle layers with customizable styles
    - Multiple mask layers with hole regions
    - Zoom and pan support
    - Layer visibility and opacity control
    - Interactive editing (draw, move, resize)
    
    Example:
        with gr.Blocks() as demo:
            canvas = LayerCanvas(
                height=600,
                show_controls=True,
                editable=True
            )
            
            # Set background image
            canvas.set_background("path/to/image.png")
            
            # Add a rectangle layer
            canvas.add_layer(RectLayer(
                id="rect1",
                name="Box 1",
                x=100, y=100,
                width=200, height=150,
                color="#FF5733"
            ))
            
            # Add a mask layer
            canvas.add_layer(MaskLayer(
                id="mask1", 
                name="Mask 1",
                color="#000000",
                opacity=0.7,
                regions=[{"type": "rect", "x": 50, "y": 50, "width": 300, "height": 200}]
            ))
    """
    
    EVENTS = [gr.events.Change(), gr.events.Input()]
    
    def __init__(
        self,
        value: Optional[Dict[str, Any]] = None,
        *,
        height: int = 500,
        width: Optional[int] = None,
        show_controls: bool = True,
        editable: bool = True,
        min_zoom: float = 0.1,
        max_zoom: float = 10.0,
        background_color: str = "#1a1a1a",
        label: Optional[str] = None,
        show_label: bool = True,
        container: bool = True,
        scale: int = 1,
        min_width: int = 160,
        interactive: Optional[bool] = None,
        visible: bool = True,
        elem_id: Optional[str] = None,
        elem_classes: Optional[List[str]] = None,
        **kwargs
    ):
        """
        Initialize the LayerCanvas component.
        
        Args:
            value: Initial value containing image and layers configuration
            height: Canvas height in pixels
            width: Canvas width in pixels (auto if None)
            show_controls: Whether to show the layer control panel
            editable: Whether layers can be edited interactively
            min_zoom: Minimum zoom level
            max_zoom: Maximum zoom level
            background_color: Canvas background color
            label: Component label
            show_label: Whether to show the label
            container: Whether to wrap in container
            scale: Scale factor in flex layout
            min_width: Minimum width
            interactive: Whether component is interactive
            visible: Whether component is visible
            elem_id: HTML element id
            elem_classes: HTML element classes
            **kwargs: Additional arguments
        """
        self.height = height
        self.width = width
        self.show_controls = show_controls
        self.editable = editable
        self.min_zoom = min_zoom
        self.max_zoom = max_zoom
        self.background_color = background_color
        
        super().__init__(
            value=value,
            label=label,
            show_label=show_label,
            container=container,
            scale=scale,
            min_width=min_width,
            interactive=interactive if interactive is not None else editable,
            visible=visible,
            elem_id=elem_id,
            elem_classes=elem_classes,
            **kwargs
        )
    
    def api_info(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "image": {"type": "string", "description": "Base64 or URL of background image"},
                "layers": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "enum": ["rect", "mask"]},
                            "id": {"type": "string"},
                            "name": {"type": "string"},
                            "visible": {"type": "boolean"},
                            "opacity": {"type": "number"},
                            "z_index": {"type": "integer"}
                        }
                    }
                }
            }
        }
    
    def example_inputs(self) -> Dict[str, Any]:
        return {
            "image": "https://via.placeholder.com/800x600",
            "layers": [
                {
                    "type": "rect",
                    "id": "rect1",
                    "name": "Rectangle 1",
                    "visible": True,
                    "opacity": 1.0,
                    "z_index": 0,
                    "x": 100, "y": 100,
                    "width": 200, "height": 150,
                    "color": "#FF5733"
                }
            ]
        }
    
    def preprocess(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Process the component input data."""
        if payload is None:
            return {"image": None, "layers": []}
        
        return payload
    
    def postprocess(self, value: Dict[str, Any]) -> Dict[str, Any]:
        """Process the component output data."""
        if value is None:
            return {"image": None, "layers": []}
        
        return value
    
    def info(self) -> Dict[str, Any]:
        return self.api_info()
    
    def frontend_params(self) -> Dict[str, Any]:
        return {
            "height": self.height,
            "width": self.width,
            "showControls": self.show_controls,
            "editable": self.editable,
            "minZoom": self.min_zoom,
            "maxZoom": self.max_zoom,
            "backgroundColor": self.background_color
        }