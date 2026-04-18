/**
 * SleekBook — PDF to Flipbook Engine
 * Powered by Antigravity
 *
 * Upload a PDF → renders each page as a canvas image → displays as an interactive flipbook
 * with physics-based page turning.
 */

// Configure PDF.js worker
// Disable worker to avoid CORS issues when opened from file:// protocol
if (window.location.protocol === 'file:') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
} else {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ==================================================
// PDF Renderer
// ==================================================
class PDFRenderer {
    constructor() {
        this.pdfDoc = null;
        this.pages = [];
        this.renderScale = 2;
    }

    async loadPDF(data) {
        const loadingTask = pdfjsLib.getDocument({
            data: data,
            cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
            cMapPacked: true,
        });
        this.pdfDoc = await loadingTask.promise;
        return this.pdfDoc.numPages;
    }

    async renderPage(pageNum) {
        const page = await this.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: this.renderScale });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        return {
            pageNum,
            dataUrl: canvas.toDataURL('image/jpeg', 0.92),
            width: viewport.width,
            height: viewport.height
        };
    }

    async renderAllPages(onProgress) {
        this.pages = [];
        const total = this.pdfDoc.numPages;
        for (let i = 1; i <= total; i++) {
            const pageData = await this.renderPage(i);
            this.pages.push(pageData);
            if (onProgress) onProgress(i, total);
        }
        return this.pages;
    }
}

// ==================================================
// Upload Manager
// ==================================================
class UploadManager {
    constructor(app) {
        this.app = app;
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('pdf-input');
        this.processingBar = document.getElementById('processing-bar');
        this.processingFill = document.getElementById('processing-fill');
        this.processingText = document.getElementById('processing-text');
        this.bindEvents();
    }

    bindEvents() {
        this.dropZone.addEventListener('click', () => {
            if (this.app.isAuthenticated) this.fileInput.click();
        });
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) this.handleFile(e.target.files[0]);
        });
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (this.app.isAuthenticated) this.dropZone.classList.add('dragover');
        });
        this.dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault(); e.stopPropagation();
            this.dropZone.classList.remove('dragover');
        });
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation();
            this.dropZone.classList.remove('dragover');
            if (!this.app.isAuthenticated) return;

            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') {
                this.handleFile(files[0]);
            } else {
                this.showError('Please drop a valid PDF file.');
            }
        });
    }

    async handleFile(file) {
        if (file.size > 50 * 1024 * 1024) {
            this.showError('File terlalu besar! Maksimal 50MB.');
            return;
        }
        this.dropZone.style.display = 'none';
        this.processingBar.classList.remove('hidden');
        this.processingText.textContent = 'Reading PDF...';
        this.processingFill.style.width = '5%';

        try {
            const arrayBuffer = await this.readFileAsArrayBuffer(file);
            const uint8Array = new Uint8Array(arrayBuffer);
            const renderer = new PDFRenderer();
            this.processingText.textContent = 'Processing pages...';
            this.processingFill.style.width = '15%';
            await renderer.loadPDF(uint8Array);
            const pages = await renderer.renderAllPages((current, total) => {
                const progress = 15 + (current / total) * 80;
                this.processingFill.style.width = `${progress}%`;
                this.processingText.textContent = `Rendering page ${current} of ${total}...`;
            });
            this.processingFill.style.width = '100%';
            this.processingText.textContent = 'Launching flipbook...';
            await new Promise(r => setTimeout(r, 400));
            this.app.launchFlipbook(pages, file.name.replace(/\.pdf$/i, ''));
        } catch (err) {
            console.error('PDF Processing Error:', err);
            this.showError('Failed to process PDF. Please try another file.');
            this.resetUpload();
        }
    }

    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }

    showError(msg) {
        const zone = this.dropZone;
        const origTitle = zone.querySelector('.drop-title').textContent;
        zone.querySelector('.drop-title').textContent = msg;
        zone.querySelector('.drop-title').style.color = '#e11d48';
        setTimeout(() => {
            zone.querySelector('.drop-title').textContent = origTitle;
            zone.querySelector('.drop-title').style.color = '';
        }, 3000);
    }

    resetUpload() {
        if (this.app.isAuthenticated) {
            this.dropZone.style.display = '';
        } else {
            this.dropZone.style.display = 'none';
        }
        this.processingBar.classList.add('hidden');
        this.processingFill.style.width = '0%';
        this.fileInput.value = '';
    }
}

