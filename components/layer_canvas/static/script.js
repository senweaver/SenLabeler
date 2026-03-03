/**
 * LayerCanvas - Multi-layer Canvas Component
 * Supports background image, rectangle layers, and mask layers
 */

class LayerCanvas {
    constructor(options = {}) {
        // Configuration
        this.container = options.container || document.getElementById('app');
        this.height = options.height || 500;
        this.width = options.width || null;
        this.showControls = options.showControls !== false;
        this.editable = options.editable !== false;
        this.minZoom = options.minZoom || 0.1;
        this.maxZoom = options.maxZoom || 10;
        this.backgroundColor = options.backgroundColor || '#1a1a1a';
        
        // State
        this.layers = [];
        this.backgroundImage = null;
        this.selectedLayerId = null;
        this.loading = false;
        this.tooltip = null;
        this.showGrid = false;
        
        // View state
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.minPanX = 0;
        this.maxPanX = 0;
        this.minPanY = 0;
        this.maxPanY = 0;
        
        // Interaction state
        this.isDragging = false;
        this.isPanning = false;
        this.isResizing = false;
        this.isDrawing = false;
        this.dragStart = { x: 0, y: 0 };
        this.activeHandle = null;
        this.currentTool = 'select'; // 'select', 'rect', 'mask', 'pan'
        
        // Canvas references
        this.mainCanvas = null;
        this.mainCtx = null;
        this.interactionCanvas = null;
        this.interactionCtx = null;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        
        // Image state
        this.imageLoaded = false;
        this.imageElement = null;
        this.imageWidth = 0;
        this.imageHeight = 0;
        
        // Event callbacks
        this.onLayerChange = options.onLayerChange || null;
        this.onSelectionChange = options.onSelectionChange || null;
        this.onViewChange = options.onViewChange || null;
        
        // Drag state for layer reordering
        this.draggedLayerIndex = null;
        
        // Initialize
        this.init();
    }
    
