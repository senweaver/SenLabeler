(function () {
    "use strict";

    // ── Constants ─────────────────────────────────────────────────

    var MIN_ZOOM = 0.5;
    var MAX_ZOOM = 10;
    var ZOOM_SENSITIVITY = 0.001;
    var DRAG_THRESHOLD = 4;

    // ── DOM References ─────────────────────────────────────────────

    var container = element.querySelector(".layer-canvas-container");
    var dataScript = element.querySelector("script.layer-canvas-data");
    var canvasWrapper = element.querySelector(".canvas-wrapper");
    var mainCanvas = element.querySelector(".main-canvas");
    var interactionCanvas = element.querySelector(".interaction-canvas");
    var mainCtx = mainCanvas.getContext("2d");
    var interCtx = interactionCanvas.getContext("2d");
    var tooltip = element.querySelector(".tooltip");
    var controlPanel = element.querySelector(".control-panel");
    var layerList = element.querySelector(".layer-list");
    var loadingIndicator = element.querySelector(".loading-indicator");
    var placeholder = element.querySelector(".placeholder");
    var zoomIndicator = element.querySelector(".zoom-indicator");
    var zoomValue = element.querySelector(".zoom-value");
    var zoomResetBtn = element.querySelector(".zoom-reset-btn");

    // Toolbar buttons - match template classes
    var selectBtn = element.querySelector(".select-tool");
    var rectBtn = element.querySelector(".rect-tool");
    var maskBtn = element.querySelector(".mask-tool");
    
    // Control panel buttons
    var addRectBtn = element.querySelector(".add-rect-btn");
    var addMaskBtn = element.querySelector(".add-mask-btn");
    var clearAllBtn = element.querySelector(".clear-all-btn");
    var resetViewBtn = element.querySelector(".reset-view-btn");
    var exportJsonBtn = element.querySelector(".export-json-btn");

    // ── State ──────────────────────────────────────────────────────

    var state = {
        image: null,
        layers: [],           // Array of layer objects: { id, type, name, visible, data }
        scale: 1,             // Canvas scale relative to image
        zoom: 1,              // User zoom level
        panX: 0,
        panY: 0,
        isPanning: false,
        panStartX: 0,
        panStartY: 0,
        panStartPanX: 0,
        panStartPanY: 0,
        didDrag: false,
        tool: "select",       // 'select', 'rect', 'mask'
        selectedLayerId: null,
        isDrawing: false,
        drawStart: null,      // { x, y } in canvas coordinates
        nextLayerId: 1,
        isDraggingLayer: false,
        dragStartX: 0,
        dragStartY: 0,
        dragStartData: null,
        resizeHandle: null,   // null or handle index (0-7)
        // Polygon drawing state
        polygonPoints: [],    // Points for polygon being drawn
        isDrawingPolygon: false,
        editingPointIndex: null, // Index of point being edited in selected mask
        hoveredPointIndex: null, // Index of hovered point for visual feedback
        hoveredEdgeIndex: null,  // Index of hovered edge for adding points
        polygonCloseThreshold: 15, // Pixels to consider closing polygon
        // Polygon editing state
        isDraggingPolygonMask: false, // Whether dragging entire polygon mask
        dragPolygonStartData: null,    // Original points when starting drag
        // Edge hover state for adding points
        hoveredEdgeInfo: null,          // {edgeIndex, pointOnEdge} for visual feedback
        // Selected vertex for keyboard operations
        selectedPointIndex: null,      // Index of selected point for deletion
        // Context menu state
        contextMenuVisible: false,
        contextMenuX: 0,
        contextMenuY: 0,
        contextMenuPointIndex: null    // Point index for context menu operations
    };

    // Layer types
    var LAYER_TYPES = {
        RECTANGLE: "rectangle",
        MASK: "mask"
    };

    // ── MutationObserver for value changes ─────────────────────────

    var observer = new MutationObserver(function () {
        handleValueChange();
    });
    observer.observe(dataScript, { childList: true, characterData: true, subtree: true });

    // Also handle initial value
    handleValueChange();

    // ── Value Change Handler ───────────────────────────────────────

    function handleValueChange() {
        var raw = dataScript.textContent.trim();
        if (!raw || raw === "null") {
            showPlaceholder();
            return;
        }

        var data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            showPlaceholder();
            return;
        }

        if (!data || !data.image) {
            showPlaceholder();
            return;
        }

        showLoading();

        var img = new Image();
        img.onload = function () {
            state.image = img;
            // Load existing layers if provided
            state.layers = data.layers || [];
            // Assign IDs to layers without them
            for (var i = 0; i < state.layers.length; i++) {
                if (!state.layers[i].id) {
                    state.layers[i].id = state.nextLayerId++;
                }
            }
            state.selectedLayerId = null;

            showContent();
            requestAnimationFrame(function () {
                fitCanvas();
                resetView();
                render();
                renderControlPanel();
            });
        };
        img.src = data.image;
    }

    // ── Display States: placeholder / loading / content ──────────

    function showPlaceholder() {
        state.image = null;
        state.layers = [];
        state.selectedLayerId = null;
        canvasWrapper.style.display = "none";
        loadingIndicator.classList.remove("visible");
        controlPanel.classList.remove("visible");
        tooltip.classList.remove("visible");
        placeholder.classList.remove("hidden");
        if (zoomIndicator) zoomIndicator.style.display = "none";
    }

    function showLoading() {
        placeholder.classList.add("hidden");
        canvasWrapper.style.display = "none";
        controlPanel.classList.remove("visible");
        loadingIndicator.classList.add("visible");
        if (zoomIndicator) zoomIndicator.style.display = "none";
    }

    function showContent() {
        placeholder.classList.add("hidden");
        loadingIndicator.classList.remove("visible");
        canvasWrapper.style.display = "flex";
        controlPanel.classList.add("visible");
        if (zoomIndicator) zoomIndicator.style.display = "flex";
        updateZoomIndicator();
    }

    // ── Canvas Sizing ─────────────────────────────────────────────

    function fitCanvas() {
        if (!state.image) return;

        var wrapperW = canvasWrapper.clientWidth || 800;
        var wrapperH = canvasWrapper.clientHeight || 600;

        // Set canvas size to match wrapper
        mainCanvas.width = wrapperW;
        mainCanvas.height = wrapperH;
        interactionCanvas.width = wrapperW;
        interactionCanvas.height = wrapperH;

        // Calculate scale to fit image
        var scaleX = wrapperW / state.image.naturalWidth;
        var scaleY = wrapperH / state.image.naturalHeight;
        state.scale = Math.min(scaleX, scaleY);
    }

    // ── Coordinate Transformations ─────────────────────────────────

    function clientToCanvas(clientX, clientY) {
        var rect = interactionCanvas.getBoundingClientRect();
        var cssX = (clientX - rect.left) * (interactionCanvas.width / rect.width);
        var cssY = (clientY - rect.top) * (interactionCanvas.height / rect.height);
        return {
            x: (cssX - state.panX) / (state.scale * state.zoom),
            y: (cssY - state.panY) / (state.scale * state.zoom)
        };
    }

    function canvasToScreen(x, y) {
        return {
            x: x * state.scale * state.zoom + state.panX,
            y: y * state.scale * state.zoom + state.panY
        };
    }

    // ── Zoom/Pan Helpers ───────────────────────────────────────────

    function clampPan() {
        if (state.zoom <= 1) {
            state.panX = 0;
            state.panY = 0;
            return;
        }
        var imgW = state.image.naturalWidth * state.scale * state.zoom;
        var imgH = state.image.naturalHeight * state.scale * state.zoom;
        var maxPanX = Math.max(0, imgW - mainCanvas.width);
        var maxPanY = Math.max(0, imgH - mainCanvas.height);
        state.panX = Math.max(-maxPanX, Math.min(0, state.panX));
        state.panY = Math.max(-maxPanY, Math.min(0, state.panY));
    }

    function zoomTo(newZoom, centerX, centerY) {
        newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));

        if (centerX == null || centerY == null) {
            centerX = mainCanvas.width / 2;
            centerY = mainCanvas.height / 2;
        }

        var oldZoom = state.zoom;
        state.panX = centerX - (centerX - state.panX) * (newZoom / oldZoom);
        state.panY = centerY - (centerY - state.panY) * (newZoom / oldZoom);
        state.zoom = newZoom;

        clampPan();
        updateZoomIndicator();
        render();
    }

    function resetView() {
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        updateZoomIndicator();
        render();
    }

    function updateZoomIndicator() {
        if (zoomValue) {
            zoomValue.textContent = Math.round(state.zoom * 100) + "%";
        }
    }

    // ── Rendering ─────────────────────────────────────────────────

    function render() {
        if (!state.image) return;

        // Clear main canvas
        mainCtx.setTransform(1, 0, 0, 1, 0, 0);
        mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

        // Clear interaction canvas
        interCtx.setTransform(1, 0, 0, 1, 0, 0);
        interCtx.clearRect(0, 0, interactionCanvas.width, interactionCanvas.height);

        // Apply zoom+pan transform
        mainCtx.setTransform(
            state.scale * state.zoom, 0, 0,
            state.scale * state.zoom,
            state.panX, state.panY
        );
        interCtx.setTransform(
            state.scale * state.zoom, 0, 0,
            state.scale * state.zoom,
            state.panX, state.panY
        );

        // Draw base image
        mainCtx.drawImage(state.image, 0, 0);

        // Draw layers (in order)
        for (var i = 0; i < state.layers.length; i++) {
            var layer = state.layers[i];
            if (!layer.visible) continue;

            var isSelected = layer.id === state.selectedLayerId;

            if (layer.type === LAYER_TYPES.RECTANGLE) {
                drawRectangle(mainCtx, layer.data, layer.color, isSelected);
            } else if (layer.type === LAYER_TYPES.MASK) {
                drawMask(mainCtx, layer.data, layer.color, isSelected);
            }
        }

        // Draw selection highlight on interaction canvas
        if (state.selectedLayerId != null) {
            var selectedLayer = findLayerById(state.selectedLayerId);
            if (selectedLayer && selectedLayer.visible) {
                drawSelectionHighlight(interCtx, selectedLayer);
            }
        }
    }

    function drawRectangle(ctx, data, color, isSelected) {
        ctx.strokeStyle = color || "#4a9eff";
        ctx.lineWidth = isSelected ? 3 / state.zoom : 2 / state.zoom;
        ctx.strokeRect(data.x, data.y, data.width, data.height);

        // Fill with semi-transparent color
        ctx.fillStyle = hexToRgba(color || "#4a9eff", 0.2);
        ctx.fillRect(data.x, data.y, data.width, data.height);
    }

    function drawMask(ctx, data, color, isSelected) {
        // Mask is an array of points defining a polygon
        if (!data.points || data.points.length < 3) return;

        ctx.beginPath();
        ctx.moveTo(data.points[0].x, data.points[0].y);
        for (var i = 1; i < data.points.length; i++) {
            ctx.lineTo(data.points[i].x, data.points[i].y);
        }
        ctx.closePath();

        ctx.fillStyle = hexToRgba(color || "#ff6b6b", 0.3);
        ctx.fill();

        ctx.strokeStyle = color || "#ff6b6b";
        ctx.lineWidth = isSelected ? 3 / state.zoom : 2 / state.zoom;
        ctx.stroke();
        
        // Draw vertex handles when selected
        if (isSelected && data.points.length >= 3) {
            drawPolygonHandles(ctx, data.points, color);
            // Draw edge hover indicator for adding points
            if (state.hoveredEdgeInfo && state.tool === "mask") {
                drawEdgeHoverIndicator(ctx, data.points, state.hoveredEdgeInfo);
            }
        }
    }
    
    function drawPolygonHandles(ctx, points, color) {
        var handleSize = 8 / state.zoom;
        var halfSize = handleSize / 2;
        
        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            var isHovered = state.hoveredPointIndex === i;
            
            // Draw handle
            ctx.fillStyle = isHovered ? "#fff" : (color || "#ff6b6b");
            ctx.strokeStyle = isHovered ? (color || "#ff6b6b") : "#fff";
            ctx.lineWidth = 1.5 / state.zoom;
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, halfSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }
    
    function drawEdgeHoverIndicator(ctx, points, edgeInfo) {
        if (!edgeInfo || edgeInfo.edgeIndex === null) return;
        
        var i = edgeInfo.edgeIndex;
        var p1 = points[i];
        var p2 = points[(i + 1) % points.length];
        
        // Highlight the edge
        ctx.strokeStyle = "#4a9eff";
        ctx.lineWidth = 3 / state.zoom;
        ctx.setLineDash([3 / state.zoom, 3 / state.zoom]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw a "+" symbol at the hovered position on the edge
        var pt = edgeInfo.pointOnEdge;
        var crossSize = 6 / state.zoom;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2 / state.zoom;
        ctx.beginPath();
        ctx.moveTo(pt.x - crossSize, pt.y);
        ctx.lineTo(pt.x + crossSize, pt.y);
        ctx.moveTo(pt.x, pt.y - crossSize);
        ctx.lineTo(pt.x, pt.y + crossSize);
        ctx.stroke();
        
        // Draw a circle around the "+" 
        ctx.strokeStyle = "#4a9eff";
        ctx.lineWidth = 1.5 / state.zoom;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, crossSize + 2 / state.zoom, 0, Math.PI * 2);
        ctx.stroke();
    }

    function drawSelectionHighlight(ctx, layer) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1 / state.zoom;
        ctx.setLineDash([5 / state.zoom, 5 / state.zoom]);

        if (layer.type === LAYER_TYPES.RECTANGLE) {
            var d = layer.data;
            ctx.strokeRect(d.x - 2/state.zoom, d.y - 2/state.zoom, 
                          d.width + 4/state.zoom, d.height + 4/state.zoom);
            ctx.setLineDash([]);
            // Draw resize handles for rectangle
            drawResizeHandles(ctx, layer.data);
        } else if (layer.type === LAYER_TYPES.MASK) {
            if (layer.data.points && layer.data.points.length >= 3) {
                ctx.beginPath();
                ctx.moveTo(layer.data.points[0].x, layer.data.points[0].y);
                for (var i = 1; i < layer.data.points.length; i++) {
                    ctx.lineTo(layer.data.points[i].x, layer.data.points[i].y);
                }
                ctx.closePath();
                ctx.stroke();
            }
            ctx.setLineDash([]);
            // Handles are drawn in drawMask for masks
        }
    }

    function drawResizeHandles(ctx, data) {
        var handleSize = 8 / state.zoom;
        var handles = [
            { x: data.x, y: data.y },                           // top-left
            { x: data.x + data.width / 2, y: data.y },          // top-center
            { x: data.x + data.width, y: data.y },              // top-right
            { x: data.x, y: data.y + data.height / 2 },         // middle-left
            { x: data.x + data.width, y: data.y + data.height / 2 }, // middle-right
            { x: data.x, y: data.y + data.height },             // bottom-left
            { x: data.x + data.width / 2, y: data.y + data.height }, // bottom-center
            { x: data.x + data.width, y: data.y + data.height } // bottom-right
        ];

        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#4a9eff";
        ctx.lineWidth = 1 / state.zoom;

        for (var i = 0; i < handles.length; i++) {
            ctx.fillRect(handles[i].x - handleSize/2, handles[i].y - handleSize/2, 
                        handleSize, handleSize);
            ctx.strokeRect(handles[i].x - handleSize/2, handles[i].y - handleSize/2, 
                          handleSize, handleSize);
        }
    }

    // ── Helper Functions ──────────────────────────────────────────

    function hexToRgba(hex, alpha) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
    }

    function findLayerById(id) {
        for (var i = 0; i < state.layers.length; i++) {
            if (state.layers[i].id === id) return state.layers[i];
        }
        return null;
    }

    function findLayerIndexById(id) {
        for (var i = 0; i < state.layers.length; i++) {
            if (state.layers[i].id === id) return i;
        }
        return -1;
    }

    function generateLayerName(type) {
        var count = 0;
        for (var i = 0; i < state.layers.length; i++) {
            if (state.layers[i].type === type) count++;
        }
        return (type === LAYER_TYPES.RECTANGLE ? "Rectangle " : "Mask ") + (count + 1);
    }

    function getRandomColor() {
        var colors = ["#4a9eff", "#ff6b6b", "#51cf66", "#ffd93d", "#a78bfa", "#ff8787", "#74c0fc"];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    // ── Control Panel ─────────────────────────────────────────────

    function renderControlPanel() {
        if (!state.image) {
            controlPanel.classList.remove("visible");
            return;
        }

        controlPanel.classList.add("visible");

        // Render layer list
        var html = "";
        for (var i = state.layers.length - 1; i >= 0; i--) {
            var layer = state.layers[i];
            var isSelected = layer.id === state.selectedLayerId;
            var icon = layer.type === LAYER_TYPES.RECTANGLE ? "&#9645;" : "&#9670;";

            html += '<div class="layer-item' + (isSelected ? ' active' : '') + '" data-id="' + layer.id + '">';
            html += '<span class="layer-icon">' + icon + '</span>';
            html += '<input type="color" class="layer-color-picker" data-id="' + layer.id + '" value="' + layer.color + '" title="Change color">';
            html += '<span class="layer-name">' + escapeHtml(layer.name) + '</span>';
            html += '<div class="layer-controls">';
            html += '<button class="layer-btn visibility-btn' + (layer.visible ? '' : ' hidden') + '" data-id="' + layer.id + '" title="Toggle visibility">' + (layer.visible ? '&#128065;' : '&#128065;&#8205;&#128488;') + '</button>';
            html += '<button class="layer-btn delete-btn" data-id="' + layer.id + '" title="Delete">&#128465;</button>';
            html += '</div>';
            html += '</div>';
        }

        if (state.layers.length === 0) {
            html = '<div style="padding: 20px; text-align: center; color: #888; font-size: 12px;">No layers yet.<br>Use the toolbar to add rectangles or masks.</div>';
        }

        layerList.innerHTML = html;

        // Bind events
        bindLayerEvents();
    }

    function bindLayerEvents() {
        // Layer item click (select)
        var items = layerList.querySelectorAll(".layer-item");
        for (var i = 0; i < items.length; i++) {
            items[i].addEventListener("click", function (e) {
                if (e.target.closest(".layer-controls") || e.target.classList.contains("layer-color-picker")) return;
                var id = parseInt(this.getAttribute("data-id"), 10);
                selectLayer(id);
            });
        }

        // Color picker in layer list
        var colorPickers = layerList.querySelectorAll(".layer-color-picker");
        for (var i = 0; i < colorPickers.length; i++) {
            colorPickers[i].addEventListener("click", function (e) {
                e.stopPropagation();
            });
            colorPickers[i].addEventListener("input", function (e) {
                e.stopPropagation();
                var id = parseInt(this.getAttribute("data-id"), 10);
                var layer = findLayerById(id);
                if (layer) {
                    layer.color = this.value;
                    render();
                }
            });
        }

        // Visibility toggle
        var visBtns = layerList.querySelectorAll(".visibility-btn");
        for (var i = 0; i < visBtns.length; i++) {
            visBtns[i].addEventListener("click", function (e) {
                e.stopPropagation();
                var id = parseInt(this.getAttribute("data-id"), 10);
                toggleLayerVisibility(id);
            });
        }

        // Delete button
        var delBtns = layerList.querySelectorAll(".delete-btn");
        for (var i = 0; i < delBtns.length; i++) {
            delBtns[i].addEventListener("click", function (e) {
                e.stopPropagation();
                var id = parseInt(this.getAttribute("data-id"), 10);
                deleteLayer(id);
            });
        }
    }

    function escapeHtml(text) {
        var div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // ── Layer Operations ──────────────────────────────────────────

    function selectLayer(id) {
        state.selectedLayerId = id;
        render();
        renderControlPanel();
    }

    function toggleLayerVisibility(id) {
        var layer = findLayerById(id);
        if (layer) {
            layer.visible = !layer.visible;
            render();
            renderControlPanel();
        }
    }

    function deleteLayer(id) {
        var idx = findLayerIndexById(id);
        if (idx >= 0) {
            state.layers.splice(idx, 1);
            if (state.selectedLayerId === id) {
                state.selectedLayerId = null;
            }
            render();
            renderControlPanel();
        }
    }

    function clearAllLayers() {
        state.layers = [];
        state.selectedLayerId = null;
        render();
        renderControlPanel();
    }

    function addRectangle(x, y, width, height) {
        var layer = {
            id: state.nextLayerId++,
            type: LAYER_TYPES.RECTANGLE,
            name: generateLayerName(LAYER_TYPES.RECTANGLE),
            visible: true,
            color: getRandomColor(),
            data: { x: x, y: y, width: width, height: height }
        };
        state.layers.push(layer);
        state.selectedLayerId = layer.id;
        render();
        renderControlPanel();
        // Auto switch to select tool after adding layer
        setTool("select");
        return layer;
    }

    function addMask(points) {
        var layer = {
            id: state.nextLayerId++,
            type: LAYER_TYPES.MASK,
            name: generateLayerName(LAYER_TYPES.MASK),
            visible: true,
            color: getRandomColor(),
            data: { points: points }
        };
        state.layers.push(layer);
        state.selectedLayerId = layer.id;
        render();
        renderControlPanel();
        // Auto switch to select tool after adding layer
        setTool("select");
        return layer;
    }

    // ── Tool Selection ────────────────────────────────────────────

    function setTool(toolName) {
        state.tool = toolName;

        // Update button states
        selectBtn.classList.toggle("active", toolName === "select");
        rectBtn.classList.toggle("active", toolName === "rect");
        maskBtn.classList.toggle("active", toolName === "mask");

        // Update cursor
        updateCursor();
    }

    function updateCursor() {
        interactionCanvas.classList.remove("grab", "grabbing", "crosshair", "move");

        if (state.tool === "select") {
            interactionCanvas.classList.add(state.isPanning ? "grabbing" : "grab");
        } else if (state.tool === "rect" || state.tool === "mask") {
            interactionCanvas.classList.add("crosshair");
        }
    }

    function updateCursorOnHover(clientX, clientY) {
        if (state.isPanning || state.isDraggingLayer) return;
        
        var pt = clientToCanvas(clientX, clientY);
        var selectedLayer = state.selectedLayerId ? findLayerById(state.selectedLayerId) : null;
        
        // Helper function to remove all cursor classes
        function removeAllCursorClasses() {
            interactionCanvas.classList.remove("grab", "grabbing", "crosshair", "move", 
                "nwse-resize", "ns-resize", "nesw-resize", "ew-resize");
        }
        
        // Polygon mask editing cursor
        if (state.tool === "mask") {
            removeAllCursorClasses();
            if (state.isDrawingPolygon) {
                // Check if near first point for closing
                if (state.polygonPoints.length >= 3) {
                    var firstPoint = state.polygonPoints[0];
                    var dist = Math.sqrt(Math.pow(pt.x - firstPoint.x, 2) + Math.pow(pt.y - firstPoint.y, 2));
                    if (dist < state.polygonCloseThreshold / (state.scale * state.zoom)) {
                        interactionCanvas.classList.add("pointer");
                        return;
                    }
                }
            }
            // Check if hovering over polygon vertex handle
            if (selectedLayer && selectedLayer.type === LAYER_TYPES.MASK && selectedLayer.data.points) {
                var pointIndex = getPolygonPointAt(pt.x, pt.y, selectedLayer.data.points);
                if (pointIndex !== null) {
                    interactionCanvas.classList.add("move");
                    return;
                }
            }
            interactionCanvas.classList.add("crosshair");
            return;
        }
        
        if (state.tool !== "select") return;
        
        if (selectedLayer && selectedLayer.type === LAYER_TYPES.RECTANGLE) {
            var handleIndex = getResizeHandleAt(pt.x, pt.y, selectedLayer);
            if (handleIndex !== null) {
                // Set cursor based on handle position
                var cursorClass = "default";
                switch (handleIndex) {
                    case 0: // top-left
                    case 7: // bottom-right
                        cursorClass = "nwse-resize";
                        break;
                    case 1: // top-center
                    case 6: // bottom-center
                        cursorClass = "ns-resize";
                        break;
                    case 2: // top-right
                    case 5: // bottom-left
                        cursorClass = "nesw-resize";
                        break;
                    case 3: // middle-left
                    case 4: // middle-right
                        cursorClass = "ew-resize";
                        break;
                }
                removeAllCursorClasses();
                interactionCanvas.classList.add(cursorClass);
                return;
            }
            
            // Check if inside the rectangle (for moving)
            var data = selectedLayer.data;
            if (pt.x >= data.x && pt.x <= data.x + data.width &&
                pt.y >= data.y && pt.y <= data.y + data.height) {
                removeAllCursorClasses();
                interactionCanvas.classList.add("move");
                return;
            }
        }
        
        // Check if hovering over polygon vertex handle for select tool
        if (selectedLayer && selectedLayer.type === LAYER_TYPES.MASK && selectedLayer.data.points) {
            var pointIndex = getPolygonPointAt(pt.x, pt.y, selectedLayer.data.points);
            if (pointIndex !== null) {
                removeAllCursorClasses();
                interactionCanvas.classList.add("move");
                return;
            }
        }
        
        // Check if hovering over any layer (for selecting)
        var hoveredLayer = findLayerAt(pt.x, pt.y);
        if (hoveredLayer) {
            removeAllCursorClasses();
            interactionCanvas.classList.add("pointer");
            return;
        }
        
        // Default cursor for select tool
        removeAllCursorClasses();
        interactionCanvas.classList.add("grab");
    }

    // ── Toolbar Event Handlers ────────────────────────────────────

    // Toolbar buttons
    if (selectBtn) selectBtn.addEventListener("click", function () { setTool("select"); });
    if (rectBtn) rectBtn.addEventListener("click", function () { setTool("rect"); });
    if (maskBtn) maskBtn.addEventListener("click", function () { setTool("mask"); });

    // Control panel buttons
    if (addRectBtn) addRectBtn.addEventListener("click", function () {
        // Add a default rectangle in center
        var x = state.image ? state.image.naturalWidth / 2 - 50 : 100;
        var y = state.image ? state.image.naturalHeight / 2 - 50 : 100;
        addRectangle(x, y, 100, 100);
    });

    if (addMaskBtn) addMaskBtn.addEventListener("click", function () {
        // Add a sample mask
        var cx = state.image ? state.image.naturalWidth / 2 : 200;
        var cy = state.image ? state.image.naturalHeight / 2 : 200;
        var r = 80;
        var points = [];
        for (var i = 0; i < 8; i++) {
            var angle = (i / 8) * Math.PI * 2;
            points.push({
                x: cx + Math.cos(angle) * r,
                y: cy + Math.sin(angle) * r
            });
        }
        addMask(points);
    });

    if (clearAllBtn) clearAllBtn.addEventListener("click", function () {
        if (confirm("清除所有图层?")) {
            clearAllLayers();
        }
    });

    if (resetViewBtn) resetViewBtn.addEventListener("click", function () {
        resetView();
    });

    if (zoomResetBtn) zoomResetBtn.addEventListener("click", function () {
        resetView();
    });

    if (exportJsonBtn) exportJsonBtn.addEventListener("click", function () {
        exportData();
    });

    function exportData() {
        var data = {
            image: state.image ? state.image.src : null,
            layers: state.layers.map(function (l) {
                return {
                    type: l.type,
                    name: l.name,
                    color: l.color,
                    data: l.data
                };
            })
        };
        console.log("Export data:", data);
        alert("数据已导出到控制台。");
    }

    // ── Canvas Mouse Interaction ──────────────────────────────────

    interactionCanvas.addEventListener("mousedown", function (e) {
        if (!state.image) return;
        if (e.button !== 0) return;

        var pt = clientToCanvas(e.clientX, e.clientY);

        if (state.tool === "select") {
            var selectedLayer = state.selectedLayerId ? findLayerById(state.selectedLayerId) : null;
            
            // Check if clicking on a polygon point handle (for editing mask vertices)
            if (selectedLayer && selectedLayer.type === LAYER_TYPES.MASK && selectedLayer.data.points) {
                var pointIndex = getPolygonPointAt(pt.x, pt.y, selectedLayer.data.points);
                if (pointIndex !== null) {
                    state.editingPointIndex = pointIndex;
                    state.isDraggingLayer = true;
                    state.dragStartX = pt.x;
                    state.dragStartY = pt.y;
                    state.dragStartData = JSON.parse(JSON.stringify(selectedLayer.data.points));
                    return;
                }
                
                // Check if clicking on an edge to add a point
                if (state.hoveredEdgeInfo) {
                    addPointToPolygonAtEdge(selectedLayer, state.hoveredEdgeInfo.edgeIndex, pt);
                    return;
                }
            }
            
            // Check if clicking on a resize handle (for rectangles)
            if (selectedLayer && selectedLayer.type === LAYER_TYPES.RECTANGLE) {
                state.resizeHandle = getResizeHandleAt(pt.x, pt.y, selectedLayer);
                if (state.resizeHandle !== null) {
                    state.isDraggingLayer = true;
                    state.dragStartX = pt.x;
                    state.dragStartY = pt.y;
                    state.dragStartData = {
                        x: selectedLayer.data.x,
                        y: selectedLayer.data.y,
                        width: selectedLayer.data.width,
                        height: selectedLayer.data.height
                    };
                    return;
                }
            }

            // Check if clicking on a layer
            var hitLayer = findLayerAt(pt.x, pt.y);
            if (hitLayer) {
                selectLayer(hitLayer.id);
                
                // Start dragging based on layer type
                if (hitLayer.type === LAYER_TYPES.MASK) {
                    // For masks, drag entire polygon
                    state.isDraggingPolygonMask = true;
                    state.isDraggingLayer = true;
                    state.dragStartX = pt.x;
                    state.dragStartY = pt.y;
                    state.dragPolygonStartData = JSON.parse(JSON.stringify(hitLayer.data.points));
                } else {
                    // For rectangles, use existing drag logic
                    state.isDraggingLayer = true;
                    state.dragStartX = pt.x;
                    state.dragStartY = pt.y;
                    state.dragStartData = {
                        x: hitLayer.data.x,
                        y: hitLayer.data.y,
                        width: hitLayer.data.width,
                        height: hitLayer.data.height
                    };
                }
            } else {
                // Start panning
                state.isPanning = true;
                state.didDrag = false;
                state.panStartX = e.clientX;
                state.panStartY = e.clientY;
                state.panStartPanX = state.panX;
                state.panStartPanY = state.panY;
                updateCursor();
            }
        } else if (state.tool === "rect") {
            state.isDrawing = true;
            state.drawStart = pt;
        } else if (state.tool === "mask") {
            // Polygon drawing mode
            handlePolygonMouseDown(pt);
        }
    });

    window.addEventListener("mousemove", function (e) {
        if (!state.image) return;

        if (state.isPanning) {
            var dx = e.clientX - state.panStartX;
            var dy = e.clientY - state.panStartY;

            if (!state.didDrag && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                state.didDrag = true;
            }

            var rect = interactionCanvas.getBoundingClientRect();
            state.panX = state.panStartPanX + dx * (interactionCanvas.width / rect.width);
            state.panY = state.panStartPanY + dy * (interactionCanvas.height / rect.height);
            clampPan();
            render();
            return;
        }

        if (state.isDraggingLayer && state.selectedLayerId) {
            var pt = clientToCanvas(e.clientX, e.clientY);
            var layer = findLayerById(state.selectedLayerId);
            
            if (layer && layer.type === LAYER_TYPES.RECTANGLE) {
                var dx = pt.x - state.dragStartX;
                var dy = pt.y - state.dragStartY;
                
                if (state.resizeHandle !== null) {
                    // Resize the rectangle based on which handle is being dragged
                    var newData = resizeRectangle(
                        state.dragStartData, 
                        state.resizeHandle, 
                        dx, dy
                    );
                    
                    // Update layer data
                    layer.data.x = newData.x;
                    layer.data.y = newData.y;
                    layer.data.width = newData.width;
                    layer.data.height = newData.height;
                } else {
                    // Move the rectangle
                    layer.data.x = state.dragStartData.x + dx;
                    layer.data.y = state.dragStartData.y + dy;
                }
                
                render();
                renderControlPanel();
            } else if (layer && layer.type === LAYER_TYPES.MASK) {
                var dx = pt.x - state.dragStartX;
                var dy = pt.y - state.dragStartY;
                
                if (state.editingPointIndex !== null) {
                    // Drag a single vertex point
                    layer.data.points[state.editingPointIndex].x = state.dragStartData[state.editingPointIndex].x + dx;
                    layer.data.points[state.editingPointIndex].y = state.dragStartData[state.editingPointIndex].y + dy;
                    render();
                } else if (state.isDraggingPolygonMask && state.dragPolygonStartData) {
                    // Drag entire polygon mask
                    for (var i = 0; i < layer.data.points.length; i++) {
                        layer.data.points[i].x = state.dragPolygonStartData[i].x + dx;
                        layer.data.points[i].y = state.dragPolygonStartData[i].y + dy;
                    }
                    render();
                }
            }
            return;
        }

        if (state.isDrawing && state.tool === "rect") {
            // Draw preview rectangle
            var pt = clientToCanvas(e.clientX, e.clientY);
            render(); // Clear previous preview

            var x = Math.min(state.drawStart.x, pt.x);
            var y = Math.min(state.drawStart.y, pt.y);
            var w = Math.abs(pt.x - state.drawStart.x);
            var h = Math.abs(pt.y - state.drawStart.y);

            interCtx.save();
            interCtx.setTransform(
                state.scale * state.zoom, 0, 0,
                state.scale * state.zoom,
                state.panX, state.panY
            );
            interCtx.strokeStyle = "#4a9eff";
            interCtx.lineWidth = 2 / state.zoom;
            interCtx.setLineDash([5 / state.zoom, 5 / state.zoom]);
            interCtx.strokeRect(x, y, w, h);
            interCtx.restore();
        }

        // Handle polygon drawing and editing
        if (state.tool === "mask") {
            handlePolygonMouseMove(clientToCanvas(e.clientX, e.clientY));
        }

        // Update cursor based on hover state
        updateCursorOnHover(e.clientX, e.clientY);

        // Tooltip
        var pt = clientToCanvas(e.clientX, e.clientY);
        var hitLayer = findLayerAt(pt.x, pt.y);
        if (hitLayer) {
            tooltip.textContent = hitLayer.name;
            tooltip.classList.add("visible");
            var rect = container.getBoundingClientRect();
            tooltip.style.left = (e.clientX - rect.left + 12) + "px";
            tooltip.style.top = (e.clientY - rect.top - 8) + "px";
        } else {
            tooltip.classList.remove("visible");
        }
    });

    window.addEventListener("mouseup", function (e) {
        if (!state.image) return;

        if (state.isPanning) {
            state.isPanning = false;
            updateCursor();
            // Update cursor based on current mouse position after panning
            updateCursorOnHover(e.clientX, e.clientY);

            if (!state.didDrag) {
                // Click without drag - deselect
                var pt = clientToCanvas(e.clientX, e.clientY);
                var hitLayer = findLayerAt(pt.x, pt.y);
                if (!hitLayer) {
                    state.selectedLayerId = null;
                    render();
                    renderControlPanel();
                }
            }
        }

        if (state.isDraggingLayer) {
            state.isDraggingLayer = false;
            state.resizeHandle = null;
            state.dragStartData = null;
            state.editingPointIndex = null;
            state.isDraggingPolygonMask = false;
            state.dragPolygonStartData = null;
            updateCursor();
            // Update cursor based on current mouse position after dragging
            updateCursorOnHover(e.clientX, e.clientY);
        }

        if (state.isDrawing && state.tool === "rect") {
            state.isDrawing = false;
            var pt = clientToCanvas(e.clientX, e.clientY);

            var x = Math.min(state.drawStart.x, pt.x);
            var y = Math.min(state.drawStart.y, pt.y);
            var w = Math.abs(pt.x - state.drawStart.x);
            var h = Math.abs(pt.y - state.drawStart.y);

            if (w > 5 && h > 5) {
                addRectangle(x, y, w, h);
            } else {
                render(); // Clear preview
            }
            // Update cursor after drawing
            updateCursorOnHover(e.clientX, e.clientY);
        }

        // Handle polygon editing mouseup
        if (state.tool === "mask") {
            handlePolygonMouseUp(clientToCanvas(e.clientX, e.clientY));
        }
    });

    // Double-click to complete polygon
    interactionCanvas.addEventListener("dblclick", function (e) {
        if (!state.image) return;
        if (state.tool !== "mask") return;
        
        e.preventDefault();
        
        if (state.isDrawingPolygon && state.polygonPoints.length >= 3) {
            finishPolygon();
        }
    });

    function findLayerById(id) {
        for (var i = 0; i < state.layers.length; i++) {
            if (state.layers[i].id === id) {
                return state.layers[i];
            }
        }
        return null;
    }

    function findLayerAt(x, y) {
        // Check layers in reverse order (topmost first)
        for (var i = state.layers.length - 1; i >= 0; i--) {
            var layer = state.layers[i];
            if (!layer.visible) continue;

            if (layer.type === LAYER_TYPES.RECTANGLE) {
                var d = layer.data;
                if (x >= d.x && x <= d.x + d.width && y >= d.y && y <= d.y + d.height) {
                    return layer;
                }
            } else if (layer.type === LAYER_TYPES.MASK) {
                // Polygon hit test for masks
                if (layer.data.points && layer.data.points.length >= 3) {
                    if (isPointInPolygon(x, y, layer.data.points)) {
                        return layer;
                    }
                }
            }
        }
        return null;
    }

    function getResizeHandleAt(x, y, layer) {
        if (!layer || layer.type !== LAYER_TYPES.RECTANGLE) return null;
        
        var data = layer.data;
        var handleSize = 8 / state.zoom;
        var handleHalfSize = handleSize / 2;
        
        var handles = [
            { x: data.x, y: data.y },                           // top-left
            { x: data.x + data.width / 2, y: data.y },          // top-center
            { x: data.x + data.width, y: data.y },              // top-right
            { x: data.x, y: data.y + data.height / 2 },         // middle-left
            { x: data.x + data.width, y: data.y + data.height / 2 }, // middle-right
            { x: data.x, y: data.y + data.height },             // bottom-left
            { x: data.x + data.width / 2, y: data.y + data.height }, // bottom-center
            { x: data.x + data.width, y: data.y + data.height } // bottom-right
        ];
        
        for (var i = 0; i < handles.length; i++) {
            var hx = handles[i].x;
            var hy = handles[i].y;
            if (x >= hx - handleHalfSize && x <= hx + handleHalfSize &&
                y >= hy - handleHalfSize && y <= hy + handleHalfSize) {
                return i;
            }
        }
        return null;
    }

    function resizeRectangle(originalData, handleIndex, dx, dy) {
        var result = {
            x: originalData.x,
            y: originalData.y,
            width: originalData.width,
            height: originalData.height
        };
        
        // Minimum size constraint
        var minSize = 10;
        
        switch (handleIndex) {
            case 0: // top-left
                result.x = originalData.x + dx;
                result.y = originalData.y + dy;
                result.width = originalData.width - dx;
                result.height = originalData.height - dy;
                break;
            case 1: // top-center
                result.y = originalData.y + dy;
                result.height = originalData.height - dy;
                break;
            case 2: // top-right
                result.y = originalData.y + dy;
                result.width = originalData.width + dx;
                result.height = originalData.height - dy;
                break;
            case 3: // middle-left
                result.x = originalData.x + dx;
                result.width = originalData.width - dx;
                break;
            case 4: // middle-right
                result.width = originalData.width + dx;
                break;
            case 5: // bottom-left
                result.x = originalData.x + dx;
                result.width = originalData.width - dx;
                result.height = originalData.height + dy;
                break;
            case 6: // bottom-center
                result.height = originalData.height + dy;
                break;
            case 7: // bottom-right
                result.width = originalData.width + dx;
                result.height = originalData.height + dy;
                break;
        }
        
        // Ensure minimum size
        if (result.width < minSize) {
            if (handleIndex === 0 || handleIndex === 3 || handleIndex === 5) {
                result.x = originalData.x + originalData.width - minSize;
            }
            result.width = minSize;
        }
        
        if (result.height < minSize) {
            if (handleIndex === 0 || handleIndex === 1 || handleIndex === 2) {
                result.y = originalData.y + originalData.height - minSize;
            }
            result.height = minSize;
        }
        
        return result;
    }

    // ── Polygon Drawing and Editing Functions ───────────────────────

    function handlePolygonMouseDown(pt) {
        var selectedLayer = state.selectedLayerId ? findLayerById(state.selectedLayerId) : null;
        
        // Check if clicking on a polygon vertex handle (for editing existing polygon)
        if (selectedLayer && selectedLayer.type === LAYER_TYPES.MASK && selectedLayer.data.points) {
            var pointIndex = getPolygonPointAt(pt.x, pt.y, selectedLayer.data.points);
            if (pointIndex !== null) {
                // Start dragging the point
                state.editingPointIndex = pointIndex;
                state.isDraggingLayer = true;
                state.dragStartX = pt.x;
                state.dragStartY = pt.y;
                state.dragStartData = JSON.parse(JSON.stringify(selectedLayer.data.points));
                return;
            }
            
            // Check if clicking on an edge to add a point
            if (state.hoveredEdgeInfo) {
                addPointToPolygonAtEdge(selectedLayer, state.hoveredEdgeInfo.edgeIndex, pt);
                return;
            }
            
            // Check if clicking inside the polygon (for moving entire polygon)
            if (isPointInPolygon(pt.x, pt.y, selectedLayer.data.points)) {
                state.isDraggingPolygonMask = true;
                state.isDraggingLayer = true;
                state.dragStartX = pt.x;
                state.dragStartY = pt.y;
                state.dragPolygonStartData = JSON.parse(JSON.stringify(selectedLayer.data.points));
                return;
            }
        }
        
        // Check if clicking on any mask layer (to select it first)
        var hitLayer = findLayerAt(pt.x, pt.y);
        if (hitLayer && hitLayer.type === LAYER_TYPES.MASK) {
            selectLayer(hitLayer.id);
            // Start dragging the entire polygon
            state.isDraggingPolygonMask = true;
            state.isDraggingLayer = true;
            state.dragStartX = pt.x;
            state.dragStartY = pt.y;
            state.dragPolygonStartData = JSON.parse(JSON.stringify(hitLayer.data.points));
            return;
        }
        
        // If already drawing a polygon, add a point
        if (state.isDrawingPolygon) {
            // Check if clicking near the first point to close the polygon
            if (state.polygonPoints.length >= 3) {
                var firstPoint = state.polygonPoints[0];
                var dist = Math.sqrt(Math.pow(pt.x - firstPoint.x, 2) + Math.pow(pt.y - firstPoint.y, 2));
                if (dist < state.polygonCloseThreshold / (state.scale * state.zoom)) {
                    // Close the polygon
                    finishPolygon();
                    return;
                }
            }
            // Add a new point
            state.polygonPoints.push({ x: pt.x, y: pt.y });
            render();
        } else {
            // Start a new polygon
            state.isDrawingPolygon = true;
            state.polygonPoints = [{ x: pt.x, y: pt.y }];
            render();
        }
    }

    function handlePolygonMouseMove(pt) {
        // Update hovered point index for visual feedback
        var selectedLayer = state.selectedLayerId ? findLayerById(state.selectedLayerId) : null;
        if (selectedLayer && selectedLayer.type === LAYER_TYPES.MASK && selectedLayer.data.points) {
            state.hoveredPointIndex = getPolygonPointAt(pt.x, pt.y, selectedLayer.data.points);
            
            // Update edge hover info if not hovering over a point
            if (state.hoveredPointIndex === null && !state.isDraggingLayer) {
                state.hoveredEdgeInfo = getPolygonEdgeAt(pt.x, pt.y, selectedLayer.data.points);
            } else {
                state.hoveredEdgeInfo = null;
            }
        } else {
            state.hoveredPointIndex = null;
            state.hoveredEdgeInfo = null;
        }
        
        // Handle entire polygon dragging
        if (state.isDraggingPolygonMask && state.dragPolygonStartData && selectedLayer) {
            var dx = pt.x - state.dragStartX;
            var dy = pt.y - state.dragStartY;
            for (var i = 0; i < selectedLayer.data.points.length; i++) {
                selectedLayer.data.points[i].x = state.dragPolygonStartData[i].x + dx;
                selectedLayer.data.points[i].y = state.dragPolygonStartData[i].y + dy;
            }
            render();
            return;
        }
        
        // Handle point dragging
        if (state.isDraggingLayer && state.editingPointIndex !== null && selectedLayer) {
            var points = selectedLayer.data.points;
            points[state.editingPointIndex].x = pt.x;
            points[state.editingPointIndex].y = pt.y;
            render();
            return;
        }
        
        // Draw polygon preview while drawing
        if (state.isDrawingPolygon && state.polygonPoints.length > 0) {
            render();
            
            // Draw preview line to current mouse position
            interCtx.save();
            interCtx.setTransform(
                state.scale * state.zoom, 0, 0,
                state.scale * state.zoom,
                state.panX, state.panY
            );
            
            // Draw existing polygon
            interCtx.beginPath();
            interCtx.moveTo(state.polygonPoints[0].x, state.polygonPoints[0].y);
            for (var i = 1; i < state.polygonPoints.length; i++) {
                interCtx.lineTo(state.polygonPoints[i].x, state.polygonPoints[i].y);
            }
            
            // Draw line to current mouse position
            interCtx.lineTo(pt.x, pt.y);
            
            // Draw preview line back to first point if close enough
            if (state.polygonPoints.length >= 3) {
                var firstPoint = state.polygonPoints[0];
                var dist = Math.sqrt(Math.pow(pt.x - firstPoint.x, 2) + Math.pow(pt.y - firstPoint.y, 2));
                if (dist < state.polygonCloseThreshold / (state.scale * state.zoom)) {
                    interCtx.lineTo(firstPoint.x, firstPoint.y);
                    interCtx.fillStyle = "rgba(74, 158, 255, 0.2)";
                    interCtx.fill();
                }
            }
            
            interCtx.strokeStyle = "#4a9eff";
            interCtx.lineWidth = 2 / state.zoom;
            interCtx.setLineDash([5 / state.zoom, 5 / state.zoom]);
            interCtx.stroke();
            
            // Draw points
            var handleSize = 8 / state.zoom;
            interCtx.fillStyle = "#4a9eff";
            for (var i = 0; i < state.polygonPoints.length; i++) {
                interCtx.beginPath();
                interCtx.arc(state.polygonPoints[i].x, state.polygonPoints[i].y, handleSize / 2, 0, Math.PI * 2);
                interCtx.fill();
            }
            
            interCtx.restore();
        }
    }

    function handlePolygonMouseUp(pt) {
        if (state.isDraggingPolygonMask) {
            state.isDraggingPolygonMask = false;
            state.isDraggingLayer = false;
            state.dragPolygonStartData = null;
            render();
            return;
        }
        
        if (state.isDraggingLayer && state.editingPointIndex !== null) {
            state.isDraggingLayer = false;
            state.editingPointIndex = null;
            state.dragStartData = null;
            render();
        }
    }

    function finishPolygon() {
        if (state.polygonPoints.length >= 3) {
            addMask(state.polygonPoints.slice());
        }
        state.isDrawingPolygon = false;
        state.polygonPoints = [];
        render();
    }

    function cancelPolygon() {
        state.isDrawingPolygon = false;
        state.polygonPoints = [];
        render();
    }

    function getPolygonPointAt(x, y, points) {
        var handleSize = 12 / state.zoom; // Slightly larger for easier selection
        for (var i = 0; i < points.length; i++) {
            var dist = Math.sqrt(Math.pow(x - points[i].x, 2) + Math.pow(y - points[i].y, 2));
            if (dist < handleSize) {
                return i;
            }
        }
        return null;
    }

    function isPointInPolygon(x, y, points) {
        var inside = false;
        for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
            var xi = points[i].x, yi = points[i].y;
            var xj = points[j].x, yj = points[j].y;
            
            var intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function addPointToPolygon(layer, x, y) {
        if (!layer || layer.type !== LAYER_TYPES.MASK || !layer.data.points) return;
        
        var points = layer.data.points;
        var insertIndex = points.length;
        
        // Find the closest edge to insert the point
        var minDist = Infinity;
        for (var i = 0; i < points.length; i++) {
            var j = (i + 1) % points.length;
            var dist = pointToLineDistance(x, y, points[i], points[j]);
            if (dist < minDist) {
                minDist = dist;
                insertIndex = j;
            }
        }
        
        // Insert the new point
        points.splice(insertIndex, 0, { x: x, y: y });
        render();
        renderControlPanel();
    }

    function addPointToPolygonAtEdge(layer, edgeIndex, pt) {
        if (!layer || layer.type !== LAYER_TYPES.MASK || !layer.data.points) return;
        
        var points = layer.data.points;
        var insertIndex = (edgeIndex + 1) % points.length;
        
        // Calculate the point on the edge
        var p1 = points[edgeIndex];
        var p2 = points[(edgeIndex + 1) % points.length];
        var newPoint = projectPointOnLine(pt.x, pt.y, p1, p2);
        
        // Insert the new point
        points.splice(insertIndex, 0, newPoint);
        state.hoveredEdgeInfo = null;
        render();
        renderControlPanel();
    }

    function removePointFromPolygon(layer, index) {
        if (!layer || layer.type !== LAYER_TYPES.MASK || !layer.data.points) return;
        if (layer.data.points.length <= 3) return; // Minimum 3 points for a polygon
        
        layer.data.points.splice(index, 1);
        render();
        renderControlPanel();
    }

    function getPolygonEdgeAt(x, y, points) {
        var threshold = 8 / state.zoom;
        var minDist = Infinity;
        var result = null;
        
        for (var i = 0; i < points.length; i++) {
            var j = (i + 1) % points.length;
            var dist = pointToLineDistance(x, y, points[i], points[j]);
            if (dist < threshold && dist < minDist) {
                // Check if the point is within the edge segment
                var projection = projectPointOnLine(x, y, points[i], points[j]);
                var segLength = Math.sqrt(
                    Math.pow(points[j].x - points[i].x, 2) + 
                    Math.pow(points[j].y - points[i].y, 2)
                );
                var distFromP1 = Math.sqrt(
                    Math.pow(projection.x - points[i].x, 2) + 
                    Math.pow(projection.y - points[i].y, 2)
                );
                
                // Only consider points within the edge segment (with small margin)
                if (distFromP1 >= -threshold && distFromP1 <= segLength + threshold) {
                    minDist = dist;
                    result = { edgeIndex: i, pointOnEdge: projection };
                }
            }
        }
        return result;
    }

    function projectPointOnLine(px, py, p1, p2) {
        var A = px - p1.x;
        var B = py - p1.y;
        var C = p2.x - p1.x;
        var D = p2.y - p1.y;
        
        var dot = A * C + B * D;
        var lenSq = C * C + D * D;
        var param = lenSq !== 0 ? dot / lenSq : 0;
        
        // Clamp param to [0, 1] to stay on the segment
        param = Math.max(0, Math.min(1, param));
        
        return {
            x: p1.x + param * C,
            y: p1.y + param * D
        };
    }

    function pointToLineDistance(px, py, p1, p2) {
        var A = px - p1.x;
        var B = py - p1.y;
        var C = p2.x - p1.x;
        var D = p2.y - p1.y;
        
        var dot = A * C + B * D;
        var lenSq = C * C + D * D;
        var param = lenSq !== 0 ? dot / lenSq : -1;
        
        var xx, yy;
        
        if (param < 0) {
            xx = p1.x;
            yy = p1.y;
        } else if (param > 1) {
            xx = p2.x;
            yy = p2.y;
        } else {
            xx = p1.x + param * C;
            yy = p1.y + param * D;
        }
        
        var dx = px - xx;
        var dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ── Wheel Zoom ─────────────────────────────────────────────────

    interactionCanvas.addEventListener("wheel", function (e) {
        if (!state.image) return;
        e.preventDefault();

        var delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 16;
        else if (e.deltaMode === 2) delta *= 100;

        var newZoom = state.zoom * (1 - delta * ZOOM_SENSITIVITY);

        var rect = interactionCanvas.getBoundingClientRect();
        var mx = (e.clientX - rect.left) * (interactionCanvas.width / rect.width);
        var my = (e.clientY - rect.top) * (interactionCanvas.height / rect.height);

        zoomTo(newZoom, mx, my);
    }, { passive: false });

    // ── Double-click to Reset Zoom ──────────────────────────────

    interactionCanvas.addEventListener("dblclick", function (e) {
        if (!state.image) return;
        e.preventDefault();
        resetView();
    });

    // ── Touch Support ─────────────────────────────────────────────

    var touchState = { lastDist: 0, lastCenterX: 0, lastCenterY: 0 };

    function getTouchDistance(t1, t2) {
        var dx = t1.clientX - t2.clientX;
        var dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(t1, t2) {
        return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
    }

    interactionCanvas.addEventListener("touchstart", function (e) {
        if (!state.image) return;
        e.preventDefault();

        if (e.touches.length === 1) {
            var pt = clientToCanvas(e.touches[0].clientX, e.touches[0].clientY);
            var hitLayer = findLayerAt(pt.x, pt.y);

            if (hitLayer) {
                selectLayer(hitLayer.id);
            } else {
                state.isPanning = true;
                state.panStartX = e.touches[0].clientX;
                state.panStartY = e.touches[0].clientY;
                state.panStartPanX = state.panX;
                state.panStartPanY = state.panY;
            }
        } else if (e.touches.length === 2) {
            state.isPanning = false;
            touchState.lastDist = getTouchDistance(e.touches[0], e.touches[1]);
            var center = getTouchCenter(e.touches[0], e.touches[1]);
            touchState.lastCenterX = center.x;
            touchState.lastCenterY = center.y;
        }
    }, { passive: false });

    interactionCanvas.addEventListener("touchmove", function (e) {
        if (!state.image) return;
        e.preventDefault();

        if (e.touches.length === 1 && state.isPanning) {
            var dx = e.touches[0].clientX - state.panStartX;
            var dy = e.touches[0].clientY - state.panStartY;

            var rect = interactionCanvas.getBoundingClientRect();
            state.panX = state.panStartPanX + dx * (interactionCanvas.width / rect.width);
            state.panY = state.panStartPanY + dy * (interactionCanvas.height / rect.height);
            clampPan();
            render();
        } else if (e.touches.length === 2) {
            var dist = getTouchDistance(e.touches[0], e.touches[1]);
            var center = getTouchCenter(e.touches[0], e.touches[1]);

            if (touchState.lastDist > 0) {
                var scale = dist / touchState.lastDist;
                var newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * scale));

                var rect = interactionCanvas.getBoundingClientRect();
                var mx = (center.x - rect.left) * (interactionCanvas.width / rect.width);
                var my = (center.y - rect.top) * (interactionCanvas.height / rect.height);

                state.panX = mx - (mx - state.panX) * (newZoom / state.zoom);
                state.panY = my - (my - state.panY) * (newZoom / state.zoom);

                var panDx = (center.x - touchState.lastCenterX) * (interactionCanvas.width / rect.width);
                var panDy = (center.y - touchState.lastCenterY) * (interactionCanvas.height / rect.height);
                state.panX += panDx;
                state.panY += panDy;

                state.zoom = newZoom;
                clampPan();
                render();
            }

            touchState.lastDist = dist;
            touchState.lastCenterX = center.x;
            touchState.lastCenterY = center.y;
        }
    }, { passive: false });

    interactionCanvas.addEventListener("touchend", function (e) {
        if (!state.image) return;
        e.preventDefault();

        if (e.touches.length === 0) {
            state.isPanning = false;
            touchState.lastDist = 0;
        } else if (e.touches.length === 1) {
            state.isPanning = true;
            state.panStartX = e.touches[0].clientX;
            state.panStartY = e.touches[0].clientY;
            state.panStartPanX = state.panX;
            state.panStartPanY = state.panY;
            touchState.lastDist = 0;
        }
    }, { passive: false });

    // ── Keyboard Shortcuts ────────────────────────────────────────

    element.setAttribute("tabindex", "0");
    element.style.outline = "none";

    element.addEventListener("keydown", function (e) {
        if (!state.image) return;
        if (e.target.tagName === "INPUT") return;

        switch (e.key) {
            case "v":
            case "V":
                setTool("select");
                e.preventDefault();
                break;
            case "r":
            case "R":
                setTool("rect");
                e.preventDefault();
                break;
            case "m":
            case "M":
                setTool("mask");
                e.preventDefault();
                break;
            case "Delete":
            case "Backspace":
                // If hovering over a polygon point, delete just that point
                if (state.hoveredPointIndex !== null && state.selectedLayerId !== null) {
                    var layer = findLayerById(state.selectedLayerId);
                    if (layer && layer.type === LAYER_TYPES.MASK && layer.data.points) {
                        removePointFromPolygon(layer, state.hoveredPointIndex);
                        state.hoveredPointIndex = null;
                    }
                } else if (state.selectedLayerId != null) {
                    deleteLayer(state.selectedLayerId);
                }
                e.preventDefault();
                break;
            case "Escape":
                // Cancel polygon drawing if in progress
                if (state.isDrawingPolygon) {
                    state.isDrawingPolygon = false;
                    state.polygonPoints = [];
                    state.hoveredPointIndex = null;
                }
                state.selectedLayerId = null;
                state.isDrawing = false;
                render();
                renderControlPanel();
                e.preventDefault();
                break;
            case "Enter":
                // Complete polygon if in drawing mode
                if (state.isDrawingPolygon && state.polygonPoints.length >= 3) {
                    completePolygon();
                }
                e.preventDefault();
                break;
            case "+":
            case "=":
                zoomTo(state.zoom * 1.25);
                e.preventDefault();
                break;
            case "-":
            case "_":
                zoomTo(state.zoom / 1.25);
                e.preventDefault();
                break;
            case "0":
                resetView();
                e.preventDefault();
                break;
        }
    });

    // ── Window Resize ─────────────────────────────────────────────

    var resizeTimer = null;
    window.addEventListener("resize", function () {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (state.image) {
                fitCanvas();
                render();
            }
        }, 150);
    });
})();