// ==================================================
// Book Manager — Single-Sheet Flipbook Model
// ==================================================
class BookManager {
    constructor(app, pages) {
        this.app = app;
        this.pages = pages;
        this.currentIndex = 0; // current view index (0 to N-1)
        this.container = document.getElementById('flipbook-container');
        this.zoomLevel = 1;

        // PDF aspect ratio for dynamic sizing
        this.pageAspect = pages[0] ? (pages[0].width / pages[0].height) : (4 / 3);
        this.applyDynamicSize();

        // Flip state
        this.isInteracting = false;
        this.flipEntity = null;
        this.startX = 0;
        this.startWidth = 0;
        this.flipDirection = '';
        this.currentAngle = 0;

        this.isMobile = window.innerWidth <= 850;
        window.addEventListener('resize', () => {
            this.isMobile = window.innerWidth <= 850;
            this.applyDynamicSize();
            this.renderVisiblePages();
        });

        this.bindEvents();
        this.setupPhysics();
    }

    applyDynamicSize() {
        const maxH = window.innerHeight - 160;
        const maxW = window.innerWidth * 0.88;
        let pageH = maxH;
        let pageW = pageH * this.pageAspect;
        const spreadW = this.isMobile ? pageW : pageW * 2;
        if (spreadW > maxW) {
            const scale = maxW / spreadW;
            pageW *= scale;
            pageH *= scale;
        }
        this.container.style.width = (this.isMobile ? pageW : pageW * 2) + 'px';
        this.container.style.height = pageH + 'px';
    }

    // ===================================
    // Content Model
    // ===================================
    getLeftContent(v) {
        if (v <= 0) return null;                            // Cover: no left page
        if (v >= this.pages.length - 1) return this.pages[v]; // Back cover: content on left
        return 'blank';                                      // Back of paper
    }

    getRightContent(v) {
        if (v >= this.pages.length - 1) return null;  // Back cover: no right page
        return this.pages[v];                          // PDF page on right
    }

    canGoForward() { return this.currentIndex < this.pages.length - 1; }
    canGoBackward() { return this.currentIndex > 0; }