    /**
     * Initialize the canvas component
     */
    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.render();
    }
    
    /**
     * Setup canvas elements
     */
    setupCanvas() {
        // Find or create canvas elements
        const wrapper = this.container.querySelector('.canvas-wrapper');
        if (!wrapper) {
            console.error('Canvas wrapper not found');
            return;
        }
        
        this.mainCanvas = wrapper.querySelector('#mainCanvas');
        this.interactionCanvas = wrapper.querySelector('#interactionCanvas');
        
        if (!this.mainCanvas || !this.interactionCanvas) {
            console.error('Canvas elements not found');
            return;
        }
        
        this.mainCtx = this.mainCanvas.getContext('2d');
        this.interactionCtx = this.interactionCanvas.getContext('2d');
        
        this.resizeCanvas();
    }
    
    /**
     * Resize canvas to fit container
     */
    resizeCanvas() {
        const wrapper = this.mainCanvas.parentElement;
        const rect = wrapper.getBoundingClientRect();
        
        this.canvasWidth = this.width || rect.width;
        this.canvasHeight = this.height || rect.height;
        
        // Set canvas size
        this.mainCanvas.width = this.canvasWidth;
        this.mainCanvas.height = this.canvasHeight;
        this.interactionCanvas.width = this.canvasWidth;
        this.interactionCanvas.height = this.canvasHeight;
        
        this.render();
    }
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Window resize
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Mouse events on interaction canvas
        this.interactionCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.interactionCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.interactionCanvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.interactionCanvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
        this.interactionCanvas.addEventListener('wheel', (e) => this.handleWheel(e));
        this.interactionCanvas.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
        
        // Double click for quick select
        this.interactionCanvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        
        // Keyboard events
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
        
        // Touch events for mobile
        this.interactionCanvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.interactionCanvas.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.interactionCanvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));
    }
    
    /**
     * Handle mouse down event
     */
    handleMouseDown(e) {
        const point = this.getCanvasPoint(e);
        this.dragStart = { x: e.clientX, y: e.clientY };
        
        if (e.button === 1 || (e.button === 0 && this.currentTool === 'pan')) {
            // Middle click or pan tool - start panning
            this.isPanning = true;
            this.interactionCanvas.classList.add('grabbing');
            return;
        }
        
        if (e.button === 0) {
            // Left click
            if (this.currentTool === 'rect') {
                this.isDrawing = true;
                this.drawingStart = point;
                this.drawingLayer = this.createRectLayer(point.x, point.y, 0, 0);
                this.addLayer(this.drawingLayer);
                this.selectLayer(this.drawingLayer.id);
            } else if (this.currentTool === 'mask') {
                this.isDrawing = true;
                this.drawingStart = point;
                this.drawingLayer = this.createMaskLayer(point.x, point.y, 0, 0);
                this.addLayer(this.drawingLayer);
                this.selectLayer(this.drawingLayer.id);
            } else {
                // Select tool
                const hitResult = this.hitTest(point);
                
                if (hitResult) {
                    if (hitResult.handle) {
                        // Resize handle
                        this.isResizing = true;
                        this.activeHandle = hitResult.handle;
                        this.resizeStart = point;
                        this.originalRect = { ...hitResult.layer };
                    } else {
                        // Layer hit
                        this.isDragging = true;
                        this.dragOffset = {
                            x: point.x - hitResult.layer.x,
                            y: point.y - hitResult.layer.y
                        };
                        this.selectLayer(hitResult.layer.id);
                    }
                } else {
                    // Background hit - deselect
                    this.selectLayer(null);
                }
            }
        }
    }
    
    /**
     * Handle mouse move event
     */
    handleMouseMove(e) {
        const point = this.getCanvasPoint(e);
        
        if (this.isPanning) {
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            this.panX += dx;
            this.panY += dy;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.render();
            return;
        }
        
        if (this.isDrawing && this.drawingLayer) {
            // Update drawing layer size
            const x = Math.min(this.drawingStart.x, point.x);
            const y = Math.min(this.drawingStart.y, point.y);
            const width = Math.abs(point.x - this.drawingStart.x);
            const height = Math.abs(point.y - this.drawingStart.y);
            
            this.drawingLayer.x = x;
            this.drawingLayer.y = y;
            this.drawingLayer.width = width;
            this.drawingLayer.height = height;
            
            if (this.drawingLayer.type === 'mask' && this.drawingLayer.regions) {
                this.drawingLayer.regions[0] = {
                    type: 'rect',
                    x, y, width, height
                };
            }
            
            this.render();
            return;
        }
        
        if (this.isDragging && this.selectedLayerId) {
            const layer = this.getLayerById(this.selectedLayerId);
            if (layer) {
                layer.x = point.x - this.dragOffset.x;
                layer.y = point.y - this.dragOffset.y;
                
                if (layer.type === 'mask' && layer.regions && layer.regions.length > 0) {
                    const region = layer.regions[0];
                    region.x = layer.x;
                    region.y = layer.y;
                }
                
                this.render();
                this.emitLayerChange();
            }
            return;
        }
        
        if (this.isResizing && this.selectedLayerId) {
            this.resizeLayer(point);
            return;
        }
        
        // Update cursor based on hit test
        const hitResult = this.hitTest(point);
        this.updateCursor(hitResult);
        
        // Show tooltip
        if (hitResult && hitResult.layer) {
            this.showTooltip(e.clientX, e.clientY, hitResult.layer.name);
        } else {
            this.hideTooltip();
        }
    }
    
    /**
     * Handle mouse up event
     */
    handleMouseUp(e) {
        if (this.isDrawing) {
            // Finalize drawing
            if (this.drawingLayer && this.drawingLayer.width < 5 && this.drawingLayer.height < 5) {
                // Too small - remove
                this.removeLayer(this.drawingLayer.id);
            }
            this.drawingLayer = null;
            this.emitLayerChange();
        }
        
        this.isPanning = false;
        this.isDragging = false;
        this.isResizing = false;
        this.isDrawing = false;
        this.activeHandle = null;
        this.interactionCanvas.classList.remove('grabbing');
    }
    
    /**
     * Handle wheel event for zoom
     */
    handleWheel(e) {
        e.preventDefault();
        
        const point = this.getCanvasPoint(e);
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * delta));
        
        if (newZoom !== this.zoom) {
            // Zoom towards cursor
            const zoomRatio = newZoom / this.zoom;
            this.panX = point.x - (point.x - this.panX) * zoomRatio;
            this.panY = point.y - (point.y - this.panY) * zoomRatio;
            this.zoom = newZoom;
            this.render();
            this.emitViewChange();
        }
    }
    
    /**
     * Handle context menu
     */
    handleContextMenu(e) {
        e.preventDefault();
        // Could show context menu here
    }
    
    /**
     * Handle double click
     */
    handleDoubleClick(e) {
        const point = this.getCanvasPoint(e);
        const hitResult = this.hitTest(point);
        
        if (hitResult && hitResult.layer) {
            // Enter edit mode or show properties
            console.log('Edit layer:', hitResult.layer.name);
        }
    }
    
    /**
     * Handle keyboard events
     */
    handleKeyDown(e) {
        // Tool shortcuts
        if (e.key === 'v' || e.key === 'V') {
            this.setTool('select');
        } else if (e.key === 'r' || e.key === 'R') {
            this.setTool('rect');
        } else if (e.key === 'm' || e.key === 'M') {
            this.setTool('mask');
        } else if (e.key === ' ') {
            e.preventDefault();
            this.setTool('pan');
        }
        
        // Delete selected layer
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedLayerId) {
            this.removeLayer(this.selectedLayerId);
            this.selectLayer(null);
        }
        
        // Escape - deselect or cancel
        if (e.key === 'Escape') {
            if (this.isDrawing || this.isDragging || this.isResizing) {
                this.isDrawing = false;
                this.isDragging = false;
                this.isResizing = false;
            } else {
                this.selectLayer(null);
            }
        }
        
        // Arrow keys to move selected layer
        if (this.selectedLayerId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const layer = this.getLayerById(this.selectedLayerId);
            if (layer) {
                const step = e.shiftKey ? 10 : 1;
                switch (e.key) {
                    case 'ArrowUp': layer.y -= step; break;
                    case 'ArrowDown': layer.y += step; break;
                    case 'ArrowLeft': layer.x -= step; break;
                    case 'ArrowRight': layer.x += step; break;
                }
                this.render();
                this.emitLayerChange();
            }
        }
    }
    
    handleKeyUp(e) {
        if (e.key === ' ') {
            this.setTool('select');
        }
    }
    
    /**
     * Touch event handlers
     */
    handleTouchStart(e) {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.handleMouseDown({ 
                clientX: touch.clientX, 
                clientY: touch.clientY, 
                button: 0 
            });
        } else if (e.touches.length === 2) {
            // Pinch to zoom
            this.isPinching = true;
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            this.pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        }
    }
    
    handleTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.handleMouseMove({ 
                clientX: touch.clientX, 
                clientY: touch.clientY 
            });
        } else if (e.touches.length === 2 && this.isPinching) {
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const scale = dist / this.pinchStartDist;
            this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * scale));
            this.pinchStartDist = dist;
            this.render();
        }
    }
    
    handleTouchEnd(e) {
        this.isPinching = false;
        this.handleMouseUp({});
    }
    
    /**
     * Get canvas point from event
     */
    getCanvasPoint(e) {
        const rect = this.interactionCanvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.panX) / this.zoom,
            y: (e.clientY - rect.top - this.panY) / this.zoom
        };
    }
    
    /**
     * Hit test for layer selection
     */
    hitTest(point) {
        // Test from top to bottom (reverse z-order)
        const sortedLayers = [...this.layers].sort((a, b) => b.z_index - a.z_index);
        
        for (const layer of sortedLayers) {
            if (!layer.visible) continue;
            
            if (layer.type === 'rect') {
                // Check resize handles first if selected
                if (layer.id === this.selectedLayerId) {
                    const handle = this.getHandleAtPoint(point, layer);
                    if (handle) {
                        return { layer, handle };
                    }
                }
                
                // Check layer bounds
                if (point.x >= layer.x && point.x <= layer.x + layer.width &&
                    point.y >= layer.y && point.y <= layer.y + layer.height) {
                    return { layer, handle: null };
                }
            } else if (layer.type === 'mask') {
                // Check if inside mask region
                for (const region of (layer.regions || [])) {
                    if (region.type === 'rect') {
                        if (point.x >= region.x && point.x <= region.x + region.width &&
                            point.y >= region.y && point.y <= region.y + region.height) {
                            return { layer, handle: null };
                        }
                    } else if (region.type === 'circle') {
                        const dx = point.x - region.cx;
                        const dy = point.y - region.cy;
                        if (dx * dx + dy * dy <= region.r * region.r) {
                            return { layer, handle: null };
                        }
                    }
                }
            }
        }
        
        return null;
    }
    
    /**
     * Get resize handle at point
     */
    getHandleAtPoint(point, layer) {
        const handleSize = 10 / this.zoom;
        const handles = this.getHandlePositions(layer);
        
        for (const [name, pos] of Object.entries(handles)) {
            if (point.x >= pos.x - handleSize / 2 && point.x <= pos.x + handleSize / 2 &&
                point.y >= pos.y - handleSize / 2 && point.y <= pos.y + handleSize / 2) {
                return name;
            }
        }
        
        return null;
    }
    
    /**
     * Get handle positions for a layer
     */
    getHandlePositions(layer) {
        return {
            nw: { x: layer.x, y: layer.y },
            n: { x: layer.x + layer.width / 2, y: layer.y },
            ne: { x: layer.x + layer.width, y: layer.y },
            e: { x: layer.x + layer.width, y: layer.y + layer.height / 2 },
            se: { x: layer.x + layer.width, y: layer.y + layer.height },
            s: { x: layer.x + layer.width / 2, y: layer.y + layer.height },
            sw: { x: layer.x, y: layer.y + layer.height },
            w: { x: layer.x, y: layer.y + layer.height / 2 }
        };
    }
    
    /**
     * Resize layer based on active handle
     */
    resizeLayer(point) {
        const layer = this.getLayerById(this.selectedLayerId);
        if (!layer) return;
        
        const dx = point.x - this.resizeStart.x;
        const dy = point.y - this.resizeStart.y;
        
        switch (this.activeHandle) {
            case 'nw':
                layer.x = this.originalRect.x + dx;
                layer.y = this.originalRect.y + dy;
                layer.width = this.originalRect.width - dx;
                layer.height = this.originalRect.height - dy;
                break;
            case 'n':
                layer.y = this.originalRect.y + dy;
                layer.height = this.originalRect.height - dy;
                break;
            case 'ne':
                layer.y = this.originalRect.y + dy;
                layer.width = this.originalRect.width + dx;
                layer.height = this.originalRect.height - dy;
                break;
            case 'e':
                layer.width = this.originalRect.width + dx;
                break;
            case 'se':
                layer.width = this.originalRect.width + dx;
                layer.height = this.originalRect.height + dy;
                break;
            case 's':
                layer.height = this.originalRect.height + dy;
                break;
            case 'sw':
                layer.x = this.originalRect.x + dx;
                layer.width = this.originalRect.width - dx;
                layer.height = this.originalRect.height + dy;
                break;
            case 'w':
                layer.x = this.originalRect.x + dx;
                layer.width = this.originalRect.width - dx;
                break;
        }
        
        // Ensure minimum size
        if (layer.width < 10) {
            if (this.activeHandle.includes('w')) {
                layer.x = this.originalRect.x + this.originalRect.width - 10;
            }
            layer.width = 10;
        }
        if (layer.height < 10) {
            if (this.activeHandle.includes('n')) {
                layer.y = this.originalRect.y + this.originalRect.height - 10;
            }
            layer.height = 10;
        }
        
        // Update mask regions if needed
        if (layer.type === 'mask' && layer.regions && layer.regions.length > 0) {
            layer.regions[0].x = layer.x;
            layer.regions[0].y = layer.y;
            layer.regions[0].width = layer.width;
            layer.regions[0].height = layer.height;
        }
        
        this.resizeStart = point;
        this.originalRect = { ...layer };
        
        this.render();
        this.emitLayerChange();
    }
    
    /**
     * Update cursor based on hit test
     */
    updateCursor(hitResult) {
        if (this.currentTool === 'pan') {
            this.interactionCanvas.className = 'grab';
        } else if (hitResult && hitResult.handle) {
            const handleCursors = {
                nw: 'nwse-resize', ne: 'nesw-resize',
                sw: 'nesw-resize', se: 'nwse-resize',
                n: 'ns-resize', s: 'ns-resize',
                e: 'ew-resize', w: 'ew-resize'
            };
            this.interactionCanvas.style.cursor = handleCursors[hitResult.handle];
        } else if (hitResult && hitResult.layer) {
            this.interactionCanvas.style.cursor = 'move';
        } else if (this.currentTool === 'rect' || this.currentTool === 'mask') {
            this.interactionCanvas.style.cursor = 'crosshair';
        } else {
            this.interactionCanvas.style.cursor = 'default';
        }
    }
    
    /**
     * Show tooltip
     */
    showTooltip(x, y, text) {
        this.tooltip = { x: x + 10, y: y + 10, text };
    }
    
    /**
     * Hide tooltip
     */
    hideTooltip() {
        this.tooltip = null;
    }
    
    // ==================== Layer Management ====================
    
    /**
     * Set background image
     */
    setBackgroundImage(src) {
        this.loading = true;
        this.render();
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            this.imageElement = img;
            this.imageWidth = img.width;
            this.imageHeight = img.height;
            this.imageLoaded = true;
            this.loading = false;
            
            // Fit image to canvas
            this.fitToCanvas();
            this.render();
        };
        
        img.onerror = () => {
            console.error('Failed to load image:', src);
            this.loading = false;
            this.imageLoaded = false;
            this.render();
        };
        
        img.src = src;
    }
    
    /**
     * Fit image to canvas
     */
    fitToCanvas() {
        if (!this.imageLoaded || !this.imageElement) return;
        
        const scaleX = this.canvasWidth / this.imageWidth;
        const scaleY = this.canvasHeight / this.imageHeight;
        this.zoom = Math.min(scaleX, scaleY) * 0.9;
        
        this.panX = (this.canvasWidth - this.imageWidth * this.zoom) / 2;
        this.panY = (this.canvasHeight - this.imageHeight * this.zoom) / 2;
    }
    
    /**
     * Add a layer
     */
    addLayer(layer) {
        layer.z_index = this.layers.length;
        this.layers.push(layer);
        this.render();
        this.emitLayerChange();
        return layer;
    }
    
    /**
     * Remove a layer
     */
    removeLayer(id) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index !== -1) {
            this.layers.splice(index, 1);
            if (this.selectedLayerId === id) {
                this.selectedLayerId = null;
            }
            this.render();
            this.emitLayerChange();
        }
    }
    
    /**
     * Get layer by ID
     */
    getLayerById(id) {
        return this.layers.find(l => l.id === id);
    }
    
    /**
     * Select a layer
     */
    selectLayer(id) {
        this.selectedLayerId = id;
        this.render();
        this.emitSelectionChange();
    }
    
    /**
     * Toggle layer visibility
     */
    toggleLayerVisibility(id) {
        const layer = this.getLayerById(id);
        if (layer) {
            layer.visible = !layer.visible;
            this.render();
            this.emitLayerChange();
        }
    }
    
    /**
     * Create a rectangle layer
     */
    createRectLayer(x, y, width, height, options = {}) {
        const id = 'rect_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        return {
            type: 'rect',
            id,
            name: options.name || `Rectangle ${this.layers.filter(l => l.type === 'rect').length + 1}`,
            x,
            y,
            width: width || 100,
            height: height || 100,
            color: options.color || '#4a9eff',
            strokeColor: options.strokeColor || '#ffffff',
            strokeWidth: options.strokeWidth || 2,
            fill: options.fill !== false,
            opacity: options.opacity ?? 0.5,
            borderRadius: options.borderRadius || 0,
            visible: true,
            z_index: this.layers.length
        };
    }
    
    /**
     * Create a mask layer
     */
    createMaskLayer(x, y, width, height, options = {}) {
        const id = 'mask_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        return {
            type: 'mask',
            id,
            name: options.name || `Mask ${this.layers.filter(l => l.type === 'mask').length + 1}`,
            x,
            y,
            width: width || 100,
            height: height || 100,
            color: options.color || '#000000',
            maskOpacity: options.maskOpacity ?? 0.7,
            regions: [{
                type: 'rect',
                x,
                y,
                width: width || 100,
                height: height || 100
            }],
            opacity: 1,
            visible: true,
            z_index: this.layers.length
        };
    }
    
    /**
     * Add a mask region
     */
    addMaskRegion(layerId, region) {
        const layer = this.getLayerById(layerId);
        if (layer && layer.type === 'mask') {
            if (!layer.regions) layer.regions = [];
            layer.regions.push(region || {
                type: 'rect',
                x: 50,
                y: 50,
                width: 100,
                height: 100
            });
            this.render();
            this.emitLayerChange();
        }
    }
    
    /**
     * Remove a mask region
     */
    removeMaskRegion(layerId, index) {
        const layer = this.getLayerById(layerId);
        if (layer && layer.type === 'mask' && layer.regions) {
            layer.regions.splice(index, 1);
            this.render();
            this.emitLayerChange();
        }
    }
    
    /**
     * Clear all layers
     */
    clearAllLayers() {
        this.layers = [];
        this.selectedLayerId = null;
        this.render();
        this.emitLayerChange();
    }
    
    /**
     * Set current tool
     */
    setTool(tool) {
        this.currentTool = tool;
        this.updateCursor(null);
    }
    
    /**
     * Load layers from JSON
     */
    loadLayers(data) {
        if (data.image) {
            this.setBackgroundImage(data.image);
        }
        if (data.layers) {
            this.layers = data.layers;
        }
        this.render();
    }
    
    /**
     * Export layers to JSON
     */
    exportLayers() {
        return {
            image: this.backgroundImage,
            layers: [...this.layers],
            view: {
                zoom: this.zoom,
                panX: this.panX,
                panY: this.panY
            }
        };
    }
    
    // ==================== Rendering ====================
    
    /**
     * Main render function
     */
    render() {
        if (!this.mainCtx) return;
        
        // Clear canvas
        this.mainCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        this.interactionCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        
        // Fill background
        this.mainCtx.fillStyle = this.backgroundColor;
        this.mainCtx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
        
        // Draw grid if enabled
        if (this.showGrid) {
            this.drawGrid();
        }
        
        // Apply transformations
        this.mainCtx.save();
        this.mainCtx.translate(this.panX, this.panY);
        this.mainCtx.scale(this.zoom, this.zoom);
        
        // Draw background image
        if (this.imageLoaded && this.imageElement) {
            this.mainCtx.drawImage(this.imageElement, 0, 0);
        }
        
        // Draw layers (sorted by z_index)
        const sortedLayers = [...this.layers].sort((a, b) => a.z_index - b.z_index);
        for (const layer of sortedLayers) {
            if (!layer.visible) continue;
            
            if (layer.type === 'rect') {
                this.drawRectLayer(layer);
            } else if (layer.type === 'mask') {
                this.drawMaskLayer(layer);
            }
        }
        
        this.mainCtx.restore();
        
        // Draw selection and handles on interaction canvas
        if (this.selectedLayerId) {
            this.drawSelection(this.getLayerById(this.selectedLayerId));
        }
    }
    
    /**
     * Draw grid
     */
    drawGrid() {
        const gridSize = 20 * this.zoom;
        this.mainCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.mainCtx.lineWidth = 1;
        
        const startX = this.panX % gridSize;
        const startY = this.panY % gridSize;
        
        for (let x = startX; x < this.canvasWidth; x += gridSize) {
            this.mainCtx.beginPath();
            this.mainCtx.moveTo(x, 0);
            this.mainCtx.lineTo(x, this.canvasHeight);
            this.mainCtx.stroke();
        }
        
        for (let y = startY; y < this.canvasHeight; y += gridSize) {
            this.mainCtx.beginPath();
            this.mainCtx.moveTo(0, y);
            this.mainCtx.lineTo(this.canvasWidth, y);
            this.mainCtx.stroke();
        }
    }
    
    /**
     * Draw rectangle layer
     */
    drawRectLayer(layer) {
        this.mainCtx.save();
        this.mainCtx.globalAlpha = layer.opacity;
        
        // Fill
        if (layer.fill) {
            this.mainCtx.fillStyle = layer.color;
            if (layer.borderRadius > 0) {
                this.roundRect(layer.x, layer.y, layer.width, layer.height, layer.borderRadius);
                this.mainCtx.fill();
            } else {
                this.mainCtx.fillRect(layer.x, layer.y, layer.width, layer.height);
            }
        }
        
        // Stroke
        if (layer.strokeWidth > 0) {
            this.mainCtx.strokeStyle = layer.strokeColor;
            this.mainCtx.lineWidth = layer.strokeWidth / this.zoom;
            if (layer.borderRadius > 0) {
                this.roundRect(layer.x, layer.y, layer.width, layer.height, layer.borderRadius);
                this.mainCtx.stroke();
            } else {
                this.mainCtx.strokeRect(layer.x, layer.y, layer.width, layer.height);
            }
        }
        
        this.mainCtx.restore();
    }
    
    /**
     * Draw rounded rectangle
     */
    roundRect(x, y, width, height, radius) {
        this.mainCtx.beginPath();
        this.mainCtx.moveTo(x + radius, y);
        this.mainCtx.lineTo(x + width - radius, y);
        this.mainCtx.quadraticCurveTo(x + width, y, x + width, y + radius);
        this.mainCtx.lineTo(x + width, y + height - radius);
        this.mainCtx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        this.mainCtx.lineTo(x + radius, y + height);
        this.mainCtx.quadraticCurveTo(x, y + height, x, y + height - radius);
        this.mainCtx.lineTo(x, y + radius);
        this.mainCtx.quadraticCurveTo(x, y, x + radius, y);
        this.mainCtx.closePath();
    }
    
    /**
     * Draw mask layer
     */
    drawMaskLayer(layer) {
        if (!layer.regions || layer.regions.length === 0) return;
        
        this.mainCtx.save();
        
        // Create mask path
        this.mainCtx.beginPath();
        this.mainCtx.rect(0, 0, this.imageWidth || this.canvasWidth, this.imageHeight || this.canvasHeight);
        
        for (const region of layer.regions) {
            if (region.type === 'rect') {
                this.mainCtx.rect(region.x, region.y, region.width, region.height);
            } else if (region.type === 'circle') {
                this.mainCtx.arc(region.cx, region.cy, region.r, 0, Math.PI * 2);
            } else if (region.type === 'ellipse') {
                this.mainCtx.ellipse(region.cx, region.cy, region.rx, region.ry, 0, 0, Math.PI * 2);
            } else if (region.type === 'polygon' && region.points) {
                this.mainCtx.moveTo(region.points[0].x, region.points[0].y);
                for (let i = 1; i < region.points.length; i++) {
                    this.mainCtx.lineTo(region.points[i].x, region.points[i].y);
                }
                this.mainCtx.closePath();
            }
        }
        
        // Use even-odd fill rule to create holes
        this.mainCtx.fillStyle = layer.color;
        this.mainCtx.globalAlpha = layer.maskOpacity;
        this.mainCtx.fill('evenodd');
        
        this.mainCtx.restore();
        
        // Draw region borders
        this.mainCtx.save();
        this.mainCtx.strokeStyle = '#4a9eff';
        this.mainCtx.lineWidth = 2 / this.zoom;
        this.mainCtx.setLineDash([5 / this.zoom, 5 / this.zoom]);
        
        for (const region of layer.regions) {
            if (region.type === 'rect') {
                this.mainCtx.strokeRect(region.x, region.y, region.width, region.height);
            }
        }
        
        this.mainCtx.restore();
    }
    
    /**
     * Draw selection and handles
     */
    drawSelection(layer) {
        if (!layer || layer.type === 'mask') return;
        
        this.interactionCtx.save();
        this.interactionCtx.translate(this.panX, this.panY);
        this.interactionCtx.scale(this.zoom, this.zoom);
        
        // Selection border
        this.interactionCtx.strokeStyle = '#4a9eff';
        this.interactionCtx.lineWidth = 2 / this.zoom;
        this.interactionCtx.setLineDash([5 / this.zoom, 5 / this.zoom]);
        this.interactionCtx.strokeRect(layer.x, layer.y, layer.width, layer.height);
        
        // Resize handles
        this.interactionCtx.setLineDash([]);
        const handleSize = 10 / this.zoom;
        const handles = this.getHandlePositions(layer);
        
        for (const pos of Object.values(handles)) {
            this.interactionCtx.fillStyle = '#ffffff';
            this.interactionCtx.strokeStyle = '#4a9eff';
            this.interactionCtx.lineWidth = 2 / this.zoom;
            this.interactionCtx.fillRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize);
            this.interactionCtx.strokeRect(pos.x - handleSize / 2, pos.y - handleSize / 2, handleSize, handleSize);
        }
        
        this.interactionCtx.restore();
    }
    
    // ==================== View Controls ====================
    
    zoomIn() {
        this.zoom = Math.min(this.maxZoom, this.zoom * 1.2);
        this.render();
        this.emitViewChange();
    }
    
    zoomOut() {
        this.zoom = Math.max(this.minZoom, this.zoom / 1.2);
        this.render();
        this.emitViewChange();
    }
    
    resetView() {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.fitToCanvas();
        this.render();
        this.emitViewChange();
    }
    
    // ==================== Export ====================
    
    exportImage() {
        // Create a temporary canvas without selection indicators
        const exportCanvas = document.createElement('canvas');
        const exportCtx = exportCanvas.getContext('2d');
        
        const width = this.imageWidth || this.canvasWidth;
        const height = this.imageHeight || this.canvasHeight;
        
        exportCanvas.width = width;
        exportCanvas.height = height;
        
        // Draw background
        exportCtx.fillStyle = this.backgroundColor;
        exportCtx.fillRect(0, 0, width, height);
        
        // Draw background image
        if (this.imageLoaded && this.imageElement) {
            exportCtx.drawImage(this.imageElement, 0, 0);
        }
        
        // Draw layers
        const sortedLayers = [...this.layers].sort((a, b) => a.z_index - b.z_index);
        for (const layer of sortedLayers) {
            if (!layer.visible) continue;
            
            if (layer.type === 'rect') {
                exportCtx.save();
                exportCtx.globalAlpha = layer.opacity;
                if (layer.fill) {
                    exportCtx.fillStyle = layer.color;
                    if (layer.borderRadius > 0) {
                        this.roundRectOnContext(exportCtx, layer.x, layer.y, layer.width, layer.height, layer.borderRadius);
                        exportCtx.fill();
                    } else {
                        exportCtx.fillRect(layer.x, layer.y, layer.width, layer.height);
                    }
                }
                if (layer.strokeWidth > 0) {
                    exportCtx.strokeStyle = layer.strokeColor;
                    exportCtx.lineWidth = layer.strokeWidth;
                    exportCtx.strokeRect(layer.x, layer.y, layer.width, layer.height);
                }
                exportCtx.restore();
            } else if (layer.type === 'mask') {
                this.drawMaskLayerOnContext(exportCtx, layer, width, height);
            }
        }
        
        // Download
        const link = document.createElement('a');
        link.download = 'layer-canvas-export.png';
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
    }
    
    roundRectOnContext(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }
    
    drawMaskLayerOnContext(ctx, layer, canvasWidth, canvasHeight) {
        if (!layer.regions || layer.regions.length === 0) return;
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, canvasWidth, canvasHeight);
        
        for (const region of layer.regions) {
            if (region.type === 'rect') {
                ctx.rect(region.x, region.y, region.width, region.height);
            } else if (region.type === 'circle') {
                ctx.arc(region.cx, region.cy, region.r, 0, Math.PI * 2);
            }
        }
        
        ctx.fillStyle = layer.color;
        ctx.globalAlpha = layer.maskOpacity;
        ctx.fill('evenodd');
        ctx.restore();
    }
    
    exportJSON() {
        const data = this.exportLayers();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = 'layer-canvas-config.json';
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
    }
    
    // ==================== Event Emitters ====================
    
    emitLayerChange() {
        if (this.onLayerChange) {
            this.onLayerChange(this.layers);
        }
    }
    
    emitSelectionChange() {
        if (this.onSelectionChange) {
            this.onSelectionChange(this.selectedLayerId);
        }
    }
    
    emitViewChange() {
        if (this.onViewChange) {
            this.onViewChange({ zoom: this.zoom, panX: this.panX, panY: this.panY });
        }
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LayerCanvas;
} else {
    window.LayerCanvas = LayerCanvas;
}