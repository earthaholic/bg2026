document.addEventListener('DOMContentLoaded', () => {
    // App State
    let token = localStorage.getItem('token');
    let currentUser = null;
    let currentTable = null;
    let tableSchema = [];
    let currentPage = 1;
    let limit = 30;
    let totalPages = 1;
    let searchQuery = '';
    let selectedPkValues = new Set();
    let currentEditRowData = null;

    // Book Search State
    let searchPage = 1;
    let searchLimit = 30;
    let searchTotalPages = 1;

    // Student Search State
    let studentSearchPage = 1;
    let studentSearchLimit = 30;
    let studentSearchTotalPages = 1;

    // Class Search State
    let classSearchPage = 1;
    let classSearchLimit = 30;
    let classSearchTotalPages = 1;

    // Class State
    let currentDetailClass = null;
    let pendingClassDeleteId = null;
    let pendingClassDeleteName = '';
    let classAllStudentsCache = []; // 수업 등록/편집 폼의 전체 학생 목록 캐시
    let classRegSelectedStudentIds = new Set(); // 수업 등록 폼에서 선택된 학생 ID (필터 재렌더 시에도 유지)
    let classRegStudentSpecialIds = new Set(); // 수업 등록 폼에서 특강으로 지정된 학생 ID (배정된 학생만 유효)
    let classEditSelectedStudentIds = new Set(); // 수업 편집 폼에서 선택된 학생 ID (필터 재렌더 시에도 유지)
    let classEditStudentSpecialIds = new Set(); // 수업 편집 폼에서 특강으로 지정된 학생 ID (배정된 학생만 유효)
    let activeBatchClassId = null;  // 일괄 등록 중인 수업 Id
    let batchCalendarMonth = ''; // YYYY-MM
    let batchCalendarDays = {};
    let activeBookPickerTarget = 'studylog'; // 도서 picker 대상 ('studylog' | 'batch')
    let activeStudentPickerTarget = 'studylog'; // 학생 picker 대상 ('studylog' | 'monthly')
    let selectedStudentsMap = new Map(); // 새 학습 기록 등록용 학생 다중 선택 Map (id -> studentObj)
    let currentMonthlyLogs = []; // 월말보고용 로드된 학습 기록 목록

    // DOM Elements
    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    const themeToggleIcon = document.getElementById('theme-toggle-icon');
    const themeToggleText = document.getElementById('theme-toggle-text');

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('bg2026_theme', theme);

        if (theme === 'light') {
            if (themeToggleIcon) themeToggleIcon.className = 'fa-solid fa-sun';
            if (themeToggleText) themeToggleText.textContent = '라이트 모드';
        } else {
            if (themeToggleIcon) themeToggleIcon.className = 'fa-solid fa-moon';
            if (themeToggleText) themeToggleText.textContent = '다크 모드';
        }
    }

    // Initialize Theme
    const savedTheme = localStorage.getItem('bg2026_theme') || 
        (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(savedTheme);

    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(nextTheme);
        });
    }

    const modalLogin = document.getElementById('modal-login');
    const formLogin = document.getElementById('form-login');
    const loginErrorMsg = document.getElementById('login-error-msg');
    
    const userProfileBadge = document.getElementById('user-profile-badge');
    const badgeUsername = document.getElementById('badge-username');
    const badgeRole = document.getElementById('badge-role');
    const btnLogout = document.getElementById('btn-logout');

    const sidebarMainMenu = document.getElementById('sidebar-main-menu');

    // Data Studio Header Controls
    const dataStudioHeaderBar = document.getElementById('data-studio-header-bar');
    const selectActiveTable = document.getElementById('select-active-table');
    const subTabBtnGrid = document.getElementById('sub-tab-btn-grid');
    const subTabBtnSchema = document.getElementById('sub-tab-btn-schema');
    const subviewDataGrid = document.getElementById('subview-data-grid');
    const subviewSchemaView = document.getElementById('subview-schema-view');

    const activeTableTitle = document.getElementById('active-table-title');
    const activeTableStats = document.getElementById('active-table-stats');
    const tableHeadTr = document.getElementById('table-head-tr');
    const tableBody = document.getElementById('table-body');
    const schemaDetails = document.getElementById('schema-details');

    const paginationInfo = document.getElementById('pagination-info');
    const btnPrevPage = document.getElementById('btn-prev-page');
    const btnNextPage = document.getElementById('btn-next-page');
    const currentPageNum = document.getElementById('current-page-num');

    const inputSearch = document.getElementById('input-search');
    const btnClearSearch = document.getElementById('btn-clear-search');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnBatchDelete = document.getElementById('btn-batch-delete');
    const selectedCountSpan = document.getElementById('selected-count');
    const btnAddRow = document.getElementById('btn-add-row');

    // User Book Registration Form Elements
    const formUserBookReg = document.getElementById('form-user-book-reg');
    const userBookMsg = document.getElementById('user-book-msg');
    const btnResetBookForm = document.getElementById('btn-reset-book-form');
    const recentBooksList = document.getElementById('recent-books-list');
    const btnRefreshRecent = document.getElementById('btn-refresh-recent');

    // Book Search & Filter Elements
    const bookSearchQ = document.getElementById('book-search-q');
    const btnDoBookSearch = document.getElementById('btn-do-book-search');
    const filterTarget = document.getElementById('filter-target');
    const filterVocaMin = document.getElementById('filter-voca-min');
    const filterVocaMax = document.getElementById('filter-voca-max');
    const filterVocaVal = document.getElementById('filter-voca-val');
    const vocaRangeFill = document.getElementById('voca-range-fill');

    const filterLengthMin = document.getElementById('filter-length-min');
    const filterLengthMax = document.getElementById('filter-length-max');
    const filterLengthVal = document.getElementById('filter-length-val');
    const lengthRangeFill = document.getElementById('length-range-fill');
    const filterChkQuiz = document.getElementById('filter-chk-quiz');
    const filterChkReading = document.getElementById('filter-chk-reading');
    const filterChkWriting = document.getElementById('filter-chk-writing');
    const filterChkPdf = document.getElementById('filter-chk-pdf');
    const btnResetFilters = document.getElementById('btn-reset-filters');

    const searchTotalCount = document.getElementById('search-total-count');
    const bookCardsGrid = document.getElementById('book-cards-grid');
    const searchPaginationInfo = document.getElementById('search-pagination-info');
    const btnSearchPrev = document.getElementById('btn-search-prev');
    const btnSearchNext = document.getElementById('btn-search-next');
    const searchCurrentPageSpan = document.getElementById('search-current-page');

    // User Student Registration Form Elements
    const formUserStudentReg = document.getElementById('form-user-student-reg');
    const userStudentMsg = document.getElementById('user-student-msg');
    const btnResetStudentForm = document.getElementById('btn-reset-student-form');
    const recentStudentsList = document.getElementById('recent-students-list');
    const btnRefreshRecentStudents = document.getElementById('btn-refresh-recent-students');

    // Student Search & Filter Elements
    const studentSearchQ = document.getElementById('student-search-q');
    const btnDoStudentSearch = document.getElementById('btn-do-student-search');
    const studentFilterSex = document.getElementById('student-filter-sex');
    const studentFilterIncludeEnded = document.getElementById('student-filter-include-ended');
    const btnResetStudentFilters = document.getElementById('btn-reset-student-filters');

    const studentSearchTotalCount = document.getElementById('student-search-total-count');
    const studentCardsGrid = document.getElementById('student-cards-grid');
    const studentSearchPaginationInfo = document.getElementById('student-search-pagination-info');
    const btnStudentSearchPrev = document.getElementById('btn-student-search-prev');
    const btnStudentSearchNext = document.getElementById('btn-student-search-next');
    const studentSearchCurrentPageSpan = document.getElementById('student-search-current-page');

    // Book Detail Modal Elements
    const modalBookDetail = document.getElementById('modal-book-detail');
    const modalBookDetailTitle = document.getElementById('modal-book-detail-title');
    const modalBookDetailActions = document.getElementById('modal-book-detail-actions');
    const modalBookDetailBody = document.getElementById('modal-book-detail-body');
    const btnCloseDetailModal = document.getElementById('btn-close-detail-modal');

    // Student Detail Modal Elements
    const modalStudentDetail = document.getElementById('modal-student-detail');
    const modalStudentDetailTitle = document.getElementById('modal-student-detail-title');
    const modalStudentDetailActions = document.getElementById('modal-student-detail-actions');
    const modalStudentDetailBody = document.getElementById('modal-student-detail-body');
    const btnCloseStudentDetailModal = document.getElementById('btn-close-student-detail-modal');

    // Admin Book Delete Safety Modal Elements
    const modalDeleteConfirm = document.getElementById('modal-delete-confirm');
    const targetDeleteTitleDisplay = document.getElementById('target-delete-title-display');
    const inputConfirmDeleteTitle = document.getElementById('input-confirm-delete-title');
    const btnSubmitDeleteConfirm = document.getElementById('btn-submit-delete-confirm');
    const btnCloseDeleteConfirm = document.getElementById('btn-close-delete-confirm');
    const btnCancelDeleteConfirm = document.getElementById('btn-cancel-delete-confirm');

    // Admin Student Delete Safety Modal Elements
    const modalStudentDeleteConfirm = document.getElementById('modal-student-delete-confirm');
    const targetStudentDeleteNameDisplay = document.getElementById('target-student-delete-name-display');
    const inputConfirmDeleteStudentName = document.getElementById('input-confirm-delete-student-name');
    const btnSubmitStudentDeleteConfirm = document.getElementById('btn-submit-student-delete-confirm');
    const btnCloseStudentDeleteConfirm = document.getElementById('btn-close-student-delete-confirm');
    const btnCancelStudentDeleteConfirm = document.getElementById('btn-cancel-student-delete-confirm');

    // SQL Console Elements
    const sqlQueryInput = document.getElementById('sql-query-input');
    const btnRunSql = document.getElementById('btn-run-sql');
    const btnExportSqlCsv = document.getElementById('btn-export-sql-csv');
    const sqlResultAlert = document.getElementById('sql-result-alert');
    const sqlResultStats = document.getElementById('sql-result-stats');
    const sqlHeadTr = document.getElementById('sql-head-tr');
    const sqlBody = document.getElementById('sql-body');

    // CRUD Modals
    const modalCrud = document.getElementById('modal-crud');
    const modalCrudTitle = document.getElementById('modal-crud-title');
    const formCrud = document.getElementById('form-crud');
    const dynamicFormFields = document.getElementById('dynamic-form-fields');
    const crudErrorMsg = document.getElementById('crud-error-msg');
    const btnCloseCrudModal = document.getElementById('btn-close-crud-modal');
    const btnCancelCrud = document.getElementById('btn-cancel-crud');

    // User Account Management Elements
    const btnOpenUserCreate = document.getElementById('btn-open-user-create');
    const userManageStats = document.getElementById('user-manage-stats');
    const userManageHead = document.getElementById('user-manage-head');
    const userManageBody = document.getElementById('user-manage-body');

    const modalUserCreate = document.getElementById('modal-user-create');
    const formUserCreate = document.getElementById('form-user-create');
    const userCreateMsg = document.getElementById('user-create-msg');
    const inputUserCreateUsername = document.getElementById('input-user-create-username');
    const inputUserCreatePassword = document.getElementById('input-user-create-password');
    const selectUserCreateRole = document.getElementById('select-user-create-role');
    const btnCloseUserCreate = document.getElementById('btn-close-user-create');
    const btnCancelUserCreate = document.getElementById('btn-cancel-user-create');
    const btnSubmitUserCreate = document.getElementById('btn-submit-user-create');

    const modalUserPassword = document.getElementById('modal-user-password');
    const formUserPassword = document.getElementById('form-user-password');
    const userPwMsg = document.getElementById('user-pw-msg');
    const userPwTargetDisplay = document.getElementById('user-pw-target-display');
    const userPwInput = document.getElementById('user-pw-input');
    const btnCloseUserPw = document.getElementById('btn-close-user-pw');
    const btnCancelUserPw = document.getElementById('btn-cancel-user-pw');

    const modalUserDelete = document.getElementById('modal-user-delete');
    const userDeleteTargetDisplay = document.getElementById('user-delete-target-display');
    const inputConfirmUserDelete = document.getElementById('input-confirm-user-delete');
    const btnCloseUserDelete = document.getElementById('btn-close-user-delete');
    const btnCancelUserDelete = document.getElementById('btn-cancel-user-delete');
    const btnSubmitUserDelete = document.getElementById('btn-submit-user-delete');

    // Class List View Elements
    const classSearchQ = document.getElementById('class-search-q');
    const btnDoClassSearch = document.getElementById('btn-do-class-search');
    const btnResetClassFilter = document.getElementById('btn-reset-class-filter');
    const classSearchTotalCount = document.getElementById('class-search-total-count');
    const classCardsGrid = document.getElementById('class-cards-grid');
    const classSearchPaginationInfo = document.getElementById('class-search-pagination-info');
    const btnClassSearchPrev = document.getElementById('btn-class-search-prev');
    const btnClassSearchNext = document.getElementById('btn-class-search-next');
    const classSearchCurrentPageSpan = document.getElementById('class-search-current-page');

    // Class Registration View Elements
    const formUserClassReg = document.getElementById('form-user-class-reg');
    const classRegMsg = document.getElementById('class-reg-msg');
    const btnResetClassForm = document.getElementById('btn-reset-class-form');
    const classStudentFilter = document.getElementById('class-student-filter');
    const classStudentList = document.getElementById('class-student-list');
    const classSelectedCount = document.getElementById('class-selected-count');

    // Class Detail Modal Elements
    const modalClassDetail = document.getElementById('modal-class-detail');
    const modalClassDetailTitle = document.getElementById('modal-class-detail-title');
    const modalClassDetailActions = document.getElementById('modal-class-detail-actions');
    const modalClassDetailBody = document.getElementById('modal-class-detail-body');
    const btnCloseClassDetail = document.getElementById('btn-close-class-detail');

    // Class Delete Confirm Modal Elements
    const modalClassDeleteConfirm = document.getElementById('modal-class-delete-confirm');
    const targetClassDeleteNameDisplay = document.getElementById('target-class-delete-name-display');
    const inputConfirmDeleteClassName = document.getElementById('input-confirm-delete-class-name');
    const btnSubmitClassDeleteConfirm = document.getElementById('btn-submit-class-delete-confirm');
    const btnCloseClassDeleteConfirm = document.getElementById('btn-close-class-delete-confirm');
    const btnCancelClassDeleteConfirm = document.getElementById('btn-cancel-class-delete-confirm');

    // Class Batch StudyLog Registration Elements
    const classBatchSelect = document.getElementById('class-batch-select');
    const classBatchInfo = document.getElementById('class-batch-info');
    const batchClassName = document.getElementById('batch-class-name');
    const batchClassTeacher = document.getElementById('batch-class-teacher');
    const batchClassSchedule = document.getElementById('batch-class-schedule');
    const batchClassStudentCount = document.getElementById('batch-class-student-count');
    const classBatchRegCard = document.getElementById('class-batch-reg-card');
    const formClassBatchStudyLog = document.getElementById('form-class-batch-studylog');
    const batchStudiedDay = document.getElementById('batch-studied-day');
    const batchCalendarMonthLabel = document.getElementById('batch-calendar-month');
    const batchCalendarGrid = document.getElementById('batch-calendar-grid');
    const batchCalendarStatus = document.getElementById('batch-calendar-status');
    const batchExistingRecords = document.getElementById('batch-existing-records');
    const btnBatchCalendarPrev = document.getElementById('btn-batch-calendar-prev');
    const btnBatchCalendarNext = document.getElementById('btn-batch-calendar-next');
    const classBatchStudentsBody = document.getElementById('class-batch-students-body');
    const classBatchResult = document.getElementById('class-batch-result');

    let pendingUserPwId = null;
    let pendingUserDeleteId = null;

    // API Helper
    async function apiFetch(url, options = {}) {
        options.headers = options.headers || {};
        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }
        if (!(options.body instanceof FormData) && !options.headers['Content-Type']) {
            options.headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(url, options);
        if (res.status === 401) {
            handleLogout();
            throw new Error('인증이 필요합니다.');
        }
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || '요청 처리 중 오류가 발생했습니다.');
        }
        return data;
    }

    // 입력 디바운스 헬퍼 (중복 경고 조회용)
    function debounce(fn, wait) {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    // Book Title Similarity Warning (등록 폼 중복 경고)
    const bookTitleInput = document.getElementById('book-title');
    const bookTitleSimilarBox = document.getElementById('book-title-similar-box');
    let bookSimilarSeq = 0;

    function renderBookSimilar(data) {
        const { total, summary, matches } = data;
        if (!total) { bookTitleSimilarBox.classList.add('hidden'); return; }
        let html = '';
        if (summary.exact > 0) {
            html += `<span class="badge badge-danger"><i class="fa-solid fa-circle-exclamation"></i> 같은 제목의 도서 ${summary.exact}건이 이미 등록되어 있습니다.</span>`;
        } else {
            html += `<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> 유사한 제목의 도서 ${summary.contains + summary.similar}건이 등록되어 있습니다.</span>`;
        }
        if (matches.length > 0) {
            html += `<div class="title-similar-list">`;
            matches.forEach(m => {
                const title = escapeHtml(m.Title || '');
                const meta = escapeHtml([m.Author, m.Publisher].filter(Boolean).join(' · '));
                html += `<div class="title-similar-item"><span class="tsi-title">${title}</span>${meta ? `<span class="tsi-meta">${meta}</span>` : ''}</div>`;
            });
            html += `</div>`;
            if (total > matches.length) { html += `<div class="text-muted">... 외 ${total - matches.length}건</div>`; }
        }
        bookTitleSimilarBox.innerHTML = html;
        bookTitleSimilarBox.classList.remove('hidden');
    }

    async function fetchBookSimilar(title) {
        const seq = ++bookSimilarSeq;
        try {
            const data = await apiFetch(`/api/user/books/similar?q=${encodeURIComponent(title)}`);
            if (seq !== bookSimilarSeq) return;
            renderBookSimilar(data);
        } catch (err) {
            if (seq !== bookSimilarSeq) return;
            bookTitleSimilarBox.classList.add('hidden');
            console.warn('[도서 중복 경고] 조회 실패:', err.message);
        }
    }

    const debouncedBookSimilar = debounce((e) => {
        const title = (e.target.value || '').trim();
        if (!title) { bookSimilarSeq++; bookTitleSimilarBox.classList.add('hidden'); return; }
        fetchBookSimilar(title);
    }, 300);

    function clearBookSimilar() { bookSimilarSeq++; bookTitleSimilarBox.classList.add('hidden'); }

    // Student Name Similarity Warning (동명이인 경고)
    const studentNameInput = document.getElementById('student-name');
    const studentNameSimilarBox = document.getElementById('student-name-similar-box');
    let studentNameSeq = 0;

    function renderStudentSimilar(data) {
        const { total, summary, matches } = data;
        if (!total) { studentNameSimilarBox.classList.add('hidden'); return; }
        let html = `<span class="badge badge-danger"><i class="fa-solid fa-circle-exclamation"></i> 같은 이름의 학생 ${summary.exact}명이 이미 등록되어 있습니다.</span>`;
        if (matches.length > 0) {
            html += `<div class="title-similar-list">`;
            matches.forEach(m => {
                const name = escapeHtml(m.Name || '');
                const meta = [formatSex(m.Sex), formatGrade(m.Grade), m.Referrer ? '추천 ' + formatReferrer(m.Referrer) : ''].filter(Boolean).join(' · ');
                html += `<div class="title-similar-item"><span class="tsi-title">${name}</span>${meta ? `<span class="tsi-meta">${meta}</span>` : ''}</div>`;
            });
            html += `</div>`;
            if (total > matches.length) { html += `<div class="text-muted">... 외 ${total - matches.length}명</div>`; }
        }
        studentNameSimilarBox.innerHTML = html;
        studentNameSimilarBox.classList.remove('hidden');
    }

    async function fetchStudentSimilar(name) {
        const seq = ++studentNameSeq;
        try {
            const data = await apiFetch(`/api/user/students/similar?q=${encodeURIComponent(name)}`);
            if (seq !== studentNameSeq) return;
            renderStudentSimilar(data);
        } catch (err) {
            if (seq !== studentNameSeq) return;
            studentNameSimilarBox.classList.add('hidden');
            console.warn('[동명이인 경고] 조회 실패:', err.message);
        }
    }

    const debouncedStudentSimilar = debounce((e) => {
        const name = (e.target.value || '').trim();
        if (!name) { studentNameSeq++; studentNameSimilarBox.classList.add('hidden'); return; }
        fetchStudentSimilar(name);
    }, 300);

    function clearStudentSimilar() { studentNameSeq++; studentNameSimilarBox.classList.add('hidden'); }

    // Init App
    init();

    // Role Helpers
    const ROLE_LABELS = { admin: '사이트 관리자', manager: '관리 선생님', teacher: '선생님' };
    const STAFF_ONLY_VIEWS = ['studylog-reg', 'student-reg', 'book-reg', 'class-reg'];
    const ADMIN_ONLY_VIEWS = ['data-view', 'sql-console', 'user-manage', 'audit-log'];

    function isAdmin() {
        return !!(currentUser && currentUser.role === 'admin');
    }

    function isStaff() {
        return !!(currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager'));
    }

    async function init() {
        setupEventListeners();
        if (token) {
            try {
                currentUser = await apiFetch('/api/auth/me');
                updateUserUI();
                await loadTables();
                await loadRecentBooks();
                await loadRecentStudents();
                await loadBookSearchResults();
                await loadStudentSearchResults();
            } catch (err) {
                showLoginModal();
            }
        } else {
            showLoginModal();
        }
    }

    function showLoginModal() {
        modalLogin.classList.remove('hidden');
    }

    function hideLoginModal() {
        modalLogin.classList.add('hidden');
    }

    function updateUserUI() {
        if (!currentUser) return;
        hideLoginModal();

        userProfileBadge.classList.remove('hidden');
        btnLogout.classList.remove('hidden');
        badgeUsername.textContent = currentUser.username;
        badgeRole.textContent = (ROLE_LABELS[currentUser.role] || currentUser.role).toUpperCase();
        badgeRole.className = `role-pill ${currentUser.role}`;

        const adminOnlyItems = document.querySelectorAll('.admin-only');
        const staffOnlyItems = document.querySelectorAll('.staff-only');
        adminOnlyItems.forEach(el => el.classList.toggle('hidden', !isAdmin()));
        staffOnlyItems.forEach(el => el.classList.toggle('hidden', !isStaff()));

        // 선생님(조회 전용)은 검색/상세 조회 뷰로 이동
        if (!isStaff()) {
            switchView('studylog-search');
        }
    }

    function switchView(targetView) {
        // 권한 가드: 선생님은 등록 뷰, 사이트 관리자 외에는 Studio 뷰 접근 불가
        if (STAFF_ONLY_VIEWS.includes(targetView) && !isStaff()) {
            targetView = 'studylog-search';
        } else if (ADMIN_ONLY_VIEWS.includes(targetView) && !isAdmin()) {
            targetView = 'studylog-search';
        }

        document.querySelectorAll('.menu-nav-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-view') === targetView);
        });

        document.querySelectorAll('.workspace-view').forEach(view => {
            view.classList.toggle('active', view.id === `view-${targetView}`);
        });

        if (targetView === 'data-view' && isAdmin()) {
            dataStudioHeaderBar.classList.remove('hidden');
        } else {
            dataStudioHeaderBar.classList.add('hidden');
        }

        if (targetView === 'book-search') {
            loadBookSearchResults();
        } else if (targetView === 'student-search') {
            loadStudentSearchResults();
        } else if (targetView === 'studylog-reg') {
            loadRecentStudyLogs();
        } else if (targetView === 'studylog-search') {
            loadStudyLogSearchResults();
        } else if (targetView === 'user-manage') {
            loadUserAccounts();
        } else if (targetView === 'audit-log') {
            applyAuditFilterFromUrl();
            loadAuditLogs();
            loadAuditUserOptions();
        } else if (targetView === 'class-list') {
            loadClassSearchResults();
        } else if (targetView === 'class-reg') {
            loadClassRegForm();
        } else if (targetView === 'class-studylog-reg') {
            loadClassOptionsForBatch();
        } else if (targetView === 'monthly-report') {
            initMonthlyReportView();
        }
    }

    function switchDataSubtab(subtab) {
        subTabBtnGrid.classList.toggle('active', subtab === 'grid');
        subTabBtnSchema.classList.toggle('active', subtab === 'schema');

        subviewDataGrid.classList.toggle('active', subtab === 'grid');
        subviewSchemaView.classList.toggle('active', subtab === 'schema');
    }

    function handleLogout() {
        token = null;
        currentUser = null;
        localStorage.removeItem('token');
        userProfileBadge.classList.add('hidden');
        btnLogout.classList.add('hidden');
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.staff-only').forEach(el => el.classList.add('hidden'));
        dataStudioHeaderBar.classList.add('hidden');
        showLoginModal();
    }

    // Event Listeners Setup
    function setupEventListeners() {
        // Login Form
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            loginErrorMsg.classList.add('hidden');
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || '로그인 실패');

                token = data.access_token;
                localStorage.setItem('token', token);
                currentUser = { username: data.username, role: data.role };
                updateUserUI();
                await loadTables();
                await loadRecentBooks();
                await loadRecentStudents();
                await loadBookSearchResults();
                await loadStudentSearchResults();
            } catch (err) {
                loginErrorMsg.textContent = err.message;
                loginErrorMsg.classList.remove('hidden');
            }
        });

        btnLogout.addEventListener('click', handleLogout);

        // Sidebar Navigation Clicks
        document.querySelectorAll('.menu-nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const view = item.getAttribute('data-view');
                switchView(view);
            });
        });

        // Table Selector Change (Data Studio)
        selectActiveTable.addEventListener('change', (e) => {
            if (e.target.value) {
                selectTable(e.target.value);
            }
        });

        // Data Studio Sub-tab Toggles
        subTabBtnGrid.addEventListener('click', () => switchDataSubtab('grid'));
        subTabBtnSchema.addEventListener('click', () => switchDataSubtab('schema'));

        // User Book Registration Form Submit
        formUserBookReg.addEventListener('submit', handleUserBookSubmit);
        bookTitleInput.addEventListener('input', debouncedBookSimilar);
        btnResetBookForm.addEventListener('click', () => {
            formUserBookReg.reset();
            userBookMsg.classList.add('hidden');
            clearBookSimilar();
        });
        btnRefreshRecent.addEventListener('click', loadRecentBooks);

        // User Student Registration Form Submit
        formUserStudentReg.addEventListener('submit', handleUserStudentSubmit);
        studentNameInput.addEventListener('input', debouncedStudentSimilar);
        btnResetStudentForm.addEventListener('click', () => {
            formUserStudentReg.reset();
            userStudentMsg.classList.add('hidden');
            clearStudentSimilar();
        });
        btnRefreshRecentStudents.addEventListener('click', loadRecentStudents);

        // Book Search & Filter Events
        btnDoBookSearch.addEventListener('click', () => {
            searchPage = 1;
            loadBookSearchResults();
        });

        bookSearchQ.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchPage = 1;
                loadBookSearchResults();
            }
        });

        function updateDualSlider(minEl, maxEl, labelEl, fillEl, evt) {
            if (!minEl || !maxEl || !labelEl) return;
            let minVal = (minEl.value !== '' && !isNaN(minEl.value)) ? parseInt(minEl.value) : 0;
            let maxVal = (maxEl.value !== '' && !isNaN(maxEl.value)) ? parseInt(maxEl.value) : 10;

            if (minVal > maxVal) {
                if (evt && evt.target === minEl) {
                    minEl.value = maxVal;
                    minVal = maxVal;
                } else {
                    maxEl.value = minVal;
                    maxVal = minVal;
                }
            }

            if (minVal === 0 && maxVal === 10) {
                labelEl.textContent = '0 ~ 10단계 (전체)';
            } else {
                labelEl.textContent = `${minVal}단계 ~ ${maxVal}단계`;
            }

            if (fillEl) {
                const left = (minVal / 10) * 100;
                const right = 100 - (maxVal / 10) * 100;
                fillEl.style.left = left + '%';
                fillEl.style.right = right + '%';
            }
        }

        document.querySelectorAll('.filter-target-chk').forEach(chk => {
            chk.addEventListener('change', () => {
                searchPage = 1;
                loadBookSearchResults();
            });
        });

        if (filterVocaMin && filterVocaMax) {
            const handleVocaChange = (e) => {
                updateDualSlider(filterVocaMin, filterVocaMax, filterVocaVal, vocaRangeFill, e);
                searchPage = 1;
                loadBookSearchResults();
            };
            filterVocaMin.addEventListener('input', handleVocaChange);
            filterVocaMax.addEventListener('input', handleVocaChange);
        }

        if (filterLengthMin && filterLengthMax) {
            const handleLengthChange = (e) => {
                updateDualSlider(filterLengthMin, filterLengthMax, filterLengthVal, lengthRangeFill, e);
                searchPage = 1;
                loadBookSearchResults();
            };
            filterLengthMin.addEventListener('input', handleLengthChange);
            filterLengthMax.addEventListener('input', handleLengthChange);
        }

        filterChkQuiz.addEventListener('change', () => { searchPage = 1; loadBookSearchResults(); });
        filterChkReading.addEventListener('change', () => { searchPage = 1; loadBookSearchResults(); });
        filterChkWriting.addEventListener('change', () => { searchPage = 1; loadBookSearchResults(); });
        filterChkPdf.addEventListener('change', () => { searchPage = 1; loadBookSearchResults(); });

        btnResetFilters.addEventListener('click', () => {
            bookSearchQ.value = '';
            document.querySelectorAll('.filter-target-chk').forEach(chk => { chk.checked = false; });
            if (filterVocaMin && filterVocaMax) {
                filterVocaMin.value = 0;
                filterVocaMax.value = 10;
                updateDualSlider(filterVocaMin, filterVocaMax, filterVocaVal, vocaRangeFill);
            }
            if (filterLengthMin && filterLengthMax) {
                filterLengthMin.value = 0;
                filterLengthMax.value = 10;
                updateDualSlider(filterLengthMin, filterLengthMax, filterLengthVal, lengthRangeFill);
            }
            filterChkQuiz.checked = false;
            filterChkReading.checked = false;
            filterChkWriting.checked = false;
            filterChkPdf.checked = false;
            searchPage = 1;
            loadBookSearchResults();
        });

        btnSearchPrev.addEventListener('click', () => {
            if (searchPage > 1) {
                searchPage--;
                loadBookSearchResults();
            }
        });

        btnSearchNext.addEventListener('click', () => {
            if (searchPage < searchTotalPages) {
                searchPage++;
                loadBookSearchResults();
            }
        });

        // Student Search & Filter Events
        btnDoStudentSearch.addEventListener('click', () => {
            studentSearchPage = 1;
            loadStudentSearchResults();
        });

        studentSearchQ.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                studentSearchPage = 1;
                loadStudentSearchResults();
            }
        });

        studentFilterSex.addEventListener('change', () => {
            studentSearchPage = 1;
            loadStudentSearchResults();
        });

        studentFilterIncludeEnded.addEventListener('change', () => {
            studentSearchPage = 1;
            loadStudentSearchResults();
        });

        btnResetStudentFilters.addEventListener('click', () => {
            studentSearchQ.value = '';
            studentFilterSex.value = '';
            studentFilterIncludeEnded.checked = false;
            studentSearchPage = 1;
            loadStudentSearchResults();
        });

        btnStudentSearchPrev.addEventListener('click', () => {
            if (studentSearchPage > 1) {
                studentSearchPage--;
                loadStudentSearchResults();
            }
        });

        btnStudentSearchNext.addEventListener('click', () => {
            if (studentSearchPage < studentSearchTotalPages) {
                studentSearchPage++;
                loadStudentSearchResults();
            }
        });

        btnCloseDetailModal.addEventListener('click', () => modalBookDetail.classList.add('hidden'));
        btnCloseStudentDetailModal.addEventListener('click', () => modalStudentDetail.classList.add('hidden'));

        // Admin Book Delete Safety Modal Events
        btnCloseDeleteConfirm.addEventListener('click', () => modalDeleteConfirm.classList.add('hidden'));
        btnCancelDeleteConfirm.addEventListener('click', () => modalDeleteConfirm.classList.add('hidden'));

        // Admin Student Delete Safety Modal Events
        btnCloseStudentDeleteConfirm.addEventListener('click', () => modalStudentDeleteConfirm.classList.add('hidden'));
        btnCancelStudentDeleteConfirm.addEventListener('click', () => modalStudentDeleteConfirm.classList.add('hidden'));

        // Search in Admin Data View
        inputSearch.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            if (searchQuery) {
                btnClearSearch.classList.remove('hidden');
            } else {
                btnClearSearch.classList.add('hidden');
            }
            currentPage = 1;
            selectedPkValues.clear();
            updateBatchDeleteUI();
            if (currentTable) loadTableData();
        });

        btnClearSearch.addEventListener('click', () => {
            inputSearch.value = '';
            searchQuery = '';
            btnClearSearch.classList.add('hidden');
            currentPage = 1;
            selectedPkValues.clear();
            updateBatchDeleteUI();
            if (currentTable) loadTableData();
        });

        // CSV Export for current table
        btnExportCsv.addEventListener('click', handleExportTableCsv);

        // Batch Delete
        btnBatchDelete.addEventListener('click', handleBatchDelete);

        // Data View Pagination
        btnPrevPage.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                selectedPkValues.clear();
                updateBatchDeleteUI();
                loadTableData();
            }
        });

        btnNextPage.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                selectedPkValues.clear();
                updateBatchDeleteUI();
                loadTableData();
            }
        });

        // SQL Console Events
        btnRunSql.addEventListener('click', handleRunSql);
        btnExportSqlCsv.addEventListener('click', handleExportSqlCsv);

        // Admin CRUD Modals
        btnAddRow.addEventListener('click', openAddModal);
        btnCloseCrudModal.addEventListener('click', () => modalCrud.classList.add('hidden'));
        btnCancelCrud.addEventListener('click', () => modalCrud.classList.add('hidden'));
        formCrud.addEventListener('submit', handleSaveCrud);

        // User Account Management Events
        btnOpenUserCreate.addEventListener('click', openUserCreateModal);
        btnCloseUserCreate.addEventListener('click', () => modalUserCreate.classList.add('hidden'));
        btnCancelUserCreate.addEventListener('click', () => modalUserCreate.classList.add('hidden'));
        formUserCreate.addEventListener('submit', handleUserCreate);

        btnCloseUserPw.addEventListener('click', () => modalUserPassword.classList.add('hidden'));
        btnCancelUserPw.addEventListener('click', () => modalUserPassword.classList.add('hidden'));
        formUserPassword.addEventListener('submit', handleUserPasswordReset);

        btnCloseUserDelete.addEventListener('click', () => modalUserDelete.classList.add('hidden'));
        btnCancelUserDelete.addEventListener('click', () => modalUserDelete.classList.add('hidden'));
        btnSubmitUserDelete.addEventListener('click', handleUserDelete);

        // Class List Search & Pagination
        if (btnDoClassSearch) {
            btnDoClassSearch.addEventListener('click', () => {
                classSearchPage = 1;
                loadClassSearchResults();
            });
        }
        if (classSearchQ) {
            classSearchQ.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    classSearchPage = 1;
                    loadClassSearchResults();
                }
            });
        }
        if (btnResetClassFilter) {
            btnResetClassFilter.addEventListener('click', () => {
                classSearchQ.value = '';
                classSearchPage = 1;
                loadClassSearchResults();
            });
        }
        if (btnClassSearchPrev) {
            btnClassSearchPrev.addEventListener('click', () => {
                if (classSearchPage > 1) {
                    classSearchPage--;
                    loadClassSearchResults();
                }
            });
        }
        if (btnClassSearchNext) {
            btnClassSearchNext.addEventListener('click', () => {
                if (classSearchPage < classSearchTotalPages) {
                    classSearchPage++;
                    loadClassSearchResults();
                }
            });
        }

        // Class Registration Form
        if (formUserClassReg) {
            formUserClassReg.addEventListener('submit', handleUserClassSubmit);
        }
        if (btnResetClassForm) {
            btnResetClassForm.addEventListener('click', () => {
                formUserClassReg.reset();
                if (classRegMsg) classRegMsg.classList.add('hidden');
                loadClassRegForm();
            });
        }
        if (classStudentFilter) {
            classStudentFilter.addEventListener('input', () => renderStudentCheckboxList(classStudentList, classStudentFilter, classRegSelectedStudentIds, classRegStudentSpecialIds, classSelectedCount, document.getElementById('class-selected-names')));
        }

        // Class Detail Modal Close
        if (btnCloseClassDetail) {
            btnCloseClassDetail.addEventListener('click', () => modalClassDetail.classList.add('hidden'));
        }

        // Class Delete Confirm Modal Events
        if (btnCloseClassDeleteConfirm) {
            btnCloseClassDeleteConfirm.addEventListener('click', () => modalClassDeleteConfirm.classList.add('hidden'));
        }
        if (btnCancelClassDeleteConfirm) {
            btnCancelClassDeleteConfirm.addEventListener('click', () => modalClassDeleteConfirm.classList.add('hidden'));
        }
        if (btnSubmitClassDeleteConfirm) {
            btnSubmitClassDeleteConfirm.addEventListener('click', handleClassDeleteSubmit);
        }
        if (inputConfirmDeleteClassName) {
            inputConfirmDeleteClassName.addEventListener('input', () => {
                btnSubmitClassDeleteConfirm.disabled = (inputConfirmDeleteClassName.value.trim() !== pendingClassDeleteName);
            });
        }

        // Class Batch StudyLog Registration
        if (classBatchSelect) {
            classBatchSelect.addEventListener('change', (e) => {
                const classId = parseInt(e.target.value || '0');
                if (classId > 0) {
                    loadClassBatchForm(classId);
                } else {
                    resetBatchRegView();
                }
            });
        }
        if (formClassBatchStudyLog) {
            formClassBatchStudyLog.addEventListener('submit', handleBatchStudyLogSubmit);
        }
        if (batchStudiedDay) {
            batchStudiedDay.addEventListener('change', handleBatchDateChange);
        }
        if (btnBatchCalendarPrev) btnBatchCalendarPrev.addEventListener('click', () => changeBatchCalendarMonth(-1));
        if (btnBatchCalendarNext) btnBatchCalendarNext.addEventListener('click', () => changeBatchCalendarMonth(1));
    }

    // User Book Registration Handler
    async function handleUserBookSubmit(e) {
        e.preventDefault();
        userBookMsg.classList.add('hidden');

        const formData = new FormData(formUserBookReg);
        const payload = {
            Title: (formData.get('Title') || '').trim(),
            Author: (formData.get('Author') || '').trim(),
            Publisher: (formData.get('Publisher') || '').trim(),
            Subject: (formData.get('Subject') || '').trim(),
            Target: (formData.get('Target') || '').trim(),
            BookLength: parseInt(formData.get('BookLength')) || 0,
            Voca: parseInt(formData.get('Voca')) || 0,
            Metaphor: parseInt(formData.get('Metaphor')) || 0,
            HasQuiz: formData.get('HasQuiz') ? 1 : 0,
            HasReadingQuestion: formData.get('HasReadingQuestion') ? 1 : 0,
            HasReadingAnswer: formData.get('HasReadingAnswer') ? 1 : 0,
            HasWritingQuestion: formData.get('HasWritingQuestion') ? 1 : 0,
            HasWritingAnswer: formData.get('HasWritingAnswer') ? 1 : 0,
            HasAdvancedMaterial: formData.get('HasAdvancedMaterial') ? 1 : 0,
            HasDebateMaterial: formData.get('HasDebateMaterial') ? 1 : 0,
            IsPaperbookExist: formData.get('IsPaperbookExist') ? 1 : 0,
            IsPdfExist: formData.get('IsPdfExist') ? 1 : 0,
            IsYes24Exist: formData.get('IsYes24Exist') ? 1 : 0,
            IsMillieExist: formData.get('IsMillieExist') ? 1 : 0,
            Desc: (formData.get('Desc') || '').trim()
        };

        if (!payload.Title) {
            userBookMsg.className = 'alert alert-danger';
            userBookMsg.textContent = '도서명(Title)은 필수 입력 항목입니다.';
            userBookMsg.classList.remove('hidden');
            return;
        }

        try {
            const result = await apiFetch('/api/user/books', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            userBookMsg.className = 'alert alert-success';
            userBookMsg.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${result.message}`;
            userBookMsg.classList.remove('hidden');

            formUserBookReg.reset();
            clearBookSimilar();
            await loadRecentBooks();
            if (isAdmin() && currentTable === 'Books') {
                await loadTableData();
            }
        } catch (err) {
            userBookMsg.className = 'alert alert-danger';
            userBookMsg.textContent = err.message;
            userBookMsg.classList.remove('hidden');
        }
    }

    // User Student Registration Handler
    async function handleUserStudentSubmit(e) {
        e.preventDefault();
        userStudentMsg.classList.add('hidden');

        const formData = new FormData(formUserStudentReg);
        const payload = {
            Name: (formData.get('Name') || '').trim(),
            Sex: (formData.get('Sex') || '').trim(),
            Grade: (formData.get('Grade') || '').trim(),
            Referrer: (formData.get('Referrer') || '').trim(),
            Description: (formData.get('Description') || '').trim(),
            IsClassEnded: formData.get('IsClassEnded') ? 1 : 0
        };

        if (!payload.Name) {
            userStudentMsg.className = 'alert alert-danger';
            userStudentMsg.textContent = '학생 이름(Name)은 필수 입력 항목입니다.';
            userStudentMsg.classList.remove('hidden');
            return;
        }

        try {
            const result = await apiFetch('/api/user/students', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            userStudentMsg.className = 'alert alert-success';
            userStudentMsg.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${result.message}`;
            userStudentMsg.classList.remove('hidden');

            formUserStudentReg.reset();
            clearStudentSimilar();
            await loadRecentStudents();
            if (isAdmin() && currentTable === 'Students') {
                await loadTableData();
            }
        } catch (err) {
            userStudentMsg.className = 'alert alert-danger';
            userStudentMsg.textContent = err.message;
            userStudentMsg.classList.remove('hidden');
        }
    }

    // Load Recent Books Summary Card
    async function loadRecentBooks() {
        if (!token) return;
        try {
            recentBooksList.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 최근 도서 조회 중...</div>';
            const data = await apiFetch('/api/user/recent-books');
            const books = data.books;

            if (books.length === 0) {
                recentBooksList.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0.5rem;"><p>등록된 도서가 없습니다.</p></div>';
                return;
            }

            let html = '';
            books.forEach(b => {
                const title = escapeHtml(b.Title || '제목 없음');
                const author = escapeHtml(b.Author || '저자 미상');
                const publisher = escapeHtml(b.Publisher || '출판사 미상');
                html += `
                    <div class="recent-book-item">
                        <div class="recent-book-title" title="${title}"><i class="fa-solid fa-book" style="color: var(--success); margin-right: 0.3rem;"></i> ${title}</div>
                        <div class="recent-book-meta">
                            <span><i class="fa-solid fa-user"></i> ${author}</span>
                            <span><i class="fa-solid fa-building"></i> ${publisher}</span>
                        </div>
                    </div>
                `;
            });
            recentBooksList.innerHTML = html;
        } catch (err) {
            recentBooksList.innerHTML = `<div class="alert alert-danger" style="font-size: 0.75rem;">${err.message}</div>`;
        }
    }

    // Load Recent Students Summary Card
    async function loadRecentStudents() {
        if (!token) return;
        try {
            recentStudentsList.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 최근 학생 조회 중...</div>';
            const data = await apiFetch('/api/user/recent-students');
            const students = data.students;

            if (students.length === 0) {
                recentStudentsList.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0.5rem;"><p>등록된 학생이 없습니다.</p></div>';
                return;
            }

            let html = '';
            students.forEach(s => {
                const name = escapeHtml(s.Name || '이름 없음');
                const sex = formatSex(s.Sex);
                const grade = formatGrade(s.Grade);
                html += `
                    <div class="recent-book-item">
                        <div class="recent-book-title" title="${name}"><i class="fa-solid fa-user-graduate" style="color: var(--primary); margin-right: 0.3rem;"></i> ${name} (${sex})</div>
                        <div class="recent-book-meta">
                            <span><i class="fa-solid fa-graduation-cap"></i> ${grade}</span>
                            ${s.Referrer ? `<span><i class="fa-solid fa-user-plus"></i> 추천: ${formatReferrer(s.Referrer)}</span>` : ''}
                        </div>
                    </div>
                `;
            });
            recentStudentsList.innerHTML = html;
        } catch (err) {
            recentStudentsList.innerHTML = `<div class="alert alert-danger" style="font-size: 0.75rem;">${err.message}</div>`;
        }
    }

    // StudyLog State & Elements
    let studylogSearchPage = 1;
    let studylogSearchLimit = 30;
    let studylogSearchTotalPages = 1;

    // StudyLog Registration Elements
    const formUserStudyLogReg = document.getElementById('form-user-studylog-reg');
    const userStudyLogMsg = document.getElementById('user-studylog-msg');
    const selectedStudentId = document.getElementById('selected-student-id');
    const selectedStudentDisplay = document.getElementById('selected-student-display');
    const btnOpenStudentPicker = document.getElementById('btn-open-student-picker');
    const previewSelectedStudent = document.getElementById('preview-selected-student');

    const selectedBookId = document.getElementById('selected-book-id');
    const selectedBookDisplay = document.getElementById('selected-book-display');
    const btnOpenBookPicker = document.getElementById('btn-open-book-picker');
    const previewSelectedBook = document.getElementById('preview-selected-book');

    const studylogDate = document.getElementById('studylog-date');
    const btnClearStudyLogCache = document.getElementById('btn-clear-studylog-cache');
    const recentStudyLogsList = document.getElementById('recent-studylogs-list');

    // Default Date to Today
    if (studylogDate && !studylogDate.value) {
        studylogDate.value = new Date().toISOString().split('T')[0];
    }

    // Picker Modals Elements
    const modalStudentPicker = document.getElementById('modal-student-picker');
    const btnCloseStudentPicker = document.getElementById('btn-close-student-picker');
    const inputPickerStudentQ = document.getElementById('input-picker-student-q');
    const pickerStudentResults = document.getElementById('picker-student-results');

    const modalBookPicker = document.getElementById('modal-book-picker');
    const btnCloseBookPicker = document.getElementById('btn-close-book-picker');
    const inputPickerBookQ = document.getElementById('input-picker-book-q');
    const pickerBookResults = document.getElementById('picker-book-results');

    // StudyLog Search View Elements
    const studylogSearchQ = document.getElementById('studylog-search-q');
    const studylogFilterDate = document.getElementById('studylog-filter-date');
    const btnDoStudyLogSearch = document.getElementById('btn-do-studylog-search');
    const btnResetStudyLogFilter = document.getElementById('btn-reset-studylog-filter');
    const studylogSearchTotalCount = document.getElementById('studylog-search-total-count');
    const studylogSearchPaginationInfo = document.getElementById('studylog-search-pagination-info');
    const studylogCardsGrid = document.getElementById('studylog-cards-grid');
    const btnStudyLogSearchPrev = document.getElementById('btn-studylog-search-prev');
    const btnStudyLogSearchNext = document.getElementById('btn-studylog-search-next');
    const studylogSearchCurrentPageSpan = document.getElementById('studylog-search-current-page');

    // StudyLog Detail Modal Elements
    const modalStudyLogDetail = document.getElementById('modal-studylog-detail');
    const btnCloseStudyLogDetail = document.getElementById('btn-close-studylog-detail');
    const modalStudyLogDetailTitle = document.getElementById('modal-studylog-detail-title');
    const modalStudyLogDetailActions = document.getElementById('modal-studylog-detail-actions');
    const modalStudyLogDetailBody = document.getElementById('modal-studylog-detail-body');

    // StudyLog Admin Safety Delete Modal Elements
    const modalStudyLogDeleteConfirm = document.getElementById('modal-studylog-delete-confirm');
    const btnCloseStudyLogDeleteConfirm = document.getElementById('btn-close-studylog-delete-confirm');
    const btnCancelStudyLogDeleteConfirm = document.getElementById('btn-cancel-studylog-delete-confirm');
    const btnSubmitStudyLogDeleteConfirm = document.getElementById('btn-submit-studylog-delete-confirm');

    // Global Event Delegation for Pickers & StudyLog Modals
    document.addEventListener('click', (e) => {
        // Open Student Picker Modal
        const studentPickerOpener = e.target.closest('#btn-open-student-picker, #selected-student-display, #btn-open-picker-monthly-student');
        if (studentPickerOpener) {
            activeStudentPickerTarget = studentPickerOpener.id === 'btn-open-picker-monthly-student' ? 'monthly' : 'studylog';
            const modal = document.getElementById('modal-student-picker');
            const inputQ = document.getElementById('input-picker-student-q');
            const footer = document.getElementById('picker-student-footer');
            if (inputQ) inputQ.value = '';
            if (footer) {
                if (activeStudentPickerTarget === 'monthly') {
                    footer.classList.add('hidden');
                } else {
                    footer.classList.remove('hidden');
                    updatePickerSelectCountBadge();
                }
            }
            if (modal) modal.classList.remove('hidden');
            loadPickerStudents();
            return;
        }

        // Close Student Picker Modal
        if (e.target.closest('#btn-close-student-picker')) {
            const modal = document.getElementById('modal-student-picker');
            if (modal) modal.classList.add('hidden');
            return;
        }

        // Student Picker Footer Buttons (Select All / Deselect All / Confirm)
        if (e.target.closest('#btn-picker-student-select-all')) {
            const container = document.getElementById('picker-student-results');
            if (container) {
                container.querySelectorAll('.btn-select-student-picker').forEach(btn => {
                    const idVal = btn.getAttribute('data-id');
                    const id = parseInt(idVal);
                    const name = btn.getAttribute('data-name');
                    const sex = btn.getAttribute('data-sex');
                    const grade = btn.getAttribute('data-grade');
                    const referrer = btn.getAttribute('data-referrer');
                    selectedStudentsMap.set(id, { id, name, sex, grade, referrer });
                });
                loadPickerStudents();
                updatePickerSelectCountBadge();
            }
            return;
        }

        if (e.target.closest('#btn-picker-student-deselect-all')) {
            selectedStudentsMap.clear();
            loadPickerStudents();
            updatePickerSelectCountBadge();
            return;
        }

        if (e.target.closest('#btn-picker-student-confirm')) {
            const modal = document.getElementById('modal-student-picker');
            if (modal) modal.classList.add('hidden');
            updateSelectedStudentsUI();
            return;
        }

        // Open Book Picker Modal (studylog-reg 기본 대상 + data-picker-target 지원)
        const bookPickerOpener = e.target.closest('#btn-open-book-picker, #selected-book-display, [data-picker-target="batch"]');
        if (bookPickerOpener) {
            activeBookPickerTarget = bookPickerOpener.getAttribute('data-picker-target') || 'studylog';
            const modal = document.getElementById('modal-book-picker');
            const inputQ = document.getElementById('input-picker-book-q');
            if (inputQ) inputQ.value = '';
            if (modal) modal.classList.remove('hidden');
            loadPickerBooks();
            return;
        }

        // Close Book Picker Modal
        if (e.target.closest('#btn-close-book-picker')) {
            const modal = document.getElementById('modal-book-picker');
            if (modal) modal.classList.add('hidden');
            return;
        }

        // Clear StudyLog Form Cache
        if (e.target.closest('#btn-clear-studylog-cache')) {
            selectedStudentsMap.clear();
            updateSelectedStudentsUI();
            updatePickerSelectCountBadge();

            const bId = document.getElementById('selected-book-id');
            const bDisp = document.getElementById('selected-book-display');
            const bPrev = document.getElementById('preview-selected-book');
            const msg = document.getElementById('user-studylog-msg');

            if (bId) bId.value = '';
            if (bDisp) bDisp.value = '';
            if (bPrev) { bPrev.innerHTML = ''; bPrev.classList.add('hidden'); }
            if (msg) msg.classList.add('hidden');
            return;
        }

        // StudyLog Search Button
        if (e.target.closest('#btn-do-studylog-search')) {
            studylogSearchPage = 1;
            loadStudyLogSearchResults();
            return;
        }

        // Reset StudyLog Search Filter
        if (e.target.closest('#btn-reset-studylog-filter')) {
            const qInput = document.getElementById('studylog-search-q');
            const dateInput = document.getElementById('studylog-filter-date');
            if (qInput) qInput.value = '';
            if (dateInput) dateInput.value = '';
            studylogSearchPage = 1;
            loadStudyLogSearchResults();
            return;
        }

        // StudyLog Search Pagination
        if (e.target.closest('#btn-studylog-search-prev')) {
            if (studylogSearchPage > 1) {
                studylogSearchPage--;
                loadStudyLogSearchResults();
            }
            return;
        }

        if (e.target.closest('#btn-studylog-search-next')) {
            if (studylogSearchPage < studylogSearchTotalPages) {
                studylogSearchPage++;
                loadStudyLogSearchResults();
            }
            return;
        }

        // Close StudyLog Detail Modal
        if (e.target.closest('#btn-close-studylog-detail')) {
            const modal = document.getElementById('modal-studylog-detail');
            if (modal) modal.classList.add('hidden');
            return;
        }

        // Close StudyLog Delete Confirm Modal
        if (e.target.closest('#btn-close-studylog-delete-confirm, #btn-cancel-studylog-delete-confirm')) {
            const modal = document.getElementById('modal-studylog-delete-confirm');
            if (modal) modal.classList.add('hidden');
            return;
        }

        // Click on StudyLog Item Card
        const studylogCard = e.target.closest('.studylog-item-card');
        if (studylogCard) {
            const logId = studylogCard.getAttribute('data-log-id');
            if (logId) openStudyLogDetailModal(logId);
            return;
        }
    });

    // Realtime Search Input Events
    document.addEventListener('input', (e) => {
        if (e.target.id === 'input-picker-student-q') {
            loadPickerStudents();
        } else if (e.target.id === 'input-picker-book-q') {
            loadPickerBooks();
        }
    });

    // Keydown Enter Event Delegation for Search Inputs
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.target.id === 'studylog-search-q' || e.target.id === 'studylog-filter-date') {
                e.preventDefault();
                studylogSearchPage = 1;
                loadStudyLogSearchResults();
            } else if (e.target.id === 'book-search-q') {
                e.preventDefault();
                searchPage = 1;
                loadBookSearchResults();
            } else if (e.target.id === 'student-search-q') {
                e.preventDefault();
                studentSearchPage = 1;
                loadStudentSearchResults();
            }
        }
    });

    // Form Submit Event Handler
    document.addEventListener('submit', (e) => {
        if (e.target.id === 'form-user-studylog-reg') {
            handleUserStudyLogSubmit(e);
        }
    });

    // Selected Students UI & Count Update Helpers
    function updateSelectedStudentsUI() {
        const elId = document.getElementById('selected-student-id');
        const elDisp = document.getElementById('selected-student-display');
        const elPrev = document.getElementById('preview-selected-student');

        const students = Array.from(selectedStudentsMap.values());
        if (students.length === 0) {
            if (elId) elId.value = '';
            if (elDisp) elDisp.value = '';
            if (elPrev) {
                elPrev.innerHTML = '';
                elPrev.classList.add('hidden');
            }
            return;
        }

        const firstStudent = students[0];
        if (elId) elId.value = firstStudent.id;

        if (students.length === 1) {
            if (elDisp) elDisp.value = `${firstStudent.name} (${firstStudent.sex}) - 학년 ${firstStudent.grade}`;
        } else {
            if (elDisp) elDisp.value = `${firstStudent.name} 외 ${students.length - 1}명 (총 ${students.length}명 선택됨)`;
        }

        if (elPrev) {
            let chipsHtml = `
                <div class="preview-info" style="margin-bottom: 0.5rem;">
                    <div class="preview-title"><i class="fa-solid fa-circle-check"></i> 선택된 학생: 총 ${students.length}명</div>
                </div>
                <div class="selected-students-chips">
            `;
            students.forEach(s => {
                chipsHtml += `
                    <span class="student-chip">
                        <i class="fa-solid fa-user-graduate"></i> ${escapeHtml(s.name)} (${s.sex}, ${s.grade})
                        <span class="btn-remove-chip" data-id="${s.id}" title="선택 삭제">&times;</span>
                    </span>
                `;
            });
            chipsHtml += `</div>`;
            elPrev.innerHTML = chipsHtml;
            elPrev.classList.remove('hidden');

            elPrev.querySelectorAll('.btn-remove-chip').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const sIdStr = btn.getAttribute('data-id');
                    const sIdNum = parseInt(sIdStr);
                    selectedStudentsMap.delete(sIdNum);
                    selectedStudentsMap.delete(sIdStr);
                    updateSelectedStudentsUI();
                    updatePickerSelectCountBadge();
                    loadPickerStudents();
                });
            });
        }
    }

    function updatePickerSelectCountBadge() {
        const badge = document.getElementById('picker-student-select-count');
        if (badge) {
            badge.textContent = `${selectedStudentsMap.size}명`;
        }
    }

    // Load Picker Students List
    async function loadPickerStudents() {
        const container = document.getElementById('picker-student-results');
        const inputQ = document.getElementById('input-picker-student-q');
        if (!container) return;

        try {
            container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 검색 중...</div>';
            const q = inputQ ? inputQ.value.trim() : '';
            const data = await apiFetch(`/api/user/picker/students${q ? '?q=' + encodeURIComponent(q) : ''}`);
            const students = data.students || [];

            if (students.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>검색 조건에 맞는 학생이 없습니다.</p></div>';
                return;
            }

            let html = '';
            students.forEach(s => {
                const sId = parseInt(s.row_id || s.Id);
                const name = escapeHtml(s.Name || '이름 없음');
                const sex = formatSex(s.Sex);
                const grade = formatGrade(s.Grade);
                const referrer = formatReferrer(s.Referrer);
                const isSelected = activeStudentPickerTarget === 'studylog' && selectedStudentsMap.has(sId);

                html += `
                    <div class="picker-item-row ${isSelected ? 'selected' : ''}" data-row-id="${sId}">
                        <div class="item-main">
                            <div class="item-title"><i class="fa-solid fa-user-graduate" style="color: var(--primary);"></i> ${name} (${sex})</div>
                            <div class="item-sub">학년: ${grade}${s.Referrer ? ' · 추천: ' + referrer : ''} | ID: #${sId}</div>
                        </div>
                        <button type="button" class="btn btn-sm ${isSelected ? 'btn-success' : 'btn-outline-primary'} btn-select-student-picker"
                                data-id="${sId}" data-name="${name}" data-sex="${sex}" data-grade="${grade}" data-referrer="${referrer}">
                            <i class="fa-solid fa-${isSelected ? 'check' : 'plus'}"></i> ${isSelected ? '선택됨' : '선택'}
                        </button>
                    </div>
                `;
            });
            container.innerHTML = html;

            container.querySelectorAll('.btn-select-student-picker').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = parseInt(btn.getAttribute('data-id'));
                    const name = btn.getAttribute('data-name');
                    const sex = btn.getAttribute('data-sex');
                    const grade = btn.getAttribute('data-grade');
                    const referrer = btn.getAttribute('data-referrer');

                    if (activeStudentPickerTarget === 'monthly') {
                        const monthlySelect = document.getElementById('monthly-report-student-select');
                        const elModal = document.getElementById('modal-student-picker');
                        if (monthlySelect) {
                            monthlySelect.value = id;
                            loadMonthlyReportLogs();
                        }
                        if (elModal) elModal.classList.add('hidden');
                        activeStudentPickerTarget = 'studylog';
                        return;
                    }

                    // Studylog multi selection toggle
                    if (selectedStudentsMap.has(id)) {
                        selectedStudentsMap.delete(id);
                    } else {
                        selectedStudentsMap.set(id, { id, name, sex, grade, referrer });
                    }

                    loadPickerStudents();
                    updatePickerSelectCountBadge();
                });
            });
        } catch (err) {
            container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    // Load Picker Books List
    async function loadPickerBooks() {
        const container = document.getElementById('picker-book-results');
        const inputQ = document.getElementById('input-picker-book-q');
        if (!container) return;

        try {
            container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 검색 중...</div>';
            const q = inputQ ? inputQ.value.trim() : '';
            const data = await apiFetch(`/api/user/picker/books${q ? '?q=' + encodeURIComponent(q) : ''}`);
            const books = data.books || [];

            if (books.length === 0) {
                container.innerHTML = '<div class="empty-state"><p>검색 조건에 맞는 도서가 없습니다.</p></div>';
                return;
            }

            let html = '';
            books.forEach(b => {
                const bId = b.row_id || b.Id;
                const title = escapeHtml(b.Title || '제목 없음');
                const author = escapeHtml(b.Author || '저자 미상');
                const publisher = escapeHtml(b.Publisher || '출판사 미상');
                const subject = escapeHtml(b.Subject || '분야 미상');
                html += `
                    <div class="picker-item-row">
                        <div class="item-main">
                            <div class="item-title"><i class="fa-solid fa-book" style="color: var(--success);"></i> ${title}</div>
                            <div class="item-sub">저자: ${author} | 출판사: ${publisher} | 분야: ${subject} | ID: #${bId}</div>
                        </div>
                        <button type="button" class="btn btn-sm btn-success btn-select-book-picker"
                                data-id="${bId}" data-title="${title}" data-author="${author}" data-publisher="${publisher}">
                            <i class="fa-solid fa-check"></i> 선택
                        </button>
                    </div>
                `;
            });
            container.innerHTML = html;

            container.querySelectorAll('.btn-select-book-picker').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-id');
                    const title = btn.getAttribute('data-title');
                    const author = btn.getAttribute('data-author');
                    const publisher = btn.getAttribute('data-publisher');

                    // 대상 요소 결정: 'batch' → 일괄 등록 폼, 그 외 → 기존 학습 기록 등록 폼
                    const targetMap = {
                        batch: { id: 'batch-book-id', display: 'batch-book-display', preview: 'preview-batch-book' },
                        studylog: { id: 'selected-book-id', display: 'selected-book-display', preview: 'preview-selected-book' }
                    };
                    const t = targetMap[activeBookPickerTarget] || targetMap.studylog;

                    const elId = document.getElementById(t.id);
                    const elDisp = document.getElementById(t.display);
                    const elPrev = document.getElementById(t.preview);
                    const elModal = document.getElementById('modal-book-picker');

                    if (elId) elId.value = id;
                    if (elDisp) elDisp.value = `${title} (${author} / ${publisher})`;

                    if (elPrev) {
                        elPrev.innerHTML = `
                            <div class="preview-info">
                                <div class="preview-title"><i class="fa-solid fa-circle-check"></i> 선택된 도서: ${title}</div>
                                <div class="preview-meta">저자: ${author} | 출판사: ${publisher} | ID: #${id}</div>
                            </div>
                        `;
                        elPrev.classList.remove('hidden');
                    }
                    if (elModal) elModal.classList.add('hidden');
                });
            });
        } catch (err) {
            container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    // Load Student Options for Registration Dropdown
    async function loadStudentOptions() {
        const select = document.getElementById('studylog-student-id');
        if (!select) return;
        try {
            const data = await apiFetch('/api/user/students-options');
            const students = data.students || [];
            if (students.length === 0) {
                select.innerHTML = '<option value="">등록된 학생이 없습니다</option>';
                return;
            }
            let html = '<option value="">-- 학습할 학생을 선택해 주세요 --</option>';
            students.forEach(s => {
                const sId = s.row_id || s.Id;
                const name = escapeHtml(s.Name || '이름 없음');
                const sex = formatSex(s.Sex);
                const birthday = formatBirthday(s.Birthday);
                html += `<option value="${sId}">${name} (${sex}) - 生 ${birthday} [#${sId}]</option>`;
            });
            const curVal = select.value;
            select.innerHTML = html;
            if (curVal) select.value = curVal;
        } catch (err) {
            select.innerHTML = `<option value="">학생 로딩 실패: ${err.message}</option>`;
        }
    }

    // Load Book Options for Registration Dropdown
    async function loadBookOptions() {
        const select = document.getElementById('studylog-book-id');
        if (!select) return;
        try {
            const data = await apiFetch('/api/user/books-options');
            const books = data.books || [];
            if (books.length === 0) {
                select.innerHTML = '<option value="">등록된 도서가 없습니다</option>';
                return;
            }
            let html = '<option value="">-- 학습할 도서를 선택해 주세요 --</option>';
            books.forEach(b => {
                const bId = b.row_id || b.Id;
                const title = escapeHtml(b.Title || '제목 없음');
                const author = escapeHtml(b.Author || '저자 미상');
                const publisher = escapeHtml(b.Publisher || '출판사 미상');
                html += `<option value="${bId}">${title} (저자: ${author} / 출판사: ${publisher}) [#${bId}]</option>`;
            });
            const curVal = select.value;
            select.innerHTML = html;
            if (curVal) select.value = curVal;
        } catch (err) {
            select.innerHTML = `<option value="">도서 로딩 실패: ${err.message}</option>`;
        }
    }

    // Handle StudyLog Form Submit (With Multiple Students Selection Caching!)
    async function handleUserStudyLogSubmit(e) {
        e.preventDefault();
        const userStudyLogMsg = document.getElementById('user-studylog-msg');
        const selectedBookId = document.getElementById('selected-book-id');
        const studylogDate = document.getElementById('studylog-date');

        if (userStudyLogMsg) userStudyLogMsg.classList.add('hidden');

        const studentIds = Array.from(selectedStudentsMap.keys()).map(id => parseInt(id)).filter(id => id > 0);
        const bId = parseInt(selectedBookId ? selectedBookId.value : '0');
        const dateVal = studylogDate ? studylogDate.value : '';

        if (studentIds.length === 0) {
            if (userStudyLogMsg) {
                userStudyLogMsg.className = 'alert alert-danger';
                userStudyLogMsg.textContent = '학습할 학생을 1명 이상 선택해 주세요.';
                userStudyLogMsg.classList.remove('hidden');
            }
            return;
        }

        if (!bId || bId <= 0) {
            if (userStudyLogMsg) {
                userStudyLogMsg.className = 'alert alert-danger';
                userStudyLogMsg.textContent = '학습할 도서를 선택해 주세요.';
                userStudyLogMsg.classList.remove('hidden');
            }
            return;
        }

        if (!dateVal) {
            if (userStudyLogMsg) {
                userStudyLogMsg.className = 'alert alert-danger';
                userStudyLogMsg.textContent = '학습 수행 일자를 입력해 주세요.';
                userStudyLogMsg.classList.remove('hidden');
            }
            return;
        }

        const descEl = document.getElementById('studylog-desc');
        const desc = descEl ? descEl.value.trim() : '';
        const contentEl = document.getElementById('studylog-content');
        const content = contentEl ? contentEl.value.trim() : '';
        const specialEl = document.getElementById('studylog-special');
        const isSpecial = specialEl ? specialEl.checked : false;

        const payload = {
            StudentIds: studentIds,
            StudentId: studentIds[0], // 하위 호환용
            BookId: bId,
            StudiedDay: dateVal,
            IsSpecial: isSpecial,
            LessonContent: content,
            Description: desc
        };

        try {
            const result = await apiFetch('/api/user/studylogs', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (userStudyLogMsg) {
                userStudyLogMsg.className = 'alert alert-success';
                userStudyLogMsg.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${result.message} (선택된 학생·도서·날짜가 그대로 유지되어 연속 등록이 가능합니다)`;
                userStudyLogMsg.classList.remove('hidden');
            }

            // NOTE: Do NOT reset the form! Selected student, book, and date remain intact!
            await loadRecentStudyLogs();
            if (isAdmin() && currentTable === 'StudyLogs') {
                await loadTableData();
            }
        } catch (err) {
            if (userStudyLogMsg) {
                userStudyLogMsg.className = 'alert alert-danger';
                userStudyLogMsg.textContent = err.message;
                userStudyLogMsg.classList.remove('hidden');
            }
        }
    }

    // Load Recent StudyLogs Summary Card
    async function loadRecentStudyLogs() {
        if (!token) return;
        try {
            recentStudyLogsList.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 최근 학습 기록 조회 중...</div>';
            const data = await apiFetch('/api/user/recent-studylogs');
            const logs = data.studylogs;

            if (logs.length === 0) {
                recentStudyLogsList.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0.5rem;"><p>등록된 학습 기록이 없습니다.</p></div>';
                return;
            }

            let html = '';
            logs.forEach(l => {
                const sName = escapeHtml(l.StudentName || '학생 미상');
                const bTitle = escapeHtml(l.BookTitle || '도서 미상');
                const day = escapeHtml(l.StudiedDay || '일자 미상');
                const sRef = l.StudentReferrer ? ' · 추천: ' + formatReferrer(l.StudentReferrer) : '';
                html += `
                    <div class="recent-book-item">
                        <div class="recent-book-title" title="${sName} - ${bTitle}">
                            <i class="fa-solid fa-book-bookmark" style="color: var(--warning); margin-right: 0.3rem;"></i> <strong>${sName}</strong>${sRef}: ${bTitle}
                        </div>
                        <div class="recent-book-meta">
                            <span><i class="fa-solid fa-calendar-check"></i> ${day}</span>
                            ${l.IsSpecial ? '<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.35);"><i class="fa-solid fa-star"></i> 특강</span>' : ''}
                        </div>
                    </div>
                `;
            });
            recentStudyLogsList.innerHTML = html;
        } catch (err) {
            recentStudyLogsList.innerHTML = `<div class="alert alert-danger" style="font-size: 0.75rem;">${err.message}</div>`;
        }
    }

    // Load StudyLog Search Results Grid
    async function loadStudyLogSearchResults() {
        if (!token) return;
        try {
            studylogCardsGrid.innerHTML = '<div class="empty-state" style="grid-column: span 10;"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>학습 기록 검색 중...</p></div>';

            const q = studylogSearchQ.value.trim();
            const date = studylogFilterDate.value.trim();

            const queryParams = new URLSearchParams({
                page: studylogSearchPage,
                limit: studylogSearchLimit
            });
            if (q) queryParams.append('q', q);
            if (date) queryParams.append('studied_day', date);

            const data = await apiFetch(`/api/user/studylogs/search?${queryParams.toString()}`);
            studylogSearchTotalPages = data.total_pages;

            studylogSearchTotalCount.textContent = `총 ${data.total_count} 건의 학습 기록`;
            studylogSearchPaginationInfo.textContent = `${studylogSearchPage} / ${studylogSearchTotalPages} 페이지 (총 ${data.total_count}건)`;
            studylogSearchCurrentPageSpan.textContent = studylogSearchPage;
            btnStudyLogSearchPrev.disabled = (studylogSearchPage <= 1);
            btnStudyLogSearchNext.disabled = (studylogSearchPage >= studylogSearchTotalPages);

            renderStudyLogCards(data.studylogs);
        } catch (err) {
            studylogCardsGrid.innerHTML = `<div class="empty-state" style="grid-column: span 10;"><p class="alert alert-danger">${err.message}</p></div>`;
        }
    }

    function showToast(message, type = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:8px; pointer-events:none;';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.cssText = 'padding:10px 16px; background:#1e293b; color:#fff; border-radius:6px; border-left:4px solid #3b82f6; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-size:0.875rem; pointer-events:auto; transition:all 0.3s ease;';
        if (type === 'success') toast.style.borderLeftColor = '#10b981';
        if (type === 'warning') toast.style.borderLeftColor = '#f59e0b';
        if (type === 'danger' || type === 'error') toast.style.borderLeftColor = '#ef4444';
        toast.innerHTML = escapeHtml(message);
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    async function toggleBookField(bookId, field, newVal, chkEl) {
        try {
            const payload = { data: {} };
            payload.data[field] = newVal;
            await apiFetch(`/api/user/books/${bookId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showToast('도서 보유 자료 정보가 업데이트되었습니다.', 'success');
        } catch (err) {
            chkEl.checked = !chkEl.checked;
            alert('도서 정보 수정 실패: ' + err.message);
        }
    }

    async function toggleStudentEnded(studentId, newVal, btnEl) {
        try {
            await apiFetch(`/api/user/students/${studentId}`, {
                method: 'PUT',
                body: JSON.stringify({ data: { IsClassEnded: newVal } })
            });
            btnEl.setAttribute('data-current', newVal);
            if (newVal === 1) {
                btnEl.className = 'btn-toggle-status is-ended btn-toggle-student-ended';
                btnEl.innerHTML = '<i class="fa-solid fa-graduation-cap"></i> 수업 종료';
            } else {
                btnEl.className = 'btn-toggle-status is-active btn-toggle-student-ended';
                btnEl.innerHTML = '<i class="fa-solid fa-circle-play"></i> 진행 중';
            }
            showToast('학생 수업 종료 상태가 변경되었습니다.', 'success');
        } catch (err) {
            alert('수업 종료 상태 변경 실패: ' + err.message);
        }
    }

    async function toggleStudentSex(studentId, newSex, btnEl) {
        try {
            await apiFetch(`/api/user/students/${studentId}`, {
                method: 'PUT',
                body: JSON.stringify({ data: { Sex: newSex } })
            });
            btnEl.setAttribute('data-current-sex', newSex);
            btnEl.textContent = newSex;
            btnEl.className = `badge btn-toggle-student-sex ${newSex === '남' ? 'badge-info' : 'badge-danger'}`;
            showToast(`학생 성별이 ${newSex}(으)로 변경되었습니다.`, 'success');
        } catch (err) {
            alert('학생 성별 변경 실패: ' + err.message);
        }
    }

    async function toggleClassEnded(classId, newVal, btnEl) {
        try {
            await apiFetch(`/api/user/classes/${classId}`, {
                method: 'PUT',
                body: JSON.stringify({ data: { IsEnded: newVal } })
            });
            btnEl.setAttribute('data-current', newVal);
            if (newVal === 1) {
                btnEl.className = 'btn-toggle-status is-ended btn-toggle-class-ended';
                btnEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> 종강/완료';
            } else {
                btnEl.className = 'btn-toggle-status is-active btn-toggle-class-ended';
                btnEl.innerHTML = '<i class="fa-solid fa-chalkboard-user"></i> 수업 진행 중';
            }
            showToast('수업 종료 상태가 변경되었습니다.', 'success');
        } catch (err) {
            alert('수업 상태 변경 실패: ' + err.message);
        }
    }

    async function toggleStudyLogSpecial(logId, newVal, btnEl) {
        try {
            await apiFetch(`/api/user/studylogs/${logId}`, {
                method: 'PUT',
                body: JSON.stringify({ data: { IsSpecial: newVal } })
            });
            btnEl.setAttribute('data-current', newVal);
            if (newVal === 1) {
                btnEl.className = 'btn-toggle-status is-special btn-toggle-studylog-special';
                btnEl.innerHTML = '<i class="fa-solid fa-star"></i> 특강';
            } else {
                btnEl.className = 'btn-toggle-status is-normal btn-toggle-studylog-special';
                btnEl.innerHTML = '<i class="fa-regular fa-star"></i> 일반';
            }
            showToast('학습 기록 특강 여부가 변경되었습니다.', 'success');
        } catch (err) {
            alert('특강 여부 변경 실패: ' + err.message);
        }
    }

    function renderStudyLogCards(studylogs) {
        if (studylogs.length === 0) {
            studylogCardsGrid.innerHTML = '<tr><td colspan="8" class="text-center p-4"><div class="empty-state"><i class="fa-solid fa-book-bookmark fa-2x"></i><p>검색 조건에 일치하는 학습 기록이 없습니다.</p></div></td></tr>';
            return;
        }

        let html = '';
        studylogs.forEach(l => {
            const sName = escapeHtml(l.StudentName || '학생 미상');
            const bTitle = escapeHtml(l.BookTitle || '도서 미상');
            const day = escapeHtml(l.StudiedDay || '일자 미상');
            const lc = escapeHtml((l.LessonContent || '').trim() || '-');
            const dc = escapeHtml((l.Description || '').trim() || '-');
            const logId = l.row_id || l.Id;
            const isSpecial = !!(l.IsSpecial == 1);

            html += `
                <tr data-log-id="${logId}">
                    <td><strong>#${logId}</strong></td>
                    <td><span class="badge badge-warning"><i class="fa-solid fa-calendar-check"></i> ${day}</span></td>
                    <td class="fw-semibold">${sName}</td>
                    <td class="text-primary text-truncate-cell" title="${bTitle}">${bTitle}</td>
                    <td class="text-center">
                        <button type="button" class="btn-toggle-status ${isSpecial ? 'is-special' : 'is-normal'} btn-toggle-studylog-special" data-log-id="${logId}" data-current="${isSpecial ? 1 : 0}">
                            ${isSpecial ? '<i class="fa-solid fa-star"></i> 특강' : '<i class="fa-regular fa-star"></i> 일반'}
                        </button>
                    </td>
                    <td class="text-truncate-cell" title="${lc}">${lc}</td>
                    <td class="text-muted text-truncate-cell" title="${dc}">${dc}</td>
                    <td>
                        <button type="button" class="btn btn-xs btn-outline btn-open-studylog-detail" data-log-id="${logId}">
                            <i class="fa-solid fa-eye"></i> 상세
                        </button>
                    </td>
                </tr>
            `;
        });

        studylogCardsGrid.innerHTML = html;

        document.querySelectorAll('.btn-open-studylog-detail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const logId = btn.getAttribute('data-log-id');
                openStudyLogDetailModal(logId);
            });
        });

        document.querySelectorAll('.btn-toggle-studylog-special').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const logId = btn.getAttribute('data-log-id');
                const currentVal = parseInt(btn.getAttribute('data-current')) || 0;
                const newVal = currentVal === 1 ? 0 : 1;
                await toggleStudyLogSpecial(logId, newVal, btn);
            });
        });
    }

    // Open StudyLog Detail Modal
    async function openStudyLogDetailModal(logId) {
        modalStudyLogDetailBody.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>학습 기록 상세 정보 조회 중...</p></div>';
        modalStudyLogDetailTitle.innerHTML = `<i class="fa-solid fa-book-bookmark"></i> 학습 기록 상세 정보`;
        modalStudyLogDetailActions.innerHTML = '';
        modalStudyLogDetail.classList.remove('hidden');

        try {
            const data = await apiFetch(`/api/user/studylogs/${logId}`);
            const l = data.studylog;

            if (isStaff()) {
                modalStudyLogDetailActions.innerHTML = `
                    <button id="btn-modal-delete-studylog" class="btn btn-sm btn-danger">
                        <i class="fa-solid fa-trash-can"></i> 학습 기록 삭제
                    </button>
                `;
                document.getElementById('btn-modal-delete-studylog').addEventListener('click', () => {
                    openAdminStudyLogDeleteSafetyModal(l, logId);
                });
            }

            const sName = escapeHtml(l.StudentName || '학생 미상');
            const sSex = formatSex(l.StudentSex);
            const sRef = l.StudentReferrer ? ' · 추천: ' + formatReferrer(l.StudentReferrer) : '';
            const bTitle = escapeHtml(l.BookTitle || '도서 미상');
            const bAuthor = escapeHtml(l.BookAuthor || '저자 미상');
            const bPublisher = escapeHtml(l.BookPublisher || '출판사 미상');
            const bSubject = escapeHtml(l.BookSubject || '분야 미상');

            // 수업 내용 + 수업 내용 메모 (항상 표시, 수업 내용이 앞. 값이 없으면 안내 문구)
            const lc = (l.LessonContent || '').trim();
            const dc = (l.Description || '').trim();
            const contentHtml = `
                <div style="margin-top: 1rem;">
                    <div class="detail-section-title"><i class="fa-solid fa-book-open"></i> 수업 내용</div>
                    <div class="detail-desc-box" style="white-space: pre-wrap; background: var(--bg-surface); padding: 0.9rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                        ${lc ? escapeHtml(lc) : '<span class="text-muted" style="font-size: 0.8rem;">작성된 수업 내용이 없습니다.</span>'}
                    </div>
                </div>
            `;
            const descHtml = `
                <div style="margin-top: 1rem;">
                    <div class="detail-section-title"><i class="fa-solid fa-note-sticky"></i> 수업 내용 메모</div>
                    <div class="detail-desc-box" style="white-space: pre-wrap; background: var(--bg-surface); padding: 0.9rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                        ${dc ? escapeHtml(dc) : '<span class="text-muted" style="font-size: 0.8rem;">작성된 메모가 없습니다.</span>'}
                    </div>
                </div>
            `;

            let html = `
                <div class="detail-header-block">
                    <div class="detail-title"><i class="fa-solid fa-user-graduate" style="color: var(--primary);"></i> ${sName} (${sSex})${sRef} 학생의 학습 기록 ${l.IsSpecial ? '<span class="badge" style="margin-left: 0.5rem; background: rgba(245, 158, 11, 0.2); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.35);"><i class="fa-solid fa-star"></i> 특강</span>' : ''}</div>
                    <div class="detail-meta-row">
                        <span><i class="fa-solid fa-calendar-check"></i> 학습 수행 일자: <strong>${escapeHtml(l.StudiedDay || '미상')}</strong></span>
                        <span><i class="fa-solid fa-hashtag"></i> Log ID: <strong>#${l.row_id || l.Id}</strong></span>
                    </div>
                </div>

                <div style="margin-top: 1rem;">
                    <div class="detail-section-title"><i class="fa-solid fa-book"></i> 학습 도서 정보</div>
                    <div style="background: var(--bg-surface); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                        <h4 style="font-size: 1.1rem; color: var(--success); margin-bottom: 0.4rem;">${bTitle}</h4>
                        <p style="font-size: 0.85rem; color: var(--text-dim); margin-bottom: 0.6rem;">저자: ${bAuthor} | 출판사: ${bPublisher} | 주제/분야: ${bSubject}</p>
                        
                        <div class="book-spec-grid" style="margin-top: 0.75rem;">
                            <div class="spec-box"><span class="spec-label">분량</span><span class="spec-value">${l.BookLength || 0} 단계</span></div>
                            <div class="spec-box"><span class="spec-label">어휘</span><span class="spec-value">${l.Voca || 0} 단계</span></div>
                            <div class="spec-box"><span class="spec-label">비유</span><span class="spec-value">${l.Metaphor || 0} 단계</span></div>
                        </div>

                        <div class="badge-feature-row" style="margin-top: 0.75rem;">
                            ${l.HasQuiz ? '<span class="badge badge-feature"><i class="fa-solid fa-check"></i> 어휘 퀴즈</span>' : ''}
                            ${l.HasReadingQuestion ? '<span class="badge badge-feature"><i class="fa-solid fa-check"></i> 독서 이해 문제</span>' : ''}
                            ${l.HasWritingQuestion ? '<span class="badge badge-feature"><i class="fa-solid fa-check"></i> 독서 논술 문제</span>' : ''}
                            ${l.HasDebateMaterial ? '<span class="badge badge-feature"><i class="fa-solid fa-check"></i> 토론 자료</span>' : ''}
                            ${l.IsPaperbookExist ? '<span class="badge badge-feature"><i class="fa-solid fa-book"></i> 종이책 보유</span>' : ''}
                            ${l.IsPdfExist ? '<span class="badge badge-feature"><i class="fa-solid fa-file-pdf"></i> PDF 파일</span>' : ''}
                        </div>
                    </div>
                </div>

                ${contentHtml}

                ${descHtml}
            `;

            modalStudyLogDetailBody.innerHTML = html;
        } catch (err) {
            modalStudyLogDetailBody.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    // Admin StudyLog Delete Safety Confirmation Handler
    function openAdminStudyLogDeleteSafetyModal(l, logId) {
        modalStudyLogDeleteConfirm.classList.remove('hidden');

        btnSubmitStudyLogDeleteConfirm.onclick = async () => {
            const pkVal = l.row_id || l.Id;

            try {
                await apiFetch(`/api/user/studylogs/${pkVal}`, {
                    method: 'DELETE'
                });

                modalStudyLogDeleteConfirm.classList.add('hidden');
                modalStudyLogDetail.classList.add('hidden');

                alert(`학습 기록 (ID: #${pkVal})이 성공적으로 삭제되었습니다.`);

                await loadStudyLogSearchResults();
                await loadRecentStudyLogs();
                if (currentTable === 'StudyLogs') await loadTableData();
            } catch (err) {
                alert(`삭제 실패: ${err.message}`);
            }
        };
    }

    function getSelectedTargetCheckboxes() {
        const chks = document.querySelectorAll('.filter-target-chk:checked');
        return Array.from(chks).map(c => c.value.trim()).filter(Boolean).join(',');
    }

    // Book Search Handler
    async function loadBookSearchResults() {
        if (!token) return;
        try {
            bookCardsGrid.innerHTML = '<div class="empty-state" style="grid-column: span 10;"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>도서 검색 중...</p></div>';

            const q = bookSearchQ.value.trim();
            const target = getSelectedTargetCheckboxes();
            const vocaMin = (filterVocaMin && filterVocaMin.value !== '' && !isNaN(filterVocaMin.value)) ? parseInt(filterVocaMin.value) : 0;
            const vocaMax = (filterVocaMax && filterVocaMax.value !== '' && !isNaN(filterVocaMax.value)) ? parseInt(filterVocaMax.value) : 10;
            const lengthMin = (filterLengthMin && filterLengthMin.value !== '' && !isNaN(filterLengthMin.value)) ? parseInt(filterLengthMin.value) : 0;
            const lengthMax = (filterLengthMax && filterLengthMax.value !== '' && !isNaN(filterLengthMax.value)) ? parseInt(filterLengthMax.value) : 10;
            const hasQuiz = filterChkQuiz.checked ? 1 : 0;
            const hasReading = filterChkReading.checked ? 1 : 0;
            const hasWriting = filterChkWriting.checked ? 1 : 0;
            const hasPdf = filterChkPdf.checked ? 1 : 0;

            const queryParams = new URLSearchParams({
                page: searchPage,
                limit: searchLimit
            });
            if (q) queryParams.append('q', q);
            if (target) queryParams.append('target', target);
            if (vocaMin > 0 || vocaMax < 10) {
                queryParams.append('voca_min', vocaMin);
                queryParams.append('voca_max', vocaMax);
            }
            if (lengthMin > 0 || lengthMax < 10) {
                queryParams.append('length_min', lengthMin);
                queryParams.append('length_max', lengthMax);
            }
            if (hasQuiz) queryParams.append('has_quiz', 1);
            if (hasReading) queryParams.append('has_reading', 1);
            if (hasWriting) queryParams.append('has_writing', 1);
            if (hasPdf) queryParams.append('has_pdf', 1);

            const data = await apiFetch(`/api/user/books/search?${queryParams.toString()}`);
            searchTotalPages = data.total_pages;

            searchTotalCount.textContent = `총 ${data.total_count} 건의 도서`;
            searchPaginationInfo.textContent = `${searchPage} / ${searchTotalPages} 페이지 (총 ${data.total_count}건)`;
            searchCurrentPageSpan.textContent = searchPage;
            btnSearchPrev.disabled = (searchPage <= 1);
            btnSearchNext.disabled = (searchPage >= searchTotalPages);

            renderBookCards(data.books);
        } catch (err) {
            bookCardsGrid.innerHTML = `<div class="empty-state" style="grid-column: span 10;"><p class="alert alert-danger">${err.message}</p></div>`;
        }
    }

    function renderBookCards(books) {
        if (books.length === 0) {
            bookCardsGrid.innerHTML = '<tr><td colspan="12" class="text-center p-4"><div class="empty-state"><i class="fa-solid fa-folder-open fa-2x"></i><p>검색 조건에 일치하는 도서가 없습니다.</p></div></td></tr>';
            return;
        }

        let html = '';
        books.forEach(b => {
            const title = escapeHtml(b.Title || '제목 없음');
            const author = escapeHtml(b.Author || '저자 미상');
            const publisher = escapeHtml(b.Publisher || '출판사 미상');
            const target = escapeHtml(b.Target || '선택안함');
            const voca = (b.Voca !== null && b.Voca !== undefined && b.Voca !== '') ? `${b.Voca}단계` : '-';
            const length = (b.BookLength !== null && b.BookLength !== undefined && b.BookLength !== '') ? `${b.BookLength}단계` : '-';
            const bookId = b.row_id || b.Id;

            const hasQuiz = !!(b.HasQuiz == 1 || b.HasVocaQuiz == 1);
            const hasReading = !!(b.HasReadingQuestion == 1 || b.HasReadingAnswer == 1 || b.HasReadingQuiz == 1);
            const hasWriting = !!(b.HasWritingQuestion == 1 || b.HasWritingAnswer == 1 || b.HasWritingQuiz == 1);
            const hasPdf = !!(b.IsPdfExist == 1 || b.HasPdf == 1);

            html += `
                <tr data-book-id="${bookId}">
                    <td><strong>#${bookId}</strong></td>
                    <td class="fw-semibold text-primary cell-clickable btn-open-book-detail" data-book-id="${bookId}">${title}</td>
                    <td>${author}</td>
                    <td>${publisher}</td>
                    <td><span class="tag-badge primary">${target}</span></td>
                    <td>${voca}</td>
                    <td>${length}</td>
                    <td class="text-center">
                        <label class="form-switch sm" title="어휘퀴즈 보유 여부 변경">
                            <input type="checkbox" class="chk-toggle-book-field" data-book-id="${bookId}" data-field="HasQuiz" ${hasQuiz ? 'checked' : ''}>
                            <span class="switch-slider"></span>
                        </label>
                    </td>
                    <td class="text-center">
                        <label class="form-switch sm" title="독서문제 보유 여부 변경">
                            <input type="checkbox" class="chk-toggle-book-field" data-book-id="${bookId}" data-field="HasReadingQuestion" ${hasReading ? 'checked' : ''}>
                            <span class="switch-slider"></span>
                        </label>
                    </td>
                    <td class="text-center">
                        <label class="form-switch sm" title="글쓰기문제 보유 여부 변경">
                            <input type="checkbox" class="chk-toggle-book-field" data-book-id="${bookId}" data-field="HasWritingQuestion" ${hasWriting ? 'checked' : ''}>
                            <span class="switch-slider"></span>
                        </label>
                    </td>
                    <td class="text-center">
                        <label class="form-switch sm" title="PDF 보유 여부 변경">
                            <input type="checkbox" class="chk-toggle-book-field" data-book-id="${bookId}" data-field="IsPdfExist" ${hasPdf ? 'checked' : ''}>
                            <span class="switch-slider"></span>
                        </label>
                    </td>
                    <td>
                        <button type="button" class="btn btn-xs btn-outline btn-open-book-detail" data-book-id="${bookId}">
                            <i class="fa-solid fa-eye"></i> 상세
                        </button>
                    </td>
                </tr>
            `;
        });

        bookCardsGrid.innerHTML = html;

        document.querySelectorAll('.btn-open-book-detail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const bookId = btn.getAttribute('data-book-id');
                openBookDetailModal(bookId);
            });
        });

        document.querySelectorAll('.chk-toggle-book-field').forEach(chk => {
            chk.addEventListener('change', async (e) => {
                e.stopPropagation();
                const bookId = chk.getAttribute('data-book-id');
                const field = chk.getAttribute('data-field');
                const val = chk.checked ? 1 : 0;
                await toggleBookField(bookId, field, val, chk);
            });
        });
    }

    // Student Search Handler
    async function loadStudentSearchResults() {
        if (!token) return;
        try {
            studentCardsGrid.innerHTML = '<tr><td colspan="8" class="text-center p-4"><div class="empty-state"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>학생 검색 중...</p></div></td></tr>';

            const q = studentSearchQ.value.trim();
            const sex = studentFilterSex.value;

            const queryParams = new URLSearchParams({
                page: studentSearchPage,
                limit: studentSearchLimit
            });
            if (q) queryParams.append('q', q);
            if (sex) queryParams.append('sex', sex);
            if (studentFilterIncludeEnded && studentFilterIncludeEnded.checked) queryParams.append('include_ended', 'true');

            const data = await apiFetch(`/api/user/students/search?${queryParams.toString()}`);
            studentSearchTotalPages = data.total_pages;

            studentSearchTotalCount.textContent = `총 ${data.total_count} 명의 학생`;
            studentSearchPaginationInfo.textContent = `${studentSearchPage} / ${studentSearchTotalPages} 페이지 (총 ${data.total_count}명)`;
            studentSearchCurrentPageSpan.textContent = studentSearchPage;
            btnStudentSearchPrev.disabled = (studentSearchPage <= 1);
            btnStudentSearchNext.disabled = (studentSearchPage >= studentSearchTotalPages);

            renderStudentCards(data.students);
        } catch (err) {
            studentCardsGrid.innerHTML = `<tr><td colspan="8" class="text-center p-4"><div class="empty-state"><p class="alert alert-danger">${err.message}</p></div></td></tr>`;
        }
    }

    function renderStudentCards(students) {
        if (students.length === 0) {
            studentCardsGrid.innerHTML = '<tr><td colspan="8" class="text-center p-4"><div class="empty-state"><i class="fa-solid fa-users-slash fa-2x"></i><p>검색 조건에 일치하는 학생이 없습니다.</p></div></td></tr>';
            return;
        }

        let html = '';
        students.forEach(s => {
            const name = escapeHtml(s.Name || '이름 없음');
            const sex = formatSex(s.Sex);
            const rawSex = escapeHtml(s.Sex || '');
            const desc = escapeHtml(s.Description || '-');
            const grade = formatGrade(s.Grade);
            const referrer = s.Referrer ? formatReferrer(s.Referrer) : '-';
            const studentId = s.row_id || s.Id;
            const isEnded = !!s.IsClassEnded;

            html += `
                <tr data-student-id="${studentId}">
                    <td><strong>#${studentId}</strong></td>
                    <td class="fw-semibold text-primary cell-clickable btn-open-student-detail" data-student-id="${studentId}">${name}</td>
                    <td>
                        <button type="button" class="badge btn-toggle-student-sex ${sex === '남' ? 'badge-info' : sex === '여' ? 'badge-danger' : 'badge-secondary'}" data-student-id="${studentId}" data-current-sex="${rawSex}" title="클릭하여 성별 변경: 미지정 → 여 → 남 → 여">${sex}</button>
                    </td>
                    <td>${grade}</td>
                    <td>${referrer}</td>
                    <td class="text-muted text-truncate-cell" title="${desc}">${desc}</td>
                    <td class="text-center">
                        <button type="button" class="btn-toggle-status ${isEnded ? 'is-ended' : 'is-active'} btn-toggle-student-ended" data-student-id="${studentId}" data-current="${isEnded ? 1 : 0}">
                            ${isEnded ? '<i class="fa-solid fa-graduation-cap"></i> 수업 종료' : '<i class="fa-solid fa-circle-play"></i> 진행 중'}
                        </button>
                    </td>
                    <td>
                        <button type="button" class="btn btn-xs btn-outline btn-open-student-detail" data-student-id="${studentId}">
                            <i class="fa-solid fa-eye"></i> 상세
                        </button>
                    </td>
                </tr>
            `;
        });

        studentCardsGrid.innerHTML = html;

        document.querySelectorAll('.btn-open-student-detail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const studentId = btn.getAttribute('data-student-id');
                openStudentDetailModal(studentId);
            });
        });

        document.querySelectorAll('.btn-toggle-student-ended').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const studentId = btn.getAttribute('data-student-id');
                const currentVal = parseInt(btn.getAttribute('data-current')) || 0;
                const newVal = currentVal === 1 ? 0 : 1;
                await toggleStudentEnded(studentId, newVal, btn);
            });
        });

        document.querySelectorAll('.btn-toggle-student-sex').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const currentSex = formatSex(btn.getAttribute('data-current-sex'));
                const newSex = currentSex === '여' ? '남' : '여';
                await toggleStudentSex(btn.getAttribute('data-student-id'), newSex, btn);
            });
        });
    }

    // Open Book Detail Modal (View Mode)
    async function openBookDetailModal(bookId) {
        modalBookDetailBody.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>도서 상세 정보 조회 중...</p></div>';
        modalBookDetailTitle.innerHTML = `<i class="fa-solid fa-book-open"></i> 도서 상세 정보`;
        modalBookDetailActions.innerHTML = '';
        modalBookDetail.classList.remove('hidden');

        try {
            const data = await apiFetch(`/api/user/books/${bookId}`);
            const b = data.book;
            currentDetailBook = b;

            if (isStaff()) {
                modalBookDetailActions.innerHTML = `
                    <button id="btn-modal-edit-book" class="btn btn-sm btn-primary">
                        <i class="fa-solid fa-pen-to-square"></i> 수정
                    </button>
                    <button id="btn-modal-delete-book" class="btn btn-sm btn-danger">
                        <i class="fa-solid fa-trash-can"></i> 도서 삭제
                    </button>
                `;
                document.getElementById('btn-modal-edit-book').addEventListener('click', () => {
                    renderBookDetailEditForm(b, bookId);
                });
                document.getElementById('btn-modal-delete-book').addEventListener('click', () => {
                    openAdminBookDeleteSafetyModal(b, bookId);
                });
            }

            const gdriveFiles = data.gdrive_files || [];
            let gdriveSectionHtml = '';
            if (gdriveFiles.length > 0) {
                let fileItemsHtml = '';
                gdriveFiles.forEach(f => {
                    const fName = escapeHtml(f.name || '구글 드라이브 자료');
                    const fLink = f.webViewLink || '#';
                    let iconClass = 'fa-file-lines';
                    if (f.mimeType && f.mimeType.includes('folder')) {
                        iconClass = 'fa-folder';
                    } else if (f.mimeType && f.mimeType.includes('document')) {
                        iconClass = 'fa-file-word';
                    } else if (f.mimeType && f.mimeType.includes('pdf')) {
                        iconClass = 'fa-file-pdf';
                    } else if (f.mimeType && f.mimeType.includes('spreadsheet')) {
                        iconClass = 'fa-file-excel';
                    }

                    fileItemsHtml += `
                        <a href="${fLink}" target="_blank" rel="noopener noreferrer" class="gdrive-file-link-card">
                            <div class="gdrive-file-info">
                                <i class="fa-solid ${iconClass} gdrive-icon"></i>
                                <span class="gdrive-filename">${fName}</span>
                            </div>
                            <span class="gdrive-action"><i class="fa-solid fa-arrow-up-right-from-square"></i> 열기</span>
                        </a>
                    `;
                });

                gdriveSectionHtml = `
                    <div style="margin-top: 1rem;">
                        <div class="detail-section-title"><i class="fa-brands fa-google-drive" style="color: #4285F4;"></i> 관련 Google Drive 자료 (${gdriveFiles.length}건)</div>
                        <div class="gdrive-files-grid">
                            ${fileItemsHtml}
                        </div>
                    </div>
                `;
            } else {
                gdriveSectionHtml = `
                    <div style="margin-top: 1rem;">
                        <div class="detail-section-title"><i class="fa-brands fa-google-drive" style="color: #4285F4;"></i> 관련 Google Drive 자료</div>
                        <div class="detail-desc-box" style="color: var(--text-dim); font-size: 0.82rem;">
                            <i class="fa-solid fa-info-circle"></i> 구글 드라이브에 이 도서 이름과 일치하는 관련 자료 파일이 없습니다.
                        </div>
                    </div>
                `;
            }

            let html = `
                <div class="detail-header-block">
                    <div class="detail-title">${escapeHtml(b.Title || '제목 없음')}</div>
                    <div class="detail-meta-row">
                        <span><i class="fa-solid fa-user"></i> 저자: <strong>${escapeHtml(b.Author || '-')}</strong></span>
                        <span><i class="fa-solid fa-building"></i> 출판사: <strong>${escapeHtml(b.Publisher || '-')}</strong></span>
                        <span><i class="fa-solid fa-layer-group"></i> 분야: <strong>${escapeHtml(b.Subject || '-')}</strong></span>
                        <span><i class="fa-solid fa-layer-group"></i> 난이도: <strong>${escapeHtml(b.Target || '선택안함')}</strong></span>
                    </div>
                </div>

                <div class="detail-grid">
                    <div class="detail-metric-card">
                        <div class="label">분량 (BookLength)</div>
                        <div class="val">${b.BookLength ? b.BookLength + '단계' : '0 (미입력)'}</div>
                    </div>
                    <div class="detail-metric-card">
                        <div class="label">어휘 수준 (Voca)</div>
                        <div class="val">${b.Voca ? b.Voca + '단계' : '0 (미입력)'}</div>
                    </div>
                    <div class="detail-metric-card">
                        <div class="label">비유/상징 (Metaphor)</div>
                        <div class="val">${b.Metaphor ? b.Metaphor + '단계' : '0 (미입력)'}</div>
                    </div>
                </div>

                <div>
                    <div class="detail-section-title"><i class="fa-solid fa-award"></i> 교재 / 학습 자료 보유 현황</div>
                    <div class="detail-badges-list">
                        ${b.HasQuiz ? '<span class="tag-badge success"><i class="fa-solid fa-check"></i> 어휘 퀴즈</span>' : '<span class="tag-badge"><i class="fa-solid fa-xmark"></i> 어휘 퀴즈 없음</span>'}
                        ${b.HasReadingQuestion ? '<span class="tag-badge success"><i class="fa-solid fa-check"></i> 독서 문제</span>' : ''}
                        ${b.HasReadingAnswer ? '<span class="tag-badge success"><i class="fa-solid fa-check"></i> 독서 답안</span>' : ''}
                        ${b.HasWritingQuestion ? '<span class="tag-badge success"><i class="fa-solid fa-check"></i> 글쓰기 문제</span>' : ''}
                        ${b.HasWritingAnswer ? '<span class="tag-badge success"><i class="fa-solid fa-check"></i> 글쓰기 답안</span>' : ''}
                        ${b.HasAdvancedMaterial ? '<span class="tag-badge primary"><i class="fa-solid fa-check"></i> 심화 자료</span>' : ''}
                        ${b.HasDebateMaterial ? '<span class="tag-badge primary"><i class="fa-solid fa-check"></i> 토론 자료</span>' : ''}
                    </div>
                </div>

                <div>
                    <div class="detail-section-title"><i class="fa-solid fa-store"></i> 도서 포맷 & 유통 채널</div>
                    <div class="detail-badges-list">
                        ${b.IsPaperbookExist ? '<span class="tag-badge success"><i class="fa-solid fa-book"></i> 종이책</span>' : ''}
                        ${b.IsPdfExist ? '<span class="tag-badge primary"><i class="fa-solid fa-file-pdf"></i> PDF</span>' : ''}
                        ${b.IsYes24Exist ? '<span class="tag-badge"><i class="fa-solid fa-shopping-cart"></i> YES24</span>' : ''}
                        ${b.IsMillieExist ? '<span class="tag-badge"><i class="fa-solid fa-tablet-screen-button"></i> 밀리의 서재</span>' : ''}
                    </div>
                </div>

                ${gdriveSectionHtml}

                <div>
                    <div class="detail-section-title"><i class="fa-solid fa-note-sticky"></i> 상세 설명 및 메모</div>
                    <div class="detail-desc-box">${escapeHtml(b.Desc || '등록된 상세 설명이 없습니다.')}</div>
                </div>
            `;

            modalBookDetailBody.innerHTML = html;
        } catch (err) {
            modalBookDetailBody.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    // Open Student Detail Modal (View Mode)
    async function openStudentDetailModal(studentId) {
        modalStudentDetailBody.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>학생 상세 정보 조회 중...</p></div>';
        modalStudentDetailTitle.innerHTML = `<i class="fa-solid fa-user-graduate"></i> 학생 상세 정보`;
        modalStudentDetailActions.innerHTML = '';
        modalStudentDetail.classList.remove('hidden');

        try {
            const data = await apiFetch(`/api/user/students/${studentId}`);
            const s = data.student;

            let actionsHtml = `
                <button id="btn-modal-monthly-report-student" class="btn btn-sm btn-success">
                    <i class="fa-solid fa-comment-sms"></i> 월말보고 문자 생성
                </button>
            `;
            if (isStaff()) {
                actionsHtml += `
                    <button id="btn-modal-edit-student" class="btn btn-sm btn-primary">
                        <i class="fa-solid fa-pen-to-square"></i> 수정
                    </button>
                    <button id="btn-modal-delete-student" class="btn btn-sm btn-danger">
                        <i class="fa-solid fa-trash-can"></i> 학생 삭제
                    </button>
                `;
            }
            modalStudentDetailActions.innerHTML = actionsHtml;

            document.getElementById('btn-modal-monthly-report-student').addEventListener('click', () => {
                modalStudentDetail.classList.add('hidden');
                switchView('monthly-report');
                initMonthlyReportView(studentId);
            });

            if (isStaff()) {
                document.getElementById('btn-modal-edit-student').addEventListener('click', () => {
                    renderStudentDetailEditForm(s, studentId);
                });
                document.getElementById('btn-modal-delete-student').addEventListener('click', () => {
                    openAdminStudentDeleteSafetyModal(s, studentId);
                });
            }

            const studylogs = data.studylogs || [];
            const totalLogs = data.total_studylogs || 0;

            let studylogsHtml = '';
            if (studylogs.length === 0) {
                studylogsHtml = `
                    <div class="empty-state" style="padding: 1.5rem !important;">
                        <i class="fa-solid fa-folder-open fa-2x"></i>
                        <p style="font-size: 0.85rem; margin-top: 0.5rem;">등록된 수업 진행 내역(학습 기록)이 없습니다.</p>
                    </div>
                `;
            } else {
                studylogsHtml = `
                    <div class="student-studylog-list">
                        ${studylogs.map(log => `
                            <div class="student-studylog-item" data-log-id="${log.row_id}">
                                <div class="log-item-header">
                                    <span class="log-date"><i class="fa-regular fa-calendar-check"></i> ${escapeHtml(log.StudiedDay || log.CreatedDay || '날짜 미상')}</span>
                                    <span class="log-book-title"><i class="fa-solid fa-book"></i> <strong>${escapeHtml(log.BookTitle || '도서 정보 없음')}</strong></span>
                                </div>
                                <div class="log-item-metrics">
                                    <span class="metric-tag">어휘 <strong>${log.Voca || 0}단계</strong></span>
                                    <span class="metric-tag">분량 <strong>${log.BookLength || 0}단계</strong></span>
                                    ${log.Metaphor ? `<span class="metric-tag">비유 <strong>${log.Metaphor}단계</strong></span>` : ''}
                                    ${log.Logic ? `<span class="metric-tag">논리 <strong>${log.Logic}단계</strong></span>` : ''}
                                    ${log.Structure ? `<span class="metric-tag">구조 <strong>${log.Structure}단계</strong></span>` : ''}
                                    ${log.Summary ? `<span class="metric-tag">요약 <strong>${log.Summary}단계</strong></span>` : ''}
                                </div>
                                ${log.TeacherMemo || log.Description ? `
                                    <div class="log-item-memo"><i class="fa-solid fa-comment-dots"></i> ${escapeHtml(log.TeacherMemo || log.Description)}</div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            let html = `
                <div class="student-detail-layout">
                    <!-- Left Column: Student Info & Study History -->
                    <div class="student-detail-left-col">
                        <div class="detail-header-block">
                            <div class="detail-title">${escapeHtml(s.Name || '이름 없음')}</div>
                            <div class="detail-meta-row">
                                <span><i class="fa-solid fa-venus-mars"></i> 성별: <strong>${formatSex(s.Sex)}</strong></span>
                                <span><i class="fa-solid fa-graduation-cap"></i> 학년: <strong>${formatGrade(s.Grade)}</strong></span>
                                <span><i class="fa-solid fa-user-plus"></i> 추천인: <strong>${formatReferrer(s.Referrer) || '미입력'}</strong></span>
                                ${s.IsClassEnded ? '<span class="badge badge-warning"><i class="fa-solid fa-graduation-cap"></i> 수업 종료</span>' : ''}
                                <span><i class="fa-solid fa-id-card"></i> ID: <strong>#${s.row_id || s.Id}</strong></span>
                                <span><i class="fa-solid fa-award"></i> 총 수업: <strong>${totalLogs}회</strong></span>
                            </div>
                        </div>

                        <div style="margin-top: 1rem;">
                            <div class="detail-section-title"><i class="fa-solid fa-note-sticky"></i> 학습 특성 및 특이사항</div>
                            <div class="detail-desc-box">${escapeHtml(s.Description || '등록된 메모나 특이사항이 없습니다.')}</div>
                        </div>

                        <div style="margin-top: 1.1rem;">
                            <div class="detail-section-title">
                                <span><i class="fa-solid fa-book-open-reader"></i> 최근 수업 진행 내역 (StudyLogs: 총 ${totalLogs}건)</span>
                            </div>
                            ${studylogsHtml}
                        </div>
                    </div>

                    <!-- Right Column: Yearly Combined Analytics Chart & Summary Table -->
                    <div class="student-detail-right-col">
                        <div class="chart-card-box">
                            <div class="chart-card-header">
                                <i class="fa-solid fa-chart-area" style="color: var(--primary);"></i>
                                <span>연도별 학습 수량(막대) & 가중 분량 평균(꺾은선) 통합 분석</span>
                            </div>
                            <div class="chart-weight-info-box" style="margin: 0.5rem 0.75rem 0 0.75rem; padding: 0.45rem 0.75rem; background: var(--bg-surface-hover); border-radius: var(--radius-sm); border: 1px solid var(--border-color); font-size: 0.76rem; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.4rem;">
                                <span><i class="fa-solid fa-scale-balanced" style="color: var(--primary);"></i> <strong>난이도 가중치 기준:</strong></span>
                                <span>선택안함·초등부 <strong>1.0x</strong> | 중등부 <strong>2.0x</strong> | 심화반·독서모임 <strong>3.0x</strong></span>
                            </div>
                            <div class="chart-canvas-container" style="position: relative; height: 280px;">
                                <canvas id="chart-student-yearly-combined"></canvas>
                            </div>
                        </div>

                        <div class="chart-card-box" style="margin-top: 1rem;">
                            <div class="chart-card-header">
                                <i class="fa-solid fa-table-list" style="color: var(--success);"></i>
                                <span>연도별 학습 성과 요약 (난이도 가중치 반영)</span>
                            </div>
                            <div class="table-responsive" style="max-height: 150px; overflow-y: auto;">
                                <table class="modern-table" style="font-size: 0.82rem;">
                                    <thead>
                                        <tr>
                                            <th>연도</th>
                                            <th>수업 도서 수량</th>
                                            <th>순수 분량 평균</th>
                                            <th>가중 분량 평균</th>
                                        </tr>
                                    </thead>
                                    <tbody id="student-summary-table-body">
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            modalStudentDetailBody.innerHTML = html;

            modalStudentDetailBody.querySelectorAll('.student-studylog-item').forEach(item => {
                item.addEventListener('click', () => {
                    const logId = item.getAttribute('data-log-id');
                    if (logId) {
                        openStudyLogDetailModal(logId);
                    }
                });
            });

            // Render Combined Chart & Summary Table
            renderStudentCharts(studylogs);
        } catch (err) {
            modalStudentDetailBody.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    // Difficulty Weight Helper (선택안함/초등부: 1.0, 중등부: 2.0, 심화반/독서모임: 3.0)
    function getDifficultyWeight(targetStr) {
        const t = String(targetStr || '').trim();
        if (t === '중등부') return 2.0;
        if (t === '심화반' || t === '독서모임') return 3.0;
        return 1.0;
    }

    // Render Student Yearly Combined Dual-Y Chart (Book Count & Weighted Average Length)
    let chartYearlyCombined = null;

    function renderStudentCharts(studylogs) {
        if (chartYearlyCombined) { chartYearlyCombined.destroy(); chartYearlyCombined = null; }

        const yearlyDataMap = {};

        studylogs.forEach(log => {
            const rawDate = String(log.StudiedDay || log.CreatedDay || '').trim();
            const match = rawDate.match(/\b(20\d\d)\b/);
            if (match) {
                const year = match[1];
                const rawLength = parseFloat(log.BookLength || log.b_BookLength || 0) || 0;
                const target = log.BookTarget || log.b_Target || log.Target || '';
                const weight = getDifficultyWeight(target);
                const weightedLength = rawLength * weight;

                if (!yearlyDataMap[year]) {
                    yearlyDataMap[year] = { rawSum: 0, weightedSum: 0, count: 0 };
                }
                yearlyDataMap[year].rawSum += rawLength;
                yearlyDataMap[year].weightedSum += weightedLength;
                yearlyDataMap[year].count += 1;
            }
        });

        const sortedYears = Object.keys(yearlyDataMap).sort();
        let labels = [];
        let countValues = [];
        let weightedAvgValues = [];
        let rawAvgValues = [];

        const summaryTableBody = document.getElementById('student-summary-table-body');

        if (sortedYears.length === 0) {
            labels = ['기록 없음'];
            countValues = [0];
            weightedAvgValues = [0];
            rawAvgValues = [0];
            if (summaryTableBody) {
                summaryTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-dim);">수업 내역이 없습니다.</td></tr>`;
            }
        } else {
            labels = sortedYears.map(y => `${y}년`);
            countValues = sortedYears.map(y => yearlyDataMap[y].count);
            weightedAvgValues = sortedYears.map(y => {
                const d = yearlyDataMap[y];
                return d.count > 0 ? parseFloat((d.weightedSum / d.count).toFixed(1)) : 0;
            });
            rawAvgValues = sortedYears.map(y => {
                const d = yearlyDataMap[y];
                return d.count > 0 ? parseFloat((d.rawSum / d.count).toFixed(1)) : 0;
            });

            if (summaryTableBody) {
                summaryTableBody.innerHTML = sortedYears.map(y => {
                    const cnt = yearlyDataMap[y].count;
                    const rawAvg = cnt > 0 ? (yearlyDataMap[y].rawSum / cnt).toFixed(1) : 0;
                    const weightedAvg = cnt > 0 ? (yearlyDataMap[y].weightedSum / cnt).toFixed(1) : 0;
                    return `
                        <tr>
                            <td><strong>${y}년</strong></td>
                            <td><span class="metric-tag" style="background: rgba(139, 92, 246, 0.12); color: #8b5cf6; border-color: rgba(139, 92, 246, 0.3);">${cnt}권</span></td>
                            <td><span class="metric-tag" style="background: rgba(148, 163, 184, 0.12); color: var(--text-main); border-color: rgba(148, 163, 184, 0.3);">${rawAvg}단계</span></td>
                            <td><span class="metric-tag" style="background: rgba(59, 130, 246, 0.12); color: #3b82f6; border-color: rgba(59, 130, 246, 0.3); font-weight: 600;">${weightedAvg}단계</span></td>
                        </tr>
                    `;
                }).join('');
            }
        }

        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const textColor = isLight ? '#334155' : '#94a3b8';
        const gridColor = isLight ? 'rgba(203, 213, 225, 0.5)' : 'rgba(255, 255, 255, 0.08)';

        // Custom inline Data Labels plugin for Dual-Y Chart
        const datalabelsPlugin = {
            id: 'customDataLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                chart.data.datasets.forEach((dataset, datasetIndex) => {
                    const meta = chart.getDatasetMeta(datasetIndex);
                    meta.data.forEach((element, index) => {
                        const val = dataset.data[index];
                        if (val !== null && val !== undefined) {
                            const unit = dataset.unit || '';
                            const text = `${val}${unit}`;
                            ctx.save();
                            ctx.font = '600 11px Inter, sans-serif';
                            ctx.fillStyle = isLight ? (dataset.colorLight || '#0f172a') : (dataset.colorDark || '#f8fafc');
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';
                            const yOffset = dataset.type === 'line' ? 8 : 6;
                            ctx.fillText(text, element.x, element.y - yOffset);
                            ctx.restore();
                        }
                    });
                });
            }
        };

        // Combined Dual-Y Axis Chart (Bar = Count, Line = Average)
        const ctxCombined = document.getElementById('chart-student-yearly-combined');
        if (ctxCombined && typeof Chart !== 'undefined') {
            chartYearlyCombined = new Chart(ctxCombined, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            type: 'bar',
                            label: '수업 수량 (좌측 Y축)',
                            data: countValues,
                            yAxisID: 'y',
                            backgroundColor: 'rgba(139, 92, 246, 0.75)',
                            borderColor: '#8b5cf6',
                            borderWidth: 1.5,
                            borderRadius: 6,
                            hoverBackgroundColor: '#8b5cf6',
                            order: 2,
                            unit: '권',
                            colorLight: '#7c3aed',
                            colorDark: '#c084fc'
                        },
                        {
                            type: 'line',
                            label: '가중 분량 평균 (우측 Y축)',
                            data: weightedAvgValues,
                            yAxisID: 'y1',
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.15)',
                            borderWidth: 3,
                            tension: 0.35,
                            fill: false,
                            pointBackgroundColor: '#3b82f6',
                            pointBorderColor: '#ffffff',
                            pointRadius: 6,
                            pointHoverRadius: 8,
                            order: 1,
                            unit: '단계',
                            colorLight: '#2563eb',
                            colorDark: '#60a5fa'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 28, left: 10, right: 10 } },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                color: textColor,
                                font: { family: 'Inter', size: 11, weight: '500' },
                                usePointStyle: true,
                                padding: 15
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const unit = ctx.dataset.unit || '';
                                    return `  ${ctx.dataset.label}: ${ctx.parsed.y}${unit}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: gridColor },
                            ticks: { color: textColor, font: { family: 'Inter', size: 11, weight: '500' } }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: {
                                display: true,
                                text: '수량 (권)',
                                color: isLight ? '#7c3aed' : '#c084fc',
                                font: { family: 'Inter', size: 11, weight: '600' }
                            },
                            beginAtZero: true,
                            grid: { color: gridColor },
                            ticks: { color: textColor, font: { family: 'Inter', size: 11 } }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            title: {
                                display: true,
                                text: '가중 분량 평균 (단계)',
                                color: isLight ? '#2563eb' : '#60a5fa',
                                font: { family: 'Inter', size: 11, weight: '600' }
                            },
                            beginAtZero: true,
                            suggestedMax: 10,
                            grid: { drawOnChartArea: false },
                            ticks: { color: textColor, font: { family: 'Inter', size: 11 } }
                        }
                    }
                },
                plugins: [datalabelsPlugin]
            });
        }
    }

    // Admin Student Delete Safety Confirmation Modal Handler
    function openAdminStudentDeleteSafetyModal(s, studentId) {
        const expectedName = (s.Name || '').trim();
        targetStudentDeleteNameDisplay.textContent = `'${expectedName}'`;
        inputConfirmDeleteStudentName.value = '';
        btnSubmitStudentDeleteConfirm.disabled = true;
        modalStudentDeleteConfirm.classList.remove('hidden');

        const checkMatch = () => {
            const val = inputConfirmDeleteStudentName.value.trim();
            if (val === expectedName) {
                btnSubmitStudentDeleteConfirm.disabled = false;
                btnSubmitStudentDeleteConfirm.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.5)';
            } else {
                btnSubmitStudentDeleteConfirm.disabled = true;
                btnSubmitStudentDeleteConfirm.style.boxShadow = 'none';
            }
        };

        inputConfirmDeleteStudentName.oninput = checkMatch;

        btnSubmitStudentDeleteConfirm.onclick = async () => {
            if (inputConfirmDeleteStudentName.value.trim() !== expectedName) return;

            const pkVal = s.row_id || s.Id;

            try {
                await apiFetch(`/api/user/students/${pkVal}`, {
                    method: 'DELETE'
                });

                modalStudentDeleteConfirm.classList.add('hidden');
                modalStudentDetail.classList.add('hidden');

                alert(`'${expectedName}' 학생이 성공적으로 삭제되었습니다.`);

                await loadStudentSearchResults();
                await loadRecentStudents();
                if (currentTable === 'Students') await loadTableData();
            } catch (err) {
                alert(`삭제 실패: ${err.message}`);
            }
        };
    }

    // Render Admin Student Detail Edit Form Mode
    function renderStudentDetailEditForm(s, studentId) {
        modalStudentDetailTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> 학생 정보 수정`;
        modalStudentDetailActions.innerHTML = '';

        let html = `
            <form id="form-modal-edit-student" class="modal-edit-form">
                <div id="modal-edit-student-alert" class="alert hidden"></div>

                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-user"></i> 기본 인적사항 수정</h4>
                    <div class="form-grid">
                        <div class="form-group span-2">
                            <label>학생 이름 (Name) <span class="required">*</span></label>
                            <input type="text" name="Name" class="form-control" value="${escapeHtml(s.Name || '')}" required>
                        </div>
                        <div class="form-group">
                            <label>성별 (Sex)</label>
                            <select name="Sex" class="form-control">
                                <option value="" ${!s.Sex ? 'selected' : ''}>성별 선택 (미선택)</option>
                                <option value="남" ${formatSex(s.Sex) === '남' ? 'selected' : ''}>남</option>
                                <option value="여" ${formatSex(s.Sex) === '여' ? 'selected' : ''}>여</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>학년 (Grade)</label>
                            <input type="text" name="Grade" class="form-control" value="${escapeHtml(s.Grade || '')}">
                        </div>
                        <div class="form-group">
                            <label>추천인 (Referrer)</label>
                            <input type="text" name="Referrer" class="form-control" value="${escapeHtml(s.Referrer || '')}">
                        </div>
                    </div>
                </div>

                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-note-sticky"></i> 학습 특성 및 메모</h4>
                    <div class="form-group">
                        <textarea name="Description" class="form-control" rows="4">${escapeHtml(s.Description || '')}</textarea>
                    </div>
                </div>

                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-graduation-cap"></i> 수업 상태</h4>
                    <label class="checkbox-pill">
                        <input type="checkbox" name="IsClassEnded" value="1" ${s.IsClassEnded ? 'checked' : ''}>
                        <span>수업 종료</span>
                    </label>
                </div>

                <div class="modal-actions">
                    <button type="button" id="btn-cancel-modal-edit-student" class="btn btn-outline">취소</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> 수정 내용 저장</button>
                </div>
            </form>
        `;

        modalStudentDetailBody.innerHTML = html;

        document.getElementById('btn-cancel-modal-edit-student').addEventListener('click', () => {
            openStudentDetailModal(studentId);
        });

        document.getElementById('form-modal-edit-student').addEventListener('submit', (e) => {
            handleAdminSaveDetailStudent(e, s, studentId);
        });
    }

    // Handle Admin Save Student from Detail Edit Mode
    async function handleAdminSaveDetailStudent(e, origStudent, studentId) {
        e.preventDefault();
        const modalEditAlert = document.getElementById('modal-edit-student-alert');
        modalEditAlert.classList.add('hidden');

        const form = e.target;
        const formData = new FormData(form);

        const data = {
            Name: (formData.get('Name') || '').trim(),
            Sex: (formData.get('Sex') || '').trim(),
            Grade: (formData.get('Grade') || '').trim(),
            Referrer: (formData.get('Referrer') || '').trim(),
            Description: (formData.get('Description') || '').trim(),
            IsClassEnded: formData.get('IsClassEnded') ? 1 : 0
        };

        if (!data.Name) {
            modalEditAlert.className = 'alert alert-danger';
            modalEditAlert.textContent = '학생 이름(Name)은 필수 입력 항목입니다.';
            modalEditAlert.classList.remove('hidden');
            return;
        }

        try {
            await apiFetch(`/api/user/students/${studentId}`, {
                method: 'PUT',
                body: JSON.stringify({ data: data })
            });

            await openStudentDetailModal(studentId);
            await loadStudentSearchResults();
            await loadRecentStudents();
            if (currentTable === 'Students') await loadTableData();
        } catch (err) {
            modalEditAlert.className = 'alert alert-danger';
            modalEditAlert.textContent = err.message;
            modalEditAlert.classList.remove('hidden');
        }
    }

    // Admin Book Delete Safety Confirmation Modal Handler
    function openAdminBookDeleteSafetyModal(b, bookId) {
        const expectedTitle = (b.Title || '').trim();
        targetDeleteTitleDisplay.textContent = `'${expectedTitle}'`;
        inputConfirmDeleteTitle.value = '';
        btnSubmitDeleteConfirm.disabled = true;
        modalDeleteConfirm.classList.remove('hidden');

        const checkMatch = () => {
            const val = inputConfirmDeleteTitle.value.trim();
            if (val === expectedTitle) {
                btnSubmitDeleteConfirm.disabled = false;
                btnSubmitDeleteConfirm.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.5)';
            } else {
                btnSubmitDeleteConfirm.disabled = true;
                btnSubmitDeleteConfirm.style.boxShadow = 'none';
            }
        };

        inputConfirmDeleteTitle.oninput = checkMatch;

        btnSubmitDeleteConfirm.onclick = async () => {
            if (inputConfirmDeleteTitle.value.trim() !== expectedTitle) return;

            const pkVal = b.row_id || b.Id;

            try {
                await apiFetch(`/api/user/books/${pkVal}`, {
                    method: 'DELETE'
                });

                modalDeleteConfirm.classList.add('hidden');
                modalBookDetail.classList.add('hidden');

                alert(`'${expectedTitle}' 도서가 성공적으로 삭제되었습니다.`);

                await loadBookSearchResults();
                await loadRecentBooks();
                if (currentTable === 'Books') await loadTableData();
            } catch (err) {
                alert(`삭제 실패: ${err.message}`);
            }
        };
    }

    // Render Admin Book Detail Edit Form Mode
    function renderBookDetailEditForm(b, bookId) {
        modalBookDetailTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> 도서 정보 수정`;
        modalBookDetailActions.innerHTML = '';

        function renderSelectOptions(currentVal) {
            let opts = '<option value="0">0 (미입력)</option>';
            for (let i = 1; i <= 10; i++) {
                const selected = parseInt(currentVal) === i ? 'selected' : '';
                opts += `<option value="${i}" ${selected}>${i} 단계</option>`;
            }
            return opts;
        }

        let html = `
            <form id="form-modal-edit-book" class="modal-edit-form">
                <div id="modal-edit-alert" class="alert hidden"></div>

                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-circle-info"></i> 기본 정보 수정</h4>
                    <div class="form-grid">
                        <div class="form-group span-2">
                            <label>도서명 (Title) <span class="required">*</span></label>
                            <input type="text" name="Title" class="form-control" value="${escapeHtml(b.Title || '')}" required>
                        </div>
                        <div class="form-group">
                            <label>저자 (Author)</label>
                            <input type="text" name="Author" class="form-control" value="${escapeHtml(b.Author || '')}">
                        </div>
                        <div class="form-group">
                            <label>출판사 (Publisher)</label>
                            <input type="text" name="Publisher" class="form-control" value="${escapeHtml(b.Publisher || '')}">
                        </div>
                        <div class="form-group">
                            <label>주제 / 분야 (Subject)</label>
                            <input type="text" name="Subject" class="form-control" value="${escapeHtml(b.Subject || '')}">
                        </div>
                        <div class="form-group span-2">
                            <label>난이도</label>
                            <div class="radio-group-inline">
                                <label class="radio-item"><input type="radio" name="Target" value="" ${(!b.Target || !b.Target.trim()) ? 'checked' : ''}> 선택안함</label>
                                <label class="radio-item"><input type="radio" name="Target" value="초등부" ${b.Target === '초등부' ? 'checked' : ''}> 초등부</label>
                                <label class="radio-item"><input type="radio" name="Target" value="중등부" ${b.Target === '중등부' ? 'checked' : ''}> 중등부</label>
                                <label class="radio-item"><input type="radio" name="Target" value="심화반" ${b.Target === '심화반' ? 'checked' : ''}> 심화반</label>
                                <label class="radio-item"><input type="radio" name="Target" value="독서모임" ${b.Target === '독서모임' ? 'checked' : ''}> 독서모임</label>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>분량 / 페이지 수 (BookLength)</label>
                            <select name="BookLength" class="form-control">
                                ${renderSelectOptions(b.BookLength)}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>어휘 수준 / 개수 (Voca)</label>
                            <select name="Voca" class="form-control">
                                ${renderSelectOptions(b.Voca)}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>비유 / 상징 수준 (Metaphor)</label>
                            <select name="Metaphor" class="form-control">
                                ${renderSelectOptions(b.Metaphor)}
                            </select>
                        </div>
                    </div>
                </div>

                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-file-pen"></i> 학습자료 보유 여부</h4>
                    <div class="checkbox-grid">
                        <label class="checkbox-pill">
                            <input type="checkbox" name="HasQuiz" value="1" ${b.HasQuiz ? 'checked' : ''}>
                            <span>어휘 퀴즈</span>
                        </label>
                        <label class="checkbox-pill">
                            <input type="checkbox" name="HasReadingQuestion" value="1" ${b.HasReadingQuestion ? 'checked' : ''}>
                            <span>독서 문제</span>
                        </label>
                        <label class="checkbox-pill">
                            <input type="checkbox" name="HasReadingAnswer" value="1" ${b.HasReadingAnswer ? 'checked' : ''}>
                            <span>독서 답안</span>
                        </label>
                        <label class="checkbox-pill">
                            <input type="checkbox" name="HasWritingQuestion" value="1" ${b.HasWritingQuestion ? 'checked' : ''}>
                            <span>글쓰기 문제</span>
                        </label>
                        <label class="checkbox-pill">
                            <input type="checkbox" name="HasWritingAnswer" value="1" ${b.HasWritingAnswer ? 'checked' : ''}>
                            <span>글쓰기 답안</span>
                        </label>
                        <label class="checkbox-pill">
                            <input type="checkbox" name="HasAdvancedMaterial" value="1" ${b.HasAdvancedMaterial ? 'checked' : ''}>
                            <span>심화 자료</span>
                        </label>
                        <label class="checkbox-pill">
                            <input type="checkbox" name="HasDebateMaterial" value="1" ${b.HasDebateMaterial ? 'checked' : ''}>
                            <span>토론 자료</span>
                        </label>
                    </div>
                </div>

                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-store"></i> 도서 포맷 및 유통 채널</h4>
                    <div class="checkbox-grid">
                        <label class="checkbox-pill">
                            <input type="checkbox" name="IsPaperbookExist" value="1" ${b.IsPaperbookExist ? 'checked' : ''}>
                            <span>종이책</span>
                        </label>
                        <label class="checkbox-pill">
                            <input type="checkbox" name="IsPdfExist" value="1" ${b.IsPdfExist ? 'checked' : ''}>
                            <span>PDF</span>
                        </label>
                        <label class="checkbox-pill">
                            <input type="checkbox" name="IsYes24Exist" value="1" ${b.IsYes24Exist ? 'checked' : ''}>
                            <span>YES24</span>
                        </label>
                        <label class="checkbox-pill">
                            <input type="checkbox" name="IsMillieExist" value="1" ${b.IsMillieExist ? 'checked' : ''}>
                            <span>밀리의 서재</span>
                        </label>
                    </div>
                </div>

                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-note-sticky"></i> 상세 설명 및 메모</h4>
                    <div class="form-group">
                        <textarea name="Desc" class="form-control" rows="3">${escapeHtml(b.Desc || '')}</textarea>
                    </div>
                </div>

                <div class="modal-actions">
                    <button type="button" id="btn-cancel-modal-edit" class="btn btn-outline">취소</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> 수정 내용 저장</button>
                </div>
            </form>
        `;

        modalBookDetailBody.innerHTML = html;

        document.getElementById('btn-cancel-modal-edit').addEventListener('click', () => {
            openBookDetailModal(bookId);
        });

        document.getElementById('form-modal-edit-book').addEventListener('submit', (e) => {
            handleAdminSaveDetailBook(e, b, bookId);
        });
    }

    // Handle Admin Save Book from Detail Edit Mode
    async function handleAdminSaveDetailBook(e, origBook, bookId) {
        e.preventDefault();
        const modalEditAlert = document.getElementById('modal-edit-alert');
        modalEditAlert.classList.add('hidden');

        const form = e.target;
        const formData = new FormData(form);

        const data = {
            Title: (formData.get('Title') || '').trim(),
            Author: (formData.get('Author') || '').trim(),
            Publisher: (formData.get('Publisher') || '').trim(),
            Subject: (formData.get('Subject') || '').trim(),
            Target: (formData.get('Target') || '').trim(),
            BookLength: parseInt(formData.get('BookLength')) || 0,
            Voca: parseInt(formData.get('Voca')) || 0,
            Metaphor: parseInt(formData.get('Metaphor')) || 0,
            HasQuiz: formData.get('HasQuiz') ? 1 : 0,
            HasReadingQuestion: formData.get('HasReadingQuestion') ? 1 : 0,
            HasReadingAnswer: formData.get('HasReadingAnswer') ? 1 : 0,
            HasWritingQuestion: formData.get('HasWritingQuestion') ? 1 : 0,
            HasWritingAnswer: formData.get('HasWritingAnswer') ? 1 : 0,
            HasAdvancedMaterial: formData.get('HasAdvancedMaterial') ? 1 : 0,
            HasDebateMaterial: formData.get('HasDebateMaterial') ? 1 : 0,
            IsPaperbookExist: formData.get('IsPaperbookExist') ? 1 : 0,
            IsPdfExist: formData.get('IsPdfExist') ? 1 : 0,
            IsYes24Exist: formData.get('IsYes24Exist') ? 1 : 0,
            IsMillieExist: formData.get('IsMillieExist') ? 1 : 0,
            Desc: (formData.get('Desc') || '').trim()
        };

        if (!data.Title) {
            modalEditAlert.className = 'alert alert-danger';
            modalEditAlert.textContent = '도서명(Title)은 필수 입력 항목입니다.';
            modalEditAlert.classList.remove('hidden');
            return;
        }

        try {
            await apiFetch(`/api/user/books/${bookId}`, {
                method: 'PUT',
                body: JSON.stringify({ data: data })
            });

            await openBookDetailModal(bookId);
            await loadBookSearchResults();
            await loadRecentBooks();
            if (currentTable === 'Books') await loadTableData();
        } catch (err) {
            modalEditAlert.className = 'alert alert-danger';
            modalEditAlert.textContent = err.message;
            modalEditAlert.classList.remove('hidden');
        }
    }

    // Load Tables List (Admin Only) - Populates Table Selector Dropdown
    async function loadTables() {
        if (!isAdmin()) {
            selectActiveTable.innerHTML = '<option value="">권한 없음</option>';
            return;
        }

        try {
            selectActiveTable.innerHTML = '<option value="">테이블 로딩 중...</option>';
            const data = await apiFetch('/api/tables');
            const tables = data.tables;

            if (tables.length === 0) {
                selectActiveTable.innerHTML = '<option value="">테이블 없음</option>';
                return;
            }

            let optsHtml = '';
            tables.forEach(t => {
                optsHtml += `<option value="${t.name}" ${currentTable === t.name ? 'selected' : ''}>${t.name} (${t.row_count}건)</option>`;
            });
            selectActiveTable.innerHTML = optsHtml;

            if (!currentTable && tables.length > 0) {
                selectTable(tables[0].name);
            }
        } catch (err) {
            selectActiveTable.innerHTML = `<option value="">오류 발생</option>`;
        }
    }

    // Select Table
    async function selectTable(tableName) {
        currentTable = tableName;
        currentPage = 1;
        searchQuery = '';
        inputSearch.value = '';
        btnClearSearch.classList.add('hidden');
        selectedPkValues.clear();
        updateBatchDeleteUI();

        selectActiveTable.value = tableName;
        activeTableTitle.innerHTML = `<i class="fa-solid fa-table"></i> ${tableName}`;

        if (isAdmin()) {
            await loadTableSchema();
            await loadTableData();
        }
    }

    // Load Table Schema
    async function loadTableSchema() {
        try {
            const data = await apiFetch(`/api/tables/${currentTable}/schema`);
            tableSchema = data.columns;
            renderSchemaInspector();
        } catch (err) {
            console.error(err);
        }
    }

    // Render Schema Inspector Tab
    function renderSchemaInspector() {
        if (!tableSchema || tableSchema.length === 0) {
            schemaDetails.innerHTML = '<p class="text-muted">스키마 정보가 없습니다.</p>';
            return;
        }

        let html = `
            <table class="schema-table">
                <thead>
                    <tr>
                        <th>CID</th>
                        <th>컬럼명</th>
                        <th>SQLite 데이터 타입</th>
                        <th>Null 허용</th>
                        <th>기본값</th>
                        <th>Primary Key</th>
                    </tr>
                </thead>
                <tbody>
        `;

        tableSchema.forEach(c => {
            html += `
                <tr>
                    <td>${c.cid}</td>
                    <td><strong>${c.name}</strong></td>
                    <td><span class="type-pill">${c.type}</span></td>
                    <td>${c.notnull ? '<span class="badge badge-danger">NOT NULL</span>' : 'NULL'}</td>
                    <td>${c.dflt_value || '-'}</td>
                    <td>${c.pk ? '<i class="fa-solid fa-key" style="color: var(--warning);"></i> PK' : '-'}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        schemaDetails.innerHTML = html;
    }

    // Load Table Data
    async function loadTableData() {
        try {
            tableBody.innerHTML = '<tr><td colspan="100" class="empty-state"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>데이터 로딩 중...</p></td></tr>';

            const url = `/api/tables/${currentTable}/data?page=${currentPage}&limit=${limit}&q=${encodeURIComponent(searchQuery)}`;
            const data = await apiFetch(url);

            totalPages = data.total_pages;
            activeTableStats.textContent = `총 ${data.total_count} 건`;

            renderTableData(data.rows);
            updatePaginationUI(data.total_count);
        } catch (err) {
            tableBody.innerHTML = `<tr><td colspan="100" class="empty-state"><p class="alert alert-danger">${err.message}</p></div></td></tr>`;
        }
    }

    // Render Table Headers and Body Rows
    function renderTableData(rows) {
        if (!tableSchema || tableSchema.length === 0) return;

        const pkColObj = tableSchema.find(c => c.pk === 1) || tableSchema[0];
        const pkCol = pkColObj.name;

        // Render Headers
        let headHtml = '';
        if (isAdmin()) {
            headHtml += `<th style="width: 40px; text-align: center;"><input type="checkbox" id="chk-select-all"></th>`;
        }

        tableSchema.forEach(col => {
            headHtml += `<th>${col.name} ${col.pk ? '<i class="fa-solid fa-key" style="color: var(--warning); font-size: 0.7rem;"></i>' : ''}</th>`;
        });
        if (isAdmin()) {
            headHtml += '<th style="text-align: right;">작업 (Admin)</th>';
        }
        tableHeadTr.innerHTML = headHtml;

        // Header select-all event
        const chkSelectAll = document.getElementById('chk-select-all');
        if (chkSelectAll) {
            chkSelectAll.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                rows.forEach(r => {
                    const val = r[pkCol];
                    if (isChecked) selectedPkValues.add(val);
                    else selectedPkValues.delete(val);
                });
                document.querySelectorAll('.chk-row').forEach(c => c.checked = isChecked);
                document.querySelectorAll('#table-body tr').forEach(tr => tr.classList.toggle('row-selected', isChecked));
                updateBatchDeleteUI();
            });
        }

        // Render Body
        if (rows.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="100" class="empty-state"><i class="fa-solid fa-folder-open fa-2x"></i><p>표시할 레코드가 없습니다.</p></td></tr>';
            return;
        }

        let bodyHtml = '';
        rows.forEach((row, idx) => {
            const pkVal = row[pkCol];
            const isRowSelected = selectedPkValues.has(pkVal);

            bodyHtml += `<tr class="${isRowSelected ? 'row-selected' : ''}">`;

            if (isAdmin()) {
                bodyHtml += `<td style="text-align: center;"><input type="checkbox" class="chk-row" data-pk="${escapeHtml(String(pkVal))}" ${isRowSelected ? 'checked' : ''}></td>`;
            }

            tableSchema.forEach(col => {
                const val = row[col.name];
                const displayVal = (val === null || val === undefined) ? '<span style="color: var(--text-dim);">NULL</span>' : escapeHtml(String(val));
                bodyHtml += `<td>${displayVal}</td>`;
            });

            if (isAdmin()) {
                bodyHtml += `
                    <td style="text-align: right;" class="table-actions">
                        <button class="btn btn-sm btn-outline btn-edit-row" data-idx="${idx}"><i class="fa-solid fa-pen"></i> 수정</button>
                        <button class="btn btn-sm btn-danger btn-delete-row" data-idx="${idx}"><i class="fa-solid fa-trash"></i> 삭제</button>
                    </td>
                `;
            }
            bodyHtml += '</tr>';
        });

        tableBody.innerHTML = bodyHtml;

        if (isAdmin()) {
            document.querySelectorAll('.chk-row').forEach(chk => {
                chk.addEventListener('change', (e) => {
                    const pkVal = e.target.getAttribute('data-pk');
                    const tr = e.target.closest('tr');
                    if (e.target.checked) {
                        selectedPkValues.add(pkVal);
                        tr.classList.add('row-selected');
                    } else {
                        selectedPkValues.delete(pkVal);
                        tr.classList.remove('row-selected');
                    }
                    updateBatchDeleteUI();
                });
            });

            document.querySelectorAll('.btn-edit-row').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = btn.getAttribute('data-idx');
                    openEditModal(rows[idx]);
                });
            });

            document.querySelectorAll('.btn-delete-row').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = btn.getAttribute('data-idx');
                    handleDeleteRow(rows[idx]);
                });
            });
        }
    }

    function updateBatchDeleteUI() {
        const count = selectedPkValues.size;
        selectedCountSpan.textContent = count;
        if (count > 0 && isAdmin()) {
            btnBatchDelete.classList.remove('hidden');
        } else {
            btnBatchDelete.classList.add('hidden');
        }
    }

    function updatePaginationUI(totalCount) {
        paginationInfo.textContent = `${currentPage} / ${totalPages} 페이지 (총 ${totalCount}건)`;
        currentPageNum.textContent = currentPage;
        btnPrevPage.disabled = (currentPage <= 1);
        btnNextPage.disabled = (currentPage >= totalPages);
    }

    // CSV Export for Table
    function handleExportTableCsv() {
        if (!currentTable) return;
        const url = `/api/tables/${currentTable}/export-csv?q=${encodeURIComponent(searchQuery)}`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentTable}_export.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Batch Delete Selected Rows
    async function handleBatchDelete() {
        if (selectedPkValues.size === 0) return;

        const count = selectedPkValues.size;
        if (!confirm(`선택한 ${count}개의 레코드를 삭제하시겠습니까?`)) return;

        const pkColObj = tableSchema.find(c => c.pk === 1) || tableSchema[0];
        const pkCol = pkColObj.name;
        const pkVals = Array.from(selectedPkValues);

        try {
            await apiFetch(`/api/tables/${currentTable}/rows/batch-delete`, {
                method: 'POST',
                body: JSON.stringify({ pk_col: pkCol, pk_vals: pkVals })
            });

            selectedPkValues.clear();
            updateBatchDeleteUI();
            await loadTables();
            await loadTableData();
        } catch (err) {
            alert(`다중 삭제 실패: ${err.message}`);
        }
    }

    // SQL Console Handlers
    async function handleRunSql() {
        const query = sqlQueryInput.value.trim();
        if (!query) {
            alert('실행할 SQL 쿼리를 입력해 주세요.');
            return;
        }

        sqlResultAlert.classList.add('hidden');
        sqlBody.innerHTML = '<tr><td colspan="100" class="empty-state"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>쿼리 실행 중...</p></td></tr>';

        try {
            const data = await apiFetch('/api/admin/sql/execute', {
                method: 'POST',
                body: JSON.stringify({ query })
            });

            if (data.is_select) {
                sqlResultStats.textContent = `${data.total_count} 건`;
                renderSqlResultGrid(data.columns, data.rows);
                sqlResultAlert.className = 'alert alert-info';
                sqlResultAlert.textContent = `SELECT 쿼리가 실행되었습니다. (총 ${data.total_count}개 행)`;
            } else {
                sqlResultStats.textContent = `${data.affected_rows} 건`;
                sqlHeadTr.innerHTML = '<th>실행 결과</th>';
                sqlBody.innerHTML = `<tr><td>${data.message}</td></tr>`;
                sqlResultAlert.className = 'alert alert-info';
                sqlResultAlert.textContent = data.message;
                await loadTables();
            }
            sqlResultAlert.classList.remove('hidden');
        } catch (err) {
            sqlResultAlert.className = 'alert alert-danger';
            sqlResultAlert.textContent = err.message;
            sqlResultAlert.classList.remove('hidden');
            sqlHeadTr.innerHTML = '<th>오류</th>';
            sqlBody.innerHTML = `<tr><td class="empty-state alert-danger">${err.message}</td></tr>`;
        }
    }

    function renderSqlResultGrid(columns, rows) {
        let headHtml = '';
        columns.forEach(col => {
            headHtml += `<th>${escapeHtml(col)}</th>`;
        });
        sqlHeadTr.innerHTML = headHtml;

        if (rows.length === 0) {
            sqlBody.innerHTML = '<tr><td colspan="100" class="empty-state"><p>조회 결과가 없습니다.</p></td></tr>';
            return;
        }

        let bodyHtml = '';
        rows.forEach(r => {
            bodyHtml += '<tr>';
            columns.forEach(col => {
                const val = r[col];
                const displayVal = (val === null || val === undefined) ? '<span style="color: var(--text-dim);">NULL</span>' : escapeHtml(String(val));
                bodyHtml += `<td>${displayVal}</td>`;
            });
            bodyHtml += '</tr>';
        });
        sqlBody.innerHTML = bodyHtml;
    }

    async function handleExportSqlCsv() {
        const query = sqlQueryInput.value.trim();
        if (!query) {
            alert('내보낼 SQL 쿼리를 입력해 주세요.');
            return;
        }

        try {
            const response = await fetch('/api/admin/sql/export-csv', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || 'CSV 내보내기 실패');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sql_query_result.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert(`SQL CSV 다운로드 오류: ${err.message}`);
        }
    }

    // Modal Dynamic Inputs Generation (Admin)
    function openAddModal() {
        currentEditRowData = null;
        modalCrudTitle.innerHTML = `<i class="fa-solid fa-plus-circle"></i> ${currentTable} 레코드 추가`;
        crudErrorMsg.classList.add('hidden');
        renderFormInputs({});
        modalCrud.classList.remove('hidden');
    }

    function openEditModal(rowData) {
        currentEditRowData = rowData;
        modalCrudTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> ${currentTable} 레코드 수정`;
        crudErrorMsg.classList.add('hidden');
        renderFormInputs(rowData);
        modalCrud.classList.remove('hidden');
    }

    function renderFormInputs(rowData) {
        dynamicFormFields.innerHTML = '';
        tableSchema.forEach(col => {
            const fieldGroup = document.createElement('div');
            fieldGroup.className = 'form-group';
            
            const isPk = col.pk === 1;
            const value = rowData[col.name] !== undefined && rowData[col.name] !== null ? rowData[col.name] : '';

            fieldGroup.innerHTML = `
                <label for="input-col-${col.name}">
                    ${col.name} ${col.notnull ? '<span style="color: var(--danger);">*</span>' : ''} 
                    <small style="color: var(--text-dim);">(${col.type})</small>
                </label>
                <input type="text" id="input-col-${col.name}" class="form-control" name="${col.name}" value="${escapeHtml(String(value))}" ${isPk && currentEditRowData ? 'readonly style="opacity: 0.6;"' : ''}>
            `;
            dynamicFormFields.appendChild(fieldGroup);
        });
    }

    async function handleSaveCrud(e) {
        e.preventDefault();
        crudErrorMsg.classList.add('hidden');

        const formData = new FormData(formCrud);
        const data = {};
        for (let [key, val] of formData.entries()) {
            data[key] = val.trim() === '' ? null : val.trim();
        }

        const pkColObj = tableSchema.find(c => c.pk === 1) || tableSchema[0];
        const pkCol = pkColObj.name;
        const pkVal = currentEditRowData ? currentEditRowData[pkCol] : null;

        try {
            if (currentEditRowData) {
                await apiFetch(`/api/tables/${currentTable}/row`, {
                    method: 'PUT',
                    body: JSON.stringify({ pk_col: pkCol, pk_val: pkVal, data })
                });
            } else {
                await apiFetch(`/api/tables/${currentTable}/row`, {
                    method: 'POST',
                    body: JSON.stringify({ data })
                });
            }

            modalCrud.classList.add('hidden');
            await loadTables();
            await loadTableData();
        } catch (err) {
            crudErrorMsg.textContent = err.message;
            crudErrorMsg.classList.remove('hidden');
        }
    }

    async function handleDeleteRow(rowData) {
        const pkColObj = tableSchema.find(c => c.pk === 1) || tableSchema[0];
        const pkCol = pkColObj.name;
        const pkVal = rowData[pkCol];

        if (!confirm(`정말로 레코드 (${pkCol} = ${pkVal})를 삭제하시겠습니까?`)) return;

        try {
            await apiFetch(`/api/tables/${currentTable}/row`, {
                method: 'DELETE',
                body: JSON.stringify({ pk_col: pkCol, pk_val: pkVal })
            });

            await loadTables();
            await loadTableData();
        } catch (err) {
            alert(`삭제 실패: ${err.message}`);
        }
    }

    function formatBirthday(b) {
        if (!b || b.trim() === '' || b.trim() === '1970-01-01' || b.trim() === '1970.01.01') {
            return '미입력';
        }
        return escapeHtml(b.trim());
    }

    function formatReferrer(r) {
        if (!r || r.trim() === '') return '';
        return escapeHtml(r.trim());
    }

    function formatGrade(g) {
        if (!g || g.trim() === '') return '미입력';
        return escapeHtml(g.trim());
    }

    function formatSex(s) {
        if (!s || s.trim() === '') return '미지정';
        const val = s.trim().toUpperCase();
        if (val === 'M' || val === 'MALE' || val === '남' || val === '남성') return '남';
        if (val === 'F' || val === 'FEMALE' || val === '여' || val === '여성') return '여';
        return escapeHtml(s.trim());
    }

    // --- User Account Management (Admin Only) ---

    async function loadUserAccounts() {
        try {
            userManageBody.innerHTML = '<tr><td colspan="4" class="empty-state"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>계정 목록 로딩 중...</p></td></tr>';
            const data = await apiFetch('/api/admin/users');
            renderUserAccounts(data.users);
        } catch (err) {
            userManageBody.innerHTML = `<tr><td colspan="4" class="empty-state"><p class="alert alert-danger">${err.message}</p></td></tr>`;
        }
    }

    function renderUserAccounts(users) {
        userManageStats.textContent = `총 ${users.length} 명의 계정`;

        if (users.length === 0) {
            userManageBody.innerHTML = '<tr><td colspan="4" class="empty-state"><i class="fa-solid fa-user-slash fa-2x"></i><p>등록된 계정이 없습니다.</p></td></tr>';
            return;
        }

        let headHtml = '<th>아이디</th><th>역할</th><th>가입일</th><th style="text-align: right;">작업</th>';
        userManageHead.innerHTML = headHtml;

        let bodyHtml = '';
        users.forEach(u => {
            const username = escapeHtml(u.username);
            const roleLabel = ROLE_LABELS[u.role] || u.role;
            const createdAt = escapeHtml(u.created_at || '-');

            let actionsHtml = '';
            if (u.role === 'admin') {
                actionsHtml = '<span style="color: var(--text-dim); font-size: 0.8rem;">관리자</span>';
            } else {
                actionsHtml = `
                    <button class="btn btn-sm btn-outline btn-user-reset-pw" data-user-id="${u.id}" data-username="${username}">
                        <i class="fa-solid fa-lock"></i> 비밀번호 초기화
                    </button>
                    <select class="select-user-role" data-user-id="${u.id}" data-username="${username}">
                        <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>관리 선생님</option>
                        <option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>선생님</option>
                    </select>
                    <button class="btn btn-sm btn-danger btn-user-delete" data-user-id="${u.id}" data-username="${username}" style="margin-left: 0.3rem;">
                        <i class="fa-solid fa-trash-can"></i> 삭제
                    </button>
                `;
            }

            bodyHtml += `
                <tr>
                    <td><strong>${username}</strong></td>
                    <td><span class="role-pill ${u.role}">${roleLabel}</span></td>
                    <td>${createdAt}</td>
                    <td style="text-align: right;">${actionsHtml}</td>
                </tr>
            `;
        });

        userManageBody.innerHTML = bodyHtml;

        userManageBody.querySelectorAll('.btn-user-reset-pw').forEach(btn => {
            btn.addEventListener('click', () => {
                const userId = parseInt(btn.getAttribute('data-user-id'));
                const username = btn.getAttribute('data-username');
                openUserPasswordResetModal(userId, username);
            });
        });

        userManageBody.querySelectorAll('.select-user-role').forEach(sel => {
            sel.addEventListener('change', () => {
                const userId = parseInt(sel.getAttribute('data-user-id'));
                const username = sel.getAttribute('data-username');
                handleUserRoleChange(userId, username, sel.value);
            });
        });

        userManageBody.querySelectorAll('.btn-user-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const userId = parseInt(btn.getAttribute('data-user-id'));
                const username = btn.getAttribute('data-username');
                openUserDeleteConfirmModal(userId, username);
            });
        });
    }

    function openUserCreateModal() {
        formUserCreate.reset();
        selectUserCreateRole.value = 'teacher';
        userCreateMsg.classList.add('hidden');
        modalUserCreate.classList.remove('hidden');
        inputUserCreateUsername.focus();
    }

    async function handleUserCreate(e) {
        e.preventDefault();
        userCreateMsg.classList.add('hidden');

        const username = inputUserCreateUsername.value.trim();
        const password = inputUserCreatePassword.value;
        const role = selectUserCreateRole.value;

        if (!username) {
            userCreateMsg.className = 'alert alert-danger';
            userCreateMsg.textContent = '아이디는 필수 입력 항목입니다.';
            userCreateMsg.classList.remove('hidden');
            return;
        }

        if (password.length < 4) {
            userCreateMsg.className = 'alert alert-danger';
            userCreateMsg.textContent = '비밀번호는 4자 이상 입력해 주세요.';
            userCreateMsg.classList.remove('hidden');
            return;
        }

        try {
            const result = await apiFetch('/api/admin/users', {
                method: 'POST',
                body: JSON.stringify({ username, password, role })
            });

            alert(result.message);
            modalUserCreate.classList.add('hidden');
            await loadUserAccounts();
        } catch (err) {
            userCreateMsg.className = 'alert alert-danger';
            userCreateMsg.textContent = err.message;
            userCreateMsg.classList.remove('hidden');
        }
    }

    function openUserPasswordResetModal(userId, username) {
        pendingUserPwId = userId;
        userPwTargetDisplay.textContent = username;
        userPwInput.value = '';
        userPwMsg.classList.add('hidden');
        modalUserPassword.classList.remove('hidden');
        userPwInput.focus();
    }

    async function handleUserPasswordReset(e) {
        e.preventDefault();
        userPwMsg.classList.add('hidden');

        const password = userPwInput.value;
        if (password.length < 4) {
            userPwMsg.className = 'alert alert-danger';
            userPwMsg.textContent = '비밀번호는 4자 이상 입력해 주세요.';
            userPwMsg.classList.remove('hidden');
            return;
        }

        try {
            const result = await apiFetch(`/api/admin/users/${pendingUserPwId}/password`, {
                method: 'PUT',
                body: JSON.stringify({ password })
            });

            alert(result.message);
            modalUserPassword.classList.add('hidden');
            await loadUserAccounts();
        } catch (err) {
            userPwMsg.className = 'alert alert-danger';
            userPwMsg.textContent = err.message;
            userPwMsg.classList.remove('hidden');
        }
    }

    async function handleUserRoleChange(userId, username, newRole) {
        const roleLabel = ROLE_LABELS[newRole] || newRole;
        if (!confirm(`'${username}' 계정의 역할을 ${roleLabel}(으)로 변경하시겠습니까?`)) {
            await loadUserAccounts();
            return;
        }

        try {
            const result = await apiFetch(`/api/admin/users/${userId}/role`, {
                method: 'PUT',
                body: JSON.stringify({ role: newRole })
            });

            alert(result.message);
            await loadUserAccounts();
        } catch (err) {
            alert(err.message);
            await loadUserAccounts();
        }
    }

    function openUserDeleteConfirmModal(userId, username) {
        pendingUserDeleteId = userId;
        userDeleteTargetDisplay.textContent = username;
        inputConfirmUserDelete.value = '';
        btnSubmitUserDelete.disabled = true;
        modalUserDelete.classList.remove('hidden');
        inputConfirmUserDelete.focus();

        inputConfirmUserDelete.oninput = () => {
            if (inputConfirmUserDelete.value.trim() === username) {
                btnSubmitUserDelete.disabled = false;
            } else {
                btnSubmitUserDelete.disabled = true;
            }
        };
    }

    async function handleUserDelete(e) {
        e.preventDefault();
        if (btnSubmitUserDelete.disabled) return;

        try {
            const result = await apiFetch(`/api/admin/users/${pendingUserDeleteId}`, {
                method: 'DELETE'
            });

            alert(result.message);
            modalUserDelete.classList.add('hidden');
            await loadUserAccounts();
            await loadTables();
        } catch (err) {
            alert(err.message);
        }
    }

    // ==================== 수업(Class) 관리 ====================
    const DAY_LABELS = { '월': '월요일', '화': '화요일', '수': '수요일', '목': '목요일', '금': '금요일', '토': '토요일', '일': '일요일' };
    const BATCH_STATUS_CLASS = { created: 'res-status-created', skipped: 'res-status-skipped', duplicate: 'res-status-skipped', error: 'res-status-error' };
    const BATCH_STATUS_ICON = { created: 'fa-circle-check', skipped: 'fa-forward', duplicate: 'fa-circle-exclamation', error: 'fa-circle-xmark' };

    function formatDayOfWeek(d) {
        return DAY_LABELS[d] || d || '-';
    }

    // 전체 학생 체크박스 목록 HTML 생성 (등록/편집 폼 공용)
    // checkedIds: 수강 배정된 학생 ID Set, specialIds: 특강으로 지정된 학생 ID Set
    function buildStudentCheckboxListHtml(filterText, checkedIds, specialIds) {
        filterText = (filterText || '').trim().toLowerCase();
        specialIds = specialIds || new Set();
        let html = '';
        classAllStudentsCache.forEach(s => {
            const sId = s.row_id || s.Id;
            const name = escapeHtml(s.Name || '이름 없음');
            const sex = formatSex(s.Sex);
            const endedTag = s.IsClassEnded ? ' <span class="badge badge-warning" style="font-size:0.65rem;">수업 종료</span>' : '';
            if (filterText && !name.toLowerCase().includes(filterText)) return;
            const checked = checkedIds.has(sId) ? 'checked' : '';
            const specialChecked = specialIds.has(sId) ? 'checked' : '';
            const specialDisabled = checked ? '' : 'disabled';
            html += `
                <div class="class-student-checkbox-item">
                    <label class="cs-select" style="display: flex; align-items: center; gap: 0.45rem; cursor: pointer; flex: 1; min-width: 0;">
                        <input type="checkbox" class="cs-chk" value="${sId}" ${checked}>
                        <span style="white-space: nowrap;"><i class="fa-solid fa-user-graduate" style="color: var(--primary);"></i> ${name}${endedTag}</span>
                    </label>
                    <label class="cs-special" title="이 학생의 이 수업을 특강으로 지정 (배정된 학생만 설정 가능)" style="display: flex; align-items: center; gap: 0.3rem; cursor: pointer; flex-shrink: 0; opacity: ${checked ? 1 : 0.45};">
                        <input type="checkbox" class="cs-special-chk" value="${sId}" ${specialChecked} ${specialDisabled} style="accent-color: var(--warning);">
                        <span style="font-size: 0.8rem; color: var(--warning); white-space: nowrap;"><i class="fa-solid fa-star"></i> 특강</span>
                    </label>
                    <span class="stu-meta">${sex} | ${s.Referrer ? '추천: ' + formatReferrer(s.Referrer) + ' | ' : ''}#${sId}</span>
                </div>
            `;
        });
        return html || '<div class="empty-state" style="padding: 1rem;"><p>검색 조건에 맞는 학생이 없습니다.</p></div>';
    }

    // 선택된 학생 카운트/이름 태그 렌더 (등록/편집 폼 공용, classAllStudentsCache는 전역 참조)
    function updateSelectedCount(selectedSet, specialSet, countEl, namesEl) {
        if (countEl) {
            countEl.textContent = selectedSet.size;
        }
        // 선택된 학생 이름 태그 렌더링 (선택 개수와 함께 이름을 보여준다)
        if (!namesEl) return;
        if (selectedSet.size === 0) {
            namesEl.innerHTML = '';
            return;
        }
        const names = [];
        classAllStudentsCache.forEach(s => {
            const sId = s.row_id || s.Id;
            if (selectedSet.has(sId)) {
                names.push({
                    name: escapeHtml(s.Name || `학생 #${sId}`),
                    referrer: s.Referrer || '',
                    special: specialSet.has(sId)
                });
            }
        });
        // 특강 지정 학생의 배지는 다른 색상(주황) + 별 아이콘으로 표시
        namesEl.innerHTML = names.map(n =>
            `<span class="selected-student-tag${n.special ? ' special' : ''}"><i class="fa-solid ${n.special ? 'fa-star' : 'fa-user'}"></i> ${n.name}${n.referrer ? `<span class="chip-referrer" style="opacity:.75;font-size:.68rem;"> · 추천:${escapeHtml(n.referrer)}</span>` : ''}</span>`
        ).join('');
    }

    // 수업 등록/편집 폼의 학생 체크박스 목록 렌더 (검색 필터 반영)
    // 선택 상태는 DOM이 아닌 Set(selectedSet/specialSet)에 보관하므로,
    // 필터로 학생을 검색해도 기존에 선택한 학생의 선택이 유지된다.
    function renderStudentCheckboxList(listEl, filterEl, selectedSet, specialSet, countEl, namesEl) {
        if (!listEl) return;
        const filterText = filterEl ? filterEl.value : '';
        listEl.innerHTML = buildStudentCheckboxListHtml(filterText, selectedSet, specialSet);
        updateSelectedCount(selectedSet, specialSet, countEl, namesEl);
        listEl.querySelectorAll('input.cs-chk').forEach(cb => {
            cb.addEventListener('change', () => {
                const sid = parseInt(cb.value);
                if (cb.checked) {
                    selectedSet.add(sid);
                } else {
                    selectedSet.delete(sid);
                    specialSet.delete(sid); // 배정 해제 시 특강 지정도 해제
                }
                updateSelectedCount(selectedSet, specialSet, countEl, namesEl);
                // 동일 행의 특강 체크박스 활성/비활성 동기화
                const row = cb.closest('.class-student-checkbox-item');
                const sp = row ? row.querySelector('input.cs-special-chk') : null;
                if (sp) {
                    sp.disabled = !cb.checked;
                    if (!cb.checked) sp.checked = false;
                    const lbl = row.querySelector('.cs-special');
                    if (lbl) lbl.style.opacity = cb.checked ? '1' : '0.45';
                }
            });
        });
        listEl.querySelectorAll('input.cs-special-chk').forEach(cb => {
            cb.addEventListener('change', () => {
                const sid = parseInt(cb.value);
                if (cb.checked) {
                    specialSet.add(sid);
                } else {
                    specialSet.delete(sid);
                }
                updateSelectedCount(selectedSet, specialSet, countEl, namesEl);
            });
        });
    }

    function getSelectedClassStudentIds() {
        return Array.from(classRegSelectedStudentIds);
    }

    // 수업 등록 폼 초기화 (선생님 옵션 + 학생 목록 로드)
    async function loadClassRegForm() {
        if (!formUserClassReg) return;
        formUserClassReg.reset();
        classRegSelectedStudentIds = new Set();
        classRegStudentSpecialIds = new Set();
        if (classRegMsg) classRegMsg.classList.add('hidden');
        if (classStudentFilter) classStudentFilter.value = '';
        classStudentList.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 학생 목록 로딩 중...</div>';
        try {
            const [tData, sData] = await Promise.all([
                apiFetch('/api/user/teachers-options'),
                apiFetch('/api/user/students-options?include_ended=true')
            ]);
            const teacherSelect = document.getElementById('class-teacher');
            let thtml = '<option value="">-- 담당 선생님 선택 --</option>';
            (tData.teachers || []).forEach(t => {
                const roleLabel = t.role === 'manager' ? '관리 선생님' : '선생님';
                thtml += `<option value="${escapeHtml(t.username)}">${escapeHtml(t.username)} (${roleLabel})</option>`;
            });
            teacherSelect.innerHTML = thtml;
            classAllStudentsCache = sData.students || [];
            renderStudentCheckboxList(classStudentList, classStudentFilter, classRegSelectedStudentIds, classRegStudentSpecialIds, classSelectedCount, document.getElementById('class-selected-names'));
        } catch (err) {
            classStudentList.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    // 수업 등록 제출
    async function handleUserClassSubmit(e) {
        e.preventDefault();
        if (classRegMsg) classRegMsg.classList.add('hidden');
        const name = document.getElementById('class-name').value.trim();
        const teacher = document.getElementById('class-teacher').value;
        const day = document.getElementById('class-day').value;
        const time = document.getElementById('class-start-time').value || '';
        if (!name) { classRegMsg.className = 'alert alert-danger'; classRegMsg.textContent = '수업명은 필수 입력 항목입니다.'; classRegMsg.classList.remove('hidden'); return; }
        if (!teacher) { classRegMsg.className = 'alert alert-danger'; classRegMsg.textContent = '담당 선생님을 선택해 주세요.'; classRegMsg.classList.remove('hidden'); return; }
        if (!day) { classRegMsg.className = 'alert alert-danger'; classRegMsg.textContent = '요일을 선택해 주세요.'; classRegMsg.classList.remove('hidden'); return; }
        const studentIds = getSelectedClassStudentIds();
        const specialMap = {};
        classRegStudentSpecialIds.forEach(sid => {
            if (studentIds.includes(sid)) specialMap[sid] = true;
        });
        try {
            const result = await apiFetch('/api/user/classes', {
                method: 'POST',
                body: JSON.stringify({ ClassName: name, TeacherUsername: teacher, DayOfWeek: day, StartTime: time, StudentIds: studentIds, StudentIsSpecial: specialMap })
            });
            classRegMsg.className = 'alert alert-success';
            classRegMsg.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(result.message)}`;
            classRegMsg.classList.remove('hidden');
            formUserClassReg.reset();
            await loadClassRegForm();
            setTimeout(() => switchView('class-list'), 900);
        } catch (err) {
            classRegMsg.className = 'alert alert-danger';
            classRegMsg.textContent = err.message;
            classRegMsg.classList.remove('hidden');
        }
    }

    // 수업 목록 검색
    async function loadClassSearchResults() {
        if (!token || !classCardsGrid) return;
        try {
            classCardsGrid.innerHTML = '<div class="empty-state" style="grid-column: span 10;"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>수업 검색 중...</p></div>';
            const q = classSearchQ ? classSearchQ.value.trim() : '';
            const params = new URLSearchParams({ page: classSearchPage, limit: classSearchLimit });
            if (q) params.append('q', q);
            const data = await apiFetch(`/api/user/classes?${params.toString()}`);
            classSearchTotalPages = data.total_pages;
            if (classSearchTotalCount) classSearchTotalCount.textContent = `총 ${data.total_count} 건의 수업`;
            if (classSearchPaginationInfo) classSearchPaginationInfo.textContent = `${classSearchPage} / ${classSearchTotalPages} 페이지 (총 ${data.total_count}건)`;
            if (classSearchCurrentPageSpan) classSearchCurrentPageSpan.textContent = classSearchPage;
            if (btnClassSearchPrev) btnClassSearchPrev.disabled = (classSearchPage <= 1);
            if (btnClassSearchNext) btnClassSearchNext.disabled = (classSearchPage >= classSearchTotalPages);
            renderClassCards(data.classes);
        } catch (err) {
            classCardsGrid.innerHTML = `<tr><td colspan="8" class="text-center p-4"><div class="empty-state"><p class="alert alert-danger">${err.message}</p></div></td></tr>`;
        }
    }

    function renderClassCards(classes) {
        if (!classCardsGrid) return;
        if (classes.length === 0) {
            classCardsGrid.innerHTML = '<tr><td colspan="8" class="text-center p-4"><div class="empty-state"><i class="fa-solid fa-folder-open fa-2x"></i><p>등록된 수업이 없습니다.</p></div></td></tr>';
            return;
        }
        let html = '';
        classes.forEach(c => {
            const cId = c.Id;
            const name = escapeHtml(c.ClassName || '수업명 없음');
            const teacher = escapeHtml(c.TeacherUsername || '-');
            const day = formatDayOfWeek(c.DayOfWeek);
            const time = c.StartTime ? escapeHtml(c.StartTime) : '미지정';
            const count = c.StudentCount || 0;
            const isEnded = !!c.IsEnded;

            html += `
                <tr data-class-id="${cId}">
                    <td><strong>#${cId}</strong></td>
                    <td class="fw-semibold text-primary cell-clickable btn-open-class-detail" data-class-id="${cId}">${name}</td>
                    <td><span class="tag-badge primary"><i class="fa-solid fa-calendar-days"></i> ${day}</span></td>
                    <td>${time}</td>
                    <td><i class="fa-solid fa-user-tie text-muted"></i> ${teacher}</td>
                    <td><span class="badge badge-info"><i class="fa-solid fa-users"></i> ${count}명</span></td>
                    <td class="text-center">
                        <button type="button" class="btn-toggle-status ${isEnded ? 'is-ended' : 'is-active'} btn-toggle-class-ended" data-class-id="${cId}" data-current="${isEnded ? 1 : 0}">
                            ${isEnded ? '<i class="fa-solid fa-circle-check"></i> 종강/완료' : '<i class="fa-solid fa-chalkboard-user"></i> 수업 진행 중'}
                        </button>
                    </td>
                    <td>
                        <div class="action-btn-group" style="display: flex; gap: 0.35rem; align-items: center;">
                            <button type="button" class="btn btn-xs btn-outline btn-open-class-detail" data-class-id="${cId}">
                                <i class="fa-solid fa-eye"></i> 상세
                            </button>
                            <button type="button" class="btn btn-xs btn-primary btn-class-batch" data-class-id="${cId}">
                                <i class="fa-solid fa-square-plus"></i> 일괄 등록
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        classCardsGrid.innerHTML = html;

        classCardsGrid.querySelectorAll('.btn-open-class-detail').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openClassDetailModal(btn.getAttribute('data-class-id'));
            });
        });

        classCardsGrid.querySelectorAll('.btn-class-batch').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                goToClassBatchReg(parseInt(btn.getAttribute('data-class-id')));
            });
        });

        classCardsGrid.querySelectorAll('.btn-toggle-class-ended').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const classId = btn.getAttribute('data-class-id');
                const currentVal = parseInt(btn.getAttribute('data-current')) || 0;
                const newVal = currentVal === 1 ? 0 : 1;
                await toggleClassEnded(classId, newVal, btn);
            });
        });
    }

    // 수업 상세 모달
    async function openClassDetailModal(classId) {
        modalClassDetailBody.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>수업 상세 정보 조회 중...</p></div>';
        modalClassDetailTitle.innerHTML = '<i class="fa-solid fa-chalkboard-user"></i> 수업 상세 정보';
        modalClassDetailActions.innerHTML = '';
        modalClassDetail.classList.remove('hidden');
        try {
            const data = await apiFetch(`/api/user/classes/${classId}`);
            const cls = data.class_;
            const students = data.students || [];
            currentDetailClass = cls;

            if (isStaff()) {
                modalClassDetailActions.innerHTML = `
                    <button id="btn-modal-edit-class" class="btn btn-sm btn-primary"><i class="fa-solid fa-pen-to-square"></i> 수정</button>
                    <button id="btn-modal-delete-class" class="btn btn-sm btn-danger"><i class="fa-solid fa-trash-can"></i> 수업 삭제</button>
                `;
                document.getElementById('btn-modal-edit-class').addEventListener('click', () => renderClassDetailEditForm(cls, students, classId));
                document.getElementById('btn-modal-delete-class').addEventListener('click', () => openClassDeleteConfirmModal(cls));
            } else {
                modalClassDetailActions.innerHTML = '';
            }

            let studentRows = '';
            if (students.length === 0) {
                studentRows = '<tr><td colspan="3" class="empty-state"><p>배정된 학생이 없습니다.</p></td></tr>';
            } else {
                students.forEach(s => {
                    const name = escapeHtml(s.Name || '이름 없음');
                    const sex = formatSex(s.Sex);
                    const referrerText = s.Referrer ? `<span class="text-muted" style="font-size: 0.75rem; margin-left: 0.4rem;"><i class="fa-solid fa-user-plus"></i> 추천: ${formatReferrer(s.Referrer)}</span>` : '';
                    const specialBadge = s.IsSpecial ? '<span class="badge" style="margin-left: 0.4rem; background: rgba(245, 158, 11, 0.2); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.35);"><i class="fa-solid fa-star"></i> 특강</span>' : '';
                    studentRows += `<tr><td><i class="fa-solid fa-user-graduate" style="color: var(--primary);"></i> ${name}${referrerText}${specialBadge}</td><td>${sex}</td><td>${formatGrade(s.Grade)}</td></tr>`;
                });
            }

            const day = formatDayOfWeek(cls.DayOfWeek);
            const time = cls.StartTime ? escapeHtml(cls.StartTime) : '미지정';
            modalClassDetailBody.innerHTML = `
                <div class="detail-header-block">
                    <div class="detail-title">${escapeHtml(cls.ClassName || '수업명 없음')}</div>
                    <div class="detail-meta-row">
                        <span><i class="fa-solid fa-user-tie"></i> 담당 선생님: <strong>${escapeHtml(cls.TeacherUsername || '-')}</strong></span>
                        <span><i class="fa-solid fa-calendar-days"></i> 요일: <strong>${day}</strong></span>
                        <span><i class="fa-solid fa-clock"></i> 시간: <strong>${time}</strong></span>
                        <span><i class="fa-solid fa-users"></i> 수강 학생: <strong>${students.length}명</strong></span>
                    </div>
                </div>
                <div style="margin-top: 1rem;">
                    <div class="detail-section-title"><i class="fa-solid fa-users"></i> 수강 학생 명단</div>
                    <div class="table-responsive">
                        <table class="modern-table">
                            <thead><tr><th>학생 이름</th><th>성별</th><th>학년</th></tr></thead>
                            <tbody>${studentRows}</tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-actions" style="margin-top: 1.25rem;">
                    <button type="button" id="btn-modal-class-batch" class="btn btn-success"><i class="fa-solid fa-square-plus"></i> 학습 이력 일괄 등록</button>
                </div>
            `;
            document.getElementById('btn-modal-class-batch').addEventListener('click', () => {
                modalClassDetail.classList.add('hidden');
                goToClassBatchReg(classId);
            });
        } catch (err) {
            modalClassDetailBody.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    // 수업 상세 모달 내 편집 폼
    async function renderClassDetailEditForm(cls, students, classId) {
        modalClassDetailTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> 수업 정보 수정';
        modalClassDetailActions.innerHTML = '';
        modalClassDetailBody.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 편집 폼 준비 중...</div>';
        try {
            const [tData, sData] = await Promise.all([
                apiFetch('/api/user/teachers-options'),
                apiFetch('/api/user/students-options?include_ended=true')
            ]);
            classAllStudentsCache = sData.students || [];
            const checkedIds = new Set(students.map(s => s.row_id || s.Id));
            const specialIds = new Set(students.filter(s => s.IsSpecial).map(s => s.row_id || s.Id));
            // 다른 수업에서 남은 stale 선택 상태 방지를 위해 진입 시 현재 수업 기준으로 초기화
            classEditSelectedStudentIds = new Set(checkedIds);
            classEditStudentSpecialIds = new Set(specialIds);

            let teacherOpts = '<option value="">-- 담당 선생님 선택 --</option>';
            (tData.teachers || []).forEach(t => {
                const sel = t.username === cls.TeacherUsername ? 'selected' : '';
                const roleLabel = t.role === 'manager' ? '관리 선생님' : '선생님';
                teacherOpts += `<option value="${escapeHtml(t.username)}" ${sel}>${escapeHtml(t.username)} (${roleLabel})</option>`;
            });
            const dayOpts = ['월', '화', '수', '목', '금', '토', '일'].map(d =>
                `<option value="${d}" ${cls.DayOfWeek === d ? 'selected' : ''}>${DAY_LABELS[d]}</option>`
            ).join('');

            modalClassDetailBody.innerHTML = `
                <form id="form-modal-edit-class" class="modal-edit-form">
                    <div id="modal-class-edit-alert" class="alert hidden"></div>
                    <div class="form-section">
                        <h4 class="section-title"><i class="fa-solid fa-circle-info"></i> 수업 기본 정보 수정</h4>
                        <div class="form-grid">
                            <div class="form-group span-2">
                                <label>수업명 <span class="required">*</span></label>
                                <input type="text" name="ClassName" class="form-control" value="${escapeHtml(cls.ClassName || '')}" required>
                            </div>
                            <div class="form-group">
                                <label>담당 선생님 <span class="required">*</span></label>
                                <select name="TeacherUsername" class="form-control">${teacherOpts}</select>
                            </div>
                            <div class="form-group">
                                <label>요일 <span class="required">*</span></label>
                                <select name="DayOfWeek" class="form-control">${dayOpts}</select>
                            </div>
                            <div class="form-group">
                                <label>시작 시간</label>
                                <input type="time" name="StartTime" class="form-control" value="${escapeHtml(cls.StartTime || '')}">
                            </div>
                        </div>
                    </div>
                    <div class="form-section">
                        <h4 class="section-title"><i class="fa-solid fa-users"></i> 수강 학생 배정</h4>
                        <div class="form-group">
                            <div class="picker-input-group">
                                <input type="text" id="modal-class-edit-student-filter" class="form-control" placeholder="학생 이름으로 검색하여 목록을 필터링...">
                            </div>
                            <div id="modal-class-edit-student-list" class="class-student-checkbox-list"></div>
                            <div class="class-selected-info">
                                <i class="fa-solid fa-user-check"></i> 선택된 학생: <strong id="modal-class-edit-selected-count">0</strong>명
                                <div id="modal-class-edit-selected-names" class="class-selected-names"></div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" id="btn-cancel-modal-edit-class" class="btn btn-outline">취소</button>
                        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> 수정 내용 저장</button>
                    </div>
                </form>
            `;
            document.getElementById('btn-cancel-modal-edit-class').addEventListener('click', () => openClassDetailModal(classId));
            document.getElementById('form-modal-edit-class').addEventListener('submit', (e) => handleAdminSaveDetailClass(e, cls, classId));
            document.getElementById('modal-class-edit-student-filter').addEventListener('input', () => renderStudentCheckboxList(
                document.getElementById('modal-class-edit-student-list'),
                document.getElementById('modal-class-edit-student-filter'),
                classEditSelectedStudentIds,
                classEditStudentSpecialIds,
                document.getElementById('modal-class-edit-selected-count'),
                document.getElementById('modal-class-edit-selected-names')
            ));
            renderStudentCheckboxList(
                document.getElementById('modal-class-edit-student-list'),
                document.getElementById('modal-class-edit-student-filter'),
                classEditSelectedStudentIds,
                classEditStudentSpecialIds,
                document.getElementById('modal-class-edit-selected-count'),
                document.getElementById('modal-class-edit-selected-names')
            );
        } catch (err) {
            modalClassDetailBody.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    // 수업 편집 저장
    async function handleAdminSaveDetailClass(e, origClass, classId) {
        e.preventDefault();
        const alertEl = document.getElementById('modal-class-edit-alert');
        if (alertEl) alertEl.classList.add('hidden');
        const f = e.target;
        const name = (f.querySelector('[name="ClassName"]').value || '').trim();
        const teacher = f.querySelector('[name="TeacherUsername"]').value;
        const day = f.querySelector('[name="DayOfWeek"]').value;
        const time = f.querySelector('[name="StartTime"]').value || '';
        const studentIds = Array.from(classEditSelectedStudentIds);
        const specialMap = {};
        classEditStudentSpecialIds.forEach(sid => {
            if (studentIds.includes(sid)) specialMap[sid] = true;
        });
        if (!name) { alertEl.className = 'alert alert-danger'; alertEl.textContent = '수업명은 필수 입력 항목입니다.'; alertEl.classList.remove('hidden'); return; }
        if (!teacher) { alertEl.className = 'alert alert-danger'; alertEl.textContent = '담당 선생님을 선택해 주세요.'; alertEl.classList.remove('hidden'); return; }
        if (!day) { alertEl.className = 'alert alert-danger'; alertEl.textContent = '요일을 선택해 주세요.'; alertEl.classList.remove('hidden'); return; }
        try {
            await apiFetch(`/api/user/classes/${classId}`, {
                method: 'PUT',
                body: JSON.stringify({ ClassName: name, TeacherUsername: teacher, DayOfWeek: day, StartTime: time, StudentIds: studentIds, StudentIsSpecial: specialMap })
            });
            await openClassDetailModal(classId);
            await loadClassSearchResults();
        } catch (err) {
            alertEl.className = 'alert alert-danger';
            alertEl.textContent = err.message;
            alertEl.classList.remove('hidden');
        }
    }

    // 수업 삭제 확인 모달
    function openClassDeleteConfirmModal(cls) {
        pendingClassDeleteId = cls.Id;
        pendingClassDeleteName = cls.ClassName || '';
        targetClassDeleteNameDisplay.textContent = pendingClassDeleteName;
        inputConfirmDeleteClassName.value = '';
        btnSubmitClassDeleteConfirm.disabled = true;
        modalClassDeleteConfirm.classList.remove('hidden');
        inputConfirmDeleteClassName.focus();
    }

    async function handleClassDeleteSubmit() {
        if (btnSubmitClassDeleteConfirm.disabled) return;
        try {
            const result = await apiFetch(`/api/user/classes/${pendingClassDeleteId}`, { method: 'DELETE' });
            alert(result.message);
            modalClassDeleteConfirm.classList.add('hidden');
            modalClassDetail.classList.add('hidden');
            pendingClassDeleteId = null;
            await loadClassSearchResults();
        } catch (err) {
            alert(err.message);
        }
    }

    // 수업 → 일괄 등록 뷰 이동
    async function goToClassBatchReg(classId) {
        switchView('class-studylog-reg');
        await loadClassOptionsForBatch(classId);
    }

    // 일괄 등록 뷰: 수업 선택 옵션 로드
    async function loadClassOptionsForBatch(preselectClassId) {
        if (!classBatchSelect) return;
        try {
            classBatchSelect.innerHTML = '<option value="">-- 수업을 불러오는 중... --</option>';
            const data = await apiFetch('/api/user/classes?limit=100');
            const classes = data.classes || [];
            let html = '<option value="">-- 수업을 선택해 주세요 --</option>';
            classes.forEach(c => {
                const name = escapeHtml(c.ClassName || '수업명 없음');
                const day = formatDayOfWeek(c.DayOfWeek);
                const teacher = escapeHtml(c.TeacherUsername || '');
                html += `<option value="${c.Id}">${name} (${day} ${c.StartTime ? c.StartTime : ''} · ${teacher})</option>`;
            });
            classBatchSelect.innerHTML = html;
            if (preselectClassId) {
                classBatchSelect.value = String(preselectClassId);
                loadClassBatchForm(preselectClassId);
            }
        } catch (err) {
            classBatchSelect.innerHTML = `<option value="">수업 로딩 실패: ${err.message}</option>`;
        }
    }

    // 일괄 등록 뷰: 수업 상세 + 학생 테이블 로드
    async function loadClassBatchForm(classId) {
        activeBatchClassId = classId;
        if (classBatchResult) classBatchResult.classList.add('hidden');
        try {
            const data = await apiFetch(`/api/user/classes/${classId}/batch-form`);
            const cls = data.class_;
            const students = data.students || [];
            if (batchClassName) batchClassName.textContent = cls.ClassName || '-';
            if (batchClassTeacher) batchClassTeacher.textContent = cls.TeacherUsername || '-';
            if (batchClassSchedule) batchClassSchedule.textContent = `${formatDayOfWeek(cls.DayOfWeek)} ${cls.StartTime ? cls.StartTime : '(시간 미지정)'}`;
            if (batchClassStudentCount) batchClassStudentCount.textContent = `${students.length}명`;
            if (classBatchInfo) classBatchInfo.classList.remove('hidden');
            if (classBatchRegCard) classBatchRegCard.classList.remove('hidden');
            if (!batchStudiedDay.value) batchStudiedDay.value = new Date().toISOString().split('T')[0];
            renderBatchStudentsTable(students);
            loadBatchStudylogCalendar(getBatchMonth(batchStudiedDay.value));
        } catch (err) {
            resetBatchRegView();
            if (classBatchInfo) classBatchInfo.classList.remove('hidden');
            if (batchClassName) batchClassName.textContent = '조회 오류';
            if (batchClassTeacher) batchClassTeacher.textContent = err.message;
        }
    }

    function renderBatchStudentsTable(students) {
        if (!classBatchStudentsBody) return;
        if (students.length === 0) {
            classBatchStudentsBody.innerHTML = '<tr><td colspan="3" class="empty-state"><p>이 수업에 배정된 학생이 없습니다.</p></td></tr>';
            return;
        }
        let html = '';
        students.forEach(s => {
            const sId = s.row_id || s.Id;
            const name = escapeHtml(s.Name || '이름 없음');
            const sex = formatSex(s.Sex);
            const specialChecked = s.IsSpecial ? 'checked' : '';
            html += `
                <tr>
                    <td style="text-align: center;">
                        <input type="checkbox" class="batch-attend" data-student-id="${sId}" checked style="width: 16px; height: 16px; accent-color: var(--success); cursor: pointer;">
                    </td>
                    <td style="text-align: center;">
                        <input type="checkbox" class="batch-special" data-student-id="${sId}" ${specialChecked} title="특강 수업 여부" style="width: 16px; height: 16px; accent-color: var(--warning); cursor: pointer;">
                    </td>
                    <td><i class="fa-solid fa-user-graduate" style="color: var(--primary);"></i> ${name} <span class="text-muted" style="font-size: 0.75rem;">(${sex})${s.Referrer ? ` · 추천: ${formatReferrer(s.Referrer)}` : ''}</span></td>
                </tr>
            `;
        });
        classBatchStudentsBody.innerHTML = html;
    }

    function getBatchMonth(dateValue) {
        return (dateValue || new Date().toISOString().slice(0, 10)).slice(0, 7);
    }

    async function loadBatchStudylogCalendar(month = getBatchMonth(batchStudiedDay?.value)) {
        if (!activeBatchClassId || !batchCalendarStatus) return;
        batchCalendarMonth = month;
        batchCalendarDays = {};
        batchCalendarStatus.textContent = '기존 학습 이력을 불러오는 중입니다...';
        batchCalendarStatus.className = 'batch-calendar-status loading';
        if (batchCalendarGrid) batchCalendarGrid.classList.add('hidden');
        if (batchExistingRecords) batchExistingRecords.classList.add('hidden');
        try {
            const data = await apiFetch(`/api/user/classes/${activeBatchClassId}/studylog-calendar?month=${encodeURIComponent(month)}`);
            if (activeBatchClassId === null || batchCalendarMonth !== month) return;
            batchCalendarDays = data.days || {};
            renderBatchStudylogCalendar();
            showBatchExistingRecords(batchStudiedDay?.value || '');
        } catch (err) {
            batchCalendarStatus.textContent = `기존 학습 이력을 불러오지 못했습니다: ${err.message}`;
            batchCalendarStatus.className = 'batch-calendar-status error';
        }
    }

    function renderBatchStudylogCalendar() {
        if (!batchCalendarGrid || !batchCalendarStatus || !batchCalendarMonth) return;
        const [year, month] = batchCalendarMonth.split('-').map(Number);
        const firstWeekday = new Date(year, month - 1, 1).getDay();
        const lastDay = new Date(year, month, 0).getDate();
        const selectedDay = batchStudiedDay?.value || '';
        const labels = ['일', '월', '화', '수', '목', '금', '토'];
        let html = labels.map(label => `<div class="batch-calendar-weekday">${label}</div>`).join('');
        html += '<div class="batch-calendar-blank"></div>'.repeat(firstWeekday);
        for (let day = 1; day <= lastDay; day++) {
            const date = `${batchCalendarMonth}-${String(day).padStart(2, '0')}`;
            const count = (batchCalendarDays[date] || []).length;
            const classes = ['batch-calendar-day'];
            if (count) classes.push('has-records');
            if (date === selectedDay) classes.push('selected');
            html += `<button type="button" class="${classes.join(' ')}" data-batch-date="${date}" aria-label="${date}${count ? `, 기존 기록 ${count}건` : ''}"><span>${day}</span>${count ? `<b>${count}</b>` : ''}</button>`;
        }
        if (batchCalendarMonthLabel) batchCalendarMonthLabel.textContent = `${year}년 ${month}월`;
        batchCalendarGrid.innerHTML = html;
        batchCalendarGrid.classList.remove('hidden');
        batchCalendarGrid.querySelectorAll('[data-batch-date]').forEach(button => button.addEventListener('click', () => selectBatchCalendarDate(button.dataset.batchDate)));
        const total = Object.values(batchCalendarDays).reduce((sum, records) => sum + records.length, 0);
        batchCalendarStatus.textContent = total ? `이번 달 기존 학습 기록 ${total}건을 표시했습니다.` : '이번 달에는 기존 학습 기록이 없습니다.';
        batchCalendarStatus.className = 'batch-calendar-status';
    }

    function selectBatchCalendarDate(date) {
        if (batchStudiedDay) batchStudiedDay.value = date;
        renderBatchStudylogCalendar();
        showBatchExistingRecords(date);
    }

    function showBatchExistingRecords(date) {
        if (!batchExistingRecords) return;
        const records = batchCalendarDays[date] || [];
        if (!date || !records.length) {
            batchExistingRecords.classList.add('hidden');
            batchExistingRecords.innerHTML = '';
            return;
        }
        const previews = records.slice(0, 3).map(record => {
            const detail = record.lesson_content || record.description || '수업 내용 미입력';
            return `<li><strong>${escapeHtml(record.student_name)}</strong> · ${escapeHtml(record.book_title)}<span>${escapeHtml(detail)}</span></li>`;
        }).join('');
        const more = records.length > 3 ? `<p class="batch-records-more">외 ${records.length - 3}건</p>` : '';
        batchExistingRecords.innerHTML = `<div><strong><i class="fa-solid fa-circle-info"></i> ${date} 기존 학습 기록 ${records.length}건</strong><p>동일 날짜에도 필요하면 추가 등록할 수 있습니다.</p></div><ul>${previews}</ul>${more}`;
        batchExistingRecords.classList.remove('hidden');
    }

    function handleBatchDateChange() {
        const month = getBatchMonth(batchStudiedDay?.value);
        if (month !== batchCalendarMonth) loadBatchStudylogCalendar(month);
        else { renderBatchStudylogCalendar(); showBatchExistingRecords(batchStudiedDay?.value || ''); }
    }

    function changeBatchCalendarMonth(offset) {
        const [year, month] = (batchCalendarMonth || getBatchMonth()).split('-').map(Number);
        const date = new Date(year, month - 1 + offset, 1);
        loadBatchStudylogCalendar(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }

    function resetBatchRegView() {
        activeBatchClassId = null;
        if (classBatchInfo) classBatchInfo.classList.add('hidden');
        if (classBatchRegCard) classBatchRegCard.classList.add('hidden');
        if (classBatchResult) classBatchResult.classList.add('hidden');
        if (classBatchStudentsBody) classBatchStudentsBody.innerHTML = '';
        batchCalendarDays = {};
        batchCalendarMonth = '';
        if (batchCalendarGrid) { batchCalendarGrid.innerHTML = ''; batchCalendarGrid.classList.add('hidden'); }
        if (batchExistingRecords) { batchExistingRecords.innerHTML = ''; batchExistingRecords.classList.add('hidden'); }
        if (batchCalendarStatus) { batchCalendarStatus.textContent = '수업을 선택하면 기존 학습 이력을 불러옵니다.'; batchCalendarStatus.className = 'batch-calendar-status'; }
        const bId = document.getElementById('batch-book-id');
        const bDisp = document.getElementById('batch-book-display');
        const bPrev = document.getElementById('preview-batch-book');
        if (bId) bId.value = '';
        if (bDisp) bDisp.value = '';
        if (bPrev) { bPrev.innerHTML = ''; bPrev.classList.add('hidden'); }
    }

    // 일괄 학습 기록 등록 제출 (단일 학습 일자 + 수업 내용 메모, 학생별로는 참석 여부·특강 여부)
    async function handleBatchStudyLogSubmit(e) {
        e.preventDefault();
        if (classBatchResult) classBatchResult.classList.add('hidden');
        if (!activeBatchClassId) { alert('먼저 수업을 선택해 주세요.'); return; }
        const bookIdEl = document.getElementById('batch-book-id');
        const bookId = bookIdEl ? parseInt(bookIdEl.value || '0') : 0;
        if (!bookId || bookId <= 0) {
            classBatchResult.className = 'alert alert-danger';
            classBatchResult.textContent = '도서를 선택해 주세요.';
            classBatchResult.classList.remove('hidden');
            return;
        }
        const dateVal = batchStudiedDay ? batchStudiedDay.value : '';
        if (!dateVal) {
            classBatchResult.className = 'alert alert-danger';
            classBatchResult.textContent = '학습 일자를 입력해 주세요.';
            classBatchResult.classList.remove('hidden');
            return;
        }
        const descEl = document.getElementById('batch-description');
        const desc = descEl ? descEl.value.trim() : '';
        const contentEl = document.getElementById('batch-lesson-content');
        const content = contentEl ? contentEl.value.trim() : '';

        const logs = [];
        document.querySelectorAll('.batch-attend').forEach(chk => {
            const sid = parseInt(chk.getAttribute('data-student-id'));
            const specialEl = document.querySelector(`.batch-special[data-student-id="${sid}"]`);
            logs.push({ StudentId: sid, include: chk.checked, is_special: specialEl ? specialEl.checked : false });
        });
        if (logs.length === 0) {
            classBatchResult.className = 'alert alert-danger';
            classBatchResult.textContent = '등록할 학생이 없습니다.';
            classBatchResult.classList.remove('hidden');
            return;
        }
        try {
            const result = await apiFetch(`/api/user/classes/${activeBatchClassId}/studylogs`, {
                method: 'POST',
                body: JSON.stringify({ BookId: bookId, StudiedDay: dateVal, LessonContent: content, Description: desc, logs: logs })
            });
            let resList = '';
            (result.results || []).forEach(r => {
                const statusClass = BATCH_STATUS_CLASS[r.status] || '';
                const icon = BATCH_STATUS_ICON[r.status] || 'fa-circle-info';
                resList += `<div class="res-row"><span>${escapeHtml(r.Name || `학생 #${r.StudentId}`)}</span><span class="${statusClass}"><i class="fa-solid ${icon}"></i> ${escapeHtml(r.message || '')}</span></div>`;
            });
            classBatchResult.className = 'alert alert-success';
            classBatchResult.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(result.message)}${resList ? `<div class="class-batch-result-list">${resList}</div>` : ''}`;
            classBatchResult.classList.remove('hidden');
            // 도서 선택 초기화 (연속 등록 편의)
            const bId = document.getElementById('batch-book-id');
            const bDisp = document.getElementById('batch-book-display');
            const bPrev = document.getElementById('preview-batch-book');
            if (bId) bId.value = '';
            if (bDisp) bDisp.value = '';
            if (bPrev) { bPrev.innerHTML = ''; bPrev.classList.add('hidden'); }
            loadBatchStudylogCalendar(getBatchMonth(dateVal));
        } catch (err) {
            classBatchResult.className = 'alert alert-danger';
            classBatchResult.textContent = err.message;
            classBatchResult.classList.remove('hidden');
        }
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // --- 월말 보고 문자 양식 자동 생성 로직 ---
    function getKoreanNameWithYi(name) {
        if (!name || name.length === 0) return '';
        const lastChar = name.charCodeAt(name.length - 1);
        if (lastChar >= 0xAC00 && lastChar <= 0xD7A3) {
            const hasPatchim = (lastChar - 0xAC00) % 28 > 0;
            return hasPatchim ? name + '이' : name;
        }
        return name;
    }

    function formatDateKorean(studiedDay) {
        if (!studiedDay) return '';
        const cleanDate = String(studiedDay).trim().split('T')[0].split(' ')[0];
        const parts = cleanDate.replace(/\./g, '-').replace(/\//g, '-').split('-');
        if (parts.length >= 3) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const d = parseInt(parts[2], 10);
            if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                const dateObj = new Date(y, m - 1, d);
                const daysKr = ['일', '월', '화', '수', '목', '금', '토'];
                const dow = daysKr[dateObj.getDay()];
                return `${m}/${d}(${dow})`;
            }
        }
        return studiedDay;
    }

    function generateMonthlyReportText() {
        const studentSelect = document.getElementById('monthly-report-student-select');
        const periodLabelInput = document.getElementById('monthly-report-period-label');
        const monthLabelInput = document.getElementById('monthly-report-month-label');
        const startLectureInput = document.getElementById('monthly-report-start-lecture');
        const specialTeacherInput = document.getElementById('monthly-report-special-teacher');
        const resultTextarea = document.getElementById('monthly-report-result-text');

        if (!resultTextarea) return;

        let studentName = '';
        if (studentSelect && studentSelect.selectedIndex >= 0) {
            const selectedOpt = studentSelect.options[studentSelect.selectedIndex];
            if (selectedOpt && selectedOpt.value) {
                const text = selectedOpt.text;
                studentName = text.split(' (')[0].trim();
            }
        }

        const periodLabel = periodLabelInput ? periodLabelInput.value.trim() : '';
        const reportMonth = monthLabelInput ? monthLabelInput.value.trim() : `${new Date().getMonth() + 1}월`;
        let startLectureNum = startLectureInput ? parseInt(startLectureInput.value, 10) : 1;
        if (isNaN(startLectureNum) || startLectureNum < 1) startLectureNum = 1;

        let specialTeacherName = specialTeacherInput ? specialTeacherInput.value.trim() : '';

        const container = document.getElementById('monthly-report-logs-container');
        const checkedLogItems = [];

        if (container) {
            const itemRows = container.querySelectorAll('.report-log-item');
            itemRows.forEach(row => {
                const chk = row.querySelector('.chk-log-include');
                if (chk && chk.checked) {
                    const logIndex = parseInt(row.getAttribute('data-index'), 10);
                    if (!isNaN(logIndex) && currentMonthlyLogs[logIndex]) {
                        checkedLogItems.push(currentMonthlyLogs[logIndex]);
                    }
                }
            });
        }

        if (!studentName && checkedLogItems.length === 0) {
            resultTextarea.value = '';
            return;
        }

        // 선택된 기록들은 문자에 작성할 때 날짜 오름차순(StudiedDay ASC)으로 정렬하여 <N강> 번호 부여
        checkedLogItems.sort((a, b) => {
            const dayA = String(a.StudiedDay || a.studied_day || '');
            const dayB = String(b.StudiedDay || b.studied_day || '');
            if (dayA < dayB) return -1;
            if (dayA > dayB) return 1;
            const idA = a.row_id || a.Id || 0;
            const idB = b.row_id || b.Id || 0;
            return idA - idB;
        });

        const nameYi = getKoreanNameWithYi(studentName);
        const lines = [];
        lines.push(`${nameYi} 어머니`);
        lines.push('안녕하세요');

        if (periodLabel && reportMonth) {
            lines.push(`${periodLabel}중 ${reportMonth} 수업보고드립니다^^`);
        } else if (reportMonth) {
            lines.push(`${reportMonth} 수업보고드립니다^^`);
        } else if (periodLabel) {
            lines.push(`${periodLabel} 수업보고드립니다^^`);
        } else {
            lines.push('수업보고드립니다^^');
        }

        lines.push('');

        let currentLecture = startLectureNum;
        let teacherSuffix = specialTeacherName;
        if (teacherSuffix && !teacherSuffix.endsWith('선생님')) {
            teacherSuffix += ' 선생님';
        }

        checkedLogItems.forEach((log, idx) => {
            if (idx > 0) {
                lines.push('');
            }

            const isSpecial = !!(log.IsSpecial || log.is_special);
            if (isSpecial) {
                if (teacherSuffix) {
                    lines.push(`<특강> ${teacherSuffix}`);
                } else {
                    lines.push('<특강>');
                }
            } else {
                lines.push(`<${currentLecture}강>`);
                currentLecture++;
            }

            const bookTitle = (log.BookTitle || log.book_title || log.Title || '').trim();
            lines.push(`도서 : ${bookTitle}`);

            const dateStr = formatDateKorean(log.StudiedDay || log.studied_day || '');
            const lessonContent = (log.LessonContent || log.lesson_content || log.Description || '').trim();
            if (dateStr && lessonContent) {
                lines.push(`${dateStr} ${lessonContent}`);
            } else if (dateStr) {
                lines.push(`${dateStr}`);
            } else if (lessonContent) {
                lines.push(`${lessonContent}`);
            }
        });

        resultTextarea.value = lines.join('\n');
    }

    async function loadMonthlyReportLogs() {
        const studentSelect = document.getElementById('monthly-report-student-select');
        const container = document.getElementById('monthly-report-logs-container');

        if (!studentSelect || !container) return;

        const studentId = studentSelect.value;
        if (!studentId) {
            showToast('학생을 선택해 주세요.', 'warning');
            return;
        }

        container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 학습 기록 불러오는 중...</div>';
        currentMonthlyLogs = [];

        try {
            const res = await apiFetch(`/api/user/monthly-report/studylogs?student_id=${studentId}`);
            currentMonthlyLogs = res.logs || []; // 최신순(StudiedDay DESC) 반환

            if (currentMonthlyLogs.length === 0) {
                container.innerHTML = `
                    <div class="empty-state-sm">
                        <i class="fa-solid fa-folder-open"></i>
                        <p>해당 학생의 등록된 학습 기록이 없습니다.</p>
                    </div>
                `;
                generateMonthlyReportText();
                return;
            }

            let html = '';
            currentMonthlyLogs.forEach((log, idx) => {
                const isSpecial = !!(log.IsSpecial || log.is_special);
                const dateStr = formatDateKorean(log.StudiedDay);
                const bookTitle = escapeHtml(log.BookTitle || '도서 제목 미입력');
                const lessonContent = escapeHtml(log.LessonContent || log.Description || '수업 내용 미입력');
                const specialBadge = isSpecial
                    ? '<span class="tag-badge warning">특강</span>'
                    : '<span class="tag-badge primary">일반강의</span>';

                html += `
                    <div class="report-log-item" data-index="${idx}">
                        <input type="checkbox" class="chk-log-include" id="chk-log-${idx}">
                        <div class="report-log-info">
                            <div class="report-log-header">
                                <span class="report-log-date">${dateStr}</span>
                                ${specialBadge}
                            </div>
                            <div class="report-log-book">도서: ${bookTitle}</div>
                            <div class="report-log-content">${lessonContent}</div>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;

            container.querySelectorAll('.chk-log-include').forEach(chk => {
                chk.addEventListener('change', () => generateMonthlyReportText());
            });
            container.querySelectorAll('.report-log-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.tagName !== 'INPUT') {
                        const chk = item.querySelector('.chk-log-include');
                        if (chk) {
                            chk.checked = !chk.checked;
                            generateMonthlyReportText();
                        }
                    }
                });
            });

            generateMonthlyReportText();

        } catch (err) {
            container.innerHTML = `<div class="alert alert-danger">학습 기록 로딩 실패: ${err.message}</div>`;
        }
    }

    async function loadMonthlyReportStudentOptions(selectedStudentId) {
        const select = document.getElementById('monthly-report-student-select');
        if (!select) return;
        try {
            const data = await apiFetch('/api/user/students-options');
            const students = data.students || [];
            if (students.length === 0) {
                select.innerHTML = '<option value="">등록된 학생이 없습니다</option>';
                return;
            }
            let html = '<option value="">-- 학생을 선택하세요 --</option>';
            students.forEach(s => {
                const sId = s.row_id || s.Id;
                const name = escapeHtml(s.Name || '이름 없음');
                const sex = formatSex(s.Sex);
                html += `<option value="${sId}">${name} (${sex}) - 학년 ${formatGrade(s.Grade)}, 추천 ${s.Referrer ? formatReferrer(s.Referrer) : '미입력'} [#${sId}]</option>`;
            });
            select.innerHTML = html;
            if (selectedStudentId) {
                select.value = selectedStudentId;
            }
        } catch (err) {
            select.innerHTML = `<option value="">학생 로딩 실패: ${err.message}</option>`;
        }
    }

    async function initMonthlyReportView(preselectStudentId) {
        const periodLabelInput = document.getElementById('monthly-report-period-label');
        const monthLabelInput = document.getElementById('monthly-report-month-label');
        const startLectureInput = document.getElementById('monthly-report-start-lecture');

        if (periodLabelInput) {
            periodLabelInput.value = '';
        }

        if (monthLabelInput && !monthLabelInput.value) {
            const now = new Date();
            const m = now.getMonth() + 1;
            monthLabelInput.value = `${m}월`;
        }

        if (startLectureInput && !startLectureInput.value) {
            startLectureInput.value = '1';
        }

        await loadMonthlyReportStudentOptions(preselectStudentId);

        // 수업 종료 학생은 students-options(기본 exclude)에 없으므로,
        // 상세 모달에서 넘어온 preselectStudentId가 셀렉트에 없으면
        // 해당 학생을 직접 조회해 "(수업 종료)" 옵션으로 추가한다.
        if (preselectStudentId) {
            const select = document.getElementById('monthly-report-student-select');
            if (select && select.value !== String(preselectStudentId)) {
                try {
                    const data = await apiFetch(`/api/user/students/${preselectStudentId}`);
                    const s = data.student;
                    const sId = s.row_id || s.Id;
                    const opt = document.createElement('option');
                    opt.value = String(sId);
                    opt.textContent = `${s.Name || '이름 없음'} (${formatSex(s.Sex)}) - 학년 ${formatGrade(s.Grade)}, 추천 ${s.Referrer ? formatReferrer(s.Referrer) : '미입력'} (수업 종료) [#${sId}]`;
                    select.appendChild(opt);
                    select.value = String(sId);
                } catch (e) {
                    /* 조용히 무시 */
                }
            }
        }

        if (preselectStudentId) {
            await loadMonthlyReportLogs();
        }
    }

    // Attach Monthly Report Control Listeners
    const btnFetchMonthlyLogs = document.getElementById('btn-fetch-monthly-logs');
    if (btnFetchMonthlyLogs) {
        btnFetchMonthlyLogs.addEventListener('click', () => loadMonthlyReportLogs());
    }

    const studentSelectEl = document.getElementById('monthly-report-student-select');
    if (studentSelectEl) {
        studentSelectEl.addEventListener('change', () => {
            if (studentSelectEl.value) {
                loadMonthlyReportLogs();
            } else {
                generateMonthlyReportText();
            }
        });
    }

    const ymInputEl = document.getElementById('monthly-report-year-month');
    const monthLabelEl = document.getElementById('monthly-report-month-label');
    if (ymInputEl) {
        ymInputEl.addEventListener('change', () => {
            if (ymInputEl.value) {
                const parts = ymInputEl.value.split('-');
                if (parts.length >= 2 && monthLabelEl) {
                    monthLabelEl.value = `${parseInt(parts[1], 10)}월`;
                }
                if (studentSelectEl && studentSelectEl.value) {
                    loadMonthlyReportLogs();
                } else {
                    generateMonthlyReportText();
                }
            }
        });
    }

    ['monthly-report-period-label', 'monthly-report-month-label', 'monthly-report-start-lecture', 'monthly-report-special-teacher'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => generateMonthlyReportText());
        }
    });

    const btnMonthlySelectAll = document.getElementById('btn-monthly-select-all');
    if (btnMonthlySelectAll) {
        btnMonthlySelectAll.addEventListener('click', () => {
            const container = document.getElementById('monthly-report-logs-container');
            if (container) {
                container.querySelectorAll('.chk-log-include').forEach(chk => chk.checked = true);
                generateMonthlyReportText();
            }
        });
    }

    const btnMonthlyDeselectAll = document.getElementById('btn-monthly-deselect-all');
    if (btnMonthlyDeselectAll) {
        btnMonthlyDeselectAll.addEventListener('click', () => {
            const container = document.getElementById('monthly-report-logs-container');
            if (container) {
                container.querySelectorAll('.chk-log-include').forEach(chk => chk.checked = false);
                generateMonthlyReportText();
            }
        });
    }

    const btnCopyMonthlyReport = document.getElementById('btn-copy-monthly-report');
    if (btnCopyMonthlyReport) {
        btnCopyMonthlyReport.addEventListener('click', () => {
            const textarea = document.getElementById('monthly-report-result-text');
            if (!textarea || !textarea.value.trim()) {
                showToast('복사할 문자 내용이 없습니다.', 'warning');
                return;
            }
            navigator.clipboard.writeText(textarea.value).then(() => {
                showToast('월말 보고 문자가 클립보드에 복사되었습니다!', 'success');
            }).catch(err => {
                textarea.select();
                document.execCommand('copy');
                showToast('월말 보고 문자가 클립보드에 복사되었습니다!', 'success');
            });
        });
    }

    // --- 감사 로그(변경 이력) 조회 (Admin Only) ---
    let auditLogPage = 1;
    let auditLogLimit = 30;
    let auditLogTotalPages = 1;
    let auditUserOptionsLoaded = false;

    const auditFilterUsername = document.getElementById('audit-filter-username');
    const auditFilterDateFrom = document.getElementById('audit-filter-date-from');
    const auditFilterDateTo = document.getElementById('audit-filter-date-to');
    const auditFilterTable = document.getElementById('audit-filter-table');
    const auditLogBody = document.getElementById('audit-log-body');
    const auditLogTotalCount = document.getElementById('audit-log-total-count');
    const auditLogPaginationInfo = document.getElementById('audit-log-pagination-info');
    const auditLogCurrentPage = document.getElementById('audit-log-current-page');
    const btnAuditLogPrev = document.getElementById('btn-audit-log-prev');
    const btnAuditLogNext = document.getElementById('btn-audit-log-next');
    const btnDoAuditSearch = document.getElementById('btn-do-audit-search');
    const btnResetAuditFilter = document.getElementById('btn-reset-audit-filter');
    const modalAuditDetail = document.getElementById('modal-audit-detail');
    const modalAuditDetailBody = document.getElementById('modal-audit-detail-body');
    const btnCloseAuditDetail = document.getElementById('btn-close-audit-detail');

    const AUDIT_TABLE_LABELS = {
        Books: '도서', Students: '학생', StudyLogs: '학습 기록', Classes: '수업', _app_users: '계정'
    };
    const AUDIT_ACTION_LABELS = { INSERT: '등록', UPDATE: '수정', DELETE: '삭제' };
    const AUDIT_ACTION_CLASSES = {
        INSERT: 'audit-action-insert', UPDATE: 'audit-action-update', DELETE: 'audit-action-delete'
    };
    const AUDIT_META_FIELDS = ['row_id', 'CreatedBy', 'UpdatedBy', 'UpdatedAt', 'password_hash'];

    function applyAuditFilterFromUrl() {
        const params = new URLSearchParams(location.search);
        auditFilterUsername.value = params.get('username') || '';
        auditFilterDateFrom.value = params.get('date_from') || '';
        auditFilterDateTo.value = params.get('date_to') || '';
        auditFilterTable.value = params.get('table_name') || '';
        const actionParam = params.get('action');
        document.querySelectorAll('.audit-filter-action').forEach(cb => {
            cb.checked = !actionParam || actionParam.split(',').includes(cb.value);
        });
        const page = parseInt(params.get('page'), 10);
        auditLogPage = page > 0 ? page : 1;
    }

    async function loadAuditUserOptions() {
        if (auditUserOptionsLoaded) return;
        try {
            const data = await apiFetch('/api/admin/audit-logs/users');
            const users = data.users || [];
            const current = auditFilterUsername.value;
            let opts = '<option value="">전체 계정</option>';
            users.forEach(u => {
                opts += `<option value="${escapeHtml(u.username)}">${escapeHtml(u.username)}</option>`;
            });
            auditFilterUsername.innerHTML = opts;
            if (current) auditFilterUsername.value = current;
            auditUserOptionsLoaded = true;
        } catch (err) {
            /* 계정 목록 로드 실패는 치명적이지 않음 */
        }
    }

    async function loadAuditLogs() {
        const params = new URLSearchParams();
        params.set('page', auditLogPage);
        params.set('limit', auditLogLimit);
        if (auditFilterUsername.value) params.set('username', auditFilterUsername.value);
        if (auditFilterDateFrom.value) params.set('date_from', auditFilterDateFrom.value);
        if (auditFilterDateTo.value) params.set('date_to', auditFilterDateTo.value);
        if (auditFilterTable.value) params.set('table_name', auditFilterTable.value);
        const actions = [...document.querySelectorAll('.audit-filter-action:checked')].map(cb => cb.value);
        if (actions.length) params.set('action', actions.join(','));

        const urlParams = new URLSearchParams(params.toString());
        history.replaceState(null, '', `${location.pathname}?${urlParams.toString()}`);

        try {
            auditLogBody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>변경 이력 로딩 중...</p></td></tr>';
            const data = await apiFetch(`/api/admin/audit-logs?${params.toString()}`);
            renderAuditLogs(data);
        } catch (err) {
            auditLogBody.innerHTML = `<tr><td colspan="6" class="empty-state"><p class="alert alert-danger">${err.message}</p></td></tr>`;
        }
    }

    function renderAuditLogs(data) {
        auditLogTotalPages = data.total_pages || 1;
        auditLogTotalCount.textContent = `총 ${data.total_count} 건의 변경 이력`;
        auditLogPaginationInfo.textContent = `${data.page} / ${auditLogTotalPages} 페이지`;
        auditLogCurrentPage.textContent = data.page;
        btnAuditLogPrev.disabled = data.page <= 1;
        btnAuditLogNext.disabled = data.page >= auditLogTotalPages;

        const logs = data.logs || [];
        if (logs.length === 0) {
            auditLogBody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fa-solid fa-magnifying-glass fa-2x"></i><p>조건에 해당하는 변경 이력이 없습니다.</p></td></tr>';
            return;
        }

        let html = '';
        logs.forEach((log, idx) => {
            const tableLabel = AUDIT_TABLE_LABELS[log.table_name] || log.table_name;
            const actionLabel = AUDIT_ACTION_LABELS[log.action] || log.action;
            const actionClass = AUDIT_ACTION_CLASSES[log.action] || '';
            let summary = '';
            if (log.action === 'INSERT') {
                summary = '신규 등록';
            } else if (log.action === 'DELETE') {
                summary = '행 삭제';
            } else {
                const changed = (log.changed_fields || []).filter(f => !AUDIT_META_FIELDS.includes(f));
                summary = changed.length
                    ? changed.map(escapeHtml).join(', ') + ' 변경'
                    : '내용 변경';
            }
            html += `
                <tr class="audit-log-row" data-audit-index="${idx}" style="cursor: pointer;">
                    <td class="text-nowrap">${escapeHtml(log.created_at || '-')}</td>
                    <td><strong>${escapeHtml(log.username)}</strong></td>
                    <td>${escapeHtml(tableLabel)}</td>
                    <td>#${escapeHtml(log.record_id || '-')}</td>
                    <td><span class="audit-action-badge ${actionClass}">${actionLabel}</span></td>
                    <td>${summary}</td>
                </tr>`;
        });
        auditLogBody.innerHTML = html;

        auditLogBody.querySelectorAll('.audit-log-row').forEach(row => {
            row.addEventListener('click', () => {
                const log = logs[parseInt(row.getAttribute('data-audit-index'), 10)];
                openAuditDetailModal(log);
            });
        });
    }

    function renderAuditJsonTable(data, changedSet) {
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            return '<div class="text-muted" style="padding: 0.5rem 0;">기록된 데이터가 없습니다.</div>';
        }
        const rows = Object.entries(data)
            .filter(([k]) => !['row_id', 'password_hash'].includes(k))
            .map(([k, v]) => {
                let val = v;
                if (v === null || v === undefined) val = '';
                else if (typeof v === 'object') val = JSON.stringify(v);
                const cls = changedSet && changedSet.has(k) ? ' class="audit-changed-row"' : '';
                return `<tr${cls}><td class="audit-key-cell">${escapeHtml(k)}</td><td>${escapeHtml(String(val))}</td></tr>`;
            }).join('');
        return `<table class="modern-table audit-json-table"><tbody>${rows}</tbody></table>`;
    }

    function openAuditDetailModal(log) {
        const tableLabel = AUDIT_TABLE_LABELS[log.table_name] || log.table_name;
        const actionLabel = AUDIT_ACTION_LABELS[log.action] || log.action;
        const actionClass = AUDIT_ACTION_CLASSES[log.action] || '';
        const changedSet = new Set(
            (log.changed_fields || []).filter(f => !AUDIT_META_FIELDS.includes(f))
        );

        let sections = '';
        if (log.action === 'DELETE') {
            sections += `<div class="audit-section">
                <h4><i class="fa-solid fa-trash-can"></i> 삭제 전 데이터</h4>
                ${renderAuditJsonTable(log.old_data, null)}
            </div>`;
        } else if (log.action === 'INSERT') {
            sections += `<div class="audit-section">
                <h4><i class="fa-solid fa-plus"></i> 등록된 데이터</h4>
                ${renderAuditJsonTable(log.new_data, null)}
            </div>`;
        } else {
            sections += `<div class="audit-section">
                <h4><i class="fa-solid fa-arrow-right-arrow-left"></i> 변경 전</h4>
                ${renderAuditJsonTable(log.old_data, changedSet)}
            </div>
            <div class="audit-section">
                <h4><i class="fa-solid fa-arrow-right-arrow-left"></i> 변경 후</h4>
                ${renderAuditJsonTable(log.new_data, changedSet)}
            </div>`;
        }

        modalAuditDetailBody.innerHTML = `
            <div class="audit-detail-meta">
                <div><span class="text-muted">일시:</span> ${escapeHtml(log.created_at || '-')}</div>
                <div><span class="text-muted">계정:</span> <strong>${escapeHtml(log.username)}</strong> <span class="role-pill ${escapeHtml(log.user_role || '')}">${escapeHtml(log.user_role || '')}</span></div>
                <div><span class="text-muted">대상:</span> ${escapeHtml(tableLabel)} (레코드 #${escapeHtml(log.record_id || '-')})</div>
                <div><span class="text-muted">액션:</span> <span class="audit-action-badge ${actionClass}">${actionLabel}</span></div>
            </div>
            ${sections}`;
        modalAuditDetail.classList.remove('hidden');
    }

    if (btnDoAuditSearch) {
        btnDoAuditSearch.addEventListener('click', () => {
            auditLogPage = 1;
            loadAuditLogs();
        });
    }
    if (btnResetAuditFilter) {
        btnResetAuditFilter.addEventListener('click', () => {
            auditFilterUsername.value = '';
            auditFilterDateFrom.value = '';
            auditFilterDateTo.value = '';
            auditFilterTable.value = '';
            document.querySelectorAll('.audit-filter-action').forEach(cb => { cb.checked = true; });
            auditLogPage = 1;
            loadAuditLogs();
        });
    }
    if (btnAuditLogPrev) {
        btnAuditLogPrev.addEventListener('click', () => {
            if (auditLogPage > 1) { auditLogPage--; loadAuditLogs(); }
        });
    }
    if (btnAuditLogNext) {
        btnAuditLogNext.addEventListener('click', () => {
            if (auditLogPage < auditLogTotalPages) { auditLogPage++; loadAuditLogs(); }
        });
    }
    if (btnCloseAuditDetail) {
        btnCloseAuditDetail.addEventListener('click', () => modalAuditDetail.classList.add('hidden'));
    }
    if (modalAuditDetail) {
        modalAuditDetail.addEventListener('click', (e) => {
            if (e.target === modalAuditDetail) modalAuditDetail.classList.add('hidden');
        });
    }
});