    // ===================================
    // Events & Physics
    // ===================================
    bindEvents() {
        document.getElementById('nav-prev').addEventListener('click', () => this.turnBackward());
        document.getElementById('nav-next').addEventListener('click', () => this.turnForward());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this.turnForward(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); this.turnBackward(); }
            else if (e.key === 'Home') { this.goToPage(0); }
            else if (e.key === 'End') { this.goToPage(this.pages.length - 1); }
        });
    }

    setupPhysics() {
        const wrap = document.getElementById('book-wrapper');

        wrap.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.book-nav') || e.target.closest('.thumb-item')) return;
            const rect = this.container.getBoundingClientRect();
            const clickedRight = e.clientX > rect.left + rect.width / 2;

            if (clickedRight && this.canGoForward()) {
                this.beginFlip(e, 'forward', rect);
            } else if (!clickedRight && this.canGoBackward()) {
                this.beginFlip(e, 'backward', rect);
            }
        });

        wrap.addEventListener('pointermove', (e) => {
            if (!this.isInteracting || !this.flipEntity) return;
            e.preventDefault();
            const deltaX = e.clientX - this.startX;
            const progress = Math.max(-1, Math.min(1, deltaX / this.startWidth));

            if (this.flipDirection === 'forward') {
                this.currentAngle = Math.max(-180, Math.min(0, progress * 180));
            } else {
                this.currentAngle = Math.min(0, Math.max(-180, -180 + progress * 180));
            }
            this.flipEntity.style.transform = `rotateY(${this.currentAngle}deg)`;
            this.flipEntity.style.zIndex = Math.abs(this.currentAngle) > 90 ? 3 : 5;
        });

        const endFlip = () => {
            if (!this.isInteracting || !this.flipEntity) return;
            this.isInteracting = false;
            const shouldCommit = this.flipDirection === 'forward'
                ? this.currentAngle < -90
                : this.currentAngle > -90;
            if (shouldCommit) this.commitFlip();
            else this.revertFlip();
        };
        wrap.addEventListener('pointerup', endFlip);
        wrap.addEventListener('pointercancel', endFlip);
    }

    beginFlip(e, direction, rect) {
        this.isInteracting = true;
        this.flipDirection = direction;
        this.startX = e.clientX;
        this.startWidth = this.isMobile ? rect.width : rect.width / 2;
        this.buildFlipEntity();
        try { e.target.setPointerCapture(e.pointerId); } catch (_) { }
    }

    commitFlip() {
        const target = this.flipDirection === 'forward' ? '-180deg' : '0deg';
        this.flipEntity.style.transition = 'transform 0.4s ease-out';
        this.flipEntity.style.transform = `rotateY(${target})`;
        setTimeout(() => {
            this.currentIndex += this.flipDirection === 'forward' ? 1 : -1;
            this.currentIndex = Math.max(0, Math.min(this.currentIndex, this.pages.length - 1));
            this.cleanup();
            this.renderVisiblePages();
            this.app.updateThumbnails();
        }, 420);
    }

    revertFlip() {
        const target = this.flipDirection === 'forward' ? '0deg' : '-180deg';
        this.flipEntity.style.transition = 'transform 0.4s ease-out';
        this.flipEntity.style.transform = `rotateY(${target})`;
        setTimeout(() => this.cleanup(), 420);
    }

    // ===================================
    // Flip Entity Builder
    // ===================================
    buildFlipEntity() {
        const el = document.createElement('div');
        el.className = 'fb-spread';
        el.style.zIndex = '5';
        el.style.transformStyle = 'preserve-3d';
        this.flipEntity = el;

        // Front face (visible at rotateY(0deg) — right side)
        const front = this.makeFace('0 6px 6px 0', '2px 0 8px rgba(0,0,0,0.1)');
        front.style.transform = 'rotateY(0deg)';

        // Back face (visible at rotateY(-180deg) — left side after flip)
        const back = this.makeFace('6px 0 0 6px', '-2px 0 8px rgba(0,0,0,0.1)');
        back.style.transform = 'rotateY(180deg)';

        const v = this.currentIndex;

        if (this.flipDirection === 'forward') {
            this.currentAngle = 0;
            // Front = current right page (flipping away)
            this.fillFace(front, this.getRightContent(v));
            // Back = blank (back of paper)
            this.fillFace(back, 'blank');
        } else {
            this.currentAngle = -180;
            el.style.transform = 'rotateY(-180deg)';
            // Front = previous right page (will appear on right when unfolded)
            this.fillFace(front, this.getRightContent(v - 1));
            // Back = current left content (visible on left before unfold)
            this.fillFace(back, this.getLeftContent(v));
        }

        if (this.isMobile) {
            el.style.width = '100%';
            el.style.right = 'auto';
            el.style.left = '0';
            el.style.transformOrigin = 'right center';
        }

        el.appendChild(front);
        el.appendChild(back);
        this.container.appendChild(el);

        // Hide base page being flipped
        if (this.isMobile) {
            const sp = document.getElementById('base-single-page');
            if (sp) sp.style.visibility = 'hidden';
        } else if (this.flipDirection === 'forward') {
            const rp = document.getElementById('base-right-page');
            if (rp) rp.style.visibility = 'hidden';
        } else {
            const lp = document.getElementById('base-left-page');
            if (lp) lp.style.visibility = 'hidden';
        }

        // Render next view underneath
        this.renderBackground();
    }

    makeFace(borderRadius, boxShadow) {
        const f = document.createElement('div');
        f.style.cssText = `
            position: absolute; inset: 0; overflow: hidden;
            backface-visibility: hidden; -webkit-backface-visibility: hidden;
            background: #fafafa;
            border-radius: ${borderRadius};
            box-shadow: ${boxShadow};
        `;
        return f;
    }

    fillFace(faceEl, content) {
        if (!content || content === 'blank') {
            faceEl.style.background = '#fafafa';
            faceEl.innerHTML = '';
        } else if (content && content.dataUrl) {
            faceEl.innerHTML = `<img class="page-img" src="${content.dataUrl}" draggable="false">`;
        }
    }

    cleanup() {
        if (this.flipEntity) { this.flipEntity.remove(); this.flipEntity = null; }
    }

    // ===================================
    // Button Navigation
    // ===================================
    turnForward() {
        if (this.isInteracting || !this.canGoForward()) return;
        this.isInteracting = true;
        this.flipDirection = 'forward';
        this.buildFlipEntity();

        this.flipEntity.style.transition = 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)';
        requestAnimationFrame(() => {
            setTimeout(() => { if (this.flipEntity) this.flipEntity.style.transform = 'rotateY(-180deg)'; }, 20);
        });
        setTimeout(() => { if (this.flipEntity) this.flipEntity.style.zIndex = '3'; }, 300);
        setTimeout(() => {
            this.currentIndex = Math.min(this.currentIndex + 1, this.pages.length - 1);
            this.cleanup();
            this.renderVisiblePages();
            this.app.updateThumbnails();
            this.isInteracting = false;
        }, 650);
    }

    turnBackward() {
        if (this.isInteracting || !this.canGoBackward()) return;
        this.isInteracting = true;
        this.flipDirection = 'backward';
        this.buildFlipEntity();

        this.flipEntity.style.transition = 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)';
        requestAnimationFrame(() => {
            setTimeout(() => { if (this.flipEntity) this.flipEntity.style.transform = 'rotateY(0deg)'; }, 20);
        });
        setTimeout(() => { if (this.flipEntity) this.flipEntity.style.zIndex = '5'; }, 300);
        setTimeout(() => {
            this.currentIndex = Math.max(0, this.currentIndex - 1);
            this.cleanup();
            this.renderVisiblePages();
            this.app.updateThumbnails();
            this.isInteracting = false;
        }, 650);
    }

    goToPage(idx) {
        if (this.isInteracting) return;
        this.currentIndex = Math.max(0, Math.min(idx, this.pages.length - 1));
        this.renderVisiblePages();
        this.app.updateThumbnails();
    }

    // ===================================
    // Static Rendering
    // ===================================
    renderVisiblePages() {
        this.container.innerHTML = '';
        if (this.isMobile) {
            this.renderMobile();
        } else {
            this.renderSpread();
        }
        this.updateIndicators();
        this.updateNavButtons();
    }

    renderMobile() {
        const base = document.createElement('div');
        base.className = 'fb-spread';
        base.id = 'base-single-page';
        base.style.cssText = 'width:100%; right:auto; left:0; z-index:2;';
        const face = document.createElement('div');
        face.className = 'fb-face fb-face-right';
        face.style.borderRadius = '6px';
        face.innerHTML = this.pageImgHTML(this.currentIndex);
        base.appendChild(face);
        this.container.appendChild(base);
    }

    renderSpread() {
        const v = this.currentIndex;
        const leftContent = this.getLeftContent(v);
        const rightContent = this.getRightContent(v);
        const isCover = (v === 0);
        const isBack = (v === this.pages.length - 1);

        // — LEFT HALF — (skip entirely on cover)
        if (!isCover) {
            const baseL = document.createElement('div');
            baseL.className = 'fb-spread';
            baseL.id = 'base-left-page';
            baseL.style.cssText = 'right:auto; left:0; transform-origin:right center; z-index:2;';
            const fL = document.createElement('div');
            fL.className = 'fb-face fb-face-left';

            if (leftContent && leftContent !== 'blank' && leftContent.dataUrl) {
                fL.innerHTML = `<img class="page-img" src="${leftContent.dataUrl}" draggable="false">`;
            } else {
                fL.style.background = '#fafafa';
            }
            baseL.appendChild(fL);
            this.container.appendChild(baseL);
        }

        // — RIGHT HALF — (skip entirely on back cover)
        if (!isBack) {
            const baseR = document.createElement('div');
            baseR.className = 'fb-spread';
            baseR.id = 'base-right-page';
            baseR.style.zIndex = '2';
            const fR = document.createElement('div');
            fR.className = 'fb-face fb-face-right';

            if (rightContent && rightContent.dataUrl) {
                fR.innerHTML = `<img class="page-img" src="${rightContent.dataUrl}" draggable="false">`;
            } else {
                fR.style.background = '#fafafa';
            }
            baseR.appendChild(fR);
            this.container.appendChild(baseR);
        }
    }

    renderBackground() {
        const nextV = this.flipDirection === 'forward'
            ? this.currentIndex + 1
            : this.currentIndex - 1;
        if (nextV < 0 || nextV >= this.pages.length) return;

        if (this.isMobile) {
            const bg = document.createElement('div');
            bg.className = 'fb-spread';
            bg.style.cssText = 'z-index:1; width:100%; right:auto; left:0;';
            const f = document.createElement('div');
            f.className = 'fb-face fb-face-right';
            f.style.borderRadius = '6px';
            f.innerHTML = this.pageImgHTML(nextV);
            bg.appendChild(f);
            this.container.appendChild(bg);
            return;
        }

        const nL = this.getLeftContent(nextV);
        const nR = this.getRightContent(nextV);
        const nextIsCover = (nextV === 0);
        const nextIsBack = (nextV === this.pages.length - 1);

        if (!nextIsCover && nL && nL !== 'blank') {
            const bgL = document.createElement('div');
            bgL.className = 'fb-spread';
            bgL.style.cssText = 'right:auto; left:0; transform-origin:right center; z-index:1;';
            const bfL = document.createElement('div');
            bfL.className = 'fb-face fb-face-left';
            if (nL.dataUrl) {
                bfL.innerHTML = `<img class="page-img" src="${nL.dataUrl}" draggable="false">`;
            }
            bgL.appendChild(bfL);
            this.container.appendChild(bgL);
        }

        if (!nextIsBack && nR && nR.dataUrl) {
            const bgR = document.createElement('div');
            bgR.className = 'fb-spread';
            bgR.style.zIndex = '1';
            const bfR = document.createElement('div');
            bfR.className = 'fb-face fb-face-right';
            bfR.innerHTML = `<img class="page-img" src="${nR.dataUrl}" draggable="false">`;
            bgR.appendChild(bfR);
            this.container.appendChild(bgR);
        }
    }

    pageImgHTML(idx) {
        if (idx < 0 || idx >= this.pages.length) return '';
        return `<img class="page-img" src="${this.pages[idx].dataUrl}" alt="Page ${idx + 1}" draggable="false">`;
    }

    updateIndicators() {
        document.getElementById('current-page').textContent = this.currentIndex + 1;
        document.getElementById('total-page').textContent = this.pages.length;
    }

    updateNavButtons() {
        document.getElementById('nav-prev').disabled = !this.canGoBackward();
        document.getElementById('nav-next').disabled = !this.canGoForward();
    }

    setZoom(level) {
        this.zoomLevel = Math.max(0.5, Math.min(2, level));
        this.container.style.transform = `scale(${this.zoomLevel})`;
    }
}

