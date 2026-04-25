// ==================================================
// Mobile Single-Page Viewer
// AnyFlip-style horizontal slide transitions
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
        this._dragDx = 0; // live drag offset for interactive swipe

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
            justify-content: center;
        `;

        // Slider track — holds current (and temporarily next/prev) page
        this.track = document.createElement('div');
        this.track.style.cssText = `
            position: absolute; inset: 0;
            display: flex; align-items: center; justify-content: center;
            will-change: transform;
        `;
        this.container.appendChild(this.track);

        // Current page image
        this.pageImg = this._createImg();
        this.track.appendChild(this.pageImg);
    }

    _createImg() {
        const img = document.createElement('img');
        img.draggable = false;
        img.style.cssText = `
            max-width: 100%; max-height: 100%;
            object-fit: contain; pointer-events: none;
            user-select: none; -webkit-user-select: none;
            flex-shrink: 0;
        `;
        return img;
    }

    _showInitial(idx) {
        this.currentIndex = idx;
        this.bm.currentIndex = idx;
        this.pageImg.src = this.pages[idx].dataUrl;
        this.track.style.transform = 'translateX(0)';
        this.bm.updateIndicators();
        this.bm.updateNavButtons();
        this.bm.app.updateThumbnails();
    }

    // --- AnyFlip-style horizontal slide transition ---
    _slideTo(newIdx, direction) {
        // direction: 'left' = next page, 'right' = prev page
        if (this._isAnimating) return;
        if (newIdx < 0 || newIdx >= this.pages.length) return;
        this._isAnimating = true;

        const containerW = this.container.offsetWidth;

        // Create incoming page image
        const incoming = this._createImg();
        incoming.src = this.pages[newIdx].dataUrl;
        incoming.style.position = 'absolute';
        incoming.style.maxWidth = '100%';
        incoming.style.maxHeight = '100%';

        // Position incoming off-screen
        if (direction === 'left') {
            // Next: incoming starts to the right
            incoming.style.left = containerW + 'px';
        } else {
            // Prev: incoming starts to the left
            incoming.style.left = -containerW + 'px';
        }

        this.track.style.transition = 'none';
        this.track.appendChild(incoming);

        // Force reflow to ensure position is applied before animation
        void this.track.offsetWidth;

        // Animate slide
        const slideDistance = direction === 'left' ? -containerW : containerW;
        this.track.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        this.track.style.transform = `translateX(${slideDistance}px)`;

        const onDone = () => {
            this.track.removeEventListener('transitionend', onDone);
            // Swap: remove old, reset track
            this.track.style.transition = 'none';
            this.track.style.transform = 'translateX(0)';
            this.pageImg.src = this.pages[newIdx].dataUrl;

            // Remove incoming element
            if (incoming.parentNode) incoming.parentNode.removeChild(incoming);

            this.currentIndex = newIdx;
            this.bm.currentIndex = newIdx;
            this.bm.updateIndicators();
            this.bm.updateNavButtons();
            this.bm.app.updateThumbnails();
            this._isAnimating = false;
        };

        this.track.addEventListener('transitionend', onDone, { once: true });

        // Safety timeout in case transitionend doesn't fire
        setTimeout(() => {
            if (this._isAnimating) onDone();
        }, 450);
    }

    next() {
        if (this.currentIndex < this.pages.length - 1) {
            this.resetZoom(false);
            this._slideTo(this.currentIndex + 1, 'left');
        }
    }

    prev() {
        if (this.currentIndex > 0) {
            this.resetZoom(false);
            this._slideTo(this.currentIndex - 1, 'right');
        }
    }

    goTo(idx) {
        if (idx === this.currentIndex || this._isAnimating) return;
        this.resetZoom(false);
        const dir = idx > this.currentIndex ? 'left' : 'right';
        this._slideTo(idx, dir);
    }

    // --- Zoom & Pan (for pinch-to-zoom) ---
    _applyTransform() {
        const maxPan = (this.zoomLevel - 1) * 250;
        this.panX = Math.max(-maxPan, Math.min(maxPan, this.panX));
        this.panY = Math.max(-maxPan, Math.min(maxPan, this.panY));
        this.pageImg.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
        this.pageImg.style.transformOrigin = 'center center';

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
                    // Interactive drag — follow finger horizontally (AnyFlip feel)
                    if (Math.abs(dx) > 10 && Math.abs(dy) < Math.abs(dx) * 1.2) {
                        if (!this._gestureState) this._gestureState = 'drag';
                    }
                    if (this._gestureState === 'drag') {
                        e.preventDefault();
                        // Apply resistance at boundaries
                        let clampedDx = dx;
                        if ((dx > 0 && this.currentIndex === 0) || (dx < 0 && this.currentIndex >= this.pages.length - 1)) {
                            clampedDx = dx * 0.2; // rubber-band effect
                        }
                        this._dragDx = clampedDx;
                        this.track.style.transition = 'none';
                        this.track.style.transform = `translateX(${clampedDx}px)`;
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

            // Interactive drag release — decide: navigate or snap back
            if (this._gestureState === 'drag') {
                const dx = this._dragDx;
                const dt = Date.now() - this._touchStartTime;
                const velocity = Math.abs(dx) / dt; // px/ms
                const threshold = this.container.offsetWidth * 0.2;
                const isSwipeFast = velocity > 0.3;
                const isDragFar = Math.abs(dx) > threshold;

                if ((isSwipeFast || isDragFar) && dx < 0 && this.currentIndex < this.pages.length - 1) {
                    // Commit next
                    this._commitDragSlide(this.currentIndex + 1, 'left');
                } else if ((isSwipeFast || isDragFar) && dx > 0 && this.currentIndex > 0) {
                    // Commit prev
                    this._commitDragSlide(this.currentIndex - 1, 'right');
                } else {
                    // Snap back
                    this.track.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                    this.track.style.transform = 'translateX(0)';
                }

                this._gestureState = null;
                this._dragDx = 0;
                return;
            }

            // Tap-based swipe detection (quick flick without drag state)
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

    // Complete an interactive drag into a full page slide
    _commitDragSlide(newIdx, direction) {
        if (newIdx < 0 || newIdx >= this.pages.length) return;
        this._isAnimating = true;

        const containerW = this.container.offsetWidth;

        // Create incoming page at correct offset position
        const incoming = this._createImg();
        incoming.src = this.pages[newIdx].dataUrl;
        incoming.style.position = 'absolute';
        incoming.style.maxWidth = '100%';
        incoming.style.maxHeight = '100%';

        if (direction === 'left') {
            incoming.style.left = containerW + 'px';
        } else {
            incoming.style.left = -containerW + 'px';
        }

        this.track.appendChild(incoming);
        void this.track.offsetWidth;

        // Animate to final position
        const slideDistance = direction === 'left' ? -containerW : containerW;
        this.track.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        this.track.style.transform = `translateX(${slideDistance}px)`;

        const onDone = () => {
            this.track.removeEventListener('transitionend', onDone);
            this.track.style.transition = 'none';
            this.track.style.transform = 'translateX(0)';
            this.pageImg.src = this.pages[newIdx].dataUrl;
            if (incoming.parentNode) incoming.parentNode.removeChild(incoming);

            this.currentIndex = newIdx;
            this.bm.currentIndex = newIdx;
            this.bm.updateIndicators();
            this.bm.updateNavButtons();
            this.bm.app.updateThumbnails();
            this._isAnimating = false;
        };

        this.track.addEventListener('transitionend', onDone, { once: true });
        setTimeout(() => { if (this._isAnimating) onDone(); }, 400);
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
