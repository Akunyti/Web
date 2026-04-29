// ==================================================
// Mobile Single-Page Viewer
// AnyFlip-style 3D page-flip animation
// ==================================================
class MobileViewer {
    constructor(bookManager) {
        this.bm = bookManager;
        this.container = bookManager.container;
        this.pages = bookManager.pages;
        this.currentIndex = bookManager.currentIndex || 0;
        this._isAnimating = false;

        // Gesture state
        this._gestureState = null;
        this._touchStartX = 0;
        this._touchStartY = 0;
        this._touchStartTime = 0;
        this._maxTouches = 0;
        this._swipeLocked = false;
        this._initialPinchDist = 0;
        this._initialZoom = 1;
        this._initialPanX = 0;
        this._initialPanY = 0;
        this._pinchMidX = 0;
        this._pinchMidY = 0;
        this._dragDx = 0;

        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;

        this._buildDOM();
        this._bindGestures();
        this._showInitial(this.currentIndex);
    }

    _buildDOM() {
        this.container.innerHTML = '';
        this.container.style.cssText = `
            width: 100%; height: 100%; position: relative;
            overflow: hidden; display: flex; align-items: center;
            justify-content: center; perspective: 1800px;
        `;

        // Flip stage — holds the page cards
        this.flipStage = document.createElement('div');
        this.flipStage.style.cssText = `
            position: relative; width: 100%; height: 100%;
            display: flex; align-items: center; justify-content: center;
            transform-style: preserve-3d;
        `;
        this.container.appendChild(this.flipStage);

        // Current page image
        this.pageImg = this._createImg();
        this.flipStage.appendChild(this.pageImg);
    }

    _createImg() {
        const img = document.createElement('img');
        img.draggable = false;
        img.style.cssText = `
            max-width: 100%; max-height: 100%;
            object-fit: contain; pointer-events: none;
            user-select: none; -webkit-user-select: none;
            flex-shrink: 0; backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
        `;
        return img;
    }

    _showInitial(idx) {
        this.currentIndex = idx;
        this.bm.currentIndex = idx;
        this.pageImg.src = this.pages[idx].dataUrl;
        this.bm.updateIndicators();
        this.bm.updateNavButtons();
        this.bm.app.updateThumbnails();
    }

    // --- AnyFlip-style 3D page-flip transition ---
    _flipTo(newIdx, direction) {
        if (this._isAnimating) return;
        if (newIdx < 0 || newIdx >= this.pages.length) return;
        this._isAnimating = true;

        const FLIP_DURATION = 500; // ms

        // Create a flip card element that holds front (current) and back (new)
        const flipCard = document.createElement('div');
        flipCard.style.cssText = `
            position: absolute; width: 100%; height: 100%;
            display: flex; align-items: center; justify-content: center;
            transform-style: preserve-3d;
            transition: transform ${FLIP_DURATION}ms cubic-bezier(0.25, 0.8, 0.25, 1);
            transform-origin: ${direction === 'left' ? 'left center' : 'right center'};
            will-change: transform;
        `;

        // Front face: current page
        const front = this._createImg();
        front.src = this.pages[this.currentIndex].dataUrl;
        front.style.position = 'absolute';
        front.style.maxWidth = '100%';
        front.style.maxHeight = '100%';
        front.style.backfaceVisibility = 'hidden';
        front.style.webkitBackfaceVisibility = 'hidden';
        front.style.zIndex = '2';

        // Back face: next page (mirrored)
        const back = this._createImg();
        back.src = this.pages[newIdx].dataUrl;
        back.style.position = 'absolute';
        back.style.maxWidth = '100%';
        back.style.maxHeight = '100%';
        back.style.backfaceVisibility = 'hidden';
        back.style.webkitBackfaceVisibility = 'hidden';
        back.style.transform = direction === 'left' ? 'rotateY(180deg)' : 'rotateY(-180deg)';
        back.style.zIndex = '1';

        flipCard.appendChild(front);
        flipCard.appendChild(back);

        // Underneath: the new page revealed as the card flips
        const underneath = this._createImg();
        underneath.src = this.pages[newIdx].dataUrl;
        underneath.style.position = 'absolute';
        underneath.style.maxWidth = '100%';
        underneath.style.maxHeight = '100%';
        underneath.style.zIndex = '0';

        // Hide current page, show flip card + underneath
        this.pageImg.style.opacity = '0';
        this.flipStage.appendChild(underneath);
        this.flipStage.appendChild(flipCard);

        // Force reflow
        void flipCard.offsetWidth;

        // Add shadow overlay for depth
        const shadow = document.createElement('div');
        shadow.style.cssText = `
            position: absolute; inset: 0; z-index: 3;
            background: linear-gradient(${direction === 'left' ? 'to right' : 'to left'},
                rgba(0,0,0,0.15) 0%, transparent 40%);
            opacity: 0;
            transition: opacity ${FLIP_DURATION}ms ease;
            pointer-events: none;
        `;
        this.flipStage.appendChild(shadow);

        // Trigger the flip
        requestAnimationFrame(() => {
            flipCard.style.transform = direction === 'left'
                ? 'rotateY(-180deg)'
                : 'rotateY(180deg)';
            shadow.style.opacity = '1';
        });

        // Cleanup after animation
        const onDone = () => {
            // Set main image to new page
            this.pageImg.src = this.pages[newIdx].dataUrl;
            this.pageImg.style.opacity = '1';

            // Remove temporary elements
            if (flipCard.parentNode) flipCard.parentNode.removeChild(flipCard);
            if (underneath.parentNode) underneath.parentNode.removeChild(underneath);
            if (shadow.parentNode) shadow.parentNode.removeChild(shadow);

            this.currentIndex = newIdx;
            this.bm.currentIndex = newIdx;
            this.bm.updateIndicators();
            this.bm.updateNavButtons();
            this.bm.app.updateThumbnails();
            this._isAnimating = false;
        };

        flipCard.addEventListener('transitionend', (e) => {
            if (e.propertyName === 'transform') onDone();
        }, { once: true });

        // Safety timeout
        setTimeout(() => { if (this._isAnimating) onDone(); }, FLIP_DURATION + 100);
    }