// ==================================================
// Main App
// ==================================================
class FlipbookApp {
    constructor() {
        this.book = null;
        this.uploadManager = null;
        this.pageImages = [];
        this.isAuthenticated = false; // Status login
        this.initSplash();
        this.bindPasswordEvents();
    }

    bindPasswordEvents() {
        const btnUnlock = document.getElementById('btn-unlock');
        const pwInput = document.getElementById('app-password');
        const pwError = document.getElementById('pw-error');

        const checkPassword = () => {
            if (pwInput.value === 'mijankuy') { // Validasi Password
                this.isAuthenticated = true;
                document.getElementById('password-section').classList.add('hidden');

                const dropZone = document.getElementById('drop-zone');
                dropZone.classList.remove('hidden');
                dropZone.style.display = '';

                pwError.classList.add('hidden');
            } else {
                pwError.classList.remove('hidden');
                pwInput.value = '';
            }
        };

        if (btnUnlock && pwInput) {
            btnUnlock.addEventListener('click', checkPassword);
            pwInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') checkPassword();
            });
        }
    }

    initSplash() {
        setTimeout(() => {
            const splash = document.getElementById('splash-screen');
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.classList.add('hidden');
                this.showUploadScreen();
            }, 800);
        }, 1800);
    }

    showUploadScreen() {
        document.getElementById('upload-screen').classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');

        // Cek autentikasi
        if (!this.isAuthenticated) {
            document.getElementById('password-section').classList.remove('hidden');
            document.getElementById('drop-zone').classList.add('hidden');
            document.getElementById('drop-zone').style.display = 'none';
        } else {
            document.getElementById('password-section').classList.add('hidden');
            const dropZone = document.getElementById('drop-zone');
            dropZone.classList.remove('hidden');
            dropZone.style.display = '';
        }

        if (!this.uploadManager) {
            this.uploadManager = new UploadManager(this);
        } else {
            this.uploadManager.resetUpload();
        }
    }

    launchFlipbook(pages, title) {
        this.pageImages = pages;
        document.getElementById('upload-screen').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('book-title').textContent = title || 'My Flipbook';

        this.book = new BookManager(this, pages);
        this.book.renderVisiblePages();
        this.buildThumbnails();
        this.bindViewerEvents();
    }

    buildThumbnails() {
        const container = document.getElementById('thumb-container');
        container.innerHTML = '';
        this.pageImages.forEach((page, idx) => {
            const thumb = document.createElement('div');
            thumb.className = 'thumb-item';
            if (idx === this.book.currentIndex) thumb.classList.add('active');
            thumb.dataset.page = idx;

            const img = document.createElement('img');
            img.src = page.dataUrl;
            img.alt = `Page ${idx + 1}`;
            img.draggable = false;

            const label = document.createElement('div');
            label.className = 'thumb-label';
            label.textContent = idx + 1;

            thumb.appendChild(img);
            thumb.appendChild(label);
            thumb.addEventListener('click', () => this.book.goToPage(idx));
            container.appendChild(thumb);
        });
    }

    updateThumbnails() {
        const thumbs = document.querySelectorAll('.thumb-item');
        thumbs.forEach(t => {
            const pageIdx = parseInt(t.dataset.page);
            t.classList.toggle('active', pageIdx === this.book.currentIndex);
        });
        const active = document.querySelector('.thumb-item.active');
        if (active) {
            active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    bindViewerEvents() {
        // Theme
        const btnTheme = document.getElementById('btn-theme');
        const newTheme = btnTheme.cloneNode(true);
        btnTheme.parentNode.replaceChild(newTheme, btnTheme);
        newTheme.addEventListener('click', () => {
            const html = document.documentElement;
            const isDark = html.getAttribute('data-theme') === 'dark';
            html.setAttribute('data-theme', isDark ? 'light' : 'dark');
            newTheme.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        });

        // Back
        const btnBack = document.getElementById('btn-back');
        const newBack = btnBack.cloneNode(true);
        btnBack.parentNode.replaceChild(newBack, btnBack);
        newBack.addEventListener('click', () => { this.book = null; this.showUploadScreen(); });

        // Fullscreen
        const btnFs = document.getElementById('btn-fullscreen');
        const newFs = btnFs.cloneNode(true);
        btnFs.parentNode.replaceChild(newFs, btnFs);
        newFs.addEventListener('click', () => {
            const app = document.getElementById('app');
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => { });
                app.classList.add('fullscreen');
                newFs.innerHTML = '<i class="fas fa-compress"></i>';
            } else {
                document.exitFullscreen();
                app.classList.remove('fullscreen');
                newFs.innerHTML = '<i class="fas fa-expand"></i>';
            }
        });

        // Zoom
        const btnZI = document.getElementById('btn-zoom-in');
        const newZI = btnZI.cloneNode(true);
        btnZI.parentNode.replaceChild(newZI, btnZI);
        newZI.addEventListener('click', () => { if (this.book) this.book.setZoom(this.book.zoomLevel + 0.15); });

        const btnZO = document.getElementById('btn-zoom-out');
        const newZO = btnZO.cloneNode(true);
        btnZO.parentNode.replaceChild(newZO, btnZO);
        newZO.addEventListener('click', () => { if (this.book) this.book.setZoom(this.book.zoomLevel - 0.15); });

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                document.getElementById('app').classList.remove('fullscreen');
                const fsBtn = document.getElementById('btn-fullscreen');
                if (fsBtn) fsBtn.innerHTML = '<i class="fas fa-expand"></i>';
            }
        });
    }
}

// ==================================================
// Boot
// ==================================================
document.addEventListener('DOMContentLoaded', () => {
    window.sleekBookApp = new FlipbookApp();
});