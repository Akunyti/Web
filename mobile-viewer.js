// ==================================================
// Mobile Single-Page Viewer
// Bypasses StPageFlip on mobile, shows 1 page at a time
// ==================================================
class MobileViewer {
    constructor(bookManager) {
        this.bm = bookManager;
        this.container = bookManager.container;
        this.pages = bookManager.pages;
        this.currentIndex = bookManager.currentIndex || 0;

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

        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;

        this._buildDOM();
        this._bindGestures();
        this.showPage(this.currentIndex, false);
    }

    _buildDOM() {
        this.container.innerHTML = '';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.position = 'relative';
        this.container.style.overflow = 'hidden';
        this.container.style.display = 'flex';
        this.container.style.alignItems = 'center';
        this.container.style.justifyContent = 'center';

        // Single page image element
        this.pageImg = document.createElement('img');
        this.pageImg.className = 'mobile-page-img';
        this.pageImg.draggable = false;
        this.pageImg.style.cssText = `
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            pointer-events: none;
            user-select: none;
            -webkit-user-select: none;
            transform-origin: center center;
            will-change: transform;
            transition: none;
        `;
        this.container.appendChild(this.pageImg);
    }

    showPage(idx, animate = true) {
        if (idx < 0 || idx >= this.pages.length) return;
        this.currentIndex = idx;
        this.bm.currentIndex = idx;

        if (animate) {
            this.pageImg.style.transition = 'opacity 0.15s ease';
            this.pageImg.style.opacity = '0';
            setTimeout(() => {
                this.pageImg.src = this.pages[idx].dataUrl;
                this.pageImg.style.opacity = '1';
                setTimeout(() => { this.pageImg.style.transition = 'none'; }, 160);
            }, 100);
        } else {
            this.pageImg.src = this.pages[idx].dataUrl;
        }

        this.bm.updateIndicators();
        this.bm.updateNavButtons();
        this.bm.app.updateThumbnails();
    }

    next() {
        if (this.currentIndex < this.pages.length - 1) {
            this.resetZoom(false);
            this.showPage(this.currentIndex + 1);
        }
    }

    prev() {
        if (this.currentIndex > 0) {
            this.resetZoom(false);
            this.showPage(this.currentIndex - 1);
        }
    }

    goTo(idx) {
        this.resetZoom(false);
        this.showPage(idx);
    }

    _applyTransform() {
        const maxPan = (this.zoomLevel - 1) * 250;
        this.panX = Math.max(-maxPan, Math.min(maxPan, this.panX));
        this.panY = Math.max(-maxPan, Math.min(maxPan, this.panY));
        this.pageImg.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;

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

    _bindGestures() {
        const stage = this.bm.stage;

        this._onTouchStart = (e) => {
            if (!stage.contains(e.target)) return;
            this._maxTouches = e.touches.length;
            this._gestureState = null;

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
            this._maxTouches = Math.max(this._maxTouches, e.touches.length);

            if (e.touches.length === 2) {
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
                    if (!this._gestureState) this._gestureState = 'pan';
                    if (this._gestureState === 'pan') {
                        e.preventDefault();
                        this.panX = this._initialPanX + dx;
                        this.panY = this._initialPanY + dy;
                        this._applyTransform();
                    }
                }
            }
        };

        this._onTouchEnd = (e) => {
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

            // Swipe detection
            if (this._maxTouches === 1 && !this._swipeLocked && e.changedTouches.length === 1) {
                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const dx = endX - this._touchStartX;
                const dy = endY - this._touchStartY;
                const dt = Date.now() - this._touchStartTime;
                const isZoomed = this.zoomLevel > 1.05;

                if (!isZoomed && dt < 450 && Math.abs(dx) > 35 && Math.abs(dy) < Math.abs(dx) * 0.8) {
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
