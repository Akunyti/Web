/**
 * SleekBook — PDF to Flipbook Engine
 * Features: Auth, Dashboard (Max 5 PDFs), Local IndexedDB Storage
 */

if (window.location.protocol === 'file:') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
} else {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ==================================================
// Local Database (IndexedDB untuk PDF)
// ==================================================
class DBManager {
    constructor() {
        this.dbName = 'SleekBookDB';
        this.dbVersion = 1;
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onerror = (e) => reject("Database error: " + e.target.errorCode);
            request.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('pdfs')) {
                    const store = db.createObjectStore('pdfs', { keyPath: 'id' });
                    store.createIndex('username', 'username', { unique: false });
                }
            };
        });
    }

    savePDF(username, fileInfo, arrayBuffer) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pdfs'], 'readwrite');
            const store = tx.objectStore('pdfs');
            const record = {
                id: Date.now().toString(),
                username: username,
                name: fileInfo.name,
                size: fileInfo.size,
                date: new Date().toLocaleDateString('id-ID'),
                data: arrayBuffer
            };
            const request = store.add(record);
            request.onsuccess = () => resolve(record);
            request.onerror = () => reject("Gagal menyimpan PDF.");
        });
    }

    getUserPDFs(username) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pdfs'], 'readonly');
            const store = tx.objectStore('pdfs');
            const index = store.index('username');
            const request = index.getAll(username);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject("Gagal mengambil data.");
        });
    }

    getPDFData(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pdfs'], 'readonly');
            const store = tx.objectStore('pdfs');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = () => reject("Gagal membuka file.");
        });
    }

    deletePDF(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['pdfs'], 'readwrite');
            const store = tx.objectStore('pdfs');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject("Gagal menghapus file.");
        });
    }
}

// ==================================================
// PDF Renderer
// ==================================================
class PDFRenderer {
    constructor() { this.pdfDoc = null; this.pages = []; this.renderScale = 2; }
    async loadPDF(data) {
        const loadingTask = pdfjsLib.getDocument({ data: data, cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/', cMapPacked: true });
        this.pdfDoc = await loadingTask.promise;
        return this.pdfDoc.numPages;
    }
    async renderPage(pageNum) {
        const page = await this.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: this.renderScale });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        return { pageNum, dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: viewport.width, height: viewport.height };
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
// Main App Controller
// ==================================================
class FlipbookApp {
    constructor() {
        this.db = new DBManager();
        this.currentUser = null;
        this.userFiles = [];
        this.book = null;

        this.ui = {
            splash: document.getElementById('splash-screen'),
            catalogScreen: document.getElementById('catalog-screen'),
            authScreen: document.getElementById('auth-screen'),
            dashScreen: document.getElementById('dashboard-screen'),
            appScreen: document.getElementById('app'),
            viewerLoading: document.getElementById('viewer-loading')
        };
        
        this.fromCatalog = false;

        this.init();
    }

    async init() {
        try {
            await this.db.init();
        } catch (e) {
            console.error("IndexedDB tidak didukung:", e);
        }

        const urlParams = new URLSearchParams(window.location.search);
        const externalFile = urlParams.get('file');

        setTimeout(() => {
            this.ui.splash.style.opacity = '0';
            setTimeout(() => {
                this.ui.splash.classList.add('hidden');
                if (externalFile) {
                    // Direct link ke PDF tertentu
                    this.loadExternalPDF(externalFile);
                } else {
                    // Tampilkan katalog multi-PDF
                    this.checkCatalogOrLogin();
                }
            }, 800);
        }, 1500);

        this.bindAuthEvents();
        this.bindDashEvents();
        this.bindViewerEvents();
    }

    async checkCatalogOrLogin() {
        let catalogData = [];
        try {
            const resp = await fetch('katalog.json');
            if (resp.ok) {
                catalogData = await resp.json();
            }
        } catch(e) {
            // fetch gagal (misal file:// protocol), tetap tampilkan katalog kosong
            console.warn('katalog.json tidak bisa di-fetch (normal jika buka via file://)');
        }
        
        // Selalu tampilkan halaman katalog sebagai landing page
        this.renderCatalog(catalogData);
    }

    renderCatalog(data) {
        this.showScreen('catalogScreen');
        const grid = document.getElementById('catalog-grid');
        grid.innerHTML = '';
        
        // Normalisasi data: dukung array of strings ATAU array of objects
        const items = data.map(entry => {
            if (typeof entry === 'string') {
                // Hanya nama file, auto-generate judul
                return { file: entry, title: this.prettifyFilename(entry), description: '' };
            }
            // Object format: { file, title?, description?, cover? }
            return {
                file: entry.file,
                title: entry.title || this.prettifyFilename(entry.file),
                description: entry.description || '',
                cover: entry.cover || null
            };
        });

        if (items.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-dim); padding:40px;">Katalog kosong.</div>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'catalog-card';
            card.innerHTML = `
                <div class="catalog-cover-icon"><i class="fas fa-book-open"></i></div>
                <div class="catalog-info">
                    <div class="catalog-title">${item.title}</div>
                    <div class="catalog-desc">${item.description}</div>
                    <div class="catalog-action">Baca Sekarang <i class="fas fa-arrow-right"></i></div>
                </div>
            `;
            card.addEventListener('click', () => {
                this.fromCatalog = true;
                this.loadExternalPDF(item.file);
            });
            grid.appendChild(card);
        });

        document.getElementById('btn-go-admin').onclick = () => {
             this.showScreen('authScreen');
        };
    }

