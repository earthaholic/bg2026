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

    // 도서 검색의 "미학습 학생" 필터: key는 Students.rowid
    const bookUnstudiedStudents = new Map();
    let bookStudentSearchTimer = null;

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
    let batchCalendarDays = {}; // 월(YYYY-MM)별 날짜 학습 이력
    let batchCalendarCancellations = {}; // 월(YYYY-MM)별 휴강 일정
    let activeBookPickerTarget = 'studylog'; // 도서 picker 대상 ('studylog' | 'batch')
    const selectedBatchBooks = new Map();
    let activeStudentPickerTarget = 'studylog'; // 학생 picker 대상 ('studylog' | 'monthly')
    let selectedStudentsMap = new Map(); // 새 학습 기록 등록용 학생 다중 선택 Map (id -> studentObj)
    let currentMonthlyLogs = []; // 월말보고용 로드된 학습 기록 목록
    let payrollTeacherOptions = [];
    const payrollSelectedSessions = new Map();
    const payrollClaimsById = new Map();
    let payrollEditingClaimTeacher = '';
    let duplicateBooksPreviewData = null;

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
    const filterChkAdvanced = document.getElementById('filter-chk-advanced');
    const filterChkDebate = document.getElementById('filter-chk-debate');
    const filterChkPaperbook = document.getElementById('filter-chk-paperbook');
    const filterChkYes24 = document.getElementById('filter-chk-yes24');
    const filterChkMillie = document.getElementById('filter-chk-millie');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const bookStudyStudentQ = document.getElementById('book-study-student-q');
    const bookStudyClassSelect = document.getElementById('book-study-class-select');
    const bookStudyStudentResults = document.getElementById('book-study-student-results');
    const bookStudyStudentChips = document.getElementById('book-study-student-chips');

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

    const modalStudentConsultations = document.getElementById('modal-student-consultations');
    const modalStudentConsultationsTitle = document.getElementById('modal-student-consultations-title');
    const modalStudentConsultationsBody = document.getElementById('modal-student-consultations-body');
    const btnCloseStudentConsultationsModal = document.getElementById('btn-close-student-consultations-modal');

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

    // Tuition Payment Detail Modal Elements
    const modalTuitionDetail = document.getElementById('modal-tuition-detail');
    const modalTuitionDetailTitle = document.getElementById('modal-tuition-detail-title');
    const modalTuitionDetailActions = document.getElementById('modal-tuition-detail-actions');
    const modalTuitionDetailBody = document.getElementById('modal-tuition-detail-body');
    const btnCloseTuitionDetail = document.getElementById('btn-close-tuition-detail');

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
    const batchIsCancelled = document.getElementById('batch-is-cancelled');
    const batchCancellationSection = document.getElementById('batch-cancellation-section');
    const btnSubmitClassBatch = document.getElementById('btn-submit-class-batch');

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
    const STAFF_ONLY_VIEWS = ['student-reg', 'book-reg', 'class-reg', 'class-rate-settings', 'tuition-payment', 'tuition-payment-search', 'tuition-fee-settings', 'book-material-review', 'book-material-rates', 'utilities'];
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
                await loadBookStudyClassOptions();
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
        document.querySelectorAll('[data-view="book-material-request"]').forEach(el => el.classList.toggle('hidden', currentUser.role !== 'teacher'));

        // 일반 선생님은 로그인 직후 학습 기록 검색 화면에서 시작한다.
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
            loadStudyLogAssignmentOptions();
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
        } else if (targetView === 'class-rate-settings') {
            loadClassRateSettings();
        } else if (targetView === 'class-studylog-reg') {
            loadClassOptionsForBatch();
        } else if (targetView === 'monthly-report') {
            initMonthlyReportView();
        } else if (targetView === 'teacher-payroll') {
            initTeacherPayrollView();
        } else if (targetView === 'tuition-payment') {
            loadTuitionPaymentView();
        } else if (targetView === 'tuition-payment-search') {
            loadTuitionPaymentSearch();
        } else if (targetView === 'tuition-fee-settings') {
            loadTuitionFeeSettings();
        } else if (targetView === 'book-material-request') {
            loadBookMaterialRequests();
        } else if (targetView === 'book-material-review') {
            loadBookMaterialRequests(true);
        } else if (targetView === 'book-material-rates') {
            loadBookMaterialRates();
        } else if (targetView === 'utilities') {
            initUtilitiesView();
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
                await loadBookStudyClassOptions();
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

        const materialType = document.getElementById('material-request-type');
        const materialForm = document.getElementById('form-book-material-request');
        const materialRateForm = document.getElementById('form-book-material-rate');
        if (materialType) materialType.addEventListener('change', toggleMaterialRequestType);
        if (materialForm) materialForm.addEventListener('submit', submitBookMaterialRequest);
        if (materialRateForm) materialRateForm.addEventListener('submit', submitBookMaterialRate);

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
        [filterChkAdvanced, filterChkDebate, filterChkPaperbook, filterChkYes24, filterChkMillie].forEach(chk => chk.addEventListener('change', () => { searchPage = 1; loadBookSearchResults(); }));

        bookStudyStudentQ.addEventListener('input', () => {
            clearTimeout(bookStudentSearchTimer);
            bookStudentSearchTimer = setTimeout(loadBookStudyStudentCandidates, 200);
        });
        bookStudyClassSelect.addEventListener('change', async () => {
            const classId = bookStudyClassSelect.value;
            if (!classId) return;
            try {
                const data = await apiFetch(`/api/user/classes/${classId}`);
                (data.students || []).forEach(student => {
                    const id = String(student.row_id);
                    bookUnstudiedStudents.set(id, { id, name: student.Name || '', grade: student.Grade || '' });
                });
                renderBookUnstudiedStudents();
                searchPage = 1;
                await loadBookSearchResults();
            } catch (err) {
                alert(`수업 학생을 추가하지 못했습니다: ${err.message}`);
            } finally {
                bookStudyClassSelect.value = '';
            }
        });
        bookStudyStudentResults.addEventListener('click', (e) => {
            const button = e.target.closest('.book-study-student-result');
            if (!button) return;
            bookUnstudiedStudents.set(button.dataset.id, { id: button.dataset.id, name: button.dataset.name, grade: button.dataset.grade });
            bookStudyStudentQ.value = '';
            bookStudyStudentResults.innerHTML = '';
            bookStudyStudentResults.classList.add('hidden');
            renderBookUnstudiedStudents();
            searchPage = 1;
            loadBookSearchResults();
        });
        bookStudyStudentChips.addEventListener('click', (e) => {
            const button = e.target.closest('[data-remove-book-study-student]');
            if (!button) return;
            bookUnstudiedStudents.delete(button.dataset.removeBookStudyStudent);
            renderBookUnstudiedStudents();
            searchPage = 1;
            loadBookSearchResults();
        });

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
            [filterChkAdvanced, filterChkDebate, filterChkPaperbook, filterChkYes24, filterChkMillie].forEach(chk => { chk.checked = false; });
            bookUnstudiedStudents.clear();
            bookStudyStudentQ.value = '';
            bookStudyStudentResults.innerHTML = '';
            bookStudyStudentResults.classList.add('hidden');
            renderBookUnstudiedStudents();
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
        btnCloseStudentConsultationsModal.addEventListener('click', () => modalStudentConsultations.classList.add('hidden'));

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
                // 수업을 변경할 때 이전 수업의 입력값이 새 수업에 남지 않도록 초기화한다.
                resetBatchRegView();
                if (classId > 0) {
                    loadClassBatchForm(classId);
                }
            });
        }
        document.getElementById('form-class-category')?.addEventListener('submit', submitClassCategory);
        document.getElementById('form-class-pay-rate')?.addEventListener('submit', submitClassPayRate);
        document.getElementById('form-special-pay-rate')?.addEventListener('submit', submitSpecialPayRate);
        if (formClassBatchStudyLog) {
            formClassBatchStudyLog.addEventListener('submit', handleBatchStudyLogSubmit);
        }
        if (batchIsCancelled) batchIsCancelled.addEventListener('change', updateBatchRegistrationMode);
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

    const MATERIAL_FIELD_LABELS = { HasQuiz: '어휘 퀴즈', HasReadingQuestion: '독서 문제', HasReadingAnswer: '독서 답안', HasWritingQuestion: '글쓰기 문제', HasWritingAnswer: '글쓰기 답안', HasAdvancedMaterial: '심화 자료', HasDebateMaterial: '토론 자료', IsPdfExist: 'PDF 파일' };

    function toggleMaterialRequestType() {
        const isNew = document.getElementById('material-request-type').value === 'new_book';
        document.getElementById('material-existing-book-fields').classList.toggle('hidden', isNew);
        document.getElementById('material-new-book-fields').classList.toggle('hidden', !isNew);
    }

    function requestBookTitle(item) {
        return item.BookTitle || (item.BookData && item.BookData.Title) || '-';
    }

    async function submitBookMaterialRequest(e) {
        e.preventDefault();
        const msg = document.getElementById('book-material-request-msg');
        const requestType = document.getElementById('material-request-type').value;
        const fields = [...document.querySelectorAll('input[name="material-field"]:checked')].map(el => el.value);
        const payload = { RequestType: requestType, BookCategory: document.getElementById('material-book-category').value, MaterialFields: fields };
        if (requestType === 'new_book') {
            payload.BookData = { Title: document.getElementById('material-new-title').value.trim(), Author: document.getElementById('material-new-author').value.trim(), Publisher: document.getElementById('material-new-publisher').value.trim() };
        } else payload.BookId = Number(document.getElementById('material-book-id').value);
        try {
            const result = await apiFetch('/api/user/book-material-requests', { method: 'POST', body: JSON.stringify(payload) });
            msg.className = 'alert alert-success'; msg.textContent = result.message; msg.classList.remove('hidden');
            e.target.reset(); toggleMaterialRequestType(); await loadBookMaterialRequests();
        } catch (err) { msg.className = 'alert alert-danger'; msg.textContent = err.message; msg.classList.remove('hidden'); }
    }

    async function loadBookMaterialRequests(forReview = false) {
        const body = document.getElementById(forReview ? 'book-material-review-body' : 'book-material-request-body');
        if (!body) return;
        try {
            const data = await apiFetch('/api/user/book-material-requests');
            if (!data.requests.length) { body.innerHTML = `<tr><td colspan="${forReview ? 7 : 6}" class="text-center p-4">등록된 요청이 없습니다.</td></tr>`; return; }
            body.innerHTML = data.requests.map(item => {
                const fields = (item.MaterialFields || []).map(field => MATERIAL_FIELD_LABELS[field] || field).join(', ');
                const status = item.Status === 'pending' ? '대기' : item.Status === 'approved' ? '승인' : '반려';
                const details = item.Status === 'approved' ? `${item.ReviewedAt} · ${Number(item.ApprovedAmount || 0).toLocaleString()}원` : item.Status === 'rejected' ? item.RejectReason : '-';
                const review = item.Status === 'pending' ? `<button class="btn btn-xs btn-success btn-material-approve" data-id="${item.Id}">승인</button> <button class="btn btn-xs btn-danger btn-material-reject" data-id="${item.Id}">반려</button>` : details;
                return forReview ? `<tr><td>${escapeHtml(item.CreatedAt || '')}</td><td>${escapeHtml(item.RequestedBy)}</td><td>${escapeHtml(requestBookTitle(item))}</td><td>${escapeHtml(item.BookCategoryLabel)}</td><td>${escapeHtml(fields)}</td><td>${status}</td><td>${review}</td></tr>` : `<tr><td>${escapeHtml(item.CreatedAt || '')}</td><td>${escapeHtml(requestBookTitle(item))}</td><td>${escapeHtml(item.BookCategoryLabel)}</td><td>${escapeHtml(fields)}</td><td>${status}</td><td>${escapeHtml(details)}</td></tr>`;
            }).join('');
            if (forReview) {
                body.querySelectorAll('.btn-material-approve').forEach(btn => btn.addEventListener('click', () => reviewBookMaterialRequest(btn.dataset.id, 'approved')));
                body.querySelectorAll('.btn-material-reject').forEach(btn => btn.addEventListener('click', () => reviewBookMaterialRequest(btn.dataset.id, 'rejected')));
            }
        } catch (err) { body.innerHTML = `<tr><td colspan="7" class="text-center">${escapeHtml(err.message)}</td></tr>`; }
    }

    async function reviewBookMaterialRequest(id, status) {
        const RejectReason = status === 'rejected' ? window.prompt('반려 사유를 입력해 주세요.') : '';
        if (status === 'rejected' && !RejectReason) return;
        try { const result = await apiFetch(`/api/user/book-material-requests/${id}/review`, { method: 'POST', body: JSON.stringify({ Status: status, RejectReason }) }); showToast(result.message, 'success'); await loadBookMaterialRequests(true); }
        catch (err) { alert(err.message); }
    }

    async function submitBookMaterialRate(e) {
        e.preventDefault(); const msg = document.getElementById('book-material-rate-msg');
        try { const result = await apiFetch('/api/user/book-material-rates', { method: 'POST', body: JSON.stringify({ BookCategory: document.getElementById('material-rate-category').value, UnitAmount: Number(document.getElementById('material-rate-amount').value), EffectiveFrom: document.getElementById('material-rate-date').value }) }); msg.className = 'alert alert-success'; msg.textContent = result.message; msg.classList.remove('hidden'); await loadBookMaterialRates(); }
        catch (err) { msg.className = 'alert alert-danger'; msg.textContent = err.message; msg.classList.remove('hidden'); }
    }

    async function loadBookMaterialRates() {
        const body = document.getElementById('book-material-rate-body'); if (!body) return;
        try { const data = await apiFetch('/api/user/book-material-rates'); body.innerHTML = data.rates.length ? data.rates.map(rate => `<tr><td>${rate.BookCategory === 'picture' ? '그림책' : '일반 도서'}</td><td>${Number(rate.UnitAmount).toLocaleString()}원</td><td>${escapeHtml(rate.EffectiveFrom)}</td></tr>`).join('') : '<tr><td colspan="3" class="text-center p-4">설정된 단가가 없습니다.</td></tr>'; }
        catch (err) { body.innerHTML = `<tr><td colspan="3">${escapeHtml(err.message)}</td></tr>`; }
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
            School: (formData.get('School') || '').trim(),
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
            const referrerSearch = document.getElementById('student-referrer-search');
            const referrerResults = document.getElementById('student-referrer-results');
            const referrerSelected = document.getElementById('student-referrer-selected');
            if (referrerSearch) referrerSearch.value = '';
            if (referrerResults) { referrerResults.innerHTML = ''; referrerResults.classList.add('hidden'); }
            if (referrerSelected) referrerSelected.textContent = '추천 학생을 검색해 선택해 주세요. (선택사항)';
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
            if (activeStudentPickerTarget === 'studylog' && currentUser?.role === 'teacher' && !document.getElementById('studylog-class')?.value) {
                alert('담당 수업을 먼저 선택해 주세요.');
                return;
            }
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
            document.getElementById('batch-book-picker-footer')?.classList.toggle('hidden', activeBookPickerTarget !== 'batch');
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
            document.getElementById('studylog-tuition-progress')?.classList.add('hidden');
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

        if (e.target.closest('#btn-confirm-batch-books')) {
            updateSelectedBatchBooksUI();
            document.getElementById('modal-book-picker')?.classList.add('hidden');
            return;
        }
        renderStudylogTuitionProgress(students);
    }

    async function renderStudylogTuitionProgress(students) {
        const box = document.getElementById('studylog-tuition-progress');
        if (!box) return;
        if (!students.length) { box.classList.add('hidden'); return; }
        try {
            const progresses = await Promise.all(students.map(s => apiFetch(`/api/user/students/${s.id}/tuition-progress`)));
            box.className = 'alert alert-info';
            box.innerHTML = progresses.map((p, i) => p.has_payment
                ? `<div><strong>${escapeHtml(students[i].name)}</strong>: 총 ${p.total_lessons}회 중 <strong>${p.next_lesson}번째 수업</strong> 등록 · 등록 후 잔여 ${p.remaining_lessons - 1}회</div>`
                : `<div><strong>${escapeHtml(students[i].name)}</strong>: 유효한 결제 정보가 없습니다.</div>`).join('');
            box.classList.remove('hidden');
        } catch (_) { box.classList.add('hidden'); }
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
            const queryParams = new URLSearchParams();
            if (q) queryParams.set('q', q);
            if (activeStudentPickerTarget === 'studylog' && currentUser?.role === 'teacher') {
                const classId = document.getElementById('studylog-class')?.value;
                if (classId) queryParams.set('class_id', classId);
            }
            const data = await apiFetch(`/api/user/picker/students${queryParams.toString() ? '?' + queryParams.toString() : ''}`);
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
                const isBatchSelected = activeBookPickerTarget === 'batch' && selectedBatchBooks.has(String(bId));
                html += `
                    <div class="picker-item-row ${isBatchSelected ? 'selected' : ''}">
                        <div class="item-main">
                            <div class="item-title"><i class="fa-solid fa-book" style="color: var(--success);"></i> ${title}</div>
                            <div class="item-sub">저자: ${author} | 출판사: ${publisher} | 분야: ${subject} | ID: #${bId}</div>
                        </div>
                        <button type="button" class="btn btn-sm btn-success btn-select-book-picker"
                                data-id="${bId}" data-title="${title}" data-author="${author}" data-publisher="${publisher}">
                            <i class="fa-solid ${isBatchSelected ? 'fa-minus' : 'fa-check'}"></i> ${isBatchSelected ? '해제' : '선택'}
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

                    if (activeBookPickerTarget === 'batch') {
                        if (selectedBatchBooks.has(String(id))) selectedBatchBooks.delete(String(id));
                        else selectedBatchBooks.set(String(id), { id: Number(id), title, author, publisher });
                        updateBatchBookPickerCount();
                        loadPickerBooks();
                        return;
                    }

                    // 개별 학습 기록 등록 폼
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
        const classId = parseInt(document.getElementById('studylog-class')?.value || '0') || null;
        const actualTeacherUsername = document.getElementById('studylog-actual-teacher')?.value || '';
        const payrollCategoryId = parseInt(document.getElementById('studylog-payroll-category')?.value || '0') || null;
        if (currentUser?.role === 'teacher' && !classId) {
            if (userStudyLogMsg) {
                userStudyLogMsg.className = 'alert alert-danger';
                userStudyLogMsg.textContent = '담당 수업을 선택해 주세요.';
                userStudyLogMsg.classList.remove('hidden');
            }
            return;
        }
        if (!classId && payrollCategoryId && !actualTeacherUsername) {
            if (userStudyLogMsg) {
                userStudyLogMsg.className = 'alert alert-danger';
                userStudyLogMsg.textContent = '정산 카테고리를 지정하려면 실제 진행 선생님을 선택해 주세요.';
                userStudyLogMsg.classList.remove('hidden');
            }
            return;
        }

        const payload = {
            StudentIds: studentIds,
            StudentId: studentIds[0], // 하위 호환용
            BookId: bId,
            StudiedDay: dateVal,
            IsSpecial: isSpecial,
            LessonContent: content,
            Description: desc,
            ClassId: classId,
            PayrollCategoryId: classId ? null : payrollCategoryId,
            ActualTeacherUsername: actualTeacherUsername
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
                    <button id="btn-modal-edit-studylog" class="btn btn-sm btn-primary">
                        <i class="fa-solid fa-pen-to-square"></i> 수정
                    </button>
                    <button id="btn-modal-delete-studylog" class="btn btn-sm btn-danger">
                        <i class="fa-solid fa-trash-can"></i> 학습 기록 삭제
                    </button>
                `;
                document.getElementById('btn-modal-edit-studylog').addEventListener('click', () => {
                    renderStudyLogDetailEditForm(l, logId);
                });
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
            const studiedDay = String(l.StudiedDay || '').trim().split('T')[0].split(' ')[0];
            const studiedDayHtml = isStaff()
                ? `<div class="studylog-date-editor">
                    <label for="input-studylog-studied-day"><i class="fa-solid fa-calendar-check"></i> 학습 수행 일자</label>
                    <div class="studylog-date-editor-controls">
                        <input type="date" id="input-studylog-studied-day" class="form-control" value="${escapeHtml(studiedDay)}" required>
                        <button type="button" id="btn-save-studylog-studied-day" class="btn btn-sm btn-primary"><i class="fa-solid fa-floppy-disk"></i> 일자 저장</button>
                    </div>
                </div>`
                : `<span><i class="fa-solid fa-calendar-check"></i> 학습 수행 일자: <strong>${escapeHtml(l.StudiedDay || '미상')}</strong></span>`;

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
                        ${studiedDayHtml}
                        <span><i class="fa-solid fa-hashtag"></i> Log ID: <strong>#${l.row_id || l.Id}</strong></span>
                        <span><i class="fa-solid fa-chalkboard-user"></i> 실제 진행: <strong>${escapeHtml(l.ActualTeacherUsername || '미지정')}</strong></span>
                        <span><i class="fa-solid fa-users-rectangle"></i> 연결 수업: <strong>${escapeHtml(l.ClassName || '수업 없음')}</strong></span>
                        <span><i class="fa-solid fa-tag"></i> 정산 카테고리: <strong>${escapeHtml(l.PayrollCategoryName || '미지정')}</strong></span>
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

            const saveStudiedDayButton = document.getElementById('btn-save-studylog-studied-day');
            if (saveStudiedDayButton) {
                saveStudiedDayButton.addEventListener('click', async () => {
                    const input = document.getElementById('input-studylog-studied-day');
                    const newStudiedDay = input.value;
                    if (!newStudiedDay) {
                        showToast('학습 수행 일자를 선택해 주세요.', 'warning');
                        return;
                    }
                    try {
                        saveStudiedDayButton.disabled = true;
                        await apiFetch(`/api/user/studylogs/${l.row_id || l.Id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ data: { StudiedDay: newStudiedDay } })
                        });
                        showToast('학습 수행 일자를 수정했습니다.', 'success');
                        await openStudyLogDetailModal(l.row_id || l.Id);
                        await loadStudyLogSearchResults();
                        await loadRecentStudyLogs();
                    } catch (err) {
                        showToast(err.message, 'danger');
                        saveStudiedDayButton.disabled = false;
                    }
                });
            }
        } catch (err) {
            modalStudyLogDetailBody.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    function updateBatchBookPickerCount() {
        const count = document.getElementById('batch-book-picker-count');
        if (count) count.textContent = `${selectedBatchBooks.size}권 선택됨`;
    }

    function updateSelectedBatchBooksUI() {
        const books = Array.from(selectedBatchBooks.values());
        const idEl = document.getElementById('batch-book-id');
        const displayEl = document.getElementById('batch-book-display');
        const previewEl = document.getElementById('preview-batch-book');
        if (idEl) idEl.value = books.map(book => book.id).join(',');
        if (displayEl) displayEl.value = books.length ? `${books.length}권 선택됨` : '';
        if (!previewEl) return;
        if (!books.length) {
            previewEl.innerHTML = '';
            previewEl.classList.add('hidden');
            return;
        }
        previewEl.innerHTML = `<div class="selected-students-chips">${books.map(book => `
            <span class="student-chip"><i class="fa-solid fa-book"></i> ${escapeHtml(book.title)}
                <span class="btn-remove-batch-book btn-remove-chip" data-id="${book.id}" title="선택 삭제">&times;</span>
            </span>`).join('')}</div>`;
        previewEl.classList.remove('hidden');
        previewEl.querySelectorAll('.btn-remove-batch-book').forEach(btn => btn.addEventListener('click', () => {
            selectedBatchBooks.delete(btn.getAttribute('data-id'));
            updateSelectedBatchBooksUI();
            updateBatchBookPickerCount();
        }));
    }

    async function renderStudyLogDetailEditForm(log, logId) {
        const studiedDay = String(log.StudiedDay || '').trim().split('T')[0].split(' ')[0];
        modalStudyLogDetailTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> 학습 기록 수정';
        modalStudyLogDetailActions.innerHTML = '';
        modalStudyLogDetailBody.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 수정 항목을 불러오는 중...</div>';
        let classes = [];
        let teachers = [];
        let categories = [];
        try {
            const [classData, teacherData, categoryData] = await Promise.all([
                apiFetch('/api/user/classes?limit=100'),
                apiFetch('/api/user/teachers-options'),
                apiFetch('/api/user/payroll/categories')
            ]);
            classes = classData.classes || [];
            teachers = teacherData.teachers || [];
            categories = categoryData.categories || [];
        } catch (err) {
            modalStudyLogDetailBody.innerHTML = `<div class="alert alert-danger">수정 항목 로딩 실패: ${escapeHtml(err.message)}</div>`;
            return;
        }
        const classOptions = '<option value="">수업 없음</option>' + classes.map(cls =>
            `<option value="${cls.Id}" data-teacher="${escapeHtml(cls.TeacherUsername || '')}" ${Number(log.ClassId) === Number(cls.Id) ? 'selected' : ''}>${escapeHtml(cls.ClassName || '수업명 없음')} · ${escapeHtml(cls.TeacherUsername || '-')}</option>`
        ).join('');
        const teacherOptions = '<option value="">선택하지 않음</option>' + teachers.map(teacher =>
            `<option value="${escapeHtml(teacher.username)}" ${teacher.username === (log.ActualTeacherUsername || '') ? 'selected' : ''}>${escapeHtml(teacher.username)}</option>`
        ).join('');
        const categoryOptions = '<option value="">정산에 포함하지 않음</option>' + categories.map(category =>
            `<option value="${category.Id}" ${Number(log.PayrollCategoryId) === Number(category.Id) ? 'selected' : ''}>${escapeHtml(category.Name)}</option>`
        ).join('');
        modalStudyLogDetailBody.innerHTML = `
            <form id="form-edit-studylog-detail" class="modal-edit-form">
                <div class="detail-header-block">
                    <div class="detail-title">${escapeHtml(log.StudentName || '학생 미상')} · ${escapeHtml(log.BookTitle || '도서 미상')}</div>
                    <div class="detail-meta-row"><span><i class="fa-solid fa-hashtag"></i> Log ID: <strong>#${log.row_id || log.Id}</strong></span></div>
                </div>
                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-calendar-check"></i> 수업 기본 정보</h4>
                    <div class="form-grid">
                        <div class="form-group"><label for="edit-studylog-studied-day">학습 수행 일자 <span class="required">*</span></label><input id="edit-studylog-studied-day" class="form-control" type="date" value="${escapeHtml(studiedDay)}" required></div>
                        <div class="form-group"><label>수업 구분</label><label class="checkbox-pill"><input id="edit-studylog-is-special" type="checkbox" ${log.IsSpecial ? 'checked' : ''}><span><i class="fa-solid fa-star"></i> 특강 수업</span></label></div>
                        <div class="form-group"><label for="edit-studylog-class">연결 수업</label><select id="edit-studylog-class" class="form-control">${classOptions}</select></div>
                        <div class="form-group"><label for="edit-studylog-actual-teacher">실제 진행 선생님</label><select id="edit-studylog-actual-teacher" class="form-control">${teacherOptions}</select></div>
                        <div class="form-group"><label for="edit-studylog-payroll-category">정산 카테고리</label><select id="edit-studylog-payroll-category" class="form-control">${categoryOptions}</select><div class="text-muted">수업이 없을 때 실제 진행 선생님과 함께 지정하면 정산에 포함됩니다.</div></div>
                    </div>
                </div>
                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-book-open"></i> 수업 내용</h4>
                    <div class="form-group"><textarea id="edit-studylog-lesson-content" class="form-control" rows="5" placeholder="수업에서 진행한 내용을 입력하세요.">${escapeHtml(log.LessonContent || '')}</textarea></div>
                </div>
                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-note-sticky"></i> 수업 내용 메모</h4>
                    <div class="form-group"><textarea id="edit-studylog-description" class="form-control" rows="5" placeholder="학생별 메모나 전달 사항을 입력하세요.">${escapeHtml(log.Description || '')}</textarea></div>
                </div>
                <div class="modal-actions">
                    <button type="button" id="btn-cancel-edit-studylog" class="btn btn-outline">취소</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> 변경사항 저장</button>
                </div>
            </form>
        `;
        const editClassSelect = document.getElementById('edit-studylog-class');
        const editTeacherSelect = document.getElementById('edit-studylog-actual-teacher');
        const editCategorySelect = document.getElementById('edit-studylog-payroll-category');
        const updateEditAssignmentOptions = (applyAssignedTeacher = true) => {
            const hasClass = Boolean(editClassSelect.value);
            editCategorySelect.disabled = hasClass;
            if (hasClass) {
                editCategorySelect.value = '';
                const assignedTeacher = editClassSelect.selectedOptions[0]?.dataset.teacher || '';
                if (applyAssignedTeacher && assignedTeacher) editTeacherSelect.value = assignedTeacher;
            }
        };
        editClassSelect.addEventListener('change', () => updateEditAssignmentOptions(true));
        updateEditAssignmentOptions(false);
        document.getElementById('btn-cancel-edit-studylog').addEventListener('click', () => openStudyLogDetailModal(logId));
        document.getElementById('form-edit-studylog-detail').addEventListener('submit', async event => {
            event.preventDefault();
            const classId = parseInt(editClassSelect.value || '0') || null;
            const actualTeacherUsername = editTeacherSelect.value || '';
            const payrollCategoryId = parseInt(editCategorySelect.value || '0') || null;
            if (!classId && payrollCategoryId && !actualTeacherUsername) {
                showToast('정산 카테고리를 지정하려면 실제 진행 선생님을 선택해 주세요.', 'warning');
                return;
            }
            const data = {
                StudiedDay: document.getElementById('edit-studylog-studied-day').value,
                LessonContent: document.getElementById('edit-studylog-lesson-content').value.trim(),
                Description: document.getElementById('edit-studylog-description').value.trim(),
                IsSpecial: document.getElementById('edit-studylog-is-special').checked ? 1 : 0,
                ClassId: classId,
                ActualTeacherUsername: actualTeacherUsername,
                PayrollCategoryId: classId ? null : payrollCategoryId
            };
            try {
                await apiFetch(`/api/user/studylogs/${log.row_id || log.Id}`, { method: 'PUT', body: JSON.stringify({ data }) });
                showToast('학습 기록을 수정했습니다.', 'success');
                await Promise.all([openStudyLogDetailModal(logId), loadStudyLogSearchResults(), loadRecentStudyLogs()]);
            } catch (err) {
                showToast(err.message, 'danger');
            }
        });
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

    async function loadStudyLogAssignmentOptions() {
        const classSelect = document.getElementById('studylog-class');
        if (!classSelect) return;
        const selectedClass = classSelect.value;
        try {
            const classData = await apiFetch('/api/user/classes?limit=100');
            const teacherData = isStaff() ? await apiFetch('/api/user/teachers-options') : { teachers: [currentUser] };
            const categoryData = isStaff() ? await apiFetch('/api/user/payroll/categories') : { categories: [] };
            const emptyLabel = currentUser?.role === 'teacher' ? '담당 수업을 선택해 주세요' : '정산에 연결하지 않음';
            classSelect.innerHTML = `<option value="">${emptyLabel}</option>` + (classData.classes || []).map(cls =>
                `<option value="${cls.Id}" data-teacher="${escapeHtml(cls.TeacherUsername || '')}">${escapeHtml(cls.ClassName || '수업명 없음')} · ${escapeHtml(cls.TeacherUsername || '-')}</option>`
            ).join('');
            classSelect.value = selectedClass;
            document.getElementById('studylog-class-required')?.classList.toggle('hidden', currentUser?.role !== 'teacher');
            const actualTeacherSelect = document.getElementById('studylog-actual-teacher');
            actualTeacherSelect.dataset.options = JSON.stringify(teacherData.teachers || []);
            const payrollCategorySelect = document.getElementById('studylog-payroll-category');
            payrollCategorySelect.dataset.options = JSON.stringify(categoryData.categories || []);
            updateStudyLogActualTeacherOptions();
        } catch (err) {
            classSelect.innerHTML = `<option value="">수업 목록 로딩 실패: ${escapeHtml(err.message)}</option>`;
        }
    }

    function updateStudyLogActualTeacherOptions() {
        const classSelect = document.getElementById('studylog-class');
        const teacherSelect = document.getElementById('studylog-actual-teacher');
        const categorySelect = document.getElementById('studylog-payroll-category');
        if (!classSelect || !teacherSelect || !categorySelect) return;
        const classId = classSelect.value;
        const assignedTeacher = classSelect.selectedOptions[0]?.dataset.teacher || '';
        const selectedTeacher = teacherSelect.value;
        let teachers = [];
        try { teachers = JSON.parse(teacherSelect.dataset.options || '[]'); } catch (_) { teachers = []; }
        const targetTeacher = classId ? assignedTeacher : selectedTeacher;
        teacherSelect.disabled = currentUser?.role === 'teacher';
        teacherSelect.innerHTML = '<option value="">선택하지 않음</option>' + teachers.map(teacher =>
            `<option value="${escapeHtml(teacher.username)}" ${teacher.username === targetTeacher ? 'selected' : ''}>${escapeHtml(teacher.username)}${classId && teacher.username === assignedTeacher ? ' (수업 담당)' : ''}</option>`
        ).join('');
        const selectedCategory = categorySelect.value;
        let categories = [];
        try { categories = JSON.parse(categorySelect.dataset.options || '[]'); } catch (_) { categories = []; }
        categorySelect.disabled = Boolean(classId) || currentUser?.role === 'teacher';
        categorySelect.innerHTML = classId
            ? '<option value="">연결된 수업 카테고리 사용</option>'
            : '<option value="">정산에 포함하지 않음</option>' + categories.map(category =>
                `<option value="${category.Id}" ${String(category.Id) === selectedCategory ? 'selected' : ''}>${escapeHtml(category.Name)}</option>`
            ).join('');
    }

    document.getElementById('studylog-class')?.addEventListener('change', () => {
        selectedStudentsMap.clear();
        updateSelectedStudentsUI();
        updateStudyLogActualTeacherOptions();
    });

    async function loadBookStudyStudentCandidates() {
        const query = bookStudyStudentQ.value.trim();
        if (!query) {
            bookStudyStudentResults.innerHTML = '';
            bookStudyStudentResults.classList.add('hidden');
            return;
        }
        try {
            const data = await apiFetch(`/api/user/picker/students?include_ended=true&q=${encodeURIComponent(query)}`);
            const candidates = data.students.filter(student => !bookUnstudiedStudents.has(String(student.row_id)));
            bookStudyStudentResults.innerHTML = candidates.length
                ? candidates.map(student => `<button type="button" class="book-study-student-result" data-id="${student.row_id}" data-name="${escapeHtml(student.Name || '')}" data-grade="${escapeHtml(student.Grade || '')}"><strong>${escapeHtml(student.Name || '이름 없음')}</strong>${student.Grade ? ` <span>(${escapeHtml(student.Grade)})</span>` : ''}</button>`).join('')
                : '<div class="empty-state-sm">추가할 학생이 없습니다.</div>';
            bookStudyStudentResults.classList.remove('hidden');
        } catch (err) {
            bookStudyStudentResults.innerHTML = `<div class="empty-state-sm">${escapeHtml(err.message)}</div>`;
            bookStudyStudentResults.classList.remove('hidden');
        }
    }

    async function loadBookStudyClassOptions() {
        if (!token) return;
        try {
            const data = await apiFetch('/api/user/classes?limit=100');
            const classes = data.classes || [];
            bookStudyClassSelect.innerHTML = '<option value="">수업을 선택해 수강생 전체 추가</option>' + classes.map(cls =>
                `<option value="${cls.Id || cls.row_id}">${escapeHtml(cls.ClassName || '이름 없는 수업')}${cls.DayOfWeek ? ` (${escapeHtml(cls.DayOfWeek)}${cls.StartTime ? ' ' + escapeHtml(cls.StartTime) : ''})` : ''}</option>`
            ).join('');
        } catch (err) {
            // 수업 목록을 사용할 수 없더라도 개별 학생 필터는 정상적으로 제공한다.
            bookStudyClassSelect.innerHTML = '<option value="">수업 목록을 불러오지 못했습니다</option>';
        }
    }

    function renderBookUnstudiedStudents() {
        const students = Array.from(bookUnstudiedStudents.values());
        bookStudyStudentChips.innerHTML = students.map(student => `
            <span class="student-chip"><i class="fa-solid fa-user"></i> ${escapeHtml(student.name)}${student.grade ? ` (${escapeHtml(student.grade)})` : ''}
                <button type="button" class="btn-remove-chip" data-remove-book-study-student="${student.id}" aria-label="${escapeHtml(student.name)} 학생 제거"><i class="fa-solid fa-xmark"></i></button>
            </span>`).join('');
        bookStudyStudentChips.classList.toggle('hidden', students.length === 0);
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
            const hasAdvanced = filterChkAdvanced.checked ? 1 : 0;
            const hasDebate = filterChkDebate.checked ? 1 : 0;
            const hasPaperbook = filterChkPaperbook.checked ? 1 : 0;
            const hasYes24 = filterChkYes24.checked ? 1 : 0;
            const hasMillie = filterChkMillie.checked ? 1 : 0;

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
            if (hasAdvanced) queryParams.append('has_advanced', 1);
            if (hasDebate) queryParams.append('has_debate', 1);
            if (hasPaperbook) queryParams.append('has_paperbook', 1);
            if (hasYes24) queryParams.append('has_yes24', 1);
            if (hasMillie) queryParams.append('has_millie', 1);
            if (bookUnstudiedStudents.size) queryParams.append('unstudied_student_ids', Array.from(bookUnstudiedStudents.keys()).join(','));

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
                <button id="btn-modal-student-consultations" class="btn btn-sm btn-outline">
                    <i class="fa-solid fa-comments"></i> 상담 기록
                </button>
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

            document.getElementById('btn-modal-student-consultations').addEventListener('click', () => {
                openStudentConsultationsModal(studentId, s.Name || '학생');
            });

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

            const studylogs = [...(data.studylogs || [])].sort((left, right) => {
                const leftDate = String(left.StudiedDay || left.CreatedDay || '');
                const rightDate = String(right.StudiedDay || right.CreatedDay || '');
                return rightDate.localeCompare(leftDate, 'ko');
            });
            const totalLogs = data.total_studylogs || 0;
            const referredStudents = data.referred_students || [];
            const tuitionProgress = data.tuition_progress;
            const tuitionHtml = isStaff() ? (tuitionProgress?.has_payment
                ? `<div class="detail-desc-box student-tuition-summary"><div class="detail-section-title"><i class="fa-solid fa-won-sign"></i> 결제 및 누적 수강 현황</div><div class="detail-meta-row"><span>누적 결제 차시: <strong>${tuitionProgress.total_lessons}회</strong></span><span>일반 수업 수강: <strong>${tuitionProgress.used_lessons}회</strong></span><span>잔여 차시: <strong>${tuitionProgress.remaining_lessons}회</strong></span>${tuitionProgress.is_exhausted ? '<span class="badge badge-warning">차시 소진</span>' : `<span>다음 수업: <strong>${tuitionProgress.next_lesson}번째</strong></span>`}</div><p class="text-muted">특강은 수강 차시에서 차감하지 않습니다.</p></div>`
                : `<div class="detail-desc-box student-tuition-summary"><div class="detail-section-title"><i class="fa-solid fa-won-sign"></i> 결제 및 누적 수강 현황</div><p class="text-muted">등록된 결제 정보가 없습니다.</p></div>`) : '';

            const referredStudentsHtml = referredStudents.length
                ? `<div class="student-referrals-list">${referredStudents.map(referred => {
                    const referredId = referred.row_id || referred.Id;
                    return `<button type="button" class="student-referral-item" data-student-id="${referredId}">
                        <strong>${escapeHtml(referred.Name || '이름 없음')}</strong>
                        <span>${formatGrade(referred.Grade)} · ${formatSex(referred.Sex)}${referred.School ? ` · ${escapeHtml(referred.School)}` : ''}${referred.IsClassEnded ? ' · 수업 종료' : ''}</span>
                    </button>`;
                }).join('')}</div>`
                : '<div class="detail-desc-box student-referrals-empty">추천한 학생이 없습니다.</div>';

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
                                <span><i class="fa-solid fa-school"></i> 학교: <strong>${escapeHtml(s.School || '미입력')}</strong></span>
                                <span><i class="fa-solid fa-user-plus"></i> 추천인: <strong>${formatReferrer(s.Referrer) || '미입력'}</strong></span>
                                ${s.IsClassEnded ? '<span class="badge badge-warning"><i class="fa-solid fa-graduation-cap"></i> 수업 종료</span>' : ''}
                                <span><i class="fa-solid fa-id-card"></i> ID: <strong>#${s.row_id || s.Id}</strong></span>
                                <span><i class="fa-solid fa-award"></i> 총 수업: <strong>${totalLogs}회</strong></span>
                            </div>
                        </div>

                        ${tuitionHtml}

                        <div class="student-referrals-section">
                            <div class="detail-section-title"><i class="fa-solid fa-user-group"></i> 피추천인 (${referredStudents.length}명)</div>
                            ${referredStudentsHtml}
                        </div>

                        <div class="student-detail-section">
                            <div class="detail-section-title"><i class="fa-solid fa-note-sticky"></i> 학습 특성 및 특이사항</div>
                            <div class="detail-desc-box">${escapeHtml(s.Description || '등록된 메모나 특이사항이 없습니다.')}</div>
                        </div>

                        <div class="student-detail-section student-studylogs-section">
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

            modalStudentDetailBody.querySelectorAll('.student-referral-item').forEach(item => {
                item.addEventListener('click', () => {
                    const referredStudentId = item.getAttribute('data-student-id');
                    if (referredStudentId) openStudentDetailModal(referredStudentId);
                });
            });

            // Render Combined Chart & Summary Table
            renderStudentCharts(studylogs);
        } catch (err) {
            modalStudentDetailBody.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
        }
    }

    // Difficulty Weight Helper (선택안함/초등부: 1.0, 중등부: 2.0, 심화반/독서모임: 3.0)
    async function openStudentConsultationsModal(studentId, studentName) {
        modalStudentConsultationsTitle.innerHTML = `<i class="fa-solid fa-comments"></i> ${escapeHtml(studentName)} 상담 기록`;
        modalStudentConsultationsBody.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p>상담 기록 조회 중...</p></div>';
        modalStudentConsultations.classList.remove('hidden');
        try {
            const data = await apiFetch(`/api/user/students/${studentId}/consultations`);
            renderStudentConsultations(studentId, studentName, data.consultations || []);
        } catch (err) {
            modalStudentConsultationsBody.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
        }
    }

    function renderStudentConsultations(studentId, studentName, consultations) {
        const formHtml = isStaff() ? `<form id="student-consultation-form" class="consultation-form"><div class="form-group"><label for="student-consultation-content">새 상담 기록</label><textarea id="student-consultation-content" class="form-control" rows="4" placeholder="상담 내용을 입력하세요." required></textarea></div><button type="submit" class="btn btn-primary"><i class="fa-solid fa-plus"></i> 기록 추가</button></form>` : '';
        const listHtml = consultations.length ? consultations.map(item => `
            <article class="consultation-item" data-consultation-id="${item.row_id || item.Id}">
                <div class="consultation-item-header"><span><i class="fa-regular fa-clock"></i> ${escapeHtml(item.CreatedAt || '작성 시각 없음')}${item.CreatedBy ? ` · ${escapeHtml(item.CreatedBy)}` : ''}</span>${isStaff() ? '<span><button type="button" class="btn btn-xs btn-outline btn-edit-consultation">수정</button> <button type="button" class="btn btn-xs btn-danger btn-delete-consultation">삭제</button></span>' : ''}</div>
                <div class="consultation-content">${escapeHtml(item.Content || '')}</div>
            </article>`).join('') : '<div class="empty-state"><i class="fa-solid fa-comments fa-2x"></i><p>등록된 상담 기록이 없습니다.</p></div>';
        modalStudentConsultationsBody.innerHTML = `${formHtml}<div class="consultation-list">${listHtml}</div>`;

        const reload = () => openStudentConsultationsModal(studentId, studentName);
        const form = document.getElementById('student-consultation-form');
        if (form) form.addEventListener('submit', async event => {
            event.preventDefault();
            const content = document.getElementById('student-consultation-content').value.trim();
            if (!content) return;
            try {
                await apiFetch(`/api/user/students/${studentId}/consultations`, { method: 'POST', body: JSON.stringify({ Content: content }) });
                showToast('상담 기록을 추가했습니다.', 'success'); reload();
            } catch (err) { showToast(err.message, 'danger'); }
        });

        modalStudentConsultationsBody.querySelectorAll('.btn-edit-consultation').forEach(button => button.addEventListener('click', () => {
            const itemEl = button.closest('.consultation-item');
            const contentEl = itemEl.querySelector('.consultation-content');
            const original = contentEl.textContent;
            contentEl.innerHTML = `<textarea class="form-control consultation-edit-input" rows="4">${escapeHtml(original)}</textarea><div class="modal-actions"><button type="button" class="btn btn-sm btn-primary btn-save-consultation">저장</button><button type="button" class="btn btn-sm btn-outline btn-cancel-consultation">취소</button></div>`;
            button.closest('.consultation-item-header').querySelector('span:last-child').innerHTML = '';
            itemEl.querySelector('.btn-cancel-consultation').addEventListener('click', reload);
            itemEl.querySelector('.btn-save-consultation').addEventListener('click', async () => {
                const content = itemEl.querySelector('.consultation-edit-input').value.trim();
                if (!content) return showToast('상담 기록을 입력해 주세요.', 'warning');
                try {
                    await apiFetch(`/api/user/consultations/${itemEl.dataset.consultationId}`, { method: 'PUT', body: JSON.stringify({ Content: content }) });
                    showToast('상담 기록을 수정했습니다.', 'success'); reload();
                } catch (err) { showToast(err.message, 'danger'); }
            });
        }));

        modalStudentConsultationsBody.querySelectorAll('.btn-delete-consultation').forEach(button => button.addEventListener('click', async () => {
            if (!confirm('이 상담 기록을 삭제하시겠습니까?')) return;
            try {
                await apiFetch(`/api/user/consultations/${button.closest('.consultation-item').dataset.consultationId}`, { method: 'DELETE' });
                showToast('상담 기록을 삭제했습니다.', 'success'); reload();
            } catch (err) { showToast(err.message, 'danger'); }
        }));
    }

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
                            <label>학교</label>
                            <input type="text" name="School" class="form-control" value="${escapeHtml(s.School || '')}">
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
            School: (formData.get('School') || '').trim(),
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
            const [tData, sData, cData] = await Promise.all([
                apiFetch('/api/user/teachers-options'),
                apiFetch('/api/user/students-options?include_ended=true'),
                apiFetch('/api/user/payroll/categories')
            ]);
            const teacherSelect = document.getElementById('class-teacher');
            let thtml = '<option value="">-- 담당 선생님 선택 --</option>';
            (tData.teachers || []).forEach(t => {
                const roleLabel = t.role === 'manager' ? '관리 선생님' : '선생님';
                thtml += `<option value="${escapeHtml(t.username)}">${escapeHtml(t.username)} (${roleLabel})</option>`;
            });
            teacherSelect.innerHTML = thtml;
            const categorySelect = document.getElementById('class-category');
            categorySelect.innerHTML = '<option value="">-- 카테고리 선택 --</option>' + (cData.categories || []).map(c => `<option value="${c.Id}">${escapeHtml(c.Name)}</option>`).join('');
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
        const categoryId = parseInt(document.getElementById('class-category').value || '0');
        if (!name) { classRegMsg.className = 'alert alert-danger'; classRegMsg.textContent = '수업명은 필수 입력 항목입니다.'; classRegMsg.classList.remove('hidden'); return; }
        if (!teacher) { classRegMsg.className = 'alert alert-danger'; classRegMsg.textContent = '담당 선생님을 선택해 주세요.'; classRegMsg.classList.remove('hidden'); return; }
        if (!day) { classRegMsg.className = 'alert alert-danger'; classRegMsg.textContent = '요일을 선택해 주세요.'; classRegMsg.classList.remove('hidden'); return; }
        if (!categoryId) { classRegMsg.className = 'alert alert-danger'; classRegMsg.textContent = '수업 카테고리를 선택해 주세요.'; classRegMsg.classList.remove('hidden'); return; }
        const studentIds = getSelectedClassStudentIds();
        const specialMap = {};
        classRegStudentSpecialIds.forEach(sid => {
            if (studentIds.includes(sid)) specialMap[sid] = true;
        });
        try {
            const result = await apiFetch('/api/user/classes', {
                method: 'POST',
                body: JSON.stringify({ ClassName: name, TeacherUsername: teacher, DayOfWeek: day, StartTime: time, CategoryId: categoryId, StudentIds: studentIds, StudentIsSpecial: specialMap })
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
                        <span><i class="fa-solid fa-tag"></i> 카테고리: <strong>${escapeHtml(cls.CategoryName || '미지정')}</strong></span>
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
            const [tData, sData, cData] = await Promise.all([
                apiFetch('/api/user/teachers-options'),
                apiFetch('/api/user/students-options?include_ended=true'),
                apiFetch('/api/user/payroll/categories')
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
            const categoryOpts = '<option value="">-- 카테고리 선택 --</option>' + (cData.categories || []).map(c => `<option value="${c.Id}" ${Number(cls.CategoryId) === Number(c.Id) ? 'selected' : ''}>${escapeHtml(c.Name)}</option>`).join('');

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
                                <label>수업 카테고리 <span class="required">*</span></label>
                                <select name="CategoryId" class="form-control" required>${categoryOpts}</select>
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
        const categoryId = parseInt(f.querySelector('[name="CategoryId"]').value || '0');
        const studentIds = Array.from(classEditSelectedStudentIds);
        const specialMap = {};
        classEditStudentSpecialIds.forEach(sid => {
            if (studentIds.includes(sid)) specialMap[sid] = true;
        });
        if (!name) { alertEl.className = 'alert alert-danger'; alertEl.textContent = '수업명은 필수 입력 항목입니다.'; alertEl.classList.remove('hidden'); return; }
        if (!teacher) { alertEl.className = 'alert alert-danger'; alertEl.textContent = '담당 선생님을 선택해 주세요.'; alertEl.classList.remove('hidden'); return; }
        if (!day) { alertEl.className = 'alert alert-danger'; alertEl.textContent = '요일을 선택해 주세요.'; alertEl.classList.remove('hidden'); return; }
        if (!categoryId) { alertEl.className = 'alert alert-danger'; alertEl.textContent = '수업 카테고리를 선택해 주세요.'; alertEl.classList.remove('hidden'); return; }
        try {
            await apiFetch(`/api/user/classes/${classId}`, {
                method: 'PUT',
                body: JSON.stringify({ ClassName: name, TeacherUsername: teacher, DayOfWeek: day, StartTime: time, CategoryId: categoryId, StudentIds: studentIds, StudentIsSpecial: specialMap })
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
            if (isStaff()) await loadActualTeacherOptions('batch-actual-teacher', cls.TeacherUsername);
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
            classBatchStudentsBody.innerHTML = '<tr><td colspan="5" class="empty-state"><p>이 수업에 배정된 학생이 없습니다.</p></td></tr>';
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
                    <td id="batch-tuition-progress-${sId}" class="text-muted">조회 중...</td>
                    <td class="batch-memo-action-cell">
                        <button type="button" class="btn btn-xs btn-outline btn-toggle-batch-memo" data-student-id="${sId}" aria-expanded="false">
                            <i class="fa-solid fa-plus"></i> 추가
                        </button>
                    </td>
                </tr>
                <tr id="batch-memo-row-${sId}" class="batch-memo-row hidden">
                    <td colspan="5">
                        <label for="batch-description-${sId}" class="batch-memo-label"><i class="fa-solid fa-note-sticky"></i> ${name} 학생 메모</label>
                        <textarea id="batch-description-${sId}" class="form-control batch-description" data-student-id="${sId}" rows="3" placeholder="이 학생에게만 저장할 수업 메모를 입력하세요. (선택사항)"></textarea>
                    </td>
                </tr>
            `;
        });
        classBatchStudentsBody.innerHTML = html;
        classBatchStudentsBody.querySelectorAll('.btn-toggle-batch-memo').forEach(button => {
            button.addEventListener('click', () => {
                const studentId = button.dataset.studentId;
                const memoRow = document.getElementById(`batch-memo-row-${studentId}`);
                const isOpen = !memoRow.classList.contains('hidden');
                memoRow.classList.toggle('hidden', isOpen);
                button.setAttribute('aria-expanded', String(!isOpen));
                button.innerHTML = isOpen
                    ? '<i class="fa-solid fa-plus"></i> 추가'
                    : '<i class="fa-solid fa-minus"></i> 닫기';
            });
        });
        students.forEach(async (s) => {
            const sId = s.row_id || s.Id;
            const cell = document.getElementById(`batch-tuition-progress-${sId}`);
            if (!cell) return;
            try {
                const p = await apiFetch(`/api/user/students/${sId}/tuition-progress`);
                cell.innerHTML = p.has_payment ? `총 ${p.total_lessons}회 중 <strong>${p.next_lesson}번째</strong><br><span class="text-muted">등록 후 잔여 ${p.remaining_lessons - 1}회</span>` : '<span class="text-warning">결제 정보 없음</span>';
            } catch (_) { cell.textContent = '-'; }
        });
    }

    function getBatchMonth(dateValue) {
        return (dateValue || new Date().toISOString().slice(0, 10)).slice(0, 7);
    }

    function getBatchMonthWithOffset(month, offset) {
        const [year, monthNumber] = month.split('-').map(Number);
        const date = new Date(year, monthNumber - 1 + offset, 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    async function loadActualTeacherOptions(selectId, assignedTeacher) {
        const select = document.getElementById(selectId);
        if (!select) return;
        const data = await apiFetch('/api/user/teachers-options');
        select.innerHTML = (data.teachers || []).map(teacher =>
            `<option value="${escapeHtml(teacher.username)}" ${teacher.username === assignedTeacher ? 'selected' : ''}>${escapeHtml(teacher.username)}${teacher.username === assignedTeacher ? ' (수업 담당)' : ''}</option>`
        ).join('');
    }

    function showClassRateMessage(message, isError = false) {
        const el = document.getElementById('class-rate-msg');
        if (!el) return;
        el.className = `alert ${isError ? 'alert-danger' : 'alert-success'}`;
        el.textContent = message;
        el.classList.remove('hidden');
    }

    async function loadClassRateSettings() {
        try {
            const [categoriesData, ratesData, specialRatesData, classesData] = await Promise.all([
                apiFetch('/api/user/payroll/categories'), apiFetch('/api/user/payroll/rates'), apiFetch('/api/user/payroll/special-rates'), apiFetch('/api/user/classes?limit=100')
            ]);
            const categories = categoriesData.categories || [];
            document.getElementById('class-category-list').innerHTML = categories.length ? categories.map(c => `<span class="badge"><i class="fa-solid fa-tag"></i> ${escapeHtml(c.Name)}</span>`).join('') : '<span class="text-muted">등록된 카테고리가 없습니다.</span>';
            document.getElementById('rate-category').innerHTML = '<option value="">-- 카테고리 선택 --</option>' + categories.map(c => `<option value="${c.Id}">${escapeHtml(c.Name)}</option>`).join('');
            const classes = (classesData.classes || []).filter(cls => !cls.CategoryId);
            const assignmentBody = document.getElementById('class-category-assignment-body');
            assignmentBody.innerHTML = classes.length ? classes.map(cls => {
                const options = '<option value="">-- 카테고리 선택 --</option>' + categories.map(c => `<option value="${c.Id}" ${Number(cls.CategoryId) === Number(c.Id) ? 'selected' : ''}>${escapeHtml(c.Name)}</option>`).join('');
                return `<tr><td><strong>${escapeHtml(cls.ClassName)}</strong></td><td>${escapeHtml(cls.TeacherUsername || '-')}</td><td><select class="form-control class-category-assignment" data-class-id="${cls.Id}">${options}</select></td><td><button type="button" class="btn btn-xs btn-primary btn-save-class-category" data-class-id="${cls.Id}"><i class="fa-solid fa-floppy-disk"></i> 저장</button></td></tr>`;
            }).join('') : '<tr><td colspan="4" class="empty-state">카테고리가 미설정된 수업이 없습니다.</td></tr>';
            assignmentBody.querySelectorAll('.btn-save-class-category').forEach(button => button.addEventListener('click', () => saveClassCategoryAssignment(button.dataset.classId)));
            const rates = ratesData.rates || [];
            document.getElementById('class-pay-rate-body').innerHTML = rates.length ? rates.map(r => `<tr><td>${escapeHtml(r.CategoryName)}</td><td>${escapeHtml(r.GradeGroup)}</td><td>${Number(r.UnitAmount).toLocaleString()}원</td><td>${escapeHtml(r.EffectiveFrom)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">등록된 일반 수업 단가가 없습니다.</td></tr>';
            const specialRates = specialRatesData.rates || [];
            document.getElementById('special-pay-rate-body').innerHTML = specialRates.length ? specialRates.map(r => `<tr><td>${Number(r.UnitAmount).toLocaleString()}원</td><td>${escapeHtml(r.EffectiveFrom)}</td></tr>`).join('') : '<tr><td colspan="2" class="empty-state">등록된 특강 학생수당 단가가 없습니다.</td></tr>';
            const today = new Date().toISOString().slice(0, 10);
            if (!document.getElementById('rate-effective-from').value) document.getElementById('rate-effective-from').value = today;
            if (!document.getElementById('special-rate-date').value) document.getElementById('special-rate-date').value = today;
        } catch (err) { showClassRateMessage(err.message, true); }
    }

    async function submitClassCategory(e) {
        e.preventDefault();
        const name = document.getElementById('rate-category-name').value.trim();
        try { await apiFetch(`/api/user/payroll/categories?name=${encodeURIComponent(name)}`, { method: 'POST' }); e.target.reset(); showClassRateMessage('수업 카테고리를 등록했습니다.'); await loadClassRateSettings(); }
        catch (err) { showClassRateMessage(err.message, true); }
    }

    async function saveClassCategoryAssignment(classId) {
        const select = document.querySelector(`.class-category-assignment[data-class-id="${classId}"]`);
        const categoryId = Number(select?.value || 0);
        if (!categoryId) { showClassRateMessage('저장할 수업 카테고리를 선택해 주세요.', true); return; }
        try {
            const result = await apiFetch(`/api/user/classes/${classId}/category`, { method: 'PUT', body: JSON.stringify({ CategoryId: categoryId }) });
            showClassRateMessage(result.message);
            await loadClassRateSettings();
        } catch (err) { showClassRateMessage(err.message, true); }
    }

    async function submitClassPayRate(e) {
        e.preventDefault();
        const payload = { CategoryId: Number(document.getElementById('rate-category').value), GradeGroup: document.getElementById('rate-grade-group').value, UnitAmount: Number(document.getElementById('rate-unit-amount').value), EffectiveFrom: document.getElementById('rate-effective-from').value };
        try { await apiFetch('/api/user/payroll/rates', { method: 'POST', body: JSON.stringify(payload) }); showClassRateMessage('일반 수업 단가를 저장했습니다.'); await loadClassRateSettings(); }
        catch (err) { showClassRateMessage(err.message, true); }
    }

    async function submitSpecialPayRate(e) {
        e.preventDefault();
        const payload = { UnitAmount: Number(document.getElementById('special-rate-amount').value), EffectiveFrom: document.getElementById('special-rate-date').value };
        try { await apiFetch('/api/user/payroll/special-rates', { method: 'POST', body: JSON.stringify(payload) }); showClassRateMessage('특강 학생수당 단가를 저장했습니다.'); await loadClassRateSettings(); }
        catch (err) { showClassRateMessage(err.message, true); }
    }

    async function loadBatchStudylogCalendar(month = getBatchMonth(batchStudiedDay?.value)) {
        if (!activeBatchClassId || !batchCalendarStatus) return;
        batchCalendarMonth = month;
        batchCalendarDays = {};
        batchCalendarCancellations = {};
        batchCalendarStatus.textContent = '기존 학습 이력을 불러오는 중입니다...';
        batchCalendarStatus.className = 'batch-calendar-status loading';
        if (batchCalendarGrid) batchCalendarGrid.classList.add('hidden');
        if (batchExistingRecords) batchExistingRecords.classList.add('hidden');
        try {
            const months = [-1, 0, 1].map(offset => getBatchMonthWithOffset(month, offset));
            const results = await Promise.all(months.map(calendarMonth =>
                apiFetch(`/api/user/classes/${activeBatchClassId}/studylog-calendar?month=${encodeURIComponent(calendarMonth)}`)
            ));
            if (activeBatchClassId === null || batchCalendarMonth !== month) return;
            batchCalendarDays = results.reduce((daysByMonth, data, index) => {
                daysByMonth[months[index]] = data.days || {};
                return daysByMonth;
            }, {});
            batchCalendarCancellations = results.reduce((cancellationsByMonth, data, index) => {
                cancellationsByMonth[months[index]] = data.cancellations || {};
                return cancellationsByMonth;
            }, {});
            renderBatchStudylogCalendar();
            showBatchExistingRecords(batchStudiedDay?.value || '');
        } catch (err) {
            batchCalendarStatus.textContent = `기존 학습 이력을 불러오지 못했습니다: ${err.message}`;
            batchCalendarStatus.className = 'batch-calendar-status error';
        }
    }

    function renderBatchStudylogCalendar() {
        if (!batchCalendarGrid || !batchCalendarStatus || !batchCalendarMonth) return;
        const selectedDay = batchStudiedDay?.value || '';
        const labels = ['일', '월', '화', '수', '목', '금', '토'];
        const months = [-1, 0, 1].map(offset => getBatchMonthWithOffset(batchCalendarMonth, offset));
        const html = months.map(calendarMonth => {
            const [year, month] = calendarMonth.split('-').map(Number);
            const firstWeekday = new Date(year, month - 1, 1).getDay();
            const lastDay = new Date(year, month, 0).getDate();
            const days = batchCalendarDays[calendarMonth] || {};
            const cancellations = batchCalendarCancellations[calendarMonth] || {};
            let calendarHtml = labels.map(label => `<div class="batch-calendar-weekday">${label}</div>`).join('');
            calendarHtml += '<div class="batch-calendar-blank"></div>'.repeat(firstWeekday);
            for (let day = 1; day <= lastDay; day++) {
                const date = `${calendarMonth}-${String(day).padStart(2, '0')}`;
                const count = (days[date] || []).length;
                const isCancelled = !!cancellations[date];
                const classes = ['batch-calendar-day'];
                if (count) classes.push('has-records');
                if (isCancelled) classes.push('has-cancellation');
                if (date === selectedDay) classes.push('selected');
                const marker = isCancelled ? '<b>휴</b>' : (count ? `<b>${count}</b>` : '');
                const label = `${date}${isCancelled ? ', 휴강' : ''}${count ? `, 기존 기록 ${count}건` : ''}`;
                calendarHtml += `<button type="button" class="${classes.join(' ')}" data-batch-date="${date}" aria-label="${label}"><span>${day}</span>${marker}</button>`;
            }
            return `<section class="batch-calendar-month" aria-label="${year}년 ${month}월"><h5>${year}년 ${month}월</h5><div class="batch-calendar-grid">${calendarHtml}</div></section>`;
        }).join('');
        if (batchCalendarMonthLabel) {
            const [selectedYear, selectedMonth] = batchCalendarMonth.split('-').map(Number);
            batchCalendarMonthLabel.textContent = `${selectedYear}년 ${selectedMonth}월`;
        }
        batchCalendarGrid.innerHTML = html;
        batchCalendarGrid.classList.remove('hidden');
        batchCalendarGrid.querySelectorAll('[data-batch-date]').forEach(button => button.addEventListener('click', () => selectBatchCalendarDate(button.dataset.batchDate)));
        const total = Object.values(batchCalendarDays).reduce((sum, days) => sum + Object.values(days).reduce((daySum, records) => daySum + records.length, 0), 0);
        const cancellationCount = Object.values(batchCalendarCancellations).reduce((sum, cancellations) => sum + Object.keys(cancellations).length, 0);
        batchCalendarStatus.textContent = (total || cancellationCount)
            ? `이전·선택·다음 달의 학습 기록 ${total}건과 휴강 ${cancellationCount}건을 표시했습니다.`
            : '표시 중인 세 달에는 학습 기록 또는 휴강 일정이 없습니다.';
        batchCalendarStatus.className = 'batch-calendar-status';
    }

    function selectBatchCalendarDate(date) {
        if (batchStudiedDay) batchStudiedDay.value = date;
        renderBatchStudylogCalendar();
        showBatchExistingRecords(date);
    }

    function showBatchExistingRecords(date) {
        if (!batchExistingRecords) return;
        const records = batchCalendarDays[date.slice(0, 7)]?.[date] || [];
        const cancellation = batchCalendarCancellations[date.slice(0, 7)]?.[date];
        if (!date || (!records.length && !cancellation)) {
            batchExistingRecords.classList.add('hidden');
            batchExistingRecords.innerHTML = '';
            return;
        }
        if (cancellation) {
            const reason = cancellation.Reason || '사유 미입력';
            batchExistingRecords.innerHTML = `
                <div><strong><i class="fa-solid fa-ban"></i> ${date} 휴강 등록됨</strong><p>사유: ${escapeHtml(reason)}</p></div>
                <div class="batch-record-summary">
                    <div class="batch-record-representative"><strong>등록자 · ${escapeHtml(cancellation.CreatedBy || '정보 없음')}</strong><span>휴강은 도서·학생별 학습 이력을 만들지 않습니다.</span></div>
                    <button type="button" class="btn btn-xs btn-danger" id="btn-delete-batch-cancellation" data-cancellation-id="${cancellation.Id}"><i class="fa-solid fa-rotate-left"></i> 휴강 해제</button>
                </div>`;
            batchExistingRecords.classList.remove('hidden');
            document.getElementById('btn-delete-batch-cancellation')?.addEventListener('click', () => deleteBatchCancellation(cancellation.Id, date));
            return;
        }
        const representative = records[0];
        const detail = representative.lesson_content || representative.description || '수업 내용 미입력';
        const studentNames = [...new Set(records.map(record => record.student_name || '학생 정보 없음'))];
        const namesHtml = studentNames.map(name => `<span class="batch-record-student-name"><i class="fa-solid fa-user-graduate"></i> ${escapeHtml(name)}</span>`).join('');
        batchExistingRecords.innerHTML = `
            <div><strong><i class="fa-solid fa-circle-info"></i> ${date} 기존 학습 기록 ${records.length}건</strong><p>동일 날짜에도 필요하면 추가 등록할 수 있습니다.</p></div>
            <div class="batch-record-summary">
                <div class="batch-record-representative"><strong>대표 기록 · ${escapeHtml(representative.student_name)}</strong> · ${escapeHtml(representative.book_title)}<span>${escapeHtml(detail)}</span></div>
                <div class="batch-record-student-list"><strong>등록 학생 (${studentNames.length}명)</strong><div>${namesHtml}</div></div>
            </div>`;
        batchExistingRecords.classList.remove('hidden');
    }

    async function deleteBatchCancellation(cancellationId, date) {
        if (!activeBatchClassId || !window.confirm(`${date} 휴강 등록을 해제하시겠습니까?`)) return;
        try {
            const result = await apiFetch(`/api/user/classes/${activeBatchClassId}/cancellations/${cancellationId}`, { method: 'DELETE' });
            alert(result.message);
            loadBatchStudylogCalendar(getBatchMonth(date));
        } catch (err) {
            alert(err.message);
        }
    }

    function handleBatchDateChange() {
        const month = getBatchMonth(batchStudiedDay?.value);
        if (month !== batchCalendarMonth) loadBatchStudylogCalendar(month);
        else { renderBatchStudylogCalendar(); showBatchExistingRecords(batchStudiedDay?.value || ''); }
    }

    function changeBatchCalendarMonth(offset) {
        loadBatchStudylogCalendar(getBatchMonthWithOffset(batchCalendarMonth || getBatchMonth(), offset));
    }

    function updateBatchRegistrationMode() {
        const isCancelled = !!batchIsCancelled?.checked;
        document.querySelectorAll('.batch-studylog-section').forEach(section => section.classList.toggle('hidden', isCancelled));
        if (batchCancellationSection) batchCancellationSection.classList.toggle('hidden', !isCancelled);
        if (btnSubmitClassBatch) {
            btnSubmitClassBatch.innerHTML = isCancelled
                ? '<i class="fa-solid fa-ban"></i> 휴강 등록'
                : '<i class="fa-solid fa-floppy-disk"></i> 선택 학생 학습 기록 일괄 등록';
            btnSubmitClassBatch.classList.toggle('btn-danger', isCancelled);
            btnSubmitClassBatch.classList.toggle('btn-success', !isCancelled);
        }
    }

    function resetBatchRegView() {
        activeBatchClassId = null;
        if (classBatchInfo) classBatchInfo.classList.add('hidden');
        if (classBatchRegCard) classBatchRegCard.classList.add('hidden');
        if (classBatchResult) classBatchResult.classList.add('hidden');
        if (classBatchStudentsBody) classBatchStudentsBody.innerHTML = '';
        if (formClassBatchStudyLog) formClassBatchStudyLog.reset();
        batchCalendarDays = {};
        batchCalendarCancellations = {};
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
        selectedBatchBooks.clear();
        updateBatchBookPickerCount();
        updateBatchRegistrationMode();
    }

    async function confirmBatchStudylogDate(classId, date) {
        const warning = await apiFetch(`/api/user/classes/${classId}/studylog-date-warning?studied_day=${encodeURIComponent(date)}`);
        if (!warning.should_warn) return true;
        return window.confirm(
            `날짜를 다시 확인해 주세요.\n\n${warning.two_weeks_ago_day}에는 이 수업 학생의 학습 기록이 ${warning.two_weeks_ago_count}건 있지만, ` +
            `${warning.previous_week_day}에는 기록이 없습니다.\n\n선택한 ${date}로 일괄 등록하시겠습니까?`
        );
    }

    // 일괄 학습 기록 등록 제출 (공통 수업 내용, 학생별 참석·특강·메모)
    async function handleBatchStudyLogSubmit(e) {
        e.preventDefault();
        if (classBatchResult) classBatchResult.classList.add('hidden');
        if (!activeBatchClassId) { alert('먼저 수업을 선택해 주세요.'); return; }
        const isCancelled = !!batchIsCancelled?.checked;
        const dateVal = batchStudiedDay ? batchStudiedDay.value : '';
        if (!dateVal) {
            classBatchResult.className = 'alert alert-danger';
            classBatchResult.textContent = '수업 일자를 입력해 주세요.';
            classBatchResult.classList.remove('hidden');
            return;
        }
        if (isCancelled) {
            const reason = document.getElementById('batch-cancellation-reason')?.value.trim() || '';
            if (!window.confirm(`${dateVal} 수업을 휴강으로 등록하시겠습니까?\n휴강은 학생별 학습 이력이나 도서 기록을 만들지 않습니다.`)) return;
            try {
                const result = await apiFetch(`/api/user/classes/${activeBatchClassId}/studylogs`, {
                    method: 'POST',
                    body: JSON.stringify({ StudiedDay: dateVal, IsCancelled: true, CancellationReason: reason })
                });
                classBatchResult.className = 'alert alert-success';
                classBatchResult.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(result.message)}`;
                classBatchResult.classList.remove('hidden');
                const reasonEl = document.getElementById('batch-cancellation-reason');
                if (reasonEl) reasonEl.value = '';
                loadBatchStudylogCalendar(getBatchMonth(dateVal));
            } catch (err) {
                classBatchResult.className = 'alert alert-danger';
                classBatchResult.textContent = err.message;
                classBatchResult.classList.remove('hidden');
            }
            return;
        }
        const bookIds = Array.from(selectedBatchBooks.values()).map(book => book.id);
        if (bookIds.length === 0) {
            classBatchResult.className = 'alert alert-danger';
            classBatchResult.textContent = '도서를 선택해 주세요.';
            classBatchResult.classList.remove('hidden');
            return;
        }
        const contentEl = document.getElementById('batch-lesson-content');
        const content = contentEl ? contentEl.value.trim() : '';

        const logs = [];
        document.querySelectorAll('.batch-attend').forEach(chk => {
            const sid = parseInt(chk.getAttribute('data-student-id'));
            const specialEl = document.querySelector(`.batch-special[data-student-id="${sid}"]`);
            const descriptionEl = document.querySelector(`.batch-description[data-student-id="${sid}"]`);
            logs.push({ StudentId: sid, include: chk.checked, is_special: specialEl ? specialEl.checked : false, Description: descriptionEl ? descriptionEl.value.trim() : '' });
        });
        if (logs.length === 0) {
            classBatchResult.className = 'alert alert-danger';
            classBatchResult.textContent = '등록할 학생이 없습니다.';
            classBatchResult.classList.remove('hidden');
            return;
        }
        try {
            const shouldContinue = await confirmBatchStudylogDate(activeBatchClassId, dateVal);
            if (!shouldContinue) return;
            const result = await apiFetch(`/api/user/classes/${activeBatchClassId}/studylogs`, {
                method: 'POST',
                body: JSON.stringify({ BookIds: bookIds, StudiedDay: dateVal, LessonContent: content, ActualTeacherUsername: isStaff() ? (document.getElementById('batch-actual-teacher')?.value || '') : '', logs: logs })
            });
            let resList = '';
            (result.results || []).forEach(r => {
                const statusClass = BATCH_STATUS_CLASS[r.status] || '';
                const icon = BATCH_STATUS_ICON[r.status] || 'fa-circle-info';
                const resultTarget = r.BookId ? `${r.Name || `학생 #${r.StudentId}`} · ${r.BookTitle || `도서 #${r.BookId}`}` : (r.Name || `학생 #${r.StudentId}`);
                resList += `<div class="res-row"><span>${escapeHtml(resultTarget)}</span><span class="${statusClass}"><i class="fa-solid ${icon}"></i> ${escapeHtml(r.message || '')}</span></div>`;
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
            selectedBatchBooks.clear();
            updateBatchBookPickerCount();
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
        const dateFromInput = document.getElementById('monthly-report-log-date-from');
        const dateToInput = document.getElementById('monthly-report-log-date-to');

        if (!studentSelect || !container) return;

        const studentId = studentSelect.value;
        if (!studentId) {
            showToast('학생을 선택해 주세요.', 'warning');
            return;
        }

        const dateFrom = dateFromInput ? dateFromInput.value : '';
        const dateTo = dateToInput ? dateToInput.value : '';
        if (dateFrom && dateTo && dateFrom > dateTo) {
            showToast('학습 시작일은 종료일보다 늦을 수 없습니다.', 'warning');
            return;
        }

        container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 학습 기록 불러오는 중...</div>';
        currentMonthlyLogs = [];

        try {
            const params = new URLSearchParams({ student_id: studentId });
            if (dateFrom) params.set('date_from', dateFrom);
            if (dateTo) params.set('date_to', dateTo);
            const res = await apiFetch(`/api/user/monthly-report/studylogs?${params.toString()}`);
            currentMonthlyLogs = res.logs || []; // 최신순(StudiedDay DESC) 반환

            if (currentMonthlyLogs.length === 0) {
                container.innerHTML = `
                    <div class="empty-state-sm">
                        <i class="fa-solid fa-folder-open"></i>
                        <p>선택한 기간에 등록된 학습 기록이 없습니다.</p>
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

    async function setMonthlyReportDefaultLogPeriod() {
        const dateFromInput = document.getElementById('monthly-report-log-date-from');
        const dateToInput = document.getElementById('monthly-report-log-date-to');
        if (!dateFromInput || !dateToInput || dateFromInput.value || dateToInput.value) return;

        try {
            const data = await apiFetch('/api/user/monthly-report/default-period');
            dateFromInput.value = data.date_from || '';
            dateToInput.value = data.date_to || '';
        } catch (err) {
            console.warn('월말보고 기본 조회 기간을 불러오지 못했습니다.', err);
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

        await Promise.all([
            loadMonthlyReportStudentOptions(preselectStudentId),
            setMonthlyReportDefaultLogPeriod()
        ]);

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

    const btnApplyMonthlyLogPeriod = document.getElementById('btn-apply-monthly-log-period');
    if (btnApplyMonthlyLogPeriod) {
        btnApplyMonthlyLogPeriod.addEventListener('click', () => loadMonthlyReportLogs());
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

    // 수업료 결제 관리
    const TUITION_CLASS_TYPES = ['초등부 독서반', '초등부 기초글쓰기반', '초등부 토론반', '중등부 독서반', '중등부 기초글쓰기반', '중등부 토론반', '심화반'];
    let tuitionSettingsCache = [];
    let tuitionPaymentsCache = [];

    function formatWon(value) { return `${Number(value || 0).toLocaleString('ko-KR')}원`; }
    function parseCurrency(value) { return Number(String(value || '').replace(/[^0-9]/g, '')) || 0; }
    function formatCurrencyInput(input) {
        const digits = String(input.value || '').replace(/[^0-9]/g, '');
        input.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
    }

    async function loadTuitionPaymentView() {
        const studentInput = document.getElementById('tuition-student-search');
        if (!studentInput) return;
        if (!document.getElementById('tuition-start-date').value) {
            const today = new Date().toISOString().slice(0, 10);
            document.getElementById('tuition-start-date').value = today;
            document.getElementById('tuition-paid-date').value = today;
        }
        try {
            const settingData = await apiFetch('/api/user/tuition-fee-settings');
            tuitionSettingsCache = settingData.settings || [];
            await loadTuitionPayments();
        } catch (err) { showToast(`기본 수업료를 불러오지 못했습니다: ${err.message}`, 'error'); }
    }

    async function searchTuitionStudents() {
        const input = document.getElementById('tuition-student-search');
        const results = document.getElementById('tuition-student-results');
        if (!input || !results) return;
        const query = input.value.trim();
        if (!query) { results.classList.add('hidden'); results.innerHTML = ''; return; }
        results.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 학생 검색 중...</div>';
        results.classList.remove('hidden');
        try {
            const data = await apiFetch(`/api/user/picker/students?q=${encodeURIComponent(query)}`);
            const students = data.students || [];
            results.innerHTML = students.length ? students.map(s => {
                const id = s.row_id || s.Id;
                return `<button type="button" class="picker-result-item btn-select-tuition-student" data-id="${id}" data-name="${escapeHtml(s.Name || '')}" data-grade="${escapeHtml(s.Grade || '')}"><strong>${escapeHtml(s.Name || '이름 없음')}</strong><span>${escapeHtml(s.Grade || '학년 미입력')} · ${escapeHtml(formatSex(s.Sex))}</span></button>`;
            }).join('') : '<div class="empty-state"><p>검색 결과가 없습니다.</p></div>';
            results.querySelectorAll('.btn-select-tuition-student').forEach(btn => btn.addEventListener('click', () => {
                document.getElementById('tuition-student').value = btn.dataset.id;
                input.value = btn.dataset.name;
                document.getElementById('tuition-selected-student').innerHTML = `<i class="fa-solid fa-circle-check"></i> 선택된 학생: <strong>${escapeHtml(btn.dataset.name)}</strong>${btn.dataset.grade ? ` (${escapeHtml(btn.dataset.grade)})` : ''}`;
                results.classList.add('hidden');
                showTuitionProgress();
            }));
        } catch (err) { results.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`; }
    }

    function applyDefaultTuitionFee() {
        const classType = document.getElementById('tuition-class-type')?.value;
        const paidLessons = parseInt(document.getElementById('tuition-paid-lessons')?.value || '0');
        const setting = tuitionSettingsCache.find(s => s.ClassType === classType && Number(s.PaidLessons) === paidLessons);
        if (setting) {
            const input = document.getElementById('tuition-fee-amount');
            input.value = setting.DefaultFee;
            formatCurrencyInput(input);
        }
    }

    async function showTuitionProgress() {
        const studentId = document.getElementById('tuition-student')?.value;
        const box = document.getElementById('tuition-progress-preview');
        if (!studentId || !box) { if (box) box.classList.add('hidden'); return; }
        try {
            const p = await apiFetch(`/api/user/students/${studentId}/tuition-progress`);
            box.className = `alert ${p.has_payment && !p.is_exhausted ? 'alert-info' : 'alert-warning'}`;
            box.innerHTML = p.has_payment
                ? `<i class="fa-solid fa-chart-line"></i> 현재 누적 수강 현황: <strong>총 ${p.total_lessons}회 중 ${p.used_lessons}회 사용</strong> · 잔여 ${p.remaining_lessons}회${p.is_exhausted ? ' (차시 소진)' : ` · 다음 수업은 ${p.next_lesson}번째`}`
                : '<i class="fa-solid fa-circle-exclamation"></i> 유효한 결제 이력이 없습니다.';
            box.classList.remove('hidden');
        } catch (_) { box.classList.add('hidden'); }
    }

    async function loadTuitionPayments() {
        const body = document.getElementById('tuition-payments-body');
        if (!body) return;
        try {
            const data = await apiFetch('/api/user/tuition-payments');
            const rows = data.payments || [];
            tuitionPaymentsCache = rows;
            body.innerHTML = rows.length ? rows.map(p => `<tr><td>${escapeHtml(p.StartDate)}</td><td>${escapeHtml(p.PaidDate || '-')}</td><td><strong>${escapeHtml(p.StudentName || '학생 미상')}</strong></td><td>${escapeHtml(p.ClassType)}</td><td>${p.PaidLessons}회 / ${p.ServiceLessons}회</td><td>${formatWon(p.FeeAmount)}</td><td><button class="btn btn-xs btn-outline btn-edit-tuition" data-id="${p.row_id || p.Id}"><i class="fa-solid fa-pen"></i> 수정</button> <button class="btn btn-xs btn-danger btn-delete-tuition" data-id="${p.row_id || p.Id}"><i class="fa-solid fa-trash-can"></i> 삭제</button></td></tr>`).join('') : '<tr><td colspan="7" class="text-center">등록된 결제 이력이 없습니다.</td></tr>';
            body.querySelectorAll('.btn-edit-tuition').forEach(btn => btn.addEventListener('click', () => editTuitionPayment(btn.dataset.id)));
            body.querySelectorAll('.btn-delete-tuition').forEach(btn => btn.addEventListener('click', async () => {
                if (!confirm('이 결제 정보를 삭제하시겠습니까?')) return;
                try { await apiFetch(`/api/user/tuition-payments/${btn.dataset.id}`, { method: 'DELETE' }); await loadTuitionPayments(); showToast('결제 정보가 삭제되었습니다.', 'success'); } catch (err) { alert(err.message); }
            }));
        } catch (err) { body.innerHTML = `<tr><td colspan="7">${escapeHtml(err.message)}</td></tr>`; }
    }

    async function editTuitionPayment(id) {
        await showTuitionPaymentDetail(id, true);
    }

    async function loadTuitionFeeSettings() {
        const body = document.getElementById('tuition-settings-body');
        if (!body) return;
        try {
            const data = await apiFetch('/api/user/tuition-fee-settings');
            tuitionSettingsCache = data.settings || [];
            body.innerHTML = TUITION_CLASS_TYPES.flatMap(type => [10, 20, 30].map(lessons => {
                const setting = tuitionSettingsCache.find(s => s.ClassType === type && Number(s.PaidLessons) === lessons);
                const fee = setting ? Number(setting.DefaultFee).toLocaleString('ko-KR') : '';
                return `<tr><td>${type}</td><td>${lessons}차시</td><td><div class="currency-input-wrap"><input class="form-control tuition-setting-fee currency-input" type="text" inputmode="numeric" value="${fee}" data-class-type="${type}" data-paid-lessons="${lessons}" placeholder="금액 입력"><span>원</span></div></td></tr>`;
            })).join('');
        } catch (err) { body.innerHTML = `<tr><td colspan="4">${escapeHtml(err.message)}</td></tr>`; }
    }

    document.getElementById('tuition-class-type')?.addEventListener('change', applyDefaultTuitionFee);
    document.getElementById('tuition-paid-lessons')?.addEventListener('change', applyDefaultTuitionFee);
    document.addEventListener('input', (e) => {
        if (e.target.classList.contains('currency-input')) formatCurrencyInput(e.target);
    });
    let tuitionStudentSearchTimer = null;
    document.getElementById('tuition-student-search')?.addEventListener('input', () => {
        document.getElementById('tuition-student').value = '';
        document.getElementById('tuition-selected-student').textContent = '학생을 검색해 선택해 주세요.';
        clearTimeout(tuitionStudentSearchTimer);
        tuitionStudentSearchTimer = setTimeout(searchTuitionStudents, 250);
    });
    document.getElementById('form-tuition-payment')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('tuition-payment-msg');
        const payload = { StudentId: Number(document.getElementById('tuition-student').value), ClassType: document.getElementById('tuition-class-type').value, PaidLessons: Number(document.getElementById('tuition-paid-lessons').value), ServiceLessons: Number(document.getElementById('tuition-service-lessons').value), StartDate: document.getElementById('tuition-start-date').value, PaidDate: document.getElementById('tuition-paid-date').value, FeeAmount: parseCurrency(document.getElementById('tuition-fee-amount').value), Memo: document.getElementById('tuition-memo').value.trim() };
        try { const result = await apiFetch('/api/user/tuition-payments', { method: 'POST', body: JSON.stringify(payload) }); msg.className = 'alert alert-success'; msg.textContent = result.message; msg.classList.remove('hidden'); await loadTuitionPayments(); await showTuitionProgress(); } catch (err) { msg.className = 'alert alert-danger'; msg.textContent = err.message; msg.classList.remove('hidden'); }
    });

    async function loadTuitionPaymentSearch() {
        const body = document.getElementById('tuition-search-body');
        if (!body) return;
        const q = document.getElementById('tuition-search-q').value.trim();
        const classType = document.getElementById('tuition-search-class').value;
        body.innerHTML = '<tr><td colspan="7" class="text-center">결제 이력을 불러오는 중입니다.</td></tr>';
        try {
            const data = await apiFetch(`/api/user/tuition-payments?q=${encodeURIComponent(q)}&class_type=${encodeURIComponent(classType)}`);
            const rows = data.payments || [];
            body.innerHTML = rows.length ? rows.map(p => `<tr><td>${escapeHtml(p.StartDate)}</td><td>${escapeHtml(p.PaidDate || '-')}</td><td><strong>${escapeHtml(p.StudentName || '학생 미상')}</strong></td><td>${escapeHtml(p.ClassType)}</td><td>${p.PaidLessons}회 / ${p.ServiceLessons}회</td><td>${formatWon(p.FeeAmount)}</td><td><button class="btn btn-xs btn-outline btn-tuition-detail" data-id="${p.row_id || p.Id}"><i class="fa-solid fa-eye"></i> 상세</button></td></tr>`).join('') : '<tr><td colspan="7" class="text-center">검색 결과가 없습니다.</td></tr>';
            body.querySelectorAll('.btn-tuition-detail').forEach(btn => btn.addEventListener('click', () => showTuitionPaymentDetail(btn.dataset.id)));
        } catch (err) { body.innerHTML = `<tr><td colspan="7">${escapeHtml(err.message)}</td></tr>`; }
    }

    function renderTuitionPaymentDetail(payment, id) {
        modalTuitionDetailTitle.innerHTML = '<i class="fa-solid fa-receipt"></i> 결제 상세 정보';
        modalTuitionDetailActions.innerHTML = isStaff()
            ? '<button id="btn-modal-edit-tuition" class="btn btn-sm btn-primary"><i class="fa-solid fa-pen-to-square"></i> 수정</button>'
            : '';
        modalTuitionDetailBody.innerHTML = `
            <div class="detail-header-block">
                <div class="detail-title">${escapeHtml(payment.StudentName || '학생 미상')}</div>
                <div class="detail-meta-row">
                    ${payment.StudentGrade ? `<span><i class="fa-solid fa-graduation-cap"></i> 학년: <strong>${escapeHtml(payment.StudentGrade)}</strong></span>` : ''}
                    <span><i class="fa-solid fa-users"></i> 반: <strong>${escapeHtml(payment.ClassType)}</strong></span>
                    <span><i class="fa-solid fa-calendar-day"></i> 차시 시작일: <strong>${escapeHtml(payment.StartDate)}</strong></span>
                    <span><i class="fa-solid fa-money-check-dollar"></i> 납부일: <strong>${escapeHtml(payment.PaidDate || '-')}</strong></span>
                </div>
            </div>
            <div class="tuition-detail-summary-grid">
                <div class="detail-info-item"><div class="label">결제 차시</div><div class="val">${Number(payment.PaidLessons || 0)}회</div></div>
                <div class="detail-info-item"><div class="label">서비스 차시</div><div class="val">${Number(payment.ServiceLessons || 0)}회</div></div>
                <div class="detail-info-item"><div class="label">총 제공 차시</div><div class="val">${Number(payment.PaidLessons || 0) + Number(payment.ServiceLessons || 0)}회</div></div>
                <div class="detail-info-item"><div class="label">수업료</div><div class="val tuition-detail-fee">${formatWon(payment.FeeAmount)}</div></div>
            </div>
            <div class="detail-desc-box"><strong><i class="fa-solid fa-note-sticky"></i> 비고</strong><p>${escapeHtml(payment.Memo || '입력된 비고가 없습니다.')}</p></div>
        `;
        document.getElementById('btn-modal-edit-tuition')?.addEventListener('click', () => renderTuitionPaymentEditForm(payment, id));
    }

    function renderTuitionPaymentEditForm(payment, id) {
        modalTuitionDetailTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> 결제 정보 수정';
        modalTuitionDetailActions.innerHTML = '';
        modalTuitionDetailBody.innerHTML = `
            <form id="form-edit-tuition-payment" class="modal-edit-form">
                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-user-graduate"></i> 학생 및 반 정보</h4>
                    <div class="form-grid">
                        <div class="form-group"><label>학생</label><input class="form-control" value="${escapeHtml(payment.StudentName || '학생 미상')}" disabled></div>
                        <div class="form-group"><label for="edit-tuition-class-type">반 정보 <span class="required">*</span></label><select id="edit-tuition-class-type" class="form-control" required>${TUITION_CLASS_TYPES.map(type => `<option value="${escapeHtml(type)}" ${type === payment.ClassType ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select></div>
                    </div>
                </div>
                <div class="form-section">
                    <h4 class="section-title"><i class="fa-solid fa-receipt"></i> 결제 정보</h4>
                    <div class="form-grid">
                        <div class="form-group"><label for="edit-tuition-paid-lessons">결제차시 <span class="required">*</span></label><select id="edit-tuition-paid-lessons" class="form-control">${[10, 20, 30].map(value => `<option value="${value}" ${Number(payment.PaidLessons) === value ? 'selected' : ''}>${value}차시</option>`).join('')}</select></div>
                        <div class="form-group"><label for="edit-tuition-service-lessons">서비스차시</label><input id="edit-tuition-service-lessons" class="form-control" type="number" min="0" max="10" value="${Number(payment.ServiceLessons || 0)}"></div>
                        <div class="form-group"><label for="edit-tuition-start-date">차시 시작일 <span class="required">*</span></label><input id="edit-tuition-start-date" class="form-control" type="date" value="${escapeHtml(payment.StartDate || '')}" required></div>
                        <div class="form-group"><label for="edit-tuition-paid-date">납부일 <span class="required">*</span></label><input id="edit-tuition-paid-date" class="form-control" type="date" value="${escapeHtml(payment.PaidDate || '')}" required></div>
                        <div class="form-group span-2"><label for="edit-tuition-fee-amount">수업료 <span class="required">*</span></label><div class="currency-input-wrap"><input id="edit-tuition-fee-amount" class="form-control currency-input" type="text" inputmode="numeric" value="${Number(payment.FeeAmount || 0).toLocaleString('ko-KR')}" required><span>원</span></div></div>
                        <div class="form-group span-2"><label for="edit-tuition-memo">비고</label><textarea id="edit-tuition-memo" class="form-control" rows="4">${escapeHtml(payment.Memo || '')}</textarea></div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button type="button" id="btn-cancel-edit-tuition" class="btn btn-outline">취소</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> 변경사항 저장</button>
                </div>
            </form>
        `;
        document.getElementById('btn-cancel-edit-tuition').addEventListener('click', () => renderTuitionPaymentDetail(payment, id));
        document.getElementById('form-edit-tuition-payment').addEventListener('submit', async event => {
            event.preventDefault();
            const payload = {
                StudentId: Number(payment.StudentId),
                ClassType: document.getElementById('edit-tuition-class-type').value,
                PaidLessons: Number(document.getElementById('edit-tuition-paid-lessons').value),
                ServiceLessons: Number(document.getElementById('edit-tuition-service-lessons').value),
                StartDate: document.getElementById('edit-tuition-start-date').value,
                PaidDate: document.getElementById('edit-tuition-paid-date').value,
                FeeAmount: parseCurrency(document.getElementById('edit-tuition-fee-amount').value),
                Memo: document.getElementById('edit-tuition-memo').value.trim()
            };
            try {
                await apiFetch(`/api/user/tuition-payments/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
                showToast('결제 정보가 수정되었습니다.', 'success');
                await Promise.all([loadTuitionPayments(), loadTuitionPaymentSearch()]);
                await showTuitionPaymentDetail(id);
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    }

    async function showTuitionPaymentDetail(id, openEdit = false) {
        modalTuitionDetail.classList.remove('hidden');
        modalTuitionDetailTitle.innerHTML = '<i class="fa-solid fa-receipt"></i> 결제 상세 정보';
        modalTuitionDetailActions.innerHTML = '';
        modalTuitionDetailBody.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 상세 정보를 불러오는 중입니다.</div>';
        try {
            const p = (await apiFetch(`/api/user/tuition-payments/${id}`)).payment;
            if (openEdit && isStaff()) renderTuitionPaymentEditForm(p, id);
            else renderTuitionPaymentDetail(p, id);
        } catch (err) { modalTuitionDetailBody.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`; }
    }

    btnCloseTuitionDetail?.addEventListener('click', () => modalTuitionDetail.classList.add('hidden'));
    modalTuitionDetail?.addEventListener('click', event => {
        if (event.target === modalTuitionDetail) modalTuitionDetail.classList.add('hidden');
    });

    document.getElementById('btn-tuition-search')?.addEventListener('click', loadTuitionPaymentSearch);
    document.getElementById('tuition-search-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadTuitionPaymentSearch(); } });
    document.getElementById('btn-save-all-tuition-settings')?.addEventListener('click', async () => {
        const msg = document.getElementById('tuition-settings-msg');
        const inputs = Array.from(document.querySelectorAll('.tuition-setting-fee'));
        const settings = [];
        for (const input of inputs) {
            if (input.value === '') continue;
            if (Number(input.value) < 0) { msg.className = 'alert alert-danger'; msg.textContent = '수업료는 0원 이상으로 입력해 주세요.'; msg.classList.remove('hidden'); return; }
            settings.push({ ClassType: input.dataset.classType, PaidLessons: Number(input.dataset.paidLessons), DefaultFee: parseCurrency(input.value) });
        }
        if (!settings.length) { msg.className = 'alert alert-warning'; msg.textContent = '저장할 수업료를 1개 이상 입력해 주세요.'; msg.classList.remove('hidden'); return; }
        try {
            await Promise.all(settings.map(setting => apiFetch('/api/user/tuition-fee-settings', { method: 'POST', body: JSON.stringify(setting) })));
            msg.className = 'alert alert-success'; msg.textContent = `${settings.length}개 기본 수업료를 저장했습니다.`; msg.classList.remove('hidden');
            await loadTuitionFeeSettings();
        } catch (err) { msg.className = 'alert alert-danger'; msg.textContent = err.message; msg.classList.remove('hidden'); }
    });

    let studentReferrerSearchTimer = null;
    async function searchStudentReferrer() {
        const input = document.getElementById('student-referrer-search');
        const results = document.getElementById('student-referrer-results');
        if (!input || !results) return;
        const query = input.value.trim();
        if (!query) { results.classList.add('hidden'); results.innerHTML = ''; return; }
        results.classList.remove('hidden');
        results.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 학생 검색 중...</div>';
        try {
            const data = await apiFetch(`/api/user/picker/students?q=${encodeURIComponent(query)}`);
            const students = data.students || [];
            results.innerHTML = students.length ? students.map(s => `<button type="button" class="picker-result-item btn-select-student-referrer" data-name="${escapeHtml(s.Name || '')}" data-grade="${escapeHtml(s.Grade || '')}"><strong>${escapeHtml(s.Name || '이름 없음')}</strong><span>${escapeHtml(s.Grade || '학년 미입력')} · ${escapeHtml(formatSex(s.Sex))}</span></button>`).join('') : '<div class="empty-state"><p>검색 결과가 없습니다.</p></div>';
            results.querySelectorAll('.btn-select-student-referrer').forEach(btn => btn.addEventListener('click', () => {
                document.getElementById('student-referrer').value = btn.dataset.name;
                input.value = btn.dataset.name;
                document.getElementById('student-referrer-selected').innerHTML = `<i class="fa-solid fa-circle-check"></i> 선택된 추천 학생: <strong>${escapeHtml(btn.dataset.name)}</strong>${btn.dataset.grade ? ` (${escapeHtml(btn.dataset.grade)})` : ''}`;
                results.classList.add('hidden');
            }));
        } catch (err) { results.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`; }
    }
    document.getElementById('student-referrer-search')?.addEventListener('input', () => {
        document.getElementById('student-referrer').value = '';
        document.getElementById('student-referrer-selected').textContent = '추천 학생을 검색해 선택해 주세요. (선택사항)';
        clearTimeout(studentReferrerSearchTimer);
        studentReferrerSearchTimer = setTimeout(searchStudentReferrer, 250);
    });

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
    async function initTeacherPayrollView() {
        const month = document.getElementById('payroll-month');
        if (!month.value) month.value = new Date().toISOString().slice(0, 7);
        const teacherGroup = document.getElementById('payroll-teacher-group');
        teacherGroup.classList.toggle('hidden', !isStaff());
        if (isStaff()) {
            await loadPayrollTeacherOptions();
        }
        await loadTeacherPayroll();
    }

    async function loadPayrollTeacherOptions() {
        const teacherSelect = document.getElementById('payroll-teacher');
        const selectedTeacher = teacherSelect.value;
        const data = await apiFetch('/api/user/teachers-options');
        let options = '<option value="">전체 선생님</option>';
        payrollTeacherOptions = data.teachers || [];
        payrollTeacherOptions.forEach(teacher => {
            const roleLabel = teacher.role === 'manager' ? '관리 선생님' : '선생님';
            options += `<option value="${escapeHtml(teacher.username)}">${escapeHtml(teacher.username)} (${roleLabel})</option>`;
        });
        teacherSelect.innerHTML = options;
        teacherSelect.value = selectedTeacher;
    }

    async function loadTeacherPayroll() {
        const month = document.getElementById('payroll-month').value;
        const teacher = isStaff() ? document.getElementById('payroll-teacher').value.trim() : '';
        if (!month) return;
        payrollSelectedSessions.clear();
        const data = await apiFetch(`/api/user/payroll?month=${encodeURIComponent(month)}${teacher ? `&teacher_username=${encodeURIComponent(teacher)}` : ''}`);
        const payrollLines = data.lines || [];
        const unconfiguredLines = payrollLines.filter(line => line.IsRateConfigured === false);
        const canTransfer = Boolean(isStaff() && teacher && !data.closed);
        renderPayrollTransferPanel(canTransfer, teacher);
        renderPayrollUnconfiguredLines(unconfiguredLines);
        renderPayrollTeamCards(payrollLines.filter(line => line.IsRateConfigured !== false), canTransfer);
        renderPayrollClaims(data.claims || []);
        const claimCard = document.getElementById('payroll-claim-card');
        claimCard.classList.toggle('hidden', Boolean(isStaff() && !teacher && !document.getElementById('payroll-claim-id').value));
        const total = Object.values(data.totals).reduce((a,b) => a + Number(b), 0);
        document.getElementById('payroll-summary').innerHTML = `<span class="payroll-summary-label">${escapeHtml(month)} 정산 합계</span><strong>${total.toLocaleString()}원</strong>${data.closed ? '<em><i class="fa-solid fa-lock"></i> 마감 완료</em>' : '<em class="is-open"><i class="fa-solid fa-lock-open"></i> 정산 진행 중</em>'}`;
        document.getElementById('btn-close-payroll').classList.toggle('hidden', !isStaff() || !teacher || data.closed);
    }

    function renderPayrollTransferPanel(canTransfer, sourceTeacher) {
        const panel = document.getElementById('payroll-transfer-panel');
        panel.classList.toggle('hidden', !canTransfer);
        const targetSelect = document.getElementById('payroll-transfer-teacher');
        targetSelect.innerHTML = '<option value="">이전할 선생님 선택</option>' + payrollTeacherOptions
            .filter(teacher => teacher.username !== sourceTeacher)
            .map(teacher => `<option value="${escapeHtml(teacher.username)}">${escapeHtml(teacher.username)}</option>`)
            .join('');
        updatePayrollTransferSelection();
    }

    function payrollSessionKey(classId, studiedDay) {
        return `${classId}|${studiedDay}`;
    }

    function payrollTransferCheckbox(line, canTransfer) {
        if (!canTransfer || !line.ClassId || !line.StudiedDay) return '';
        const key = payrollSessionKey(line.ClassId, line.StudiedDay);
        return `<label class="payroll-transfer-check" title="이 차시의 담당 선생님 이전"><input type="checkbox" class="payroll-session-transfer-checkbox" data-session-key="${escapeHtml(key)}" data-class-id="${Number(line.ClassId)}" data-studied-day="${escapeHtml(line.StudiedDay)}" data-class-name="${escapeHtml(line.ClassName || '수업 정보 미연결')}"><span>선택</span></label>`;
    }

    function updatePayrollTransferSelection() {
        const count = payrollSelectedSessions.size;
        const label = document.getElementById('payroll-transfer-selection');
        const button = document.getElementById('btn-transfer-payroll-sessions');
        if (label) label.textContent = count ? `${count}개 차시 선택됨` : '선택한 차시 없음';
        if (button) button.disabled = !count || !document.getElementById('payroll-transfer-teacher')?.value;
    }

    function renderPayrollTeamCards(lines, canTransfer = false) {
        const container = document.getElementById('payroll-team-cards');
        const teams = new Map();
        lines.forEach(line => {
            const teamKey = `${line.ClassId || 'unlinked'}|${line.ClassName || '수업 정보 미연결'}`;
            if (!teams.has(teamKey)) teams.set(teamKey, []);
            teams.get(teamKey).push(line);
        });
        if (!teams.size) {
            container.innerHTML = '<div class="card payroll-empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>해당 월에 정산할 수업 내역이 없습니다.</p></div>';
            return;
        }
        container.innerHTML = [...teams.values()].map(teamLines => {
            const teamName = teamLines[0].ClassName || '수업 정보 미연결';
            const lessonDates = [...new Set(teamLines.map(line => line.StudiedDay).filter(Boolean))].sort();
            // 정산 표는 비교하기 쉽게 항상 1~5차시 칸을 유지한다.
            const dates = Array.from({ length: 5 }, (_, index) => lessonDates[index] || '');
            const students = new Map();
            teamLines.forEach(line => {
                const formattedGrade = formatPayrollGrade(line.GradeSnapshot || line.CurrentGrade);
                const key = `${line.StudentName || '-'}|${formattedGrade}`;
                if (!students.has(key)) students.set(key, { name: line.StudentName || '-', grade: formattedGrade, lines: [] });
                students.get(key).lines.push(line);
            });
            const teamTotal = teamLines.reduce((sum, line) => sum + Number(line.Amount || 0), 0);
            const headerCells = dates.map((date, index) => {
                const sessionLine = date ? teamLines.find(line => line.StudiedDay === date) : null;
                const checkbox = sessionLine ? payrollTransferCheckbox(sessionLine, canTransfer) : '';
                return `<th><span>${index + 1}차시</span><small>${date ? escapeHtml(date.slice(5).replace('-', '/')) : '&nbsp;'}</small>${checkbox}</th>`;
            }).join('');
            const rows = [...students.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(student => {
                const attendedDates = new Set(student.lines.map(line => line.StudiedDay));
                const amount = student.lines.reduce((sum, line) => sum + Number(line.Amount || 0), 0);
                return `<tr><td class="payroll-grade">${escapeHtml(student.grade)}</td><td class="payroll-student-name">${escapeHtml(student.name)}</td>${dates.map(date => `<td class="${date && attendedDates.has(date) ? 'is-attended' : ''}">${date && attendedDates.has(date) ? '<i class="fa-solid fa-check"></i>' : '-'}</td>`).join('')}<td><b>${student.lines.length}회</b></td><td class="payroll-amount">${amount.toLocaleString()}원</td></tr>`;
            }).join('');
            return `<article class="card payroll-team-card"><header><div><span class="payroll-team-eyebrow">수업 팀</span><h3>${escapeHtml(teamName)}</h3></div><div class="payroll-team-total"><span>팀 정산액</span><strong>${teamTotal.toLocaleString()}원</strong></div></header><div class="table-responsive"><table class="modern-table payroll-session-table"><thead><tr><th>학년</th><th>이름</th>${headerCells}<th>총 차시</th><th>정산액</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
        }).join('');
    }

    function renderPayrollUnconfiguredLines(lines) {
        const card = document.getElementById('payroll-unconfigured-card');
        card.classList.toggle('hidden', !lines.length);
        if (!lines.length) return;
        document.getElementById('payroll-unconfigured-count').textContent = `${lines.length}건`;
        document.getElementById('payroll-unconfigured-body').innerHTML = lines.map(line => {
            const grade = formatPayrollGrade(line.GradeSnapshot || line.CurrentGrade);
            const lessonType = line.IsSpecial ? '특강' : '일반 수업';
            return `<tr><td>${escapeHtml(line.ClassName || '수업 정보 미연결')}</td><td>${escapeHtml(grade)}</td><td><b>${escapeHtml(line.StudentName || '-')}</b></td><td>${escapeHtml(line.StudiedDay || '-')}</td><td>${lessonType}</td><td class="payroll-unconfigured-reason">${escapeHtml(line.Reason || '정산 기준 미설정')}</td></tr>`;
        }).join('');
    }

    function formatPayrollGrade(grade) {
        const value = String(grade || '').replace(/\s+/g, '');
        const elementary = value.match(/^초(?:등)?(?:학교)?([1-6])(?:학년)?$/) || value.match(/^([1-6])(?:학년)?$/);
        if (elementary) return `초${elementary[1]}`;
        const middle = value.match(/^중(?:등)?(?:학교)?([1-3])(?:학년)?$/);
        if (middle) return `중${middle[1]}`;
        const middleNumber = value.match(/^([7-9])(?:학년)?$/);
        if (middleNumber) return `중${Number(middleNumber[1]) - 6}`;
        return value || '-';
    }

    function renderPayrollClaims(claims) {
        const card = document.getElementById('payroll-claim-list-card');
        card.classList.toggle('hidden', !claims.length);
        payrollClaimsById.clear();
        claims.forEach(claim => payrollClaimsById.set(Number(claim.Id), claim));
        document.getElementById('payroll-claims-body').innerHTML = claims.map(claim => {
            return `<tr><td>${escapeHtml(claim.TeacherUsername)}</td><td>${escapeHtml(claim.ClaimDate || '-')}</td><td>${escapeHtml(claim.ItemName)}</td><td>${escapeHtml(claim.Description || '-')}</td><td class="payroll-amount">${Number(claim.Amount || 0).toLocaleString()}원</td><td><button type="button" class="btn btn-xs btn-outline btn-edit-payroll-claim" data-id="${Number(claim.Id)}">수정</button> <button type="button" class="btn btn-xs btn-danger btn-delete-payroll-claim" data-id="${Number(claim.Id)}">삭제</button></td></tr>`;
        }).join('');
    }

    function resetPayrollClaimForm() {
        document.getElementById('form-payroll-claim').reset();
        document.getElementById('payroll-claim-id').value = '';
        payrollEditingClaimTeacher = '';
        document.getElementById('payroll-claim-form-title').innerHTML = '<i class="fa-solid fa-circle-plus"></i> 추가 청구 등록';
        document.getElementById('btn-submit-payroll-claim').innerHTML = '<i class="fa-solid fa-plus"></i> 청구 등록';
        document.getElementById('btn-cancel-payroll-claim-edit').classList.add('hidden');
        const selectedTeacher = document.getElementById('payroll-teacher')?.value.trim();
        document.getElementById('payroll-claim-card').classList.toggle('hidden', Boolean(isStaff() && !selectedTeacher));
    }

    function startPayrollClaimEdit(claim) {
        document.getElementById('payroll-claim-id').value = claim.Id;
        document.getElementById('payroll-month').value = claim.PayrollMonth;
        document.getElementById('payroll-claim-date').value = claim.ClaimDate || '';
        document.getElementById('payroll-claim-name').value = claim.ItemName || '';
        document.getElementById('payroll-claim-amount').value = Number(claim.Amount || 0);
        document.getElementById('payroll-claim-description').value = claim.Description || '';
        payrollEditingClaimTeacher = claim.TeacherUsername;
        document.getElementById('payroll-claim-form-title').innerHTML = `<i class="fa-solid fa-pen"></i> ${escapeHtml(claim.TeacherUsername)} 추가 청구 수정`;
        document.getElementById('btn-submit-payroll-claim').innerHTML = '<i class="fa-solid fa-check"></i> 수정 저장';
        document.getElementById('btn-cancel-payroll-claim-edit').classList.remove('hidden');
        const card = document.getElementById('payroll-claim-card');
        card.classList.remove('hidden');
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.getElementById('btn-load-payroll')?.addEventListener('click', () => loadTeacherPayroll().catch(e => alert(e.message)));
    document.getElementById('payroll-teacher')?.addEventListener('change', () => { resetPayrollClaimForm(); loadTeacherPayroll().catch(e => alert(e.message)); });
    document.getElementById('payroll-month')?.addEventListener('change', () => { resetPayrollClaimForm(); loadTeacherPayroll().catch(e => alert(e.message)); });
    document.getElementById('payroll-transfer-teacher')?.addEventListener('change', updatePayrollTransferSelection);
    document.getElementById('view-teacher-payroll')?.addEventListener('change', event => {
        const checkbox = event.target.closest('.payroll-session-transfer-checkbox');
        if (!checkbox) return;
        const key = checkbox.dataset.sessionKey;
        if (checkbox.checked) {
            payrollSelectedSessions.set(key, {
                ClassId: Number(checkbox.dataset.classId),
                StudiedDay: checkbox.dataset.studiedDay,
                ClassName: checkbox.dataset.className
            });
        } else {
            payrollSelectedSessions.delete(key);
        }
        document.querySelectorAll('.payroll-session-transfer-checkbox').forEach(item => {
            if (item.dataset.sessionKey === key) item.checked = checkbox.checked;
        });
        updatePayrollTransferSelection();
    });
    document.getElementById('btn-transfer-payroll-sessions')?.addEventListener('click', async () => {
        const month = document.getElementById('payroll-month').value;
        const sourceTeacher = document.getElementById('payroll-teacher').value.trim();
        const targetTeacher = document.getElementById('payroll-transfer-teacher').value.trim();
        const sessions = [...payrollSelectedSessions.values()];
        if (!month || !sourceTeacher || !targetTeacher || !sessions.length) return;
        const sessionSummary = sessions.map(item => `${item.ClassName} ${item.StudiedDay}`).join('\n');
        if (!confirm(`${sourceTeacher} 선생님의 아래 ${sessions.length}개 차시를 ${targetTeacher} 선생님에게 이전할까요?\n\n${sessionSummary}\n\n이전 즉시 두 선생님의 정산 금액이 다시 계산됩니다.`)) return;
        const result = await apiFetch('/api/user/payroll/transfer-sessions', {
            method: 'POST',
            body: JSON.stringify({
                PayrollMonth: month,
                SourceTeacherUsername: sourceTeacher,
                TargetTeacherUsername: targetTeacher,
                Sessions: sessions.map(({ ClassId, StudiedDay }) => ({ ClassId, StudiedDay }))
            })
        });
        showToast(result.message, 'success');
        await loadTeacherPayroll();
    });
    async function initUtilitiesView() {
        const month = document.getElementById('utility-backfill-month');
        if (!month.value) month.value = new Date().toISOString().slice(0, 7);
        await loadDuplicateBooksPreview();
    }

    async function loadDuplicateBooksPreview() {
        const summary = document.getElementById('duplicate-books-summary');
        const mergeButton = document.getElementById('btn-merge-duplicate-books');
        const previewCard = document.getElementById('duplicate-books-preview-card');
        summary.textContent = '병합 대상을 확인하는 중입니다.';
        mergeButton.disabled = true;
        previewCard.classList.add('hidden');
        try {
            const data = await apiFetch('/api/user/utilities/duplicate-books');
            duplicateBooksPreviewData = data;
            summary.textContent = data.group_count
                ? `${data.group_count}개 그룹 · 중복 ${data.duplicate_count}권 · 이동할 참조 ${data.reference_count}건`
                : '현재 병합할 중복 도서가 없습니다.';
            mergeButton.disabled = !data.duplicate_count;
            if (data.group_count) {
                const tableLabels = { StudyLogs: '학습 이력', BookMaterialRequests: '도서·자료 요청' };
                document.getElementById('duplicate-books-preview-body').innerHTML = data.groups.map(group => {
                    const survivor = group.SurvivorBook;
                    const removed = group.RemovedBooks.map(book => `<span class="utility-book-id is-removed">rowid ${Number(book.RowId)} / ID ${Number(book.Id)}</span>`).join('');
                    const references = Object.entries(group.ReferencesByTable)
                        .map(([table, count]) => `<span class="utility-reference-item"><b>${escapeHtml(tableLabels[table] || table)}</b> ${Number(count)}건</span>`)
                        .join('') || '<span class="utility-no-reference">수정할 참조 없음</span>';
                    return `<tr><td><b>${escapeHtml(group.Title || '(도서명 없음)')}</b></td><td>${escapeHtml(group.Author || '-')}<small>${escapeHtml(group.Publisher || '-')}</small></td><td><span class="utility-book-id is-survivor">rowid ${Number(survivor.RowId)} / ID ${Number(survivor.Id)}</span></td><td>${removed}</td><td>${references}</td></tr>`;
                }).join('');
                previewCard.classList.remove('hidden');
            }
        } catch (error) {
            duplicateBooksPreviewData = null;
            summary.textContent = error.message;
        }
    }

    document.getElementById('btn-refresh-duplicate-books')?.addEventListener('click', () => loadDuplicateBooksPreview());
    document.getElementById('btn-backfill-payroll-class-links')?.addEventListener('click', async () => {
        const month = document.getElementById('utility-backfill-month').value;
        if (!month || !confirm(`${month}의 수업 연결이 비어 있는 학습 이력을 자동 연결할까요?\n\n학생별 일반/특강 수업이 각각 정확히 하나인 경우에만 처리하며, 기존 연결은 변경하지 않습니다.`)) return;
        const result = await apiFetch(`/api/user/payroll/backfill-class-links?month=${encodeURIComponent(month)}`, { method: 'POST' });
        showToast(`${result.message}${result.unmatched_count ? ` 자동 연결하지 않은 기록 ${result.unmatched_count}건` : ''}`, result.linked_count ? 'success' : 'info');
    });
    document.getElementById('btn-merge-duplicate-books')?.addEventListener('click', async () => {
        const preview = duplicateBooksPreviewData;
        if (!preview?.duplicate_count) return;
        if (!confirm(`표시된 수정 목록대로 병합할까요?\n\n중복 그룹: ${preview.group_count}개\n삭제될 도서: ${preview.duplicate_count}권\n수정될 참조: ${preview.reference_count}건\n\n가장 오래된 도서를 남기며, 이 작업은 되돌릴 수 없습니다.`)) return;
        const button = document.getElementById('btn-merge-duplicate-books');
        button.disabled = true;
        const result = await apiFetch('/api/user/utilities/merge-duplicate-books', { method: 'POST' });
        showToast(result.message, result.deleted_count ? 'success' : 'info');
        await loadDuplicateBooksPreview();
    });
    document.getElementById('btn-close-payroll')?.addEventListener('click', async () => { const month=document.getElementById('payroll-month').value, teacher=document.getElementById('payroll-teacher').value.trim(); if (!teacher || !confirm(`${teacher} 선생님의 ${month} 정산을 마감할까요?`)) return; await apiFetch(`/api/user/payroll/${month}/close?teacher_username=${encodeURIComponent(teacher)}`, {method:'POST'}); await loadTeacherPayroll(); });
    document.getElementById('btn-cancel-payroll-claim-edit')?.addEventListener('click', resetPayrollClaimForm);
    document.getElementById('payroll-claims-body')?.addEventListener('click', async event => {
        const editButton = event.target.closest('.btn-edit-payroll-claim');
        const deleteButton = event.target.closest('.btn-delete-payroll-claim');
        const claimId = Number((editButton || deleteButton)?.dataset.id);
        const claim = payrollClaimsById.get(claimId);
        if (!claim) return;
        if (editButton) {
            startPayrollClaimEdit(claim);
            return;
        }
        if (!confirm(`${claim.TeacherUsername} 선생님의 '${claim.ItemName}' 추가 청구를 삭제할까요?\n\n삭제 즉시 정산 합계에서 제외됩니다.`)) return;
        const result = await apiFetch(`/api/user/payroll/claims/${claimId}`, { method: 'DELETE' });
        if (Number(document.getElementById('payroll-claim-id').value) === claimId) resetPayrollClaimForm();
        await loadTeacherPayroll();
        showToast(result.message, 'success');
    });
    document.getElementById('form-payroll-claim')?.addEventListener('submit', async e => {
        e.preventDefault();
        const claimId = document.getElementById('payroll-claim-id').value;
        const selectedTeacher = isStaff() ? document.getElementById('payroll-teacher').value.trim() : currentUser.username;
        const payload = {
            PayrollMonth: document.getElementById('payroll-month').value,
            ClaimDate: document.getElementById('payroll-claim-date').value,
            ItemName: document.getElementById('payroll-claim-name').value,
            Amount: Number(document.getElementById('payroll-claim-amount').value),
            Description: document.getElementById('payroll-claim-description').value,
            TeacherUsername: payrollEditingClaimTeacher || selectedTeacher
        };
        const result = await apiFetch(claimId ? `/api/user/payroll/claims/${claimId}` : '/api/user/payroll/claims', {
            method: claimId ? 'PUT' : 'POST',
            body: JSON.stringify(payload)
        });
        resetPayrollClaimForm();
        await loadTeacherPayroll();
        showToast(result.message, 'success');
    });

    /* 모든 목록 테이블 공통 정렬 */
    const NON_SORTABLE_HEADER_PATTERN = /^(관리|작업|처리|상세|저장|선택|이전)$/;

    function isSortableTableHeader(header) {
        if (!header || header.dataset.sortable === 'false' || header.colSpan > 1) return false;
        const label = header.textContent.replace(/\s+/g, ' ').trim();
        if (!label || NON_SORTABLE_HEADER_PATTERN.test(label)) return false;
        const table = header.closest('table');
        const columnIndex = Array.from(header.parentElement.children).indexOf(header);
        if (!table || columnIndex < 0 || header.querySelector('input, button, select, a')) return false;
        return !Array.from(table.tBodies).some(body =>
            Array.from(body.rows).some(row => row.cells[columnIndex]?.querySelector('input, button, select, a'))
        );
    }

    function enhanceSortableTable(table) {
        table.querySelectorAll('thead th').forEach(header => {
            const sortable = isSortableTableHeader(header);
            header.classList.toggle('sortable-header', sortable);
            if (sortable) {
                header.tabIndex = 0;
                header.setAttribute('role', 'button');
                header.setAttribute('title', '클릭하여 정렬');
                if (!header.hasAttribute('aria-sort')) header.setAttribute('aria-sort', 'none');
            } else {
                header.removeAttribute('tabindex');
                header.removeAttribute('role');
                header.removeAttribute('title');
                header.removeAttribute('aria-sort');
            }
        });
    }

    function getSortableCellValue(cell) {
        const raw = (cell?.dataset.sortValue || cell?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!raw || raw === '-') return { type: 'empty', value: '' };
        const dateMatch = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
        if (dateMatch) {
            return { type: 'number', value: Number(`${dateMatch[1]}${dateMatch[2].padStart(2, '0')}${dateMatch[3].padStart(2, '0')}`) };
        }
        const numericText = raw.replace(/^#/, '').replace(/,/g, '').replace(/\s*(원|회|건|명|권|%|페이지)$/u, '');
        if (/^-?\d+(?:\.\d+)?$/.test(numericText)) return { type: 'number', value: Number(numericText) };
        return { type: 'text', value: raw };
    }

    function sortTableByHeader(header) {
        if (!isSortableTableHeader(header)) return;
        const table = header.closest('table');
        const columnIndex = Array.from(header.parentElement.children).indexOf(header);
        const previousColumn = Number(table.dataset.sortColumn);
        const direction = previousColumn === columnIndex && table.dataset.sortDirection === 'asc' ? 'desc' : 'asc';

        table.querySelectorAll('thead th').forEach(item => {
            item.classList.remove('sort-asc', 'sort-desc');
            if (item.classList.contains('sortable-header')) item.setAttribute('aria-sort', 'none');
        });
        header.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
        header.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
        table.dataset.sortColumn = String(columnIndex);
        table.dataset.sortDirection = direction;

        Array.from(table.tBodies).forEach(body => {
            const rows = Array.from(body.rows);
            if (rows.length < 2 || rows.some(row => row.cells.length <= columnIndex || row.cells[0]?.colSpan > 1)) return;
            rows.sort((leftRow, rightRow) => {
                const left = getSortableCellValue(leftRow.cells[columnIndex]);
                const right = getSortableCellValue(rightRow.cells[columnIndex]);
                if (left.type === 'empty' && right.type !== 'empty') return 1;
                if (right.type === 'empty' && left.type !== 'empty') return -1;
                const result = left.type === 'number' && right.type === 'number'
                    ? left.value - right.value
                    : String(left.value).localeCompare(String(right.value), 'ko', { numeric: true, sensitivity: 'base' });
                return direction === 'asc' ? result : -result;
            });
            rows.forEach(row => body.appendChild(row));
        });
    }

    document.querySelectorAll('table.modern-table').forEach(enhanceSortableTable);
    const sortableTableObserver = new MutationObserver(mutations => {
        const tables = new Set();
        mutations.forEach(mutation => {
            const table = mutation.target.nodeType === Node.ELEMENT_NODE
                ? mutation.target.closest?.('table.modern-table')
                : mutation.target.parentElement?.closest('table.modern-table');
            if (table) tables.add(table);
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                if (node.matches?.('table.modern-table')) tables.add(node);
                node.querySelectorAll?.('table.modern-table').forEach(item => tables.add(item));
            });
        });
        tables.forEach(enhanceSortableTable);
    });
    sortableTableObserver.observe(document.querySelector('main'), { childList: true, subtree: true });

    document.addEventListener('click', event => {
        const header = event.target.closest('table.modern-table thead th.sortable-header');
        if (header) sortTableByHeader(header);
    });
    document.addEventListener('keydown', event => {
        const header = event.target.closest('table.modern-table thead th.sortable-header');
        if (header && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            sortTableByHeader(header);
        }
    });

    if (modalAuditDetail) {
        modalAuditDetail.addEventListener('click', (e) => {
            if (e.target === modalAuditDetail) modalAuditDetail.classList.add('hidden');
        });
    }
});