    next() {
        if (this.currentIndex < this.pages.length - 1) {
            this.resetZoom(false);
            this._flipTo(this.currentIndex + 1, 'left');
        }
    }

    prev() {
        if (this.currentIndex > 0) {
            this.resetZoom(false);
            this._flipTo(this.currentIndex - 1, 'right');
        }
    }

    goTo(idx) {
        if (idx === this.currentIndex || this._isAnimating) return;
        this.resetZoom(false);
        const dir = idx > this.currentIndex ? 'left' : 'right';
        this._flipTo(idx, dir);
    }

    // --- Zoom & Pan (for pinch-to-zoom) ---
    _applyTransform() {
        const maxPan = (this.zoomLevel - 1) * 250;
        this.panX = Math.max(-maxPan, Math.min(maxPan, this.panX));
        this.panY = Math.max(-maxPan, Math.min(maxPan, this.panY));
        this.pageImg.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.zoomLevel})`;
        this.pageImg.style.transformOrigin = 'center center';
        this.pageImg.style.willChange = 'transform';

        const stage = this.bm.stage;
        if (stage) stage.classList.toggle('is-zoomed', this.zoomLevel > 1.05);
    }

    resetZoom(animate = false) {
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this._initialPanX = 0;
        this._initialPanY = 0;
        if (animate) {
            this.pageImg.style.transition = 'transform 0.3s cubic-bezier(.25,.8,.25,1)';
            setTimeout(() => { this.pageImg.style.transition = 'none'; }, 320);
        } else {
            this.pageImg.style.transition = 'none';
        }
        this._applyTransform();
    }

    setZoom(level) {
        this.zoomLevel = Math.max(1, Math.min(4, level));
        if (this.zoomLevel <= 1.05) {
            this.resetZoom(true);
        } else {
            this.panX = 0;
            this.panY = 0;
            this._initialPanX = 0;
            this._initialPanY = 0;
            this._applyTransform();
        }
    }

    // --- Touch Gesture Handling ---
    _bindGestures() {
        const stage = this.bm.stage;

        this._onTouchStart = (e) => {
            if (!stage.contains(e.target)) return;
            if (this._isAnimating) return;
            this._maxTouches = e.touches.length;
            this._gestureState = null;
            this._dragDx = 0;

            if (e.touches.length === 1) {
                this._touchStartX = e.touches[0].clientX;
                this._touchStartY = e.touches[0].clientY;
                this._touchStartTime = Date.now();
                this._swipeLocked = false;
                this._initialPanX = this.panX;
                this._initialPanY = this.panY;
            } else if (e.touches.length === 2) {
                this._gestureState = 'pinch';
                this._swipeLocked = true;
                const dx = e.touches[1].clientX - e.touches[0].clientX;
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                this._initialPinchDist = Math.hypot(dx, dy);
                this._initialZoom = this.zoomLevel;
                this._initialPanX = this.panX;
                this._initialPanY = this.panY;
                this._pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                this._pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            }
        };

        this._onTouchMove = (e) => {
            if (this._isAnimating) return;
            this._maxTouches = Math.max(this._maxTouches, e.touches.length);

            if (e.touches.length === 2) {
                // Pinch zoom
                e.preventDefault();
                this._gestureState = 'pinch';
                this._swipeLocked = true;
                const dx = e.touches[1].clientX - e.touches[0].clientX;
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                const dist = Math.hypot(dx, dy);
                const scale = dist / this._initialPinchDist;
                this.zoomLevel = Math.max(1, Math.min(4, this._initialZoom * scale));

                const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                this.panX = this._initialPanX + (midX - this._pinchMidX);
                this.panY = this._initialPanY + (midY - this._pinchMidY);
                this._applyTransform();
            } else if (e.touches.length === 1 && !this._swipeLocked) {
                const dx = e.touches[0].clientX - this._touchStartX;
                const dy = e.touches[0].clientY - this._touchStartY;

                if (this.zoomLevel > 1.05) {
                    // Pan when zoomed
                    if (!this._gestureState) this._gestureState = 'pan';
                    if (this._gestureState === 'pan') {
                        e.preventDefault();
                        this.panX = this._initialPanX + dx;
                        this.panY = this._initialPanY + dy;
                        this._applyTransform();
                    }
                } else {
                    // Detect horizontal drag for interactive page curl preview
                    if (Math.abs(dx) > 10 && Math.abs(dy) < Math.abs(dx) * 1.2) {
                        if (!this._gestureState) this._gestureState = 'drag';
                    }
                    if (this._gestureState === 'drag') {
                        e.preventDefault();
                        this._dragDx = dx;
                        // Interactive curl: slight rotation following the finger
                        const containerW = this.container.offsetWidth;
                        const progress = Math.min(1, Math.abs(dx) / (containerW * 0.5));
                        const maxAngle = 25; // degrees
                        if (dx < 0 && this.currentIndex < this.pages.length - 1) {
                            // Dragging left — preview next page flip
                            const angle = progress * maxAngle;
                            this.pageImg.style.transition = 'none';
                            this.pageImg.style.transformOrigin = 'right center';
                            this.pageImg.style.transform = `perspective(1800px) rotateY(${-angle}deg)`;
                        } else if (dx > 0 && this.currentIndex > 0) {
                            // Dragging right — preview prev page flip
                            const angle = progress * maxAngle;
                            this.pageImg.style.transition = 'none';
                            this.pageImg.style.transformOrigin = 'left center';
                            this.pageImg.style.transform = `perspective(1800px) rotateY(${angle}deg)`;
                        } else {
                            // At boundary — rubber band
                            const rubberDx = dx * 0.15;
                            this.pageImg.style.transition = 'none';
                            this.pageImg.style.transformOrigin = 'center center';
                            this.pageImg.style.transform = `translateX(${rubberDx}px)`;
                        }
                    }
                }
            }
        };

        this._onTouchEnd = (e) => {
            if (this._isAnimating) return;

            if (this._gestureState === 'pinch') {
                this._initialPanX = this.panX;
                this._initialPanY = this.panY;
                if (this.zoomLevel <= 1.05) this.resetZoom(true);
                this._gestureState = null;
                return;
            }
            if (this._gestureState === 'pan') {
                this._initialPanX = this.panX;
                this._initialPanY = this.panY;
                this._gestureState = null;
                return;
            }

            // Interactive drag release
            if (this._gestureState === 'drag') {
                const dx = this._dragDx;
                const dt = Date.now() - this._touchStartTime;
                const velocity = Math.abs(dx) / dt;
                const threshold = this.container.offsetWidth * 0.15;
                const isSwipeFast = velocity > 0.3;
                const isDragFar = Math.abs(dx) > threshold;

                // Reset the interactive curl first
                this.pageImg.style.transition = 'transform 0.3s ease';
                this.pageImg.style.transformOrigin = 'center center';
                this.pageImg.style.transform = 'none';
                setTimeout(() => { this.pageImg.style.transition = 'none'; }, 310);

                if ((isSwipeFast || isDragFar) && dx < 0 && this.currentIndex < this.pages.length - 1) {
                    setTimeout(() => this.next(), 50);
                } else if ((isSwipeFast || isDragFar) && dx > 0 && this.currentIndex > 0) {
                    setTimeout(() => this.prev(), 50);
                }

                this._gestureState = null;
                this._dragDx = 0;
                return;
            }

            // Quick flick detection
            if (this._maxTouches === 1 && !this._swipeLocked && e.changedTouches.length === 1) {
                const endX = e.changedTouches[0].clientX;
                const dx = endX - this._touchStartX;
                const dy = e.changedTouches[0].clientY - this._touchStartY;
                const dt = Date.now() - this._touchStartTime;
                const isZoomed = this.zoomLevel > 1.05;

                if (!isZoomed && dt < 300 && Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx) * 0.7) {
                    if (dx < 0) this.next();
                    else this.prev();
                }
            }
            this._gestureState = null;
        };

        stage.addEventListener('touchstart', this._onTouchStart, { passive: true });
        stage.addEventListener('touchmove', this._onTouchMove, { passive: false });
        stage.addEventListener('touchend', this._onTouchEnd, { passive: true });
    }

    destroy() {
        const stage = this.bm.stage;
        if (stage) {
            stage.removeEventListener('touchstart', this._onTouchStart);
            stage.removeEventListener('touchmove', this._onTouchMove);
            stage.removeEventListener('touchend', this._onTouchEnd);
            stage.classList.remove('is-zoomed');
        }
        this.container.innerHTML = '';
        this.container.style.cssText = '';
    }
}