    // Ubah nama file random jadi judul yang rapi
    prettifyFilename(filename) {
        return filename
            .replace(/\.pdf$/i, '')       // hapus .pdf
            .replace(/[_\-\.]+/g, ' ')    // ganti _, -, . jadi spasi
            .replace(/\s+/g, ' ')         // hapus spasi ganda
            .trim()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ') || 'Untitled';
    }

    showScreen(screenName) {
        Object.values(this.ui).forEach(el => el && el.classList.add('hidden'));
        if (this.ui[screenName]) this.ui[screenName].classList.remove('hidden');
    }

    // --- AUTHENTICATION ---
    checkLoginState() {
        const loggedInUser = localStorage.getItem('sleekbook_active_user');
        if (loggedInUser) {
            this.currentUser = loggedInUser;
            this.loadDashboard();
        } else {
            this.showScreen('authScreen');
        }
    }

    bindAuthEvents() {
        const btnLogin = document.getElementById('btn-login');
        const passIn = document.getElementById('auth-password');
        const errTxt = document.getElementById('auth-error');
        const btnBack = document.getElementById('btn-back-viewer');

        if(btnBack) {
            btnBack.addEventListener('click', () => {
                this.showScreen('appScreen');
            });
        }

        const doAuth = () => {
            const p = passIn.value.trim();
            if (!p) {
                errTxt.textContent = "Isi password!";
                errTxt.classList.remove('hidden'); return;
            }

            if (p !== 'mijankuy' && p !== 'mijankuyy') {
                errTxt.textContent = "Password salah!";
                errTxt.classList.remove('hidden'); return;
            }

            errTxt.classList.add('hidden');
            passIn.value = '';
            
            // Redirect to GitHub for editing
            window.open('https://github.com/', '_blank');
            this.showScreen('appScreen');
        };

        btnLogin.addEventListener('click', doAuth);
        passIn.addEventListener('keypress', (e) => { if (e.key === 'Enter') doAuth(); });
    }

    // --- DASHBOARD ---
    async loadDashboard() {
        this.showScreen('dashScreen');
        document.getElementById('dash-username').textContent = this.currentUser;
        await this.refreshFileList();
    }

