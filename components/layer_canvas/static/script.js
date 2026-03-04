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
    var layerProperties = element.querySelector(".layer-properties");
    var loadingIndicator = element.querySelector(".loading-indicator");
    var placeholder = element.querySelector(".placeholder");

    // Toolbar buttons - match template classes
    var selectBtn = element.querySelector(".select-tool");
    var rectBtn = element.querySelector(".rect-tool");
    var maskBtn = element.querySelector(".mask-tool");
    
    // Control panel buttons
    var addRectBtn = element.querySelector(".add-rect-btn");
    var addMaskBtn = element.querySelector(".add-mask-btn");
    var clearAllBtn = element.querySelector(".clear-all-btn");
    var zoomInBtn = element.querySelector(".zoom-in-btn");
    var zoomOutBtn = element.querySelector(".zoom-out-btn");
    var resetViewBtn = element.querySelector(".reset-view-btn");
    var exportJsonBtn = element.querySelector(".export-json-btn");
    
    // Additional controls (optional - may not exist in template)
    var opacitySlider = element.querySelector(".opacity-slider");

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
        nextLayerId: 1
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
    }

    function showLoading() {
        placeholder.classList.add("hidden");
        canvasWrapper.style.display = "none";
        controlPanel.classList.remove("visible");
        loadingIndicator.classList.add("visible");
    }

    function showContent() {
        placeholder.classList.add("hidden");
        loadingIndicator.classList.remove("visible");
        canvasWrapper.style.display = "flex";
        controlPanel.classList.add("visible");
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
        render();
    }

    function resetView() {
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        render();
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
    }

    function drawSelectionHighlight(ctx, layer) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1 / state.zoom;
        ctx.setLineDash([5 / state.zoom, 5 / state.zoom]);

        if (layer.type === LAYER_TYPES.RECTANGLE) {
            var d = layer.data;
            ctx.strokeRect(d.x - 2/state.zoom, d.y - 2/state.zoom, 
                          d.width + 4/state.zoom, d.height + 4/state.zoom);
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
        }

        ctx.setLineDash([]);

        // Draw resize handles for rectangle
        if (layer.type === LAYER_TYPES.RECTANGLE) {
            drawResizeHandles(ctx, layer.data);
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

        // Render layer properties
        renderLayerProperties();

        // Bind events
        bindLayerEvents();
    }

    function renderLayerProperties() {
        if (state.selectedLayerId == null) {
            layerProperties.classList.remove("visible");
            return;
        }

        var layer = findLayerById(state.selectedLayerId);
        if (!layer) {
            layerProperties.classList.remove("visible");
            return;
        }

        layerProperties.classList.add("visible");

        var html = '<div class="prop-section">';

        if (layer.type === LAYER_TYPES.RECTANGLE) {
            html += '<div class="prop-row"><label>X:</label><input type="number" class="prop-x" value="' + layer.data.x.toFixed(1) + '"></div>';
            html += '<div class="prop-row"><label>Y:</label><input type="number" class="prop-y" value="' + layer.data.y.toFixed(1) + '"></div>';
            html += '<div class="prop-row"><label>Width:</label><input type="number" class="prop-width" value="' + layer.data.width.toFixed(1) + '"></div>';
            html += '<div class="prop-row"><label>Height:</label><input type="number" class="prop-height" value="' + layer.data.height.toFixed(1) + '"></div>';
        }

        html += '<div class="prop-row"><label>Color:</label><input type="color" class="prop-color" value="' + layer.color + '"></div>';
        html += '<div class="prop-row"><label>Opacity:</label><input type="range" class="prop-opacity" min="0" max="100" value="30"><span>30%</span></div>';
        html += '</div>';

        layerProperties.innerHTML = html;

        // Bind property events
        bindPropertyEvents(layer);
    }

    function bindLayerEvents() {
        // Layer item click (select)
        var items = layerList.querySelectorAll(".layer-item");
        for (var i = 0; i < items.length; i++) {
            items[i].addEventListener("click", function (e) {
                if (e.target.closest(".layer-controls")) return;
                var id = parseInt(this.getAttribute("data-id"), 10);
                selectLayer(id);
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

    function bindPropertyEvents(layer) {
        var xInput = layerProperties.querySelector(".prop-x");
        var yInput = layerProperties.querySelector(".prop-y");
        var wInput = layerProperties.querySelector(".prop-width");
        var hInput = layerProperties.querySelector(".prop-height");
        var colorInput = layerProperties.querySelector(".prop-color");

        function updateRect() {
            if (xInput) layer.data.x = parseFloat(xInput.value) || 0;
            if (yInput) layer.data.y = parseFloat(yInput.value) || 0;
            if (wInput) layer.data.width = parseFloat(wInput.value) || 0;
            if (hInput) layer.data.height = parseFloat(hInput.value) || 0;
            render();
        }

        if (xInput) xInput.addEventListener("change", updateRect);
        if (yInput) yInput.addEventListener("change", updateRect);
        if (wInput) wInput.addEventListener("change", updateRect);
        if (hInput) hInput.addEventListener("change", updateRect);

        if (colorInput) {
            colorInput.addEventListener("change", function () {
                layer.color = this.value;
                render();
                renderControlPanel();
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
            // Check if clicking on a layer
            var hitLayer = findLayerAt(pt.x, pt.y);
            if (hitLayer) {
                selectLayer(hitLayer.id);
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
            // For mask, we would start a polygon drawing mode
            // Simplified: just create a sample mask
            alert("Mask drawing not fully implemented. Use rectangle tool instead.");
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
        }
    });

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
                // Simple bounding box check for masks
                if (layer.data.points && layer.data.points.length > 0) {
                    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (var j = 0; j < layer.data.points.length; j++) {
                        var p = layer.data.points[j];
                        minX = Math.min(minX, p.x);
                        minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x);
                        maxY = Math.max(maxY, p.y);
                    }
                    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
                        return layer;
                    }
                }
            }
        }
        return null;
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
                if (state.selectedLayerId != null) {
                    deleteLayer(state.selectedLayerId);
                }
                e.preventDefault();
                break;
            case "Escape":
                state.selectedLayerId = null;
                state.isDrawing = false;
                render();
                renderControlPanel();
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