    async refreshFileList() {
        try {
            this.userFiles = await this.db.getUserPDFs(this.currentUser);
            const count = this.userFiles.length;
            document.getElementById('file-count').textContent = count;

            const dropZone = document.getElementById('drop-zone');
            if (count >= 5) {
                dropZone.classList.add('disabled');
                dropZone.querySelector('span').textContent = "Batas 5 File Tercapai";
            } else {
                dropZone.classList.remove('disabled');
                dropZone.querySelector('span').textContent = "Upload PDF Baru (Max 50MB)";
            }

            this.renderFileGrid();
        } catch (e) {
            console.error(e);
        }
    }

    renderFileGrid() {
        const grid = document.getElementById('file-grid');
        grid.innerHTML = '';
        if (this.userFiles.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-dim); padding:40px;">Belum ada file. Upload PDF pertamamu!</div>';
            return;
        }

        this.userFiles.forEach(file => {
            const card = document.createElement('div');
            card.className = 'file-card';
            card.innerHTML = `
                <div style="display:flex; gap:16px; align-items:center;">
                    <div class="file-icon"><i class="fas fa-file-pdf"></i></div>
                    <div class="file-info">
                        <div class="file-name" title="${file.name}">${file.name}</div>
                        <div class="file-date">${file.date} • ${(file.size / (1024 * 1024)).toFixed(2)} MB</div>
                    </div>
                </div>
                <div class="file-actions">
                    <button class="btn-view" data-id="${file.id}"><i class="fas fa-book-open"></i> Buka</button>
                    <button class="btn-delete" data-id="${file.id}"><i class="fas fa-trash"></i></button>
                </div>
            `;
            grid.appendChild(card);
        });

        grid.querySelectorAll('.btn-view').forEach(b => b.addEventListener('click', (e) => this.openViewer(e.currentTarget.dataset.id)));
        grid.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', (e) => this.deleteFile(e.currentTarget.dataset.id)));
    }

    bindDashEvents() {
        document.getElementById('btn-logout').addEventListener('click', () => {
            localStorage.removeItem('sleekbook_active_user');
            this.currentUser = null;
            this.showScreen('authScreen');
        });

        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('pdf-input');

        dropZone.addEventListener('click', () => { if (this.userFiles.length < 5) fileInput.click(); });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (this.userFiles.length < 5) dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.remove('dragover');
            if (this.userFiles.length >= 5) return;
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') this.handleUpload(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                this.handleUpload(e.target.files[0]);
                fileInput.value = ''; // reset
            }
        });
    }

    showDashMsg(msg, isError = true) {
        const m = document.getElementById('dash-message');
        m.textContent = msg;
        m.className = `dash-msg ${isError ? 'error' : 'success'}`;
        m.classList.remove('hidden');
        setTimeout(() => m.classList.add('hidden'), 3000);
    }

    async handleUpload(file) {
        if (file.size > 50 * 1024 * 1024) { this.showDashMsg("Ukuran file maksimal 50MB!"); return; }

        document.getElementById('dashboard-loading').classList.remove('hidden');
        try {
            const arrayBuffer = await new Promise((res, rej) => {
                const reader = new FileReader();
                reader.onload = () => res(reader.result);
                reader.onerror = () => rej(reader.error);
                reader.readAsArrayBuffer(file);
            });
            await this.db.savePDF(this.currentUser, { name: file.name, size: file.size }, arrayBuffer);
            await this.refreshFileList();
        } catch (e) {
            this.showDashMsg("Gagal mengupload file.");
        } finally {
            document.getElementById('dashboard-loading').classList.add('hidden');
        }
    }

    async deleteFile(id) {
        if (!confirm("Yakin ingin menghapus PDF ini?")) return;
        await this.db.deletePDF(id);
        await this.refreshFileList();
    }

    // --- VIEWER ---
    async openViewer(id) {
        const fileRecord = this.userFiles.find(f => f.id === id);
        if (!fileRecord) return;

        this.showScreen('appScreen');
        document.getElementById('btn-back-dash').style.display = 'flex'; // pastikan tombol back tampil
        document.getElementById('book-title').textContent = fileRecord.name.replace(/\.pdf$/i, '');
        this.ui.viewerLoading.classList.remove('hidden');
        const loadText = document.getElementById('viewer-loading-text');
        const loadFill = document.getElementById('viewer-loading-fill');
        loadFill.style.width = '10%';

        try {
            const arrayBuffer = await this.db.getPDFData(id);
            const uint8Array = new Uint8Array(arrayBuffer);
            const renderer = new PDFRenderer();

            loadText.textContent = "Membaca Dokumen...";
            loadFill.style.width = '30%';
            await renderer.loadPDF(uint8Array);

            const pages = await renderer.renderAllPages((current, total) => {
                const progress = 30 + (current / total) * 70;
                loadFill.style.width = `${progress}%`;
                loadText.textContent = `Merender halaman ${current} dari ${total}...`;
            });

            this.ui.viewerLoading.classList.add('hidden');
            this.book = new BookManager(this, pages);
            this.book.fileId = id;
            this.book.fileName = fileRecord.name;
            this.book.isExternal = false;
            this.book.renderVisiblePages();
            this.buildThumbnails(pages);
        } catch (e) {
            console.error(e);
            alert("Gagal membuka PDF.");
            this.loadDashboard();
        }
    }

    // --- PUBLIC VIEWER (STATIC HOSTING SUPPORT) ---
    async loadExternalPDF(url) {
        this.showScreen('appScreen');
        
        let displayTitle = url;
        try { displayTitle = decodeURIComponent(url.split('/').pop().replace(/\.pdf$/i, '')); } catch(e){}
        document.getElementById('book-title').textContent = displayTitle;
        
        this.ui.viewerLoading.classList.remove('hidden');
        const loadText = document.getElementById('viewer-loading-text');
        const loadFill = document.getElementById('viewer-loading-fill');
        
        loadText.textContent = "Mengunduh Dokumen Publik...";
        loadFill.style.width = '10%';

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("File tidak ditemukan (404).");
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            const renderer = new PDFRenderer();
            loadText.textContent = "Membaca Dokumen...";
            loadFill.style.width = '30%';
            await renderer.loadPDF(uint8Array);

            const pages = await renderer.renderAllPages((current, total) => {
                const progress = 30 + (current / total) * 70;
                loadFill.style.width = `${progress}%`;
                loadText.textContent = `Merender halaman ${current} dari ${total}...`;
            });

            this.ui.viewerLoading.classList.add('hidden');
            this.book = new BookManager(this, pages);
            this.book.fileId = null;
            this.book.fileName = url.split('/').pop();
            this.book.isExternal = true;
            this.book.externalData = arrayBuffer; // Simpan di RAM untuk di download
            this.book.renderVisiblePages();
            this.buildThumbnails(pages);
        } catch (e) {
            console.error(e);
            this.ui.viewerLoading.classList.add('hidden');
            this.container = document.getElementById('flipbook-container');
            if (this.container) {
                this.container.innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);text-align:center;padding:40px;">
                        <i class="fas fa-exclamation-triangle" style="font-size:3rem;color:var(--danger);margin-bottom:16px;"></i>
                        <h3 style="color:var(--text-primary);margin-bottom:8px;">Gagal Memuat PDF</h3>
                        <p style="margin-bottom:20px;">Pastikan file PDF sudah di-upload ke server dengan benar.</p>
                        <button onclick="location.reload()" style="padding:10px 24px;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;">Coba Lagi</button>
                    </div>
                `;
            }
        }
    }

    buildThumbnails(pages) {
        const container = document.getElementById('thumb-container');
        container.innerHTML = '';
        pages.forEach((page, idx) => {
            const thumb = document.createElement('div');
            thumb.className = 'thumb-item';
            if (idx === this.book.currentIndex) thumb.classList.add('active');
            thumb.dataset.page = idx;
            const img = document.createElement('img');
            img.src = page.dataUrl; img.draggable = false;
            const label = document.createElement('div');
            label.className = 'thumb-label'; label.textContent = idx + 1;
            thumb.appendChild(img); thumb.appendChild(label);
            thumb.addEventListener('click', () => this.book.goToPage(idx));
            container.appendChild(thumb);
        });
    }

    updateThumbnails() {
        document.querySelectorAll('.thumb-item').forEach(t => {
            t.classList.toggle('active', parseInt(t.dataset.page) === this.book.currentIndex);
        });
        const active = document.querySelector('.thumb-item.active');
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    bindViewerEvents() {
        const btnBackCatalog = document.getElementById('btn-back-catalog');
        if (btnBackCatalog) {
            btnBackCatalog.addEventListener('click', () => {
                this.book = null;
                document.getElementById('flipbook-container').innerHTML = '';
                document.getElementById('thumb-container').innerHTML = '';
                this.checkCatalogOrLogin();
            });
        }

        const btnAdminEdit = document.getElementById('btn-admin-edit');
        if (btnAdminEdit) {
            btnAdminEdit.addEventListener('click', () => {
                this.showScreen('authScreen');
            });
        }

        document.getElementById('btn-theme').addEventListener('click', (e) => {
            const html = document.documentElement;
            const isDark = html.getAttribute('data-theme') === 'dark';
            html.setAttribute('data-theme', isDark ? 'light' : 'dark');
            e.currentTarget.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        });

        document.getElementById('btn-fullscreen').addEventListener('click', (e) => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => { });
                document.getElementById('app').classList.add('fullscreen');
                e.currentTarget.innerHTML = '<i class="fas fa-compress"></i>';
            } else {
                document.exitFullscreen();
                document.getElementById('app').classList.remove('fullscreen');
                e.currentTarget.innerHTML = '<i class="fas fa-expand"></i>';
            }
        });

        document.getElementById('btn-zoom-in').addEventListener('click', () => { if (this.book) this.book.setZoom(this.book.zoomLevel + 0.15); });
        document.getElementById('btn-zoom-out').addEventListener('click', () => { if (this.book) this.book.setZoom(this.book.zoomLevel - 0.15); });

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                document.getElementById('app').classList.remove('fullscreen');
                document.getElementById('btn-fullscreen').innerHTML = '<i class="fas fa-expand"></i>';
            }
        });
    }
}

// ==================================================
// Book Manager (Fisika Flipbook tetap sama)
// ==================================================
class BookManager {
    constructor(app, pages) {
        this.app = app; this.pages = pages; this.currentIndex = 0;
        this.container = document.getElementById('flipbook-container');
        this.zoomLevel = 1;
        this.pageAspect = pages[0] ? (pages[0].width / pages[0].height) : (4 / 3);
        this.isInteracting = false; this.flipEntity = null; this.startX = 0; this.startWidth = 0;
        this.flipDirection = ''; this.currentAngle = 0;
        this.isMobile = window.innerWidth <= 850;
        this.applyDynamicSize();

        window.addEventListener('resize', () => {
            this.isMobile = window.innerWidth <= 850;
            this.applyDynamicSize(); this.renderVisiblePages();
        });
        this.bindEvents(); this.setupPhysics();
    }

    applyDynamicSize() {
        const maxH = window.innerHeight - 160; const maxW = window.innerWidth * 0.88;
        let pageH = maxH; let pageW = pageH * this.pageAspect;
        const spreadW = this.isMobile ? pageW : pageW * 2;
        if (spreadW > maxW) { const scale = maxW / spreadW; pageW *= scale; pageH *= scale; }
        this.container.style.width = (this.isMobile ? pageW : pageW * 2) + 'px';
        this.container.style.height = pageH + 'px';
    }

    getLeftContent(v) { return (v <= 0) ? null : (v >= this.pages.length - 1 ? this.pages[v] : 'blank'); }
    getRightContent(v) { return (v >= this.pages.length - 1) ? null : this.pages[v]; }
    canGoForward() { return this.currentIndex < this.pages.length - 1; }
    canGoBackward() { return this.currentIndex > 0; }

    bindEvents() {
        document.getElementById('nav-prev').onclick = () => this.turnBackward();
        document.getElementById('nav-next').onclick = () => this.turnForward();
        document.onkeydown = (e) => {
            if (this.app.ui.appScreen.classList.contains('hidden')) return;
            if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this.turnForward(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); this.turnBackward(); }
        };
    }

    setupPhysics() {
        const wrap = document.getElementById('book-wrapper');
        wrap.onpointerdown = (e) => {
            if (this.isInteracting) return; // Prevent overlapping interactions
            if (e.target.closest('.book-nav') || e.target.closest('.thumb-item')) return;
            const rect = this.container.getBoundingClientRect();
            const clickedRight = e.clientX > rect.left + rect.width / 2;
            if (clickedRight && this.canGoForward()) this.beginFlip(e, 'forward', rect);
            else if (!clickedRight && this.canGoBackward()) this.beginFlip(e, 'backward', rect);
        };
        wrap.onpointermove = (e) => {
            if (!this.isInteracting || !this.flipEntity) return;
            e.preventDefault();
            const deltaX = e.clientX - this.startX;
            const progress = Math.max(-1, Math.min(1, deltaX / this.startWidth));
            if (this.flipDirection === 'forward') this.currentAngle = Math.max(-180, Math.min(0, progress * 180));
            else this.currentAngle = Math.min(0, Math.max(-180, -180 + progress * 180));
            this.flipEntity.style.transform = `rotateY(${this.currentAngle}deg)`;
            this.flipEntity.style.zIndex = Math.abs(this.currentAngle) > 90 ? 3 : 5;
        };
        const endFlip = () => {
            if (!this.isInteracting || !this.flipEntity) {
                this.isInteracting = false;
                return;
            }
            const shouldCommit = this.flipDirection === 'forward' ? this.currentAngle < -45 : this.currentAngle > -135;
            if (shouldCommit) this.commitFlip(); else this.revertFlip();
        };
        wrap.onpointerup = endFlip; wrap.onpointercancel = endFlip;
        wrap.onpointerleave = (e) => {
            if (this.isInteracting && this.flipEntity) endFlip();
        };
    }

    beginFlip(e, direction, rect) {
        // Double check clear
        this.cleanup();
        this.isInteracting = true; this.flipDirection = direction;
        this.startX = e.clientX; this.startWidth = this.isMobile ? rect.width : rect.width / 2;
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
            this.cleanup(); this.renderVisiblePages(); this.app.updateThumbnails();
            this.isInteracting = false;
        }, 420);
    }

    revertFlip() {
        const target = this.flipDirection === 'forward' ? '0deg' : '-180deg';
        this.flipEntity.style.transition = 'transform 0.4s ease-out';
        this.flipEntity.style.transform = `rotateY(${target})`;
        setTimeout(() => {
            this.cleanup();
            this.isInteracting = false;
        }, 420);
    }

    buildFlipEntity() {
        const el = document.createElement('div');
        el.className = 'fb-spread'; el.style.zIndex = '5'; el.style.transformStyle = 'preserve-3d';
        this.flipEntity = el;
        const front = this.makeFace('0 6px 6px 0', '2px 0 8px rgba(0,0,0,0.1)'); front.style.transform = 'rotateY(0deg)';
        const back = this.makeFace('6px 0 0 6px', '-2px 0 8px rgba(0,0,0,0.1)'); back.style.transform = 'rotateY(180deg)';
        const v = this.currentIndex;

        if (this.flipDirection === 'forward') {
            this.currentAngle = 0;
            this.fillFace(front, this.getRightContent(v)); this.fillFace(back, 'blank');
        } else {
            this.currentAngle = -180; el.style.transform = 'rotateY(-180deg)';
            this.fillFace(front, this.getRightContent(v - 1)); this.fillFace(back, this.getLeftContent(v));
        }

        if (this.isMobile) { el.style.width = '100%'; el.style.right = 'auto'; el.style.left = '0'; el.style.transformOrigin = 'right center'; }
        el.appendChild(front); el.appendChild(back); this.container.appendChild(el);

        if (this.isMobile) { const sp = document.getElementById('base-single-page'); if (sp) sp.style.visibility = 'hidden'; }
        else if (this.flipDirection === 'forward') { const rp = document.getElementById('base-right-page'); if (rp) rp.style.visibility = 'hidden'; }
        else { const lp = document.getElementById('base-left-page'); if (lp) lp.style.visibility = 'hidden'; }
        this.renderBackground();
    }

    makeFace(borderRadius, boxShadow) {
        const f = document.createElement('div');
        f.style.cssText = `position:absolute; inset:0; overflow:hidden; backface-visibility:hidden; -webkit-backface-visibility:hidden; background:#fafafa; border-radius:${borderRadius}; box-shadow:${boxShadow};`;
        return f;
    }

    fillFace(faceEl, content) {
        if (!content || content === 'blank') { faceEl.style.background = '#fafafa'; faceEl.innerHTML = ''; }
        else if (content && content.dataUrl) { faceEl.innerHTML = `<img class="page-img" src="${content.dataUrl}" draggable="false">`; }
    }

    cleanup() { 
        if (this.flipEntity) { this.flipEntity.remove(); this.flipEntity = null; }
        // Remove any orphaned spread elements that might have been left behind
        const orphans = this.container.querySelectorAll('.fb-spread');
        orphans.forEach(el => {
            if (el.id !== 'base-single-page' && el.id !== 'base-left-page' && el.id !== 'base-right-page') {
                el.remove();
            }
        });
    }

    turnForward() {
        if (this.isInteracting || !this.canGoForward()) return;
        this.cleanup();
        this.isInteracting = true; this.flipDirection = 'forward'; this.buildFlipEntity();
        this.flipEntity.style.transition = 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)';
        requestAnimationFrame(() => setTimeout(() => { if (this.flipEntity) this.flipEntity.style.transform = 'rotateY(-180deg)'; }, 20));
        setTimeout(() => { if (this.flipEntity) this.flipEntity.style.zIndex = '3'; }, 300);
        setTimeout(() => {
            this.currentIndex = Math.min(this.currentIndex + 1, this.pages.length - 1);
            this.cleanup(); this.renderVisiblePages(); this.app.updateThumbnails(); this.isInteracting = false;
        }, 650);
    }

    turnBackward() {
        if (this.isInteracting || !this.canGoBackward()) return;
        this.cleanup();
        this.isInteracting = true; this.flipDirection = 'backward'; this.buildFlipEntity();
        this.flipEntity.style.transition = 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)';
        requestAnimationFrame(() => setTimeout(() => { if (this.flipEntity) this.flipEntity.style.transform = 'rotateY(0deg)'; }, 20));
        setTimeout(() => { if (this.flipEntity) this.flipEntity.style.zIndex = '5'; }, 300);
        setTimeout(() => {
            this.currentIndex = Math.max(0, this.currentIndex - 1);
            this.cleanup(); this.renderVisiblePages(); this.app.updateThumbnails(); this.isInteracting = false;
        }, 650);
    }

    goToPage(idx) {
        if (this.isInteracting) return;
        this.cleanup();
        this.currentIndex = Math.max(0, Math.min(idx, this.pages.length - 1));
        this.renderVisiblePages(); this.app.updateThumbnails();
    }

    renderVisiblePages() {
        this.container.innerHTML = '';
        if (this.isMobile) this.renderMobile(); else this.renderSpread();
        this.updateIndicators(); this.updateNavButtons();
    }

    renderMobile() {
        const base = document.createElement('div');
        base.className = 'fb-spread'; base.id = 'base-single-page'; base.style.cssText = 'width:100%; right:auto; left:0; z-index:2;';
        const face = document.createElement('div'); face.className = 'fb-face fb-face-right'; face.style.borderRadius = '6px';
        face.innerHTML = this.pageImgHTML(this.currentIndex);
        base.appendChild(face); this.container.appendChild(base);
    }

    renderSpread() {
        const v = this.currentIndex; const leftContent = this.getLeftContent(v); const rightContent = this.getRightContent(v);
        if (v !== 0) {
            const baseL = document.createElement('div'); baseL.className = 'fb-spread'; baseL.id = 'base-left-page';
            baseL.style.cssText = 'right:auto; left:0; transform-origin:right center; z-index:2;';
            const fL = document.createElement('div'); fL.className = 'fb-face fb-face-left';
            if (leftContent && leftContent !== 'blank' && leftContent.dataUrl) fL.innerHTML = `<img class="page-img" src="${leftContent.dataUrl}" draggable="false">`;
            else fL.style.background = '#fafafa';
            baseL.appendChild(fL); this.container.appendChild(baseL);
        }
        if (v !== this.pages.length - 1) {
            const baseR = document.createElement('div'); baseR.className = 'fb-spread'; baseR.id = 'base-right-page'; baseR.style.zIndex = '2';
            const fR = document.createElement('div'); fR.className = 'fb-face fb-face-right';
            if (rightContent && rightContent.dataUrl) fR.innerHTML = `<img class="page-img" src="${rightContent.dataUrl}" draggable="false">`;
            else fR.style.background = '#fafafa';
            baseR.appendChild(fR); this.container.appendChild(baseR);
        }
    }

    renderBackground() {
        const nextV = this.flipDirection === 'forward' ? this.currentIndex + 1 : this.currentIndex - 1;
        if (nextV < 0 || nextV >= this.pages.length) return;
        if (this.isMobile) {
            const bg = document.createElement('div'); bg.className = 'fb-spread'; bg.style.cssText = 'z-index:1; width:100%; right:auto; left:0;';
            const f = document.createElement('div'); f.className = 'fb-face fb-face-right'; f.style.borderRadius = '6px';
            f.innerHTML = this.pageImgHTML(nextV); bg.appendChild(f); this.container.appendChild(bg); return;
        }
        const nL = this.getLeftContent(nextV); const nR = this.getRightContent(nextV);
        if (nextV !== 0 && nL) {
            const bgL = document.createElement('div'); bgL.className = 'fb-spread'; bgL.style.cssText = 'right:auto; left:0; transform-origin:right center; z-index:1;';
            const bfL = document.createElement('div'); bfL.className = 'fb-face fb-face-left';
            if (nL !== 'blank' && nL.dataUrl) {
                bfL.innerHTML = `<img class="page-img" src="${nL.dataUrl}" draggable="false">`;
            } else {
                bfL.style.background = '#fafafa';
            }
            bgL.appendChild(bfL); this.container.appendChild(bgL);
        }
        if (nextV !== this.pages.length - 1 && nR && nR.dataUrl) {
            const bgR = document.createElement('div'); bgR.className = 'fb-spread'; bgR.style.zIndex = '1';
            const bfR = document.createElement('div'); bfR.className = 'fb-face fb-face-right';
            bfR.innerHTML = `<img class="page-img" src="${nR.dataUrl}" draggable="false">`;
            bgR.appendChild(bfR); this.container.appendChild(bgR);
        }
    }

    pageImgHTML(idx) { return (idx < 0 || idx >= this.pages.length) ? '' : `<img class="page-img" src="${this.pages[idx].dataUrl}" alt="Page ${idx + 1}" draggable="false">`; }
    updateIndicators() { document.getElementById('current-page').textContent = this.currentIndex + 1; document.getElementById('total-page').textContent = this.pages.length; }
    updateNavButtons() { document.getElementById('nav-prev').disabled = !this.canGoBackward(); document.getElementById('nav-next').disabled = !this.canGoForward(); }
    setZoom(level) { this.zoomLevel = Math.max(0.5, Math.min(2, level)); this.container.style.transform = `scale(${this.zoomLevel})`; }
}

// Boot
document.addEventListener('DOMContentLoaded', () => { window.sleekBookApp = new FlipbookApp(); });