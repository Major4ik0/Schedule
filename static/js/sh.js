let swapContext = null;
let PERIODS_DATA = {};
let skipAutoScroll = false;
// Глобальный кэш цветов групп (выживает между переключениями месяцев)
const GROUP_COLOR_CACHE = new Map();
// Глобальный буфер для копирования/вставки пар
let clipboardPair = null;  // хранит данные скопированной пары
let clipboardCut = false;  // флаг: была ли пара вырезана

/* ===== Утилиты дат ===== */
const pad2 = (n) => String(n).padStart(2, '0'),
    isoFromYMD = (y, m0, d) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`,
    isWeekend = (d) => [0, 6].includes(d.getDay()),
    daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();

const getMonthBounds = (value) => {
    const [y, m] = value.split('-').map(Number);
    const year = y, month0 = m - 1;
    return {year, month0, first: new Date(year, month0, 1), lastDay: daysInMonth(year, month0)}
};

const formatMonthTitle = (value) => {
    const [y, m] = value.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', {month: 'long', year: 'numeric'})
};

let pendingScrollRestore = null;

const saveScrollPosition = () => {
    const wrap = document.querySelector('.table-wrap');
    if (!wrap) {
        pendingScrollRestore = null;
        return;
    }

    // Находим видимого преподавателя (чей заголовок ближе всего к верху)
    const sectionHeads = wrap.querySelectorAll('.section-head, .teacher-title');
    let closestTeacher = null;
    let minDistance = Infinity;

    sectionHeads.forEach(head => {
        const rect = head.getBoundingClientRect();
        const distance = Math.abs(rect.top);
        if (distance < minDistance) {
            minDistance = distance;
            closestTeacher = head.id || head.textContent.trim();
        }
    });

    pendingScrollRestore = {
        tableLeft: wrap.scrollLeft,
        windowTop: window.scrollY,
        windowLeft: window.scrollX,
        targetTeacher: closestTeacher,  // ← запоминаем преподавателя
        offset: sectionHeads.length > 0 ? sectionHeads[0].getBoundingClientRect().top : 0
    };

    console.log('📍 Сохранена позиция:', pendingScrollRestore.targetTeacher);
};

const forceRestoreScroll = () => {
    if (!pendingScrollRestore) return;

    const wrap = document.querySelector('.table-wrap');
    if (!wrap) return;

    // Пытаемся найти того же преподавателя по ID
    let targetElement = null;

    if (pendingScrollRestore.targetTeacher) {
        // Ищем по ID (для section-head) или по содержимому (для teacher-title)
        targetElement = document.getElementById(pendingScrollRestore.targetTeacher);

        if (!targetElement) {
            // Ищем по тексту
            const allHeads = wrap.querySelectorAll('.section-head, .teacher-title');
            allHeads.forEach(head => {
                if (head.textContent.trim() === pendingScrollRestore.targetTeacher) {
                    targetElement = head;
                }
            });
        }
    }

    if (targetElement) {
        // Прокручиваем к найденному преподавателю
        targetElement.scrollIntoView({ behavior: 'auto', block: 'start' });
    }

    // Восстанавливаем горизонтальный скролл
    setTimeout(() => {
        if (wrap) wrap.scrollLeft = pendingScrollRestore.tableLeft || 0;
    }, 50);

    console.log('📍 Восстановлена позиция к:', pendingScrollRestore.targetTeacher);

    // Не сбрасываем pendingScrollRestore сразу — может понадобиться ещё
    setTimeout(() => {
        pendingScrollRestore = null;
    }, 1000);
};

// let scrollTimeout;
// window.addEventListener('scroll', () => {
//     clearTimeout(scrollTimeout);
//     scrollTimeout = setTimeout(() => {
//         if (!pendingScrollRestore) {
//             const wrap = document.querySelector('.table-wrap');
//             pendingScrollRestore = {
//                 tableLeft: wrap ? wrap.scrollLeft : 0,
//                 windowTop: window.scrollY,
//                 windowLeft: window.scrollX
//             };
//         }
//     }, 100);
// }, { passive: true });

/* ===== API функции ===== */
const API_BASE = '/api';
let TEACHER_COLORS = {};
let COLOR_PALETTE = [];
let DISCIPLINES = [];
let CLASSROOMS = [];
let LESSON_TYPES = [];
let GROUPS = [];
let TEACHER_ID = {};
// Кэш для цветов групп и преподавателей
let TEACHER_COLOR_CACHE_PROMISES = {};

const isAdminMode = () => IS_ADMIN_MODE === true;

let FACULTIES = [];
const loadFaculties = async () => {
    try {
        const response = await fetch(`${API_BASE}/getFaculty`);
        const data = await response.json();
        FACULTIES = data.map(f => ({ id: f.idfaculty, name: f.faculty, short_name: f.shortName }));
    } catch (error) {
        console.error('Error loading faculties:', error);
        FACULTIES = [];
    }
};

const loadModalData = async () => {
    try {
        const [disciplinesRes, classroomsRes, lessonTypesRes, groupsRes] = await Promise.all([
            fetch(`${API_BASE}/getDisciplines`),
            fetch(`${API_BASE}/getClassrooms`),
            fetch(`${API_BASE}/getLessonTypes`),
            fetch(`${API_BASE}/getGroups`)
        ]);
        DISCIPLINES = await disciplinesRes.json();
        CLASSROOMS = await classroomsRes.json();
        LESSON_TYPES = await lessonTypesRes.json();
        GROUPS = await groupsRes.json();
        await loadFaculties();

        // Строим категории дисциплин по префиксу алиаса
        buildCourseCategories();

        populateSelect('f_type', LESSON_TYPES, 'id', 'alias');
        // f_course больше не select, скрываем или удаляем из DOM
        // populateSelect('f_course', DISCIPLINES, 'id', 'alias');

        initMultiSelect();
        initCourseSelect();
    } catch (error) {
        console.error('Error loading modal data:', error);
    }
};

// Построение категорий дисциплин
const buildCourseCategories = () => {
    COURSE_CATEGORIES = {};

    DISCIPLINES.forEach(course => {
        // Извлекаем префикс из алиаса: "ДП-1201" -> "ДП"
        // или "инф-ка" -> "инф-ка", "Экз. (12)" -> "Экз"
        const alias = course.alias || '';
        let prefix;

        if (alias.includes('-')) {
            // "ДП-1201" -> "ДП"
            prefix = alias.split('-')[0];
        } else if (alias.includes(' ')) {
            // "Экз. (12)" -> "Экз."
            prefix = alias.split(' ')[0];
        } else {
            prefix = alias;
        }

        if (!COURSE_CATEGORIES[prefix]) {
            COURSE_CATEGORIES[prefix] = [];
        }
        COURSE_CATEGORIES[prefix].push(course);
    });

    // Сортируем категории
    const sortedCategories = Object.keys(COURSE_CATEGORIES).sort((a, b) => {
        // Русские буквы в конец
        const aIsRus = /^[А-ЯЁ]/.test(a);
        const bIsRus = /^[А-ЯЁ]/.test(b);
        if (aIsRus && !bIsRus) return 1;
        if (!aIsRus && bIsRus) return -1;
        return a.localeCompare(b);
    });

    // Рендерим вкладки
    const tabsContainer = document.getElementById('courseTabs');
    if (!tabsContainer) return;

    let html = '<button class="pmk-tab active" data-course-prefix="all">Все</button>';
    sortedCategories.forEach(prefix => {
        const count = COURSE_CATEGORIES[prefix].length;
        html += `<button class="pmk-tab" data-course-prefix="${prefix}">${escapeHtml(prefix)} (${count})</button>`;
    });
    tabsContainer.innerHTML = html;

    // Обработчики вкладок
    tabsContainer.querySelectorAll('.pmk-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            tabsContainer.querySelectorAll('.pmk-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const prefix = tab.dataset.coursePrefix;
            renderCourseList(courseSearch?.value || '', prefix);
            if (courseDropdown) courseDropdown.style.display = 'block';
        });
    });
};

// Инициализация выбора дисциплины
const initCourseSelect = () => {
    if (!courseSearch || !courseDropdown || !courseList) return;

    courseSearch.addEventListener('focus', () => {
        courseDropdown.style.display = 'block';
        const activePrefix = document.querySelector('#courseTabs .pmk-tab.active')?.dataset?.coursePrefix || 'all';
        renderCourseList(courseSearch.value, activePrefix);
    });

    courseSearch.addEventListener('input', (e) => {
        courseDropdown.style.display = 'block';
        const activePrefix = document.querySelector('#courseTabs .pmk-tab.active')?.dataset?.coursePrefix || 'all';
        renderCourseList(e.target.value, activePrefix);
    });

    courseSearch.addEventListener('click', (e) => {
        e.stopPropagation();
        courseDropdown.style.display = 'block';
        const activePrefix = document.querySelector('#courseTabs .pmk-tab.active')?.dataset?.coursePrefix || 'all';
        renderCourseList(courseSearch.value, activePrefix);
    });

    // Закрытие при клике вне
    document.addEventListener('click', (e) => {
        const courseWrap = courseSearch.closest('.multi-select-wrapper');
        if (courseWrap && !courseWrap.contains(e.target) && courseDropdown) {
            courseDropdown.style.display = 'none';
        }
    });

    // Начальный рендер
    renderCourseList('', 'all');
};

// Рендер списка дисциплин
const renderCourseList = (filter = '', prefixFilter = 'all') => {
    if (!courseList) return;

    let filtered;

    if (prefixFilter === 'all') {
        filtered = DISCIPLINES;
    } else {
        filtered = COURSE_CATEGORIES[prefixFilter] || [];
    }

    // Поиск по названию или алиасу
    if (filter) {
        const searchLower = filter.toLowerCase();
        filtered = filtered.filter(c =>
            c.alias.toLowerCase().includes(searchLower) ||
            c.title.toLowerCase().includes(searchLower)
        );
    }

    // Сортируем по алиасу
    filtered = [...filtered].sort((a, b) => a.alias.localeCompare(b.alias, 'ru'));

    if (filtered.length === 0) {
        courseList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted); font-size: 12px;">Ничего не найдено</div>';
        return;
    }

    courseList.innerHTML = filtered.map(c => {
        const isSelected = selectedCourseId === c.id;
        return `
            <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-course-id="${c.id}">
                <span class="name">${escapeHtml(c.alias)}</span>
                <span class="course-title-sub" style="font-size: 10px; color: var(--muted); margin-left: auto; flex-shrink: 1; text-align: right;">${escapeHtml(c.title)}</span>
            </div>
        `;
    }).join('');

    // Обработчики выбора
    courseList.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', () => {
            const courseId = parseInt(item.dataset.courseId);
            const course = DISCIPLINES.find(c => c.id === courseId);

            selectedCourseId = courseId;
            if (courseSearch) courseSearch.value = course ? `${course.alias} — ${course.title}` : '';
            if (courseDropdown) courseDropdown.style.display = 'none';

            // Обновляем все элементы списка
            courseList.querySelectorAll('.multi-list-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
        });
    });
};

// Функция получения ID выбранной дисциплины
const getSelectedCourseId = () => {
    return selectedCourseId;
};

const populateSelect = (selectId, data, valueField, textField) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    const currentValue = select.value;
    while (select.options.length > 1) select.remove(1);
    data.forEach(item => {
        const option = document.createElement('option');
        option.value = item[valueField];
        option.textContent = item[textField];
        option.title = item.title || item[textField];
        select.appendChild(option);
    });
    if (currentValue && data.some(item => item[valueField] === currentValue)) select.value = currentValue;
};

/* ===== Цвета ===== */
const initColorSystem = async (teachersCount = 12) => {
    try {
        const paletteSize = Math.max(12, teachersCount);
        const response = await fetch(`${API_BASE}/palette/${paletteSize}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        COLOR_PALETTE = data.palette;
    } catch (error) {
        COLOR_PALETTE = generateFallbackPalette(teachersCount);
    }
};

const generateFallbackPalette = (count) => {
    const basePalette = ['#7c5cff', '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#06b6d4', '#d946ef', '#f97316', '#84cc16', '#14b8a6'];
    if (count <= basePalette.length) return basePalette.slice(0, count);
    const additionalColors = [];
    for (let i = basePalette.length; i < count; i++) {
        const hue = (i * 137.5) % 360;
        const saturation = 70 + (i % 3) * 10;
        const lightness = 45 + (i % 2) * 10;
        additionalColors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
    }
    return [...basePalette, ...additionalColors];
};

const getTeacherColor = async (teacherName) => {
    if (!teacherName) return '#cccccc';
    if (TEACHER_COLORS[teacherName]) {
        const colorObj = TEACHER_COLORS[teacherName];
        return typeof colorObj === 'object' ? colorObj.color : colorObj;
    }
    try {
        const response = await fetch(`${API_BASE}/teacher/${encodeURIComponent(teacherName)}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        const color = data.color || (typeof data === 'string' ? data : null);
        if (!color) throw new Error('No color in response');
        TEACHER_COLORS[teacherName] = color;
        return color;
    } catch (error) {
        if (COLOR_PALETTE.length === 0) await initColorSystem();
        const teacherHash = hashString(teacherName);
        const colorIndex = teacherHash % COLOR_PALETTE.length;
        const fallbackColor = COLOR_PALETTE[colorIndex];
        TEACHER_COLORS[teacherName] = fallbackColor;
        return fallbackColor;
    }
};

// Замените существующую функцию
const getTeachersColors = async (teachers) => {
    if (teachers.length === 0) return {};

    // Фильтруем только тех, кого нет в кэше
    const uncached = teachers.filter(t => !TEACHER_COLORS[t]);

    if (uncached.length === 0) {
        // Все уже в кэше
        const result = {};
        teachers.forEach(t => {
            const colorObj = TEACHER_COLORS[t];
            result[t] = typeof colorObj === 'object' ? colorObj.color : colorObj;
        });
        return result;
    }

    try {
        const totalTeachers = Object.keys(TEACHERS_LIST).length;
        const paletteSize = Math.max(12, totalTeachers);
        const response = await fetch(`${API_BASE}/teachers-colors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teachers: teachers, palette_size: paletteSize })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();

        // Обрабатываем и кэшируем
        Object.keys(data).forEach(teacher => {
            const colorObj = data[teacher];
            TEACHER_COLORS[teacher] = typeof colorObj === 'object' ? colorObj.color : colorObj;
        });

        // Возвращаем цвета для запрошенных преподавателей
        const result = {};
        teachers.forEach(teacher => {
            const colorObj = TEACHER_COLORS[teacher];
            result[teacher] = typeof colorObj === 'object' ? colorObj.color : colorObj;
        });

        return result;
    } catch (error) {
        // Fallback: генерируем цвета локально
        const result = {};
        teachers.forEach(teacher => {
            if (!TEACHER_COLORS[teacher]) {
                const teacherHash = hashString(teacher);
                const colorIndex = teacherHash % (COLOR_PALETTE.length || 12);
                TEACHER_COLORS[teacher] = COLOR_PALETTE[colorIndex] || '#cccccc';
            }
            const colorObj = TEACHER_COLORS[teacher];
            result[teacher] = typeof colorObj === 'object' ? colorObj.color : colorObj;
        });
        return result;
    }
};

const hashString = (s) => {
    if (!s) return 0;
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return Math.abs(h);
};

const teacherId = (n) => 't-' + hashString(n);

/* ===== API запросы ===== */
const fetchTeachers = async () => {
    try {
        const response = await fetch(`${API_BASE}/getTeachers`);
        if (!response.ok) throw new Error('Ошибка загрузки преподавателей');
        const teachers = await response.json();
        TEACHER_ID = teachers;
        const teacherNames = Object.keys(teachers);
        await getTeachersColors(teacherNames);
        return teachers;
    } catch (error) {
        console.error('Error fetching teachers:', error);
        return {};
    }
};

const fetchSchedule = async (teachers, month) => {
    if (teachers.length === 0) return {};
    try {
        const params = new URLSearchParams();
        params.append('month', month);
        const teacherIds = Object.values(TEACHER_ID).map(teacher => teacher.id);
        params.append('teachers', teacherIds.join(','));
        const response = await fetch(`${API_BASE}/getsSchedule?${params}`);
        if (!response.ok) {
            let errorText = 'Ошибка загрузки расписания';
            try { const errorData = await response.json(); errorText = errorData.error || errorText; } catch (e) { errorText = `HTTP error! status: ${response.status}`; }
            throw new Error(errorText);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching schedule:', error);
        throw error;
    }
};

const postSchedule = async (scheduleData) => {
    try {
        const response = await fetch(`${API_BASE}/postSchedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scheduleData)
        });
        if (!response.ok) {
            let errorText = 'Ошибка добавления расписания';
            try { const errorData = await response.json(); errorText = errorData.error || errorText; } catch (e) { errorText = `HTTP error! status: ${response.status}`; }
            throw new Error(errorText);
        }
        return await response.json();
    } catch (error) { console.error('Error posting schedule:', error); throw error; }
};

const updateSchedule = async (scheduleData) => {
    try {
        const response = await fetch(`${API_BASE}/updateSchedule`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scheduleData)
        });
        if (!response.ok) throw new Error('Ошибка обновления расписания');
        return await response.json();
    } catch (error) { console.error('Error updating schedule:', error); throw error; }
};

const deleteSchedule = async (scheduleId) => {
    try {
        const response = await fetch(`${API_BASE}/deleteSchedule?schedule_id=${scheduleId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Ошибка удаления расписания');
        return await response.json();
    } catch (error) { console.error('Error deleting schedule:', error); throw error; }
};

/* ===== Хранилище ===== */
let DATA = {};
let TEACHERS_LIST = {};
let TEACHER_CATEGORIES = {};

/* ===== DOM элементы ===== */
const teachersSel = document.getElementById('teachers'),
    allTeachersChk = document.getElementById('allTeachers'),
    monthLabel = document.getElementById('monthLabel'),
    buildBtn = document.getElementById('build'),
    build_1Btn = document.getElementById('build_1'),
    printBtn = document.getElementById('print'),
    tables = document.getElementById('tables'),
    adminInfo = document.getElementById('adminInfo'),
    userInfo = document.getElementById('userInfo');

const rail = document.getElementById('rail'),
    railSearch = document.getElementById('railSearch'),
    railToggle = document.getElementById('railToggle'),
    railCategories = document.getElementById('railCategories');

const modal = document.getElementById('modal'),
    modalTitle = document.getElementById('modalTitle'),
    f_type = document.getElementById('f_type'),
    f_course = document.getElementById('f_course'),
    f_lesson_num = document.getElementById('f_lesson_num'),
    btnSave = document.getElementById('btnSave'),
    btnDelete = document.getElementById('btnDelete');

const multiTeacher_el = document.getElementById('multiTeacher');
const teacherMulti = document.getElementById('teacherMulti'),
    teacherSearch = document.getElementById('teacherSearch'),
    teacherDropdown = document.getElementById('teacherDropdown'),
    teacherList = document.getElementById('teacherList'),
    teacherBadge = document.getElementById('teacherBadge');

const roomMulti = document.getElementById('roomMulti'),
    roomSearch = document.getElementById('roomSearch'),
    roomDropdown = document.getElementById('roomDropdown'),
    roomList = document.getElementById('roomList'),
    roomBadge = document.getElementById('roomBadge');

const groupMulti = document.getElementById('groupMulti'),
    groupSearch = document.getElementById('groupSearch'),
    groupDropdown = document.getElementById('groupDropdown'),
    groupList = document.getElementById('groupList'),
    groupBadge = document.getElementById('groupBadge');

const addScheduleBtn = document.getElementById('addSchedule'),
    f_date = document.getElementById('f_date'),
    f_pair = document.getElementById('f_pair');

const switchModeBtn = document.getElementById('switchMode');
const swapModal = document.getElementById('swapModal');
const swapModalTitle = document.getElementById('swapModalTitle');
const swapCancel = document.getElementById('swapCancel');
const swapConfirm = document.getElementById('swapConfirm');

const ms = document.getElementById('msTeachers'),
    msBadge = document.getElementById('msBadge'),
    msSearch = document.getElementById('msSearch'),
    msList = document.getElementById('msList'),
    msNone = document.getElementById('msNone'),
    msSelectCategory = document.getElementById('msSelectCategory'),
    msCategories = document.getElementById('msCategories');
// Дисциплина с поиском
const courseSearch = document.getElementById('courseSearch'),
    courseDropdown = document.getElementById('courseDropdown'),
    courseList = document.getElementById('courseList');

// Категории дисциплин
let COURSE_CATEGORIES = {};
let selectedCourseId = null;

/* ===== Состояния ===== */
let selectedTeachersModal = new Set();
let selectedRoomsModal = new Set();
let selectedGroupsModal = new Set();

const selectedTeachers = new Set();
let TEACHER_SECTIONS = [];
let activeCategory = 'all';
let RAIL_CATEGORIES_STATE = {};
let swapMode = false;
let selectedSwapCell = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let isManualAdd = false;
let ctx = null;
let clickTimer = null;

/* ===== Режим замены ===== */
switchModeBtn.addEventListener('click', () => {
    swapMode = !swapMode;
    if (swapMode) {
        switchModeBtn.textContent = 'Отменить замену';
        switchModeBtn.classList.remove('ghost');
        switchModeBtn.classList.add('yellow');
        document.body.classList.add('swap-mode');
        showNotification('Выберите пару для замены. Кликните на ячейку с парой.', 'info');
    } else {
        switchModeBtn.textContent = 'Замена';
        switchModeBtn.classList.remove('yellow');
        switchModeBtn.classList.add('ghost');
        document.body.classList.remove('swap-mode');
        resetSwapSelection();
    }
});

/* ===== Инициализация множественного выбора ===== */
const initMultiSelect = () => {
    setupMultiSelectTeacher();
    setupMultiSelectRoom();
    setupMultiSelectGroup();
};

const setupMultiSelectTeacher = () => {
    if (!teacherSearch || !teacherDropdown || !teacherList) return;
    teacherSearch.addEventListener('focus', () => {
        teacherDropdown.style.display = 'block';
        const activePmk = document.querySelector('#pmkTabs .pmk-tab.active')?.dataset?.pmk || 'all';
        renderTeacherMultiList(teacherSearch.value, activePmk);
    });
    teacherSearch.addEventListener('input', (e) => {
        teacherDropdown.style.display = 'block';
        const activePmk = document.querySelector('#pmkTabs .pmk-tab.active')?.dataset?.pmk || 'all';
        renderTeacherMultiList(e.target.value, activePmk);
    });
    teacherSearch.addEventListener('click', (e) => {
        e.stopPropagation();
        teacherDropdown.style.display = 'block';
        const activePmk = document.querySelector('#pmkTabs .pmk-tab.active')?.dataset?.pmk || 'all';
        renderTeacherMultiList(teacherSearch.value, activePmk);
    });
    renderTeacherMultiList('', '1');
};

const setupMultiSelectRoom = () => {
    if (!roomSearch || !roomDropdown || !roomList) return;
    const renderBuildingTabs = () => {
        const tabsContainer = document.getElementById('buildingTabs');
        if (!tabsContainer) return;
        const buildings = new Set();
        CLASSROOMS.forEach(r => buildings.add(getRoomBuilding(r.short_name)));
        let html = '<button class="pmk-tab active" data-building="all">Все</button>';
        [...buildings].sort().forEach(b => { html += `<button class="pmk-tab" data-building="${b}">${b}</button>`; });
        tabsContainer.innerHTML = html;
        tabsContainer.querySelectorAll('.pmk-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                tabsContainer.querySelectorAll('.pmk-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                roomDropdown.style.display = 'block';
                renderRoomMultiList(roomSearch.value, tab.dataset.building);
            });
        });
    };
    renderBuildingTabs();
    roomSearch.addEventListener('focus', () => { roomDropdown.style.display = 'block'; renderRoomMultiList(roomSearch.value); });
    roomSearch.addEventListener('input', (e) => { roomDropdown.style.display = 'block'; renderRoomMultiList(e.target.value); });
    roomSearch.addEventListener('click', (e) => { e.stopPropagation(); roomDropdown.style.display = 'block'; renderRoomMultiList(roomSearch.value); });
    renderRoomMultiList('');
};

const setupMultiSelectGroup = () => {
    if (!groupSearch || !groupDropdown) return;
    const renderFacultyTabs = () => {
        const tabsContainer = document.getElementById('facultyTabs');
        if (!tabsContainer) return;
        let html = '<button class="pmk-tab active" data-faculty="all">Все</button>';
        if (FACULTIES && FACULTIES.length > 0) {
            FACULTIES.forEach(f => {
                const name = f.short_name || f.name || 'Без названия';
                html += `<button class="pmk-tab" data-faculty="${f.id}">${escapeHtml(name)}</button>`;
            });
        }
        tabsContainer.innerHTML = html;
        tabsContainer.querySelectorAll('.pmk-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                tabsContainer.querySelectorAll('.pmk-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                groupDropdown.style.display = 'block';
                renderGroupMultiList(groupSearch.value, tab.dataset.faculty);
            });
        });
    };
    renderFacultyTabs();
    groupSearch.addEventListener('focus', () => {
        groupDropdown.style.display = 'block';
        const activeFaculty = document.querySelector('#facultyTabs .pmk-tab.active')?.dataset?.faculty || 'all';
        renderGroupMultiList(groupSearch.value, activeFaculty);
    });
    groupSearch.addEventListener('input', (e) => {
        groupDropdown.style.display = 'block';
        const activeFaculty = document.querySelector('#facultyTabs .pmk-tab.active')?.dataset?.faculty || 'all';
        renderGroupMultiList(e.target.value, activeFaculty);
    });
    groupSearch.addEventListener('click', (e) => {
        e.stopPropagation();
        groupDropdown.style.display = 'block';
        const activeFaculty = document.querySelector('#facultyTabs .pmk-tab.active')?.dataset?.faculty || 'all';
        renderGroupMultiList(groupSearch.value, activeFaculty);
    });
    renderGroupMultiList('', 'all');
};

// Закрытие дропдаунов при клике вне
document.addEventListener('click', (e) => {
    if (teacherMulti && !teacherMulti.contains(e.target) && teacherDropdown) teacherDropdown.style.display = 'none';
    if (roomMulti && !roomMulti.contains(e.target) && roomDropdown) roomDropdown.style.display = 'none';
    if (groupMulti && !groupMulti.contains(e.target) && groupDropdown) groupDropdown.style.display = 'none';
});

// ПМК фильтры
document.addEventListener('click', (e) => {
    const tab = e.target.closest('.pmk-tab');
    if (tab) {
        const container = tab.closest('.pmk-tabs');
        if (container) {
            container.querySelectorAll('.pmk-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        }
        const pmk = tab.dataset.pmk;
        renderTeacherMultiList(teacherSearch?.value || '', pmk);
    }
});

/* ===== Рендер множественных списков ===== */
const updateBadge = (type) => {
    let selectedSet, badgeEl, itemCount;
    switch(type) {
        case 'teacher': selectedSet = selectedTeachersModal; badgeEl = teacherBadge; itemCount = Object.keys(TEACHERS_LIST).length; break;
        case 'room': selectedSet = selectedRoomsModal; badgeEl = roomBadge; itemCount = CLASSROOMS.length; break;
        case 'group': selectedSet = selectedGroupsModal; badgeEl = groupBadge; itemCount = GROUPS.length; break;
    }
    if (!badgeEl) return;
    const count = selectedSet.size;
    if (count === 0) badgeEl.textContent = 'Ничего не выбрано';
    else if (count === itemCount) badgeEl.textContent = `Выбрано все (${count})`;
    else badgeEl.textContent = `Выбрано: ${count}`;
};

const renderTeacherMultiList = (filter = '', pmkFilter = 'all') => {
    const container = document.getElementById('teacherList');
    if (!container) return;
    const allTeachers = Object.keys(TEACHERS_LIST).sort((a, b) => a.localeCompare(b, 'ru'));
    const filtered = allTeachers.filter(name => {
        const categoryStr = String(TEACHERS_LIST[name]?.category || 'other');
        const matchesPmk = pmkFilter === 'all' || categoryStr === pmkFilter;
        const matchesSearch = !filter || name.toLowerCase().includes(filter.toLowerCase());
        return matchesPmk && matchesSearch;
    });
    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted); font-size: 12px;">Ничего не найдено</div>';
        return;
    }
    container.innerHTML = filtered.map(name => {
        const isSelected = selectedTeachersModal.has(name);
        const categoryStr = String(TEACHERS_LIST[name]?.category || 'other');
        const pmkLabel = categoryStr === '1' ? 'ПМК 1' : categoryStr === '2' ? 'ПМК 2' : 'Другое';
        return `<div class="multi-list-item ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(name)}">
            <input type="checkbox" ${isSelected ? 'checked' : ''} tabindex="-1">
            <span class="dot" style="background: ${TEACHER_COLORS[name] || '#ccc'}; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;"></span>
            <span class="name">${escapeHtml(name)}</span>
            <span class="pmk-badge">${pmkLabel}</span>
        </div>`;
    }).join('');
    container.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', () => {
            const name = item.dataset.name;
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) { selectedTeachersModal.add(name); item.classList.add('selected'); }
            else { selectedTeachersModal.delete(name); item.classList.remove('selected'); }
            renderTeacherTags();
            updateBadge('teacher');
        });
    });
    updateBadge('teacher');
};

const renderTeacherTags = () => {
    const container = document.getElementById('selectedTeachersTags');
    if (!container) return;
    if (selectedTeachersModal.size === 0) { container.innerHTML = ''; return; }
    container.innerHTML = Array.from(selectedTeachersModal).map(name => `
        <span class="tag-item">
            <span class="dot" style="background: ${TEACHER_COLORS[name] || '#ccc'}; width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 4px;"></span>
            ${escapeHtml(name)}
            <button class="tag-remove" data-name="${escapeHtml(name)}">×</button>
        </span>`).join('');
    container.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedTeachersModal.delete(btn.dataset.name);
            renderTeacherTags();
            const activePmk = document.querySelector('.pmk-tab.active')?.dataset?.pmk || 'all';
            renderTeacherMultiList(teacherSearch?.value || '', activePmk);
            updateBadge('teacher');
        });
    });
};

const getRoomBuilding = (shortName) => {
    if (!shortName) return 'Другие';
    const match = shortName.match(/^(\d+)к/);
    if (match) return `${match[1]}к`;
    const firstDigit = shortName.match(/^(\d+)/);
    if (firstDigit) return `${firstDigit[1]}к`;
    return 'Другие';
};

const renderRoomMultiList = (filter = '', buildingFilter = 'all') => {
    const container = document.getElementById('roomList');
    if (!container) return;
    const filtered = CLASSROOMS.filter(r => {
        const matchesSearch = !filter || r.short_name.toLowerCase().includes(filter.toLowerCase());
        const matchesBuilding = buildingFilter === 'all' || getRoomBuilding(r.short_name) === buildingFilter;
        return matchesSearch && matchesBuilding;
    });
    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted); font-size: 12px;">Ничего не найдено</div>';
        return;
    }
    container.innerHTML = filtered.map(r => {
        const isSelected = selectedRoomsModal.has(r.id.toString());
        return `<div class="multi-list-item ${isSelected ? 'selected' : ''}" data-id="${r.id}">
            <input type="checkbox" ${isSelected ? 'checked' : ''} tabindex="-1">
            <span class="name">🏫 ${escapeHtml(r.short_name)}</span>
            <span class="pmk-badge">${getRoomBuilding(r.short_name)}</span>
        </div>`;
    }).join('');
    container.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) { selectedRoomsModal.add(id); item.classList.add('selected'); }
            else { selectedRoomsModal.delete(id); item.classList.remove('selected'); }
            renderRoomTags();
            updateBadge('room');
        });
    });
    updateBadge('room');
};

const renderRoomTags = () => {
    const container = document.getElementById('selectedRoomsTags');
    if (!container) return;
    if (selectedRoomsModal.size === 0) { container.innerHTML = ''; return; }
    container.innerHTML = Array.from(selectedRoomsModal).map(id => {
        const room = CLASSROOMS.find(r => r.id.toString() === id);
        const name = room ? room.short_name : id;
        return `<span class="tag-item">🏫 ${escapeHtml(name)}<button class="tag-remove" data-id="${id}">×</button></span>`;
    }).join('');
    container.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedRoomsModal.delete(btn.dataset.id);
            renderRoomTags();
            renderRoomMultiList(roomSearch?.value || '');
            updateBadge('room');
        });
    });
};

const renderGroupMultiList = (filter = '', facultyFilter = 'all') => {
    const container = document.getElementById('groupList');
    if (!container) return;
    const filtered = GROUPS.filter(g => {
        const matchesSearch = !filter || g.name.toLowerCase().includes(filter.toLowerCase());
        const matchesFaculty = facultyFilter === 'all' || String(g.idfaculty) === String(facultyFilter);
        return matchesSearch && matchesFaculty;
    });
    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted); font-size: 12px;">Ничего не найдено</div>';
        return;
    }
    container.innerHTML = filtered.map(g => {
        const isSelected = selectedGroupsModal.has(String(g.id));
        const faculty = FACULTIES ? FACULTIES.find(f => String(f.id) === String(g.idfaculty)) : null;
        const facultyName = faculty ? (faculty.short_name || faculty.name) : '';
        return `<div class="multi-list-item ${isSelected ? 'selected' : ''}" data-id="${g.id}">
            <input type="checkbox" ${isSelected ? 'checked' : ''} tabindex="-1">
            <span class="name">${escapeHtml(g.name)}</span>
            ${facultyName ? `<span class="pmk-badge">${escapeHtml(facultyName)}</span>` : ''}
        </div>`;
    }).join('');
    container.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) { selectedGroupsModal.add(String(id)); item.classList.add('selected'); }
            else { selectedGroupsModal.delete(String(id)); item.classList.remove('selected'); }
            renderGroupTags();
            updateBadge('group');
        });
    });
    updateBadge('group');
};

const renderGroupTags = () => {
    const container = document.getElementById('selectedGroupsTags');
    if (!container) return;
    if (selectedGroupsModal.size === 0) { container.innerHTML = ''; return; }
    container.innerHTML = Array.from(selectedGroupsModal).map(id => {
        const group = GROUPS.find(g => g.id.toString() === id);
        const name = group ? group.name : id;
        return `<span class="tag-item">👥 ${escapeHtml(name)}<button class="tag-remove" data-id="${id}">×</button></span>`;
    }).join('');
    container.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedGroupsModal.delete(btn.dataset.id);
            renderGroupTags();
            renderGroupMultiList(groupSearch?.value || '');
            updateBadge('group');
        });
    });
};

/* ===== Модальное окно редактора ===== */
const openManualAddModal = () => {
    ctx = null;
    isManualAdd = true;

    if (window._editingContext) {
        window._editingContext = null;
    }

    selectedTeachersModal.clear();
    selectedRoomsModal.clear();
    selectedGroupsModal.clear();
    selectedCourseId = null;

    updateBadge('teacher');
    updateBadge('room');
    updateBadge('group');

    if (teacherSearch) teacherSearch.value = '';
    if (roomSearch) roomSearch.value = '';
    if (groupSearch) groupSearch.value = '';
    if (courseSearch) courseSearch.value = '';

    f_type.value = '';
    f_lesson_num.value = '';
    f_date.value = new Date().toISOString().split('T')[0];
    f_pair.value = '';

    // Очищаем теги
    const teacherTagsContainer = document.getElementById('selectedTeachersTags');
    const roomTagsContainer = document.getElementById('selectedRoomsTags');
    const groupTagsContainer = document.getElementById('selectedGroupsTags');
    if (teacherTagsContainer) teacherTagsContainer.innerHTML = '';
    if (roomTagsContainer) roomTagsContainer.innerHTML = '';
    if (groupTagsContainer) groupTagsContainer.innerHTML = '';

    // === ВАЖНО: ПЕРЕРИСОВЫВАЕМ СПИСКИ, ЧТОБЫ УБРАТЬ ГАЛОЧКИ ===
    const activePmk = document.querySelector('#pmkTabs .pmk-tab.active')?.dataset?.pmk || '1';
    renderTeacherMultiList('', activePmk);
    renderRoomMultiList('', 'all');
    renderGroupMultiList('', 'all');

    document.querySelectorAll('.manual-field').forEach(el => el.style.display = 'block');
    btnDelete.style.display = 'none';

    openModal('Добавление занятия', null);
};

let openModal_fn = (title, pairData = null) => {
    const showRecBtn = document.getElementById('showRecommendationsBtn');
    modalTitle.textContent = title;
    const pairInfo = document.getElementById('pairInfo');
    if (pairData) {
        pairInfo.style.display = 'block';
        const hoursMap = ['1-2 час', '3-4 час', '5-6 час', '7-8 час'];
        document.getElementById('pairInfoTeacher').textContent = pairData.teacher || '-';
        document.getElementById('pairInfoDate').textContent = pairData.date || '-';
        document.getElementById('pairInfoPeriod').textContent = hoursMap[pairData.index] || `Пара ${(pairData.index || 0) + 1}`;
    } else {
        pairInfo.style.display = 'none';
    }
    if (showRecBtn) showRecBtn.style.display = (isAdminMode() && (ctx || isManualAdd)) ? 'inline-flex' : 'none';
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
};

const openModal = function(title, pairData = null) {
    if (!isManualAdd) document.querySelectorAll('.manual-field').forEach(el => el.style.display = 'none');
    openModal_fn(title, pairData);
};

const closeModal = () => {
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');
    isManualAdd = false;
    document.querySelectorAll('.manual-field').forEach(el => el.style.display = 'none');
};

addScheduleBtn.addEventListener('click', () => {
    if (Object.keys(TEACHERS_LIST).length === 0) {
        alert('Сначала загрузите список преподавателей (нажмите "Показать расписание")');
        return;
    }
    openManualAddModal();
});

document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ===== Обработчик кликов по таблице ===== */
tables.addEventListener('click', async (e) => {
    const td = e.target.closest('td');
    if (!td || !td.dataset.teacher) return;
    saveScrollPosition();

    if (swapMode) {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        const teacher = td.dataset.teacher;
        const iso = td.dataset.date;
        const index = Number(td.dataset.index);
        const scheduleId = td.dataset.scheduleId;
        if (!scheduleId) { showNotification('В этой ячейке нет пары для замены', 'error'); return; }
        if (selectedSwapCell) selectedSwapCell.classList.remove('swap-selected');
        td.classList.add('swap-selected');
        selectedSwapCell = td;
        await openSwapModal(teacher, iso, index, scheduleId);
        return;
    }

    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        if (isAdminMode()) {
            if (DISCIPLINES.length === 0) await loadModalData();
            const teacher = td.dataset.teacher;
            const iso = td.dataset.date;
            const index = Number(td.dataset.index);
            const scheduleId = td.dataset.scheduleId;
            const teacher_mid = td.dataset.teacher_mid;
            ctx = {teacher, iso, index, scheduleId, teacher_mid};
            const list = (DATA[teacher]?.[iso] || []);
            const pair = list[index];

            selectedTeachersModal.clear();
            selectedRoomsModal.clear();
            selectedGroupsModal.clear();
            updateBadge('teacher');
            updateBadge('room');
            updateBadge('group');
            if (teacherSearch) teacherSearch.value = '';
            if (roomSearch) roomSearch.value = '';
            if (groupSearch) groupSearch.value = '';

            const getTypeId = (typeAlias) => { const found = LESSON_TYPES.find(item => item.alias === typeAlias); return found ? found.id : ''; };
            const getCourseId = (courseAlias) => { const found = DISCIPLINES.find(item => item.alias === courseAlias); return found ? found.id : ''; };

            if (pair) {
                f_type.value = getTypeId(pair.type);
                f_lesson_num.value = pair.lesson_num || '';

                // Заполняем дисциплину
                const courseId = getCourseId(pair.course);
                selectedCourseId = courseId;
                const course = DISCIPLINES.find(c => c.id == courseId);
                if (courseSearch) courseSearch.value = course ? `${course.alias} — ${course.title}` : '';

                // Заполняем преподавателей
                if (pair.teachers && pair.teachers.length > 0) {
                    pair.teachers.forEach(t => selectedTeachersModal.add(t));
                } else if (teacher) {
                    // selectedTeachersModal.add(teacher);
                }
                renderTeacherTags();
                updateBadge('teacher');

                // Заполняем аудитории (ищем ID по названиям)
                if (pair.rooms && pair.rooms.length > 0) {
                    pair.rooms.forEach(roomName => {
                        const room = CLASSROOMS.find(r => r.short_name === roomName);
                        if (room) {
                            selectedRoomsModal.add(String(room.id));
                        }
                    });
                } else if (pair.room) {
                    const roomObj = CLASSROOMS.find(r => r.short_name === pair.room);
                    if (roomObj) {
                        selectedRoomsModal.add(String(roomObj.id));
                    }
                }
                renderRoomTags();
                updateBadge('room');

                // Заполняем группы (ищем ID по названиям)
                if (pair.groups && pair.groups.length > 0) {
                    pair.groups.forEach(groupName => {
                        const groupObj = GROUPS.find(g => g.name === groupName);
                        if (groupObj) {
                            selectedGroupsModal.add(String(groupObj.id));
                        }
                    });
                } else if (pair.group) {
                    const groupObj = GROUPS.find(g => g.name === pair.group);
                    if (groupObj) {
                        selectedGroupsModal.add(String(groupObj.id));
                    }
                }
                renderGroupTags();
                updateBadge('group');
            } else {
                f_type.value = '';
                selectedCourseId = null;
                if (courseSearch) courseSearch.value = '';
                f_lesson_num.value = '';
            }
            btnDelete.style.display = pair && pair.schedule_id ? 'inline-flex' : 'none';
            openModal(`${teacher} — ${iso}`, { teacher, date: iso, index, scheduleId });
        }
        return;
    }
    selectCell(td);
    clickTimer = setTimeout(() => { clickTimer = null; }, 300);
});

/* ===== Сохранение / Удаление ===== */
btnSave.addEventListener('click', async () => {
    if (isManualAdd) {
        const selectedDate = f_date.value;
        const selectedPair = f_pair.value;

        if (!selectedDate) {
            alert('Выберите дату');
            return;
        }
        if (selectedTeachersModal.size === 0) {
            alert('Выберите хотя бы одного преподавателя');
            return;
        }
        if (selectedPair === '') {
            alert('Выберите пару');
            return;
        }

        const teacherNames = Array.from(selectedTeachersModal);
        const courseId = getSelectedCourseId();

        // Получаем массивы ID
        const roomIds = Array.from(selectedRoomsModal).map(id => parseInt(id));
        const groupIds = Array.from(selectedGroupsModal).map(id => parseInt(id));

        const scheduleData = {
            teacher_name: teacherNames[0] || '',
            teacher_mid: '',
            period: '',
            date: selectedDate,
            pair_index: parseInt(selectedPair),
            typeid: f_type.value.trim(),
            cid: courseId || '',
            lesson_num: f_lesson_num.value.trim() || null,
            teachers: teacherNames,
            rooms: roomIds,                    // массив всех аудиторий
            rid: roomIds,                      // массив всех аудиторий (для БД)
            groups: groupIds,                  // массив всех групп
            gid: groupIds[0] || ''             // первая группа как основная (одно число)
        };

        // Валидация: проверяем что есть хотя бы одна аудитория и группа
        if (!scheduleData.typeid || !scheduleData.cid || !roomIds.length || !groupIds.length) {
            alert('Пожалуйста, заполните все обязательные поля');
            return;
        }

        try {
            skipAutoScroll = true;
            saveScrollPosition();
            const result = await postSchedule(scheduleData);

            if (result.success) {
                closeModal();
                isManualAdd = false;
                const selectedTeachers = getSelectedTeachers();
                const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
                await loadScheduleData(selectedTeachers, monthVal);
                alert('Расписание успешно добавлено!');
            } else {
                alert('Ошибка при добавлении: ' + (result.error || 'Неизвестная ошибка'));
            }
        } catch (error) {
            alert('Ошибка при добавлении: ' + error.message);
        }
        return;
    }

    if (!ctx) return;

    const {teacher, iso, index, scheduleId, teacher_mid, period} = ctx;
    const teacherNames = Array.from(selectedTeachersModal);
    const courseId = getSelectedCourseId();

    // Получаем массивы ID
    const roomIds = Array.from(selectedRoomsModal).map(id => parseInt(id));
    const groupIds = Array.from(selectedGroupsModal).map(id => parseInt(id));

    const scheduleData = {
        teacher_name: teacherNames[0] || teacher,
        teacher_mid: teacher_mid,
        period: period,
        date: iso,
        pair_index: index,
        typeid: f_type.value.trim(),
        cid: courseId || '',
        lesson_num: f_lesson_num.value.trim() || null,
        teachers: teacherNames,
        rooms: roomIds,                    // массив всех аудиторий
        rid: roomIds,                      // массив всех аудиторий (для БД)
        groups: groupIds,                  // массив всех групп
        gid: groupIds[0] || ''             // первая группа как основная
    };

    if (!scheduleData.typeid || !scheduleData.cid) {
        alert('Пожалуйста, заполните обязательные поля');
        return;
    }

    try {
        saveScrollPosition();
        let result;
        if (scheduleId) {
            scheduleData.schedule_id = scheduleId;
            result = await updateSchedule(scheduleData);
        } else {
            result = await postSchedule(scheduleData);
        }

        if (result.success) {
            closeModal();
            const selectedTeachers = getSelectedTeachers();
            const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
            await loadScheduleData(selectedTeachers, monthVal);
            alert('Расписание успешно сохранено!');
        } else {
            alert('Ошибка при сохранении: ' + (result.error || 'Неизвестная ошибка'));
        }

    } catch (error) {
        alert('Ошибка при сохранении: ' + error.message);
    }
});

btnDelete.addEventListener('click', async () => {
    if (!ctx || !ctx.scheduleId) return;
    if (!confirm('Вы уверены, что хотите удалить эту запись?')) return;
    try {
        saveScrollPosition();
        await deleteSchedule(ctx.scheduleId);
        closeModal();
        const sel = getSelectedTeachers();
        const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
        await loadScheduleData(sel, monthVal);
    } catch (error) {
        alert('Ошибка при удалении: ' + error.message);
    }
});

/* ===== Модальное окно замены ===== */
const getPeriodsForDate = async (date) => {
    try {
        if (PERIODS_DATA[date]) return PERIODS_DATA[date];
        const response = await fetch(`${API_BASE}/getPeriodsForDate?date=${date}`);
        if (!response.ok) throw new Error('Failed to load periods');
        const data = await response.json();
        PERIODS_DATA[date] = data.periods;
        return data.periods;
    } catch (error) {
        console.error('Error loading periods:', error);
        return getFallbackPeriods(date);
    }
};

const getFallbackPeriods = (date) => {
    const dateObj = new Date(date);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    let studyYear = month >= 9 ? year : year - 1;
    const defaultPeriods = {
        2025: [
            {index: 0, pair_id: 112, name: '1-2 vac', short_name: '1-2 час', time_range: ''},
            {index: 1, pair_id: 113, name: '3-4 vac', short_name: '3-4 час', time_range: ''},
            {index: 2, pair_id: 114, name: '5-6 vac', short_name: '4-5 час', time_range: ''},
            {index: 3, pair_id: 115, name: '7-8 vac', short_name: '7-8 час', time_range: ''}
        ],
        2024: [
            {index: 0, pair_id: 104, name: '1-2 vac', short_name: '1-2 час', time_range: ''},
            {index: 1, pair_id: 105, name: '3-4 vac', short_name: '3-4 час', time_range: ''},
            {index: 2, pair_id: 106, name: '5-6 vac', short_name: '5-6 час', time_range: ''},
            {index: 3, pair_id: 107, name: '7-8 vac', short_name: '7-8 час', time_range: ''}
        ]
    };
    return defaultPeriods[studyYear] || defaultPeriods[2025];
};

const renderPairSelection = async (date, selectedPairIndex = 0) => {
    const pairSelection = document.getElementById('pairSelection');
    if (!pairSelection) return;
    try {
        pairSelection.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Загрузка расписания...</div>';
        const periods = await getPeriodsForDate(date);
        if (!periods || periods.length === 0) {
            pairSelection.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--danger);">Нет данных о расписании пар</div>';
            return;
        }
        const periodsHTML = periods.map(period => {
            const isSelected = period.index === selectedPairIndex;
            return `<div class="pair-option ${isSelected ? 'selected' : ''}" data-pair="${period.index}" data-pair-id="${period.pair_id}">${period.short_name}<span class="pair-time">${period.time_range}</span></div>`;
        }).join('');
        pairSelection.innerHTML = periodsHTML;
        pairSelection.querySelectorAll('.pair-option').forEach(option => {
            option.addEventListener('click', () => {
                pairSelection.querySelectorAll('.pair-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
                if (swapContext) {
                    swapContext.pairIndex = parseInt(option.dataset.pair);
                    swapContext.pairId = parseInt(option.dataset.pairId);
                }
            });
        });
    } catch (error) {
        console.error('Error rendering pair selection:', error);
        pairSelection.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--danger);">Ошибка загрузки расписания</div>';
    }
};

const populateTeacherListForSwap = async (excludeTeacher) => {
    const teachersList = document.getElementById('swapTeachersList');
    const teacherSearchInput = document.getElementById('swapTeacherSearch');
    teachersList.innerHTML = '';
    const allTeachers = Object.keys(TEACHERS_LIST);
    if (allTeachers.length === 0) {
        teachersList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Нет доступных преподавателей</div>';
        return;
    }
    const teachersHTML = await Promise.all(allTeachers.map(async (teacherName) => {
        const category = TEACHERS_LIST[teacherName]?.category || 'other';
        const categoryNames = {'1': 'ПМК 1', '2': 'ПМК 2', 'other': 'Другие'};
        const color = await getTeacherColor(teacherName);
        const isCurrentTeacher = teacherName === excludeTeacher;
        return `<div class="teacher-option ${isCurrentTeacher ? 'current-teacher' : ''}" data-name="${teacherName}" data-category="${category}" data-search="${teacherName.toLowerCase()}">
            <span class="teacher-dot" style="background: ${color}"></span>
            <span class="teacher-name">${teacherName} ${isCurrentTeacher ? '(текущий)' : ''}</span>
            <span class="teacher-category">${categoryNames[category] || 'Другие'}</span>
        </div>`;
    }));
    teachersList.innerHTML = teachersHTML.join('');
    teachersList.querySelectorAll('.teacher-option').forEach(option => {
        option.addEventListener('click', () => {
            teachersList.querySelectorAll('.teacher-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
        });
    });
    const handleSearch = () => {
        const searchTerm = teacherSearchInput.value.toLowerCase().trim();
        teachersList.querySelectorAll('.teacher-option').forEach(option => {
            option.style.display = (!searchTerm || option.dataset.search.includes(searchTerm)) ? '' : 'none';
        });
    };
    teacherSearchInput.addEventListener('input', handleSearch);
    document.querySelectorAll('#teacherCategories .teacher-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#teacherCategories .teacher-category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const selectedCategory = btn.dataset.category;
            teachersList.querySelectorAll('.teacher-option').forEach(option => {
                const category = option.dataset.category;
                option.style.display = (selectedCategory === 'all' || category === selectedCategory) ? '' : 'none';
            });
        });
    });
    const currentTeacherOption = teachersList.querySelector(`.teacher-option[data-name="${excludeTeacher}"]`);
    if (currentTeacherOption) currentTeacherOption.classList.add('selected');
};

// ===== ОБРАБОТЧИКИ КНОПОК РЕКОМЕНДАЦИЙ =====

// Обработчик кнопки "Рекомендации" (математические)
document.getElementById('loadRecommendations').addEventListener('click', async () => {
    console.log('🔘 Нажата кнопка "Рекомендации"');

    if (!swapContext) {
        showNotification('Сначала выберите пару для замены', 'warning');
        return;
    }

    const recommendationsPanel = document.getElementById('recommendationsPanel');
    const recommendationsList = document.getElementById('recommendationsList');
    const recLoading = document.getElementById('recLoading');
    const recEmpty = document.getElementById('recEmpty');
    const recBadge = document.getElementById('recBadge');

    recommendationsPanel.classList.add('open');
    recLoading.style.display = 'flex';
    recommendationsList.innerHTML = '';
    recEmpty.style.display = 'none';

    try {
        const currentData = swapContext.currentData;
        console.log('📊 Данные для математических рекомендаций:', currentData);

        if (!currentData) {
            recLoading.style.display = 'none';
            recEmpty.style.display = 'block';
            return;
        }

        // Получаем typeid
        let typeid = currentData.typeid;
        if (!typeid && currentData.type) {
            const foundType = LESSON_TYPES.find(t => t.alias === currentData.type);
            if (foundType) {
                typeid = foundType.id;
                console.log('✅ typeid из LESSON_TYPES:', typeid);
            }
        }

        const teacherInfo = TEACHERS_LIST[swapContext.fromTeacher];
        const teacherMid = teacherInfo?.id;

        let cathedraId = currentData.cathedra_id || currentData.idcathedra || 151;

        console.log('📤 Отправляю математический запрос:', {
            pair_type_id: typeid,
            cathedra_id: cathedraId,
            exclude_teacher_id: teacherMid,
            group_id: currentData.gid,
            course_id: currentData.cid,
            course_alias: currentData.course
        });

        const response = await fetch(`${API_BASE}/getTeacherRecommendations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pair_type_id: typeid,
                cathedra_id: cathedraId,
                exclude_teacher_id: teacherMid,
                group_id: currentData.gid,
                course_id: currentData.cid,
                course_alias: currentData.course
            })
        });

        const data = await response.json();
        console.log('📥 Математический ответ:', data);

        recLoading.style.display = 'none';

        if (data.success && data.recommendations && data.recommendations.length > 0) {
            console.log(`✅ Получено ${data.recommendations.length} рекомендаций`);
            displaySwapRecommendations(data.recommendations, 'mathematical');
            if (recBadge) {
                recBadge.textContent = data.recommendations.length;
                recBadge.style.display = 'inline';
            }
        } else {
            console.log('⚠️ Рекомендации пустые:', data);
            recEmpty.style.display = 'block';
            if (recBadge) recBadge.style.display = 'none';
        }
    } catch (error) {
        console.error('❌ Ошибка:', error);
        recLoading.style.display = 'none';
        recEmpty.style.display = 'block';
    }
});

// Обработчик кнопки "Рекомендации от ИИ"
document.getElementById('loadAIRecommendations').addEventListener('click', async () => {
    console.log('🤖 Нажата кнопка "Рекомендации от ИИ"');

    if (!swapContext) {
        showNotification('Сначала выберите пару для замены', 'warning');
        return;
    }

    const recommendationsPanel = document.getElementById('recommendationsPanel');
    const recommendationsList = document.getElementById('recommendationsList');
    const recLoading = document.getElementById('recLoading');
    const recEmpty = document.getElementById('recEmpty');
    const recNote = document.getElementById('recNote');
    const aiRecBadge = document.getElementById('aiRecBadge');

    recommendationsPanel.classList.add('open');
    recLoading.style.display = 'flex';
    recommendationsList.innerHTML = '';
    recEmpty.style.display = 'none';
    if (recNote) recNote.style.display = 'none';

    try {
        const currentData = swapContext.currentData;

        console.log('📊 Данные для AI рекомендаций:', currentData);

        if (!currentData) {
            showNotification('Нет данных о текущей паре', 'error');
            recLoading.style.display = 'none';
            recEmpty.style.display = 'block';
            return;
        }

        // ===== ПРОВЕРЯЕМ И ПОЛУЧАЕМ typeid =====
        let typeid = currentData.typeid;
        if (!typeid && currentData.type) {
            const foundType = LESSON_TYPES.find(t => t.alias === currentData.type);
            if (foundType) {
                typeid = foundType.id;
                console.log('✅ typeid получен из LESSON_TYPES:', typeid);
            }
        }

        if (!typeid) {
            console.error('❌ Не удалось определить typeid');
            recLoading.style.display = 'none';
            recEmpty.style.display = 'block';
            const emptyHint = recEmpty.querySelector('.empty-hint');
            if (emptyHint) emptyHint.textContent = 'Не удалось определить тип занятия';
            return;
        }

        // Получаем ID преподавателя
        const teacherInfo = TEACHERS_LIST[swapContext.fromTeacher];
        const teacherMid = teacherInfo?.id;

        // Определяем параметры
        const dateObj = new Date(swapContext.date);
        let dayOfWeek = dateObj.getDay();
        if (dayOfWeek === 0) dayOfWeek = 7;

        const pairIndex = swapContext.originalPairIndex ?? swapContext.pairIndex;

        // Получаем period_id
        let periodId = currentData.period || 0;
        try {
            const periodsData = await getPeriodsForDate(swapContext.date);
            if (periodsData && periodsData[pairIndex]) {
                periodId = periodsData[pairIndex].pair_id;
                console.log('✅ period_id из getPeriodsForDate:', periodId);
            }
        } catch (e) {
            console.warn('⚠️ Не удалось получить периоды, используем из данных:', periodId);
        }

        // Определяем cathedra_id
        let cathedraId = currentData.cathedra_id || currentData.idcathedra || 151;

        // Определяем study_year_id
        let studyYearId = 5;
        try {
            const studyYearRes = await fetch(`${API_BASE}/getStudyYear?date=${swapContext.date}`);
            const studyYearData = await studyYearRes.json();
            if (studyYearData.success) {
                studyYearId = studyYearData.study_year_id;
                console.log('✅ study_year_id:', studyYearId);
            }
        } catch (e) {
            console.warn('⚠️ Не удалось определить учебный год, используем:', studyYearId);
        }

        const requestBody = {
            group_id: currentData.gid,
            pair_type_id: typeid,  // ← теперь число, не null
            period_id: periodId,
            day_of_week: dayOfWeek,
            cathedra_id: cathedraId,
            study_year_id: studyYearId,
            exclude_teacher_id: teacherMid,
            course_id: currentData.cid,
            course_alias: currentData.course
        };

        console.log('📤 Отправляю AI запрос:', requestBody);

        const response = await fetch(`${API_BASE}/getAIRecommendations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        console.log('📥 AI ответ:', data);

        recLoading.style.display = 'none';

        if (data.success && data.recommendations && data.recommendations.length > 0) {
            console.log(`✅ Получено ${data.recommendations.length} AI-рекомендаций`);
            displaySwapRecommendations(data.recommendations, 'ai');
            if (aiRecBadge) {
                aiRecBadge.textContent = data.recommendations.length;
                aiRecBadge.style.display = 'inline';
            }
        } else {
            console.log('⚠️ AI рекомендации пустые:', data);
            recEmpty.style.display = 'block';
            if (recEmpty.querySelector('.empty-text')) {
                recEmpty.querySelector('.empty-text').textContent = 'Нет ИИ-рекомендаций';
            }
            if (recEmpty.querySelector('.empty-hint')) {
                recEmpty.querySelector('.empty-hint').textContent = data.error || 'Недостаточно данных для рекомендаций';
            }
            if (aiRecBadge) aiRecBadge.style.display = 'none';
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки AI рекомендаций:', error);
        recLoading.style.display = 'none';
        recEmpty.style.display = 'block';
        showNotification('Ошибка: ' + error.message, 'error');
    }
});

// Функция отображения рекомендаций
const displaySwapRecommendations = async (recommendations, type) => {
    const recommendationsList = document.getElementById('recommendationsList');
    if (!recommendationsList) {
        console.error('❌ Не найден элемент recommendationsList');
        return;
    }

    console.log(`🎨 Отображаю ${recommendations.length} рекомендаций типа "${type}"`);

    let html = '';

    for (let i = 0; i < recommendations.length; i++) {
        const rec = recommendations[i];

        // Определяем оценку
        let score;
        if (type === 'ai') {
            score = rec.confidence || (rec.ai_score ? rec.ai_score * 100 : 0);
        } else {
            score = rec.math_score || 0;
        }

        const scoreColor = score > 70 ? '#22c55e' : (score > 40 ? '#f59e0b' : '#ef4444');
        const teacherName = (rec.full_name || `${rec.lastname || ''} ${rec.firstname || ''} ${rec.patronymic || ''}`).trim();

        if (!teacherName) {
            console.warn('⚠️ Пропущена рекомендация без имени:', rec);
            continue;
        }

        const color = await getTeacherColor(teacherName);
        const initials = ((rec.firstname?.[0] || '') + (rec.lastname?.[0] || '')).toUpperCase() || '👤';
        const avatarColor = rec.id_pmk === 1 ? '#7c5cff' : '#22c55e';

        const sameGroupCount = rec.same_group_count || (rec.stats?.same_group || 0);
        const totalCount = rec.total_count || (rec.stats?.total || 0);

        let experienceBadge = '';
        if (sameGroupCount > 0) {
            experienceBadge = `<span class="rec-badge experience">✓ С группой (${sameGroupCount})</span>`;
        } else if (totalCount > 0) {
            experienceBadge = `<span class="rec-badge rank-high">📚 Дисциплина (${totalCount})</span>`;
        } else {
            experienceBadge = `<span class="rec-badge">🆕 Новый</span>`;
        }

        html += `
        <div class="rec-item ${sameGroupCount > 0 ? 'experienced' : ''}" 
             onclick="selectSwapTeacher('${teacherName.replace(/'/g, "\\'")}', ${rec.mid || 0})"
             style="animation: fadeIn 0.3s ease ${i * 0.05}s both;">
            <div class="rec-avatar" style="background: ${avatarColor};">${initials}</div>
            <div class="rec-info">
                <div class="rec-name">${escapeHtml(teacherName)}</div>
                <div class="rec-meta">
                    <span style="display: inline-flex; align-items: center; gap: 4px;">
                        <span class="dot" style="background: ${color}; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"></span>
                        ${rec.degree_short ? `<span class="rec-degree">🎓 ${escapeHtml(rec.degree_short)}</span>` : ''}
                        <span class="rec-pmk">ПМК ${rec.id_pmk || '?'}</span>
                    </span>
                </div>
                <div class="rec-meta" style="margin-top: 4px;">
                    ${experienceBadge}
                </div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0;">
                <span style="font-size: 16px; font-weight: 700; color: ${scoreColor};">${Math.round(score)}%</span>
                <span style="font-size: 11px; color: var(--muted);">выбрать →</span>
            </div>
        </div>`;
    }

    recommendationsList.innerHTML = html || '<div style="text-align: center; padding: 20px; color: var(--muted);">Нет данных для отображения</div>';

    console.log(`✅ Отображено рекомендаций: ${recommendations.length}`);
};

// Функция выбора преподавателя из рекомендаций
window.selectSwapTeacher = function(teacherName, teacherMid) {
    console.log('👆 Выбран преподаватель из рекомендаций:', teacherName);

    // Закрываем панель
    document.getElementById('recommendationsPanel').classList.remove('open');

    // Выбираем в списке замены
    const teachersList = document.getElementById('swapTeachersList');
    const options = teachersList.querySelectorAll('.teacher-option');

    let found = false;
    options.forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.name === teacherName) {
            option.classList.add('selected');
            option.scrollIntoView({ behavior: 'smooth', block: 'center' });
            found = true;
        }
    });

    if (!found) {
        // Если не нашли в списке, ищем по поиску
        const searchInput = document.getElementById('swapTeacherSearch');
        if (searchInput) {
            searchInput.value = teacherName.split(' ')[0]; // Фамилия
            searchInput.dispatchEvent(new Event('input'));
            setTimeout(() => {
                const updatedOptions = teachersList.querySelectorAll('.teacher-option');
                updatedOptions.forEach(opt => {
                    if (opt.dataset.name === teacherName) {
                        opt.classList.add('selected');
                        opt.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                });
            }, 200);
        }
    }

    showNotification(`Выбран: ${teacherName}`, 'success');
};

// Закрытие панели рекомендаций
document.getElementById('closeRecommendations').addEventListener('click', () => {
    document.getElementById('recommendationsPanel').classList.remove('open');
});

const openSwapModal = async (fromTeacher, date, pairIndex, scheduleId) => {
    try {
        const currentData = DATA[fromTeacher]?.[date]?.[pairIndex];
        console.log('🔍 Swap modal data:', { fromTeacher, date, pairIndex, currentData });

        if (!currentData) {
            showNotification('Не удалось получить данные о паре', 'error');
            return;
        }

        // ===== ВАЖНО: Получаем typeid =====
        if (!currentData.typeid && currentData.type) {
            // Ищем typeid по названию типа (alias)
            const foundType = LESSON_TYPES.find(t => t.alias === currentData.type);
            if (foundType) {
                currentData.typeid = foundType.id;
                console.log('✅ Найден typeid:', currentData.typeid, 'для типа:', currentData.type);
            } else {
                console.warn('⚠️ Не найден typeid для типа:', currentData.type);
            }
        }

        // Заполняем поля на UI
        document.getElementById('currentTeacher').textContent = fromTeacher;
        document.getElementById('currentCourse').textContent = currentData.course || 'Не указано';
        document.getElementById('currentGroup').textContent = currentData.group || 'Не указано';
        document.getElementById('currentRoom').textContent = currentData.room || 'Не указано';

        const swapDateInput = document.getElementById('swapDateInput');
        swapDateInput.value = date;
        swapDateInput.min = new Date().toISOString().split('T')[0];

        swapDateInput.addEventListener('change', async (e) => {
            if (swapContext) {
                swapContext.date = e.target.value;
                await renderPairSelection(e.target.value, swapContext.pairIndex);
            }
        });

        await renderPairSelection(date, pairIndex);
        await populateTeacherListForSwap(fromTeacher);

        swapModal.setAttribute('aria-hidden', 'false');
        swapModal.classList.add('open');
        swapModalTitle.textContent = `Замена пары: ${fromTeacher}`;

        // ===== СОХРАНЯЕМ ПОЛНЫЕ ДАННЫЕ =====
        swapContext = {
            fromTeacher,
            date,
            pairIndex,
            scheduleId,
            originalDate: date,
            originalPairIndex: pairIndex,
            pairId: currentData.pair_id || 0,
            currentData: currentData  // ← теперь содержит typeid
        };

        console.log('✅ swapContext сохранен:', swapContext);

    } catch (error) {
        console.error('Error opening swap modal:', error);
        showNotification('Ошибка при открытии окна замены', 'error');
    }
};

swapConfirm.addEventListener('click', async () => {
    const selectedTeacherOption = document.querySelector('#swapTeachersList .teacher-option.selected');
    if (!selectedTeacherOption) { showNotification('Выберите преподавателя для замены', 'error'); return; }
    if (!swapContext) { showNotification('Нет данных о замене', 'error'); return; }
    const toTeacher = selectedTeacherOption.dataset.name;
    const {fromTeacher, date, pairIndex, scheduleId, pairId, originalPairIndex} = swapContext;
    if (fromTeacher === toTeacher && pairIndex === originalPairIndex) { showNotification('Это та же самая ячейка', 'error'); return; }
    if (fromTeacher === toTeacher) {
        const existingPair = DATA[toTeacher]?.[date]?.[pairIndex];
        if (existingPair && !confirm(`У преподавателя ${toTeacher} уже есть пара в это время. Заменить?`)) return;
    }
    const actionType = fromTeacher === toTeacher ? 'Перенести пару' : 'Передать пару';
    const confirmMessage = `${actionType}:\n\nОт: ${fromTeacher}\n${fromTeacher === toTeacher ? '' : `К: ${toTeacher}\n`}Дата: ${date}\nПара: ${pairIndex + 1}`;
    if (!confirm(confirmMessage)) return;
    try {
        saveScrollPosition();
        swapConfirm.disabled = true;
        swapConfirm.innerHTML = '<span style="opacity: 0.7;">Выполнение...</span>';
        const result = await performSwap(fromTeacher, toTeacher, date, pairIndex, scheduleId, pairId);
        if (result.success) {
            showNotification('Замена успешно выполнена', 'success');
            const sel = getSelectedTeachers();
            const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
            await loadScheduleData(sel, monthVal);
            swapModal.setAttribute('aria-hidden', 'true');
            swapModal.classList.remove('open');
            resetSwapSelection();
            switchModeBtn.click();
        } else {
            alert('Ошибка при замене: ' + (result.error || 'Неизвестная ошибка'));
        }
    } catch (error) {
        alert('Ошибка при замене: ' + error.message);
    } finally {
        swapConfirm.disabled = false;
        swapConfirm.textContent = 'Выполнить замену';
    }
});

swapCancel.addEventListener('click', () => {
    swapModal.setAttribute('aria-hidden', 'true');
    swapModal.classList.remove('open');
    resetSwapSelection();
});

swapModal.addEventListener('click', (e) => { if (e.target === swapModal) { swapModal.setAttribute('aria-hidden', 'true'); swapModal.classList.remove('open'); resetSwapSelection(); } });

const resetSwapSelection = () => {
    if (selectedSwapCell) { selectedSwapCell.classList.remove('swap-selected'); selectedSwapCell = null; }
    swapContext = null;
    if (swapModal) {
        document.getElementById('swapTeacherSearch').value = '';
        document.querySelectorAll('#teacherCategories .teacher-category-btn').forEach((btn, index) => btn.classList.toggle('active', index === 0));
        document.querySelectorAll('#pairSelection .pair-option').forEach((option, index) => option.classList.toggle('selected', index === 0));
    }
};

const performSwap = async (fromTeacher, toTeacher, date, pairIndex, scheduleId, pairId = null) => {
    try {
        const response = await fetch(`${API_BASE}/swapSchedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_teacher: fromTeacher, to_teacher: toTeacher, date, pair_index: pairIndex, schedule_id: scheduleId, pair_id: pairId })
        });
        if (!response.ok) {
            let errorText = 'Ошибка выполнения замены';
            try { const errorData = await response.json(); errorText = errorData.error || errorText; } catch (e) { errorText = `HTTP error! status: ${response.status}`; }
            throw new Error(errorText);
        }
        return await response.json();
    } catch (error) { console.error('Error performing swap:', error); throw error; }
};

/* ===== Управление датами ===== */
function populateYears() {
    const yearSelect = document.getElementById('yearSelect');
    if (!yearSelect) return;
    yearSelect.innerHTML = '';
    const startYear = currentYear - 5;
    const endYear = currentYear + 5;
    for (let year = startYear; year <= endYear; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }
    yearSelect.value = currentYear;
}

function updateDateDisplay() {
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const monthLabelEl = document.getElementById('monthLabel');
    const monthSelect = document.getElementById('monthSelect');
    const yearSelect = document.getElementById('yearSelect');
    if (monthLabelEl) monthLabelEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
    if (monthSelect) monthSelect.value = currentMonth;
    if (yearSelect) yearSelect.value = currentYear;
}

function initDateSelectors() {
    populateYears();
    updateDateDisplay();
    document.getElementById('prevMonth')?.addEventListener('click', () => {
        saveScrollPosition();
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        updateDateDisplay();
        render();
    });
    document.getElementById('nextMonth')?.addEventListener('click', () => {
        saveScrollPosition();
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        updateDateDisplay();
        render();
    });
    document.getElementById('monthSelect')?.addEventListener('change', (e) => { currentMonth = parseInt(e.target.value); updateDateDisplay(); render(); });
    document.getElementById('yearSelect')?.addEventListener('change', (e) => { currentYear = parseInt(e.target.value); updateDateDisplay(); render(); });
    document.getElementById('todayBtn')?.addEventListener('click', () => { const now = new Date(); currentYear = now.getFullYear(); currentMonth = now.getMonth(); updateDateDisplay(); render(); });
}

/* ===== Загрузка преподавателей ===== */
const fillTeachers = async () => {
    try {
        TEACHERS_LIST = await fetchTeachers();
        TEACHER_CATEGORIES = {};
        Object.keys(TEACHERS_LIST).forEach(teacherName => {
            const category = String(TEACHERS_LIST[teacherName]?.category || 'other');
            if (!TEACHER_CATEGORIES[category]) TEACHER_CATEGORIES[category] = [];
            TEACHER_CATEGORIES[category].push(teacherName);
            TEACHERS_LIST[teacherName].category = category;
        });
        Object.keys(TEACHER_CATEGORIES).forEach(category => TEACHER_CATEGORIES[category].sort((a, b) => a.localeCompare(b, 'ru')));
        await initColorSystem(Object.keys(TEACHERS_LIST).length);
        teachersSel.innerHTML = Object.keys(TEACHERS_LIST).sort((a, b) => a.localeCompare(b, 'ru')).map(n => `<option value="${n}">${n}</option>`).join('');
        renderTeacherCategories();
        await renderTeacherList('all');
        updateMsBadge();
        Object.keys(TEACHERS_LIST).forEach(n => selectedTeachers.add(n));
        allTeachersChk.checked = true;
        updateMsBadge();
        if (Object.keys(TEACHERS_LIST).length <= 20) {
            Object.keys(TEACHERS_LIST).forEach(n => selectedTeachers.add(n));
            allTeachersChk.checked = true;
            updateMsBadge();
        }
    } catch (error) { console.error('Ошибка при загрузке преподавателей:', error); }
};

const renderTeacherCategories = () => {
    const categories = Object.keys(TEACHER_CATEGORIES).sort();
    const categoryNames = {'1': 'ПМК 1', '2': 'ПМК 2', 'other': 'Другие'};
    let categoriesHTML = `<div class="ms-category ${activeCategory === 'all' ? 'active' : ''}" data-category="all">Все преподаватели</div>`;
    categories.forEach(category => {
        const categoryName = categoryNames[category] || `Категория ${category}`;
        const count = TEACHER_CATEGORIES[category]?.length || 0;
        categoriesHTML += `<div class="ms-category ${activeCategory === category ? 'active' : ''}" data-category="${category}">${categoryName} <span class="category-count">(${count})</span></div>`;
    });
    if (msCategories) {
        msCategories.innerHTML = categoriesHTML;
        msCategories.querySelectorAll('.ms-category').forEach(cat => {
            cat.addEventListener('click', () => {
                activeCategory = cat.dataset.category;
                msCategories.querySelectorAll('.ms-category').forEach(c => c.classList.remove('active'));
                cat.classList.add('active');
                renderTeacherList(activeCategory);
            });
        });
    }
};

const renderTeacherList = async (category) => {
    let teachers = category === 'all' ? Object.keys(TEACHERS_LIST).sort((a, b) => a.localeCompare(b, 'ru')) : (TEACHER_CATEGORIES[category] || []);
    const msItems = await Promise.all(teachers.map(async (n) => {
        const color = await getTeacherColor(n);
        const isSelected = selectedTeachers.has(n);
        return `<label class="ms-item ${isSelected ? 'selected' : ''}" data-name="${n}"><input type="checkbox" data-name="${n}" ${isSelected ? 'checked' : ''} /><span class="dot" style="background:${color}"></span><span>${n}</span></label>`;
    }));
    msList.innerHTML = msItems.join('');
    updateMsBadge();
};

const updateMsBadge = () => {
    const c = selectedTeachers.size, t = Object.keys(TEACHERS_LIST).length;
    msBadge.textContent = c === t ? 'Все' : (c ? `${c} выбрано` : 'Ничего не выбрано');
    msBadge.className = c === t ? 'badge all' : (c ? 'badge some' : 'badge none');
};

const getSelectedTeachers = () => allTeachersChk.checked ? Object.keys(TEACHERS_LIST) : Array.from(selectedTeachers);

/* ===== Рендеринг таблиц ===== */
const buildHeadRow = (year, month0, lastDay) => {
    const tr = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.className = 'col-pair col-head row-head';
    th0.textContent = 'Часы';
    tr.appendChild(th0);
    const now = new Date(), todayIso = isoFromYMD(now.getFullYear(), now.getMonth(), now.getDate());
    for (let d = 1; d <= lastDay; d++) {
        const iso = isoFromYMD(year, month0, d), dt = new Date(year, month0, d);
        const th = document.createElement('th');
        th.className = 'day-th col-head';
        if (isWeekend(dt)) th.classList.add('weekend');
        if (iso === todayIso) th.classList.add('today');
        th.textContent = pad2(d);
        tr.appendChild(th);
    }
    return tr;
};

const renderTeacher = async (teacher, monthVal) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const {year, month0, lastDay} = getMonthBounds(monthVal);
    const tData = DATA[teacher] || {};

    // Предзагружаем цвета групп
    await preloadGroupColorsBatch(DATA);

    const teacherColor = await getTeacherColor(teacher);
    const id = teacherId(teacher);

    let html = `<div class="teacher-title" id="${id}">
        <span class="dot" style="width:12px;height:12px;border-radius:50%;background:${teacherColor};display:inline-block;margin-right:8px"></span>
        <span>${escapeHtml(teacher)}</span>
    </div>`;

    html += '<table>';
    html += '<thead>';
    html += buildHeadRowHTML(year, month0, lastDay); // Нужна HTML-версия
    html += '</thead><tbody>';

    const hoursMap = ['1 - 2', '3 - 4', '5 - 6', '7 - 8'];

    for (let i = 0; i < 4; i++) {
        html += `<tr><td class="row-head col-pair">${hoursMap[i]}</td>`;

        for (let d = 1; d <= lastDay; d++) {
            const iso = isoFromYMD(year, month0, d);
            const pair = (tData[iso] || [])[i];
            const isSunday = new Date(year, month0, d).getDay() === 0;

            let bgStyle = '';
            if (pair && pair.schedule_id && pair.group) {
                const cachedColor = GROUP_COLOR_CACHE.get(pair.group);
                if (cachedColor) bgStyle = `background-color:${cachedColor};`;
            }

            const scheduleId = pair?.schedule_id || '';
            const teacherMid = pair?.teacher_mid || '';
            const cellContent = pair ? buildPairHTML(pair) : '<span class="chip muted">-</span>';

            html += `<td class="${isSunday ? 'isSundayTrue' : 'isSundayFalse'} ${isAdminMode() ? 'editable' : ''}" 
                data-teacher="${escapeHtml(teacher)}" 
                data-date="${iso}" 
                data-index="${i}" 
                data-teacher_mid="${teacherMid}"
                ${scheduleId ? `data-schedule-id="${scheduleId}"` : ''}
                style="${bgStyle}">${cellContent}</td>`;
        }

        html += '</tr>';
    }

    html += '</tbody></table>';

    wrap.innerHTML = html;
    attachScrollUX(wrap, wrap.querySelector('table'));

    TEACHER_SECTIONS = [{name: teacher, id, el: document.getElementById(id)}];

    return wrap;
};

// HTML-версия buildHeadRow
const buildHeadRowHTML = (year, month0, lastDay) => {
    const now = new Date();
    const todayIso = isoFromYMD(now.getFullYear(), now.getMonth(), now.getDate());

    let html = '<tr><th class="col-pair col-head row-head">Часы</th>';

    for (let d = 1; d <= lastDay; d++) {
        const iso = isoFromYMD(year, month0, d);
        const dt = new Date(year, month0, d);
        let classes = 'day-th col-head';
        if (isWeekend(dt)) classes += ' weekend';
        if (iso === todayIso) classes += ' today';

        html += `<th class="${classes}">${pad2(d)}</th>`;
    }

    html += '</tr>';
    return html;
};

const renderCombinedStacked = async (teachers, monthVal) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const {year, month0, lastDay} = getMonthBounds(monthVal);

    console.time('⏱️ renderCombinedStacked');

    // Предзагружаем цвета групп ОДНИМ пакетом
    await preloadGroupColorsBatch(DATA);

    // Предзагружаем цвета преподавателей
    const teachersColors = await getTeachersColors(teachers);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.appendChild(buildHeadRow(year, month0, lastDay));
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    TEACHER_SECTIONS = [];

    // Используем innerHTML для массовой вставки
    let tbodyHTML = '';

    for (const tName of teachers) {
        const teacherColor = teachersColors[tName] || '#cccccc';
        const tData = DATA[tName] || {};
        const id = teacherId(tName);

        // Секция преподавателя
        tbodyHTML += `<tr><td colspan="${lastDay + 1}" class="section-head" id="${id}">
            <span class="chip ch" style="border-color:${teacherColor}">
                <span class="dot" style="background:${teacherColor}"></span>${escapeHtml(tName)}
            </span>
        </td></tr>`;

        TEACHER_SECTIONS.push({name: tName, id, el: null}); // el заполним позже

        const hoursMap = ['1 - 2', '3 - 4', '5 - 6', '7 - 8'];

        for (let i = 0; i < 4; i++) {
            tbodyHTML += `<tr><td class="row-head col-pair">${hoursMap[i]}</td>`;

            for (let d = 1; d <= lastDay; d++) {
                const iso = isoFromYMD(year, month0, d);
                const pair = (tData[iso] || [])[i];
                const isSunday = new Date(year, month0, d).getDay() === 0;

                let bgStyle = '';
                if (pair && pair.schedule_id && pair.group) {
                    const cachedColor = GROUP_COLOR_CACHE.get(pair.group);
                    if (cachedColor) {
                        bgStyle = `background-color:${cachedColor};`;
                    }
                }

                const scheduleId = pair?.schedule_id || '';
                const teacherMid = pair?.teacher_mid || '';
                const cellContent = pair ? buildPairHTML(pair) : '<span class="chip muted">-</span>';

                tbodyHTML += `<td class="${isSunday ? 'isSundayTrue' : 'isSundayFalse'} ${isAdminMode() ? 'editable' : ''}" 
                    data-teacher="${escapeHtml(tName)}" 
                    data-date="${iso}" 
                    data-index="${i}" 
                    data-teacher_mid="${teacherMid}"
                    ${scheduleId ? `data-schedule-id="${scheduleId}"` : ''}
                    style="${bgStyle}">${cellContent}</td>`;
            }

            tbodyHTML += '</tr>';
        }
    }

    tbody.innerHTML = tbodyHTML;
    table.appendChild(tbody);
    wrap.appendChild(table);

    // Заполняем ссылки на DOM-элементы
    TEACHER_SECTIONS.forEach(section => {
        section.el = document.getElementById(section.id);
    });

    attachScrollUX(wrap, table);

    console.timeEnd('⏱️ renderCombinedStacked');

    return wrap;
};
// Построение HTML для ячейки с парой (поддержка множественных значений)
const buildPairHTML = (pair) => {
    // Аудитории
    let roomsHTML = '';
    if (pair.rooms && pair.rooms.length > 0) {
        const uniqueRooms = [...new Set(pair.rooms.filter(r => r && r !== 'Ауд. не указана'))];
        if (uniqueRooms.length > 0) {
            roomsHTML = uniqueRooms.map(r => `<span class="chip green"><span class="dot"></span>${escapeHtml(r)}</span>`).join('');
        } else {
            roomsHTML = `<span class="chip green"><span class="dot"></span>${escapeHtml(pair.room || 'Ауд. не указана')}</span>`;
        }
    } else {
        roomsHTML = `<span class="chip green"><span class="dot"></span>${escapeHtml(pair.room || 'Ауд. не указана')}</span>`;
    }

    // Группы
    let groupsHTML = '';
    if (pair.groups && pair.groups.length > 0) {
        const uniqueGroups = [...new Set(pair.groups)];
        groupsHTML = uniqueGroups.map(g => `<span class="chip">${escapeHtml(g)}</span>`).join('');
    } else {
        groupsHTML = `<span class="chip">${escapeHtml(pair.group || '—')}</span>`;
    }

    return `<div class="pair">
        <div class="line">
            <span class="chip"><span class="dot"></span>${escapeHtml(pair.type)}${pair.lesson_num ? ` ${pair.lesson_num}` : ''}</span>
            ${roomsHTML}
        </div>
        <div class="line">
            ${groupsHTML}
            <span class="chip">${escapeHtml(pair.course)}</span>
        </div>
    </div>`;
};

/* ===== Навигация ===== */
const getWrap = () => tables.querySelector('.table-wrap');
const dayWidth = (wrap) => { const th = wrap?.querySelector('thead th:nth-child(2)'); return th ? th.getBoundingClientRect().width : 80; };
const getLastDay = () => daysInMonth(currentYear, currentMonth);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const updateNavDisabled = () => {
    const wrap = getWrap();
    if (!wrap) return;
    const last = getLastDay();
    const cur = clamp(currentDayFromScroll(wrap), 1, last);
};

const currentDayFromScroll = (wrap) => 1 + Math.round((wrap?.scrollLeft || 0) / dayWidth(wrap));

async function findCathedraByGroupName(groupName) {
    if (!groupName) return '#f0f0f0';

    // Проверяем глобальный кэш
    if (GROUP_COLOR_CACHE.has(groupName)) {
        return GROUP_COLOR_CACHE.get(groupName);
    }

    try {
        const response = await fetch(`${API_BASE}/getColorAtGroup/${encodeURIComponent(groupName)}`);
        if (!response.ok) {
            const color = '#f0f0f0';
            GROUP_COLOR_CACHE.set(groupName, color);
            return color;
        }
        const color = await response.json();
        GROUP_COLOR_CACHE.set(groupName, color);
        return color;
    } catch (e) {
        const color = '#f0f0f0';
        GROUP_COLOR_CACHE.set(groupName, color);
        return color;
    }
}

// Добавить в любое место
async function preloadGroupColorsBatch(data) {
    const uniqueGroups = new Set();

    // Собираем все группы из данных
    Object.values(data).forEach(teacherData => {
        Object.values(teacherData).forEach(pairs => {
            pairs.forEach(pair => {
                if (pair && pair.group) {
                    uniqueGroups.add(pair.group);
                }
            });
        });
    });

    // Фильтруем только незакешированные
    const uncached = [...uniqueGroups].filter(g => !GROUP_COLOR_CACHE.has(g));

    if (uncached.length === 0) {
        console.log('✅ Все цвета групп уже в кэше');
        return;
    }

    console.log(`🎨 Загружаем цвета для ${uncached.length} новых групп...`);

    // Загружаем параллельно с ограничением в 10 одновременных запросов
    const batchSize = 10;
    for (let i = 0; i < uncached.length; i += batchSize) {
        const batch = uncached.slice(i, i + batchSize);
        await Promise.allSettled(batch.map(g => findCathedraByGroupName(g)));
    }

    console.log(`✅ Цвета групп загружены (всего в кэше: ${GROUP_COLOR_CACHE.size})`);
}

// Предзагрузка всех цветов групп при загрузке данных
async function preloadGroupColors(data) {
    const uniqueGroups = new Set();

    Object.values(data).forEach(teacherData => {
        Object.values(teacherData).forEach(pairs => {
            pairs.forEach(pair => {
                if (pair && pair.group) {
                    uniqueGroups.add(pair.group);
                }
            });
        });
    });

    // Загружаем цвета параллельно
    const promises = [...uniqueGroups].map(group => findCathedraByGroupName(group));
    await Promise.allSettled(promises);
    console.log(`✅ Предзагружено цветов групп: ${uniqueGroups.size}`);
}

const populateJumpTeacher = async () => {
    const sel = getSelectedTeachers();

    const railCategoriesHTML = Object.keys(TEACHER_CATEGORIES).map(category => {
        const categoryNames = {
            '1': 'ПМК 1',
            '2': 'ПМК 2',
            'other': 'Другие'
        };
        const categoryName = categoryNames[category] || `Категория ${category}`;
        const teachersInCategory = TEACHER_CATEGORIES[category].filter(t => sel.includes(t));

        if (teachersInCategory.length === 0) return '';

        const isExpanded = RAIL_CATEGORIES_STATE[category] !== false;

        const teachersHTML = teachersInCategory.map(n => `
            <div class="rail-item" data-target="${teacherId(n)}">
                <span class="dot" style="background:${TEACHER_COLORS[n] || '#ccc'}"></span>
                <span class="rail-item-name">${n}</span>
            </div>
        `).join('');

        return `<div class="rail-category">
            <div class="rail-category-title ${isExpanded ? 'expanded' : 'collapsed'}" data-category="${category}">
                <span class="rail-category-arrow">${isExpanded ? '▼' : '▶'}</span>
                ${categoryName}
                <span class="rail-category-count">(${teachersInCategory.length})</span>
            </div>
            ${isExpanded ? `<div class="rail-category-content">${teachersHTML}</div>` : ''}
        </div>`;
    }).join('');

    railCategories.innerHTML = railCategoriesHTML;

    railCategories.querySelectorAll('.rail-category-title').forEach(title => {
        title.addEventListener('click', (e) => {
            e.stopPropagation();
            const category = title.dataset.category;
            const isExpanded = title.classList.contains('expanded');

            RAIL_CATEGORIES_STATE[category] = !isExpanded;

            populateJumpTeacher();
        });
    });

    railCategories.querySelectorAll('.rail-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.target;
            const el = document.getElementById(id);

            if (el) {
                const originalPosition = window.getComputedStyle(el).position;
                const originalTop = window.getComputedStyle(el).top;
                const originalZIndex = window.getComputedStyle(el).zIndex;

                if (el.classList.contains('section-head')) {
                    el.style.position = 'relative';
                    el.style.top = '0';
                    el.style.zIndex = 'auto';
                }

                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                    inline: 'nearest'
                });

                setTimeout(() => {
                    const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
                    window.scrollTo({
                        top: currentScroll - 50,
                        behavior: 'smooth'
                    });
                }, 300);

                setTimeout(() => {
                    if (el.classList.contains('section-head')) {
                        el.style.position = originalPosition;
                        el.style.top = originalTop;
                        el.style.zIndex = originalZIndex;
                    }
                }, 10);

            }
        });
    });
};

/* ===== Scroll UX ===== */
const attachScrollUX = (wrap, table) => {
    const toggleEdges = () => {
        const atStart = wrap.scrollLeft <= 2, atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2;
        wrap.classList.toggle('shadow-left', !atStart);
        wrap.classList.toggle('shadow-right', !atEnd);
    };
    if (!wrap._wheelBound) {
        wrap._wheelBound = true;
        wrap.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); wrap.scrollLeft += e.deltaY; } }, {passive: false});
    }
    if (!wrap._dragBound) {
        wrap._dragBound = true;
        let down = false, sx = 0, sl = 0, dragged = false;
        wrap.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; down = true; dragged = false; sx = e.clientX; sl = wrap.scrollLeft; });
        wrap.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - sx; if (!dragged && Math.abs(dx) > 3) { dragged = true; wrap.classList.add('grabbing'); } if (dragged) wrap.scrollLeft = sl - dx; });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => wrap.addEventListener(ev, () => { down = false; wrap.classList.remove('grabbing'); }));
    }
    toggleEdges();
};

/* ===== Основные функции ===== */
const loadScheduleData = async (teachers, month) => {
    if (teachers.length === 0) {
        DATA = {};
        await renderTable();
        return;
    }
    try {
        console.time('⏱️ Общая загрузка');

        console.time('  📡 API запрос');
        DATA = await fetchSchedule(teachers, month);
        console.timeEnd('  📡 API запрос');

        console.time('  🎨 Цвета групп');
        await preloadGroupColorsBatch(DATA);
        console.timeEnd('  🎨 Цвета групп');

        console.time('  📊 Рендер таблицы');
        await renderTable();
        console.timeEnd('  📊 Рендер таблицы');

        console.timeEnd('⏱️ Общая загрузка');

        if (swapMode) switchModeBtn.click();
    } catch (error) {
        console.error('Ошибка при загрузке расписания:', error);
        tables.innerHTML = `<p class="error">Ошибка загрузки расписания: ${error.message}</p>`;
        DATA = {};
    }
};

const renderTable = async () => {
    const sel = getSelectedTeachers(), monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    // === СОХРАНЯЕМ ТОЧНУЮ ПОЗИЦИЮ ПЕРЕД ОЧИСТКОЙ ===
    const wrap = document.querySelector('.table-wrap');
    const savedScrollTop = window.scrollY || window.pageYOffset;
    const savedScrollLeft = wrap ? wrap.scrollLeft : 0;

    tables.innerHTML = '';

    if (!sel.length) {
        tables.innerHTML = '<div class="note" style="margin-top: 6px;">Выберите преподавателей и месяц, затем нажмите "Показать расписание"</div>';
        await populateJumpTeacher();
        return;
    }
    if (sel.length > 1) {
        const table = await renderCombinedStacked(sel, monthVal);
        tables.appendChild(table);
    } else {
        const table = await renderTeacher(sel[0], monthVal);
        tables.appendChild(table);
    }

    await populateJumpTeacher();

    // === ВОССТАНАВЛИВАЕМ ПОЗИЦИЮ ===
    if (skipAutoScroll) {
        // После вставки/удаления — возвращаем точную позицию
        console.log('⏸️ Восстанавливаю позицию после операции');
        window.scrollTo(0, savedScrollTop);
        const newWrap = document.querySelector('.table-wrap');
        if (newWrap) {
            newWrap.scrollLeft = savedScrollLeft;
        }
        skipAutoScroll = false;
    } else if (pendingScrollRestore) {
        // При смене месяца — восстанавливаем по преподавателю
        console.log('📍 Восстанавливаю позицию после смены месяца');
        setTimeout(() => forceRestoreScroll(), 200);
    } else {
        // Первая загрузка — к сегодня
        const todayElement = document.querySelector('.today');
        if (todayElement) todayElement.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    }

    const newWrap = getWrap();
    if (newWrap) { updateNavDisabled(); }
};

// Добавьте в render() перед loadScheduleData
const render = () => {
    const sel = getSelectedTeachers(), monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    if (!monthVal) return;
    loadScheduleData(sel, monthVal);
};

/* ===== UI слушатели ===== */
printBtn.addEventListener('click', () => {
    const now = new Date();
    const printDate = now.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    document.body.setAttribute('data-print-date', printDate);
    const printHeader = document.createElement('div');
    printHeader.className = 'print-header';
    printHeader.innerHTML = `<h1>Расписание преподавателей</h1><div class="print-date">Дата печати: ${printDate}</div>`;
    const sel = getSelectedTeachers();
    const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const printInfo = document.createElement('div');
    printInfo.className = 'print-info';
    printInfo.innerHTML = `<strong>Период:</strong> ${formatMonthTitle(monthVal)}<br><strong>Преподаватели:</strong> ${sel.join(', ')}<br><strong>Количество преподавателей:</strong> ${sel.length}`;
    if (tables.firstChild) { tables.insertBefore(printHeader, tables.firstChild); tables.insertBefore(printInfo, tables.firstChild.nextSibling); }
    window.print();
    setTimeout(() => { if (printHeader.parentNode) printHeader.remove(); if (printInfo.parentNode) printInfo.remove(); }, 100);
});

// В начале функции buildBtn.addEventListener (поиск преподавателей изменился):
buildBtn.addEventListener('click', () => {
    // Проверяем, изменился ли набор преподавателей
    const currentSelection = getSelectedTeachers().sort().join(',');
    if (buildBtn._lastSelection && buildBtn._lastSelection !== currentSelection) {
        // Набор преподавателей изменился — очищаем кэш
        GROUP_COLOR_CACHE.clear();
    }
    buildBtn._lastSelection = currentSelection;

    render();
});
build_1Btn.addEventListener('click', () => {
    const currentSelection = getSelectedTeachers().sort().join(',');
    if (build_1Btn._lastSelection && build_1Btn._lastSelection !== currentSelection) {
        GROUP_COLOR_CACHE.clear();
    }
    build_1Btn._lastSelection = currentSelection;

    render();
    ms.classList.remove('open');
});
allTeachersChk.addEventListener('change', () => {
    if (allTeachersChk.checked) { selectedTeachers.clear(); Object.keys(TEACHERS_LIST).forEach(n => selectedTeachers.add(n)); }
    else selectedTeachers.clear();
    updateMsBadge();
    renderTeacherList(activeCategory);
});

ms.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); ms.classList.toggle('open'); });
document.addEventListener('click', (e) => { if (!ms.contains(e.target)) ms.classList.remove('open'); });

msSearch.addEventListener('input', () => {
    const q = msSearch.value.trim().toLowerCase();
    msList.querySelectorAll('.ms-item').forEach(li => li.style.display = li.dataset.name.toLowerCase().includes(q) ? '' : 'none');
});

msList.addEventListener('click', (e) => {
    const item = e.target.closest('.ms-item');
    if (!item) return;
    const name = item.dataset.name, cb = item.querySelector('input[type="checkbox"]');
    cb.checked = !cb.checked;
    if (cb.checked) selectedTeachers.add(name); else selectedTeachers.delete(name);
    allTeachersChk.checked = selectedTeachers.size === Object.keys(TEACHERS_LIST).length;
    updateMsBadge();
});

msNone.addEventListener('click', () => { selectedTeachers.clear(); allTeachersChk.checked = false; updateMsBadge(); renderTeacherList(activeCategory); });

msSelectCategory.addEventListener('click', () => {
    if (activeCategory === 'all') { selectedTeachers.clear(); Object.keys(TEACHERS_LIST).forEach(n => selectedTeachers.add(n)); }
    else { const categoryTeachers = TEACHER_CATEGORIES[activeCategory] || []; categoryTeachers.forEach(n => selectedTeachers.add(n)); }
    allTeachersChk.checked = selectedTeachers.size === Object.keys(TEACHERS_LIST).length;
    updateMsBadge();
    renderTeacherList(activeCategory);
});

railSearch.addEventListener('input', () => {
    const q = railSearch.value.trim().toLowerCase();
    railCategories.querySelectorAll('.rail-item').forEach(i => i.style.display = i.textContent.toLowerCase().includes(q) ? '' : 'none');
});

railToggle.addEventListener('click', () => rail.classList.toggle('collapsed'));

/* ===== Рекомендации в редакторе ===== */
const loadPairRecommendations = async () => {
    const courseId = getSelectedCourseId();
    const groupId = Array.from(selectedGroupsModal)[0] || '';
    const date = isManualAdd ? f_date.value : (ctx ? ctx.iso : '');
    const pairIndex = isManualAdd ? f_pair.value : (ctx ? ctx.index : 0);
    const typeId = f_type.value;

    if (!courseId) { showNotification('Сначала выберите дисциплину', 'warning'); return; }
    if (!groupId) { showNotification('Сначала выберите группу', 'warning'); return; }
    if (!date || pairIndex === '') { showNotification('Заполните дату и пару', 'warning'); return; }

    const course = DISCIPLINES.find(c => c.id == courseId);
    const courseAlias = course ? course.alias : '';

    document.getElementById('editorRecTeacher').textContent = 'Поиск по дисциплине...';
    document.getElementById('editorRecDate').textContent = date || 'Не выбрана';
    document.getElementById('editorRecPeriod').textContent = `Пара ${parseInt(pairIndex) + 1}`;

    const recModal = document.getElementById('editorRecModal');
    const loading = document.getElementById('editorRecLoading');
    const list = document.getElementById('editorRecList');
    const empty = document.getElementById('editorRecEmpty');

    recModal.setAttribute('aria-hidden', 'false');
    recModal.classList.add('open');
    if (loading) loading.style.display = 'flex';
    if (list) list.style.display = 'none';
    if (empty) empty.style.display = 'none';

    try {
        const response = await fetch('/api/findTeachersForCourse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ course_id: parseInt(courseId), course_alias: courseAlias, group_id: parseInt(groupId), date, pair_index: parseInt(pairIndex || 0), type_id: typeId ? parseInt(typeId) : null })
        });
        const data = await response.json();
        if (loading) loading.style.display = 'none';
        if (data.success) {
            const recommendations = data.recommendations || [];
            if (recommendations.length > 0) {
                displayTeacherRecommendations(recommendations, { courseId, groupId, date, pairIndex, course });
                if (list) list.style.display = 'block';
                document.getElementById('editorRecTeacher').textContent = `Найдено ${recommendations.length} преподавателей`;
            } else {
                if (empty) { empty.querySelector('.empty-text').textContent = 'Нет преподавателей'; empty.querySelector('.empty-hint').textContent = 'Никто не вел эту дисциплину для выбранной группы'; empty.style.display = 'block'; }
            }
        } else {
            if (empty) { empty.querySelector('.empty-text').textContent = 'Ошибка'; empty.querySelector('.empty-hint').textContent = data.error || 'Не удалось получить рекомендации'; empty.style.display = 'block'; }
        }
    } catch (error) {
        console.error('Error loading recommendations:', error);
        if (loading) loading.style.display = 'none';
        if (empty) { empty.querySelector('.empty-text').textContent = 'Ошибка соединения'; empty.querySelector('.empty-hint').textContent = error.message; empty.style.display = 'block'; }
    }
};

const displayTeacherRecommendations = (recommendations, context) => {
    const list = document.getElementById('editorRecList');
    if (!list) return;
    let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
    html += `<div style="padding: 8px 12px; background: var(--surface); border-radius: 8px; margin-bottom: 8px; font-size: 13px; color: var(--muted);">📖 Дисциплина: <b>${escapeHtml(context.course?.alias || context.course?.title || '—')}</b></div>`;
    recommendations.forEach((rec, index) => {
        const score = rec.confidence || rec.match_score || 0;
        const scoreColor = score > 70 ? '#22c55e' : (score > 40 ? '#f59e0b' : '#ef4444');
        const initials = (rec.firstname?.[0] || '') + (rec.lastname?.[0] || '');
        const avatarColor = rec.id_pmk === 1 ? '#7c5cff' : '#22c55e';
        const totalCount = rec.total_count || 0;
        const sameGroupCount = rec.same_group_count || 0;
        let experienceBadge = '';
        if (sameGroupCount > 0) experienceBadge = `<span class="rec-badge" style="background: #22c55e;">✓ Вел у этой группы (${sameGroupCount} раз)</span>`;
        else if (totalCount > 0) experienceBadge = `<span class="rec-badge" style="background: #f59e0b;">📚 Вел дисциплину (${totalCount} раз)</span>`;
        else experienceBadge = `<span class="rec-badge" style="background: #94a3b8;">🆕 Нет опыта с этой дисциплиной</span>`;
        html += `<div class="rec-item" style="animation: fadeIn 0.3s ease ${index * 0.05}s both; cursor: pointer;" onclick="selectTeacherForEditor('${rec.full_name.replace(/'/g, "\\'")}', '${rec.mid}', '${rec.id_pmk || ''}')">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="rec-avatar" style="background: ${avatarColor}; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 14px;">${initials || '👤'}</div>
                    <span style="font-weight: 600; font-size: 14px;">${escapeHtml(rec.full_name)}</span>
                </div>
                <span class="rec-badge" style="background: ${scoreColor}20; color: ${scoreColor}; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;">📊 ${Math.round(score)}%</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; margin-left: 46px;">
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">${rec.degree_short ? `<span class="rec-degree">🎓 ${escapeHtml(rec.degree_short)}</span>` : ''}<span class="rec-pmk">ПМК ${rec.id_pmk || '?'}</span></div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">${experienceBadge}</div>
                ${rec.last_lesson_date ? `<div style="font-size: 11px; color: var(--muted);">Последний раз вел: ${rec.last_lesson_date}</div>` : ''}
            </div>
        </div>`;
    });
    html += '</div>';
    list.innerHTML = html;
};

const selectTeacherForEditor = (teacherName, teacherMid, pmk) => {
    selectedTeachersModal.add(teacherName);
    renderTeacherTags();
    updateBadge('teacher');
    closeEditorRecModal();
    showNotification(`Добавлен: ${teacherName} (ПМК ${pmk || '?'})`, 'success');
};

const selectCandidate = (name, id) => {
    selectedTeachersModal.add(name);
    renderTeacherTags();
    updateBadge('teacher');
    if (teacherDropdown) teacherDropdown.style.display = 'none';
    showNotification(`Выбран: ${name}`, 'success');
};

const closeEditorRecModal = () => {
    const recModal = document.getElementById('editorRecModal');
    recModal.setAttribute('aria-hidden', 'true');
    recModal.classList.remove('open');
    document.getElementById('editorRecLoading').style.display = 'none';
    document.getElementById('editorRecList').style.display = 'none';
    document.getElementById('editorRecEmpty').style.display = 'none';
};

const initEditorRecommendations = () => {
    const showRecBtn = document.getElementById('showRecommendationsBtn');
    const closeModalBtn = document.getElementById('closeEditorRecModal');
    const closeModalBtn2 = document.getElementById('closeEditorRecModalBtn');
    if (showRecBtn) showRecBtn.addEventListener('click', () => loadPairRecommendations());
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeEditorRecModal);
    if (closeModalBtn2) closeModalBtn2.addEventListener('click', closeEditorRecModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const rm = document.getElementById('editorRecModal'); if (rm.getAttribute('aria-hidden') === 'false') closeEditorRecModal(); } });
    const recModal = document.getElementById('editorRecModal');
    if (recModal) recModal.addEventListener('click', (e) => { if (e.target === recModal) closeEditorRecModal(); });
};

/* ===== Утилиты ===== */
const showNotification = (message, type = 'info') => {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; padding: 12px 16px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 1000; max-width: 300px;';
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
};

const escapeHtml = (str) => {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

/* ===== Копирование/вставка ===== */
let copiedPair = null;
let cutPair = null;
let selectedCell = null;

const getPairDataFromCell = (td) => {
    const teacher = td.dataset.teacher;
    const iso = td.dataset.date;
    const index = Number(td.dataset.index);

    if (!teacher || !iso) return null;

    const pair = DATA[teacher]?.[iso]?.[index];
    if (!pair) return null;

    let typeId = pair.typeid || '';
    if (!typeId && pair.type) {
        const found = LESSON_TYPES.find(t => t.alias === pair.type || t.id == pair.type);
        typeId = found ? found.id : '';
    }

    const courseId = pair.cid || '';

    // Получаем ID для аудиторий
    const roomIds = (pair.rooms || []).map(roomName => {
        if (!isNaN(Number(roomName))) {
            const numId = Number(roomName);
            const found = CLASSROOMS.find(c => c.id === numId);
            if (found) return numId;
        }
        const found = CLASSROOMS.find(c => c.short_name === roomName || String(c.id) === String(roomName));
        return found ? found.id : null;
    }).filter(id => id !== null);

    const allRoomIds = roomIds.length > 0 ? roomIds : (() => {
        if (pair.room) {
            const found = CLASSROOMS.find(c => c.short_name === pair.room || String(c.id) === String(pair.room));
            if (found) return [found.id];
        }
        return pair.rid ? [pair.rid] : [];
    })();

    // Получаем ID для групп (ИСПРАВЛЕНО)
    const groupIds = (pair.groups || []).map(groupName => {
        if (!isNaN(Number(groupName))) {
            const numId = Number(groupName);
            const found = GROUPS.find(gr => gr.id === numId);
            if (found) return numId;
        }
        const found = GROUPS.find(gr => gr.name === groupName || String(gr.id) === String(groupName));
        if (found) return found.id;

        // Пробуем gid из пары
        console.warn('⚠️ Группа не найдена:', groupName, 'gid из пары:', pair.gid);
        return pair.gid || null;
    }).filter(id => id !== null && id !== '');

    const allGroupIds = groupIds.length > 0 ? groupIds : (() => {
        if (pair.gid) {
            const found = GROUPS.find(gr => gr.id === pair.gid || String(gr.id) === String(pair.gid));
            if (found) return [found.id];
        }
        if (pair.group) {
            const found = GROUPS.find(gr => gr.name === pair.group || String(gr.id) === String(pair.group));
            if (found) return [found.id];
        }
        console.error('❌ Не удалось найти ID группы:', pair.group, pair.gid);
        return [];
    })();

    // Для отправки на бэкенд: gid должен быть одним числом (первая группа)
    const primaryGid = allGroupIds.length > 0 ? allGroupIds[0] : '';

    return {
        typeid: typeId,
        cid: courseId,
        lesson_num: pair.lesson_num || null,
        rooms: allRoomIds,
        rid: allRoomIds,
        groups: allGroupIds,
        gid: primaryGid,                    // одно число для БД
        teachers: pair.teachers || [],
        course_alias: pair.course || '',
        type_alias: pair.type || '',
        _sourceScheduleId: null             // заполнится в обработчике Ctrl+C/X
    };
};

const pastePairToCell = async (td, pairInfo) => {
    if (!isAdminMode()) {
        showNotification('Копирование/вставка доступны только в режиме администратора', 'warning');
        return;
    }

    const targetTeacher = td.dataset.teacher;
    const iso = td.dataset.date;
    const index = Number(td.dataset.index);

    const existingPair = DATA[targetTeacher]?.[iso]?.[index];
    if (existingPair && existingPair.schedule_id) {
        if (!confirm('В ячейке уже есть пара. Заменить её?')) return;
    }

    const scheduleData = {
        teacher_name: targetTeacher,
        teacher_mid: '',
        period: '',
        date: iso,
        pair_index: index,
        typeid: pairInfo.typeid || '',
        rid: pairInfo.rid || [],
        gid: pairInfo.gid || '',
        cid: pairInfo.cid || '',
        lesson_num: pairInfo.lesson_num || null,
        teachers: [targetTeacher],
        rooms: pairInfo.rooms || [],
        groups: pairInfo.groups || []
    };

    if (!scheduleData.typeid || !scheduleData.cid || !scheduleData.gid) {
        showNotification('Ошибка: неполные данные пары.', 'error');
        return;
    }

    try {
        // ЯВНО сохраняем позицию
        skipAutoScroll = true;
        console.log('📍 Позиция сохранена перед вставкой');

        let result;

        if (existingPair && existingPair.schedule_id) {
            scheduleData.schedule_id = existingPair.schedule_id;
            result = await updateSchedule(scheduleData);
        } else {
            result = await postSchedule(scheduleData);
        }

        if (result.success) {
            showNotification(`Пара вставлена → ${targetTeacher}`, 'success');
            const sel = getSelectedTeachers();
            const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
            await loadScheduleData(sel, monthVal);

            if (clipboardCut && clipboardPair?._sourceScheduleId) {
                try {
                    saveScrollPosition();
                    await deleteSchedule(clipboardPair._sourceScheduleId);
                    showNotification('Исходная пара удалена', 'info');
                    await loadScheduleData(sel, monthVal);
                } catch (e) {
                    console.error('Error deleting source pair:', e);
                }
                clipboardCut = false;
            }
            ctx = null;
            isManualAdd = false;
        } else {
            showNotification('Ошибка при вставке: ' + (result.error || 'Неизвестная ошибка'), 'error');
        }
    } catch (error) {
        showNotification('Ошибка при вставке: ' + error.message, 'error');
    }
};

const deletePairFromCell = async (td) => {
    if (!isAdminMode()) { showNotification('Удаление доступно только в режиме администратора', 'warning'); return; }
    const scheduleId = td.dataset.scheduleId;
    if (!scheduleId) { showNotification('В этой ячейке нет пары для удаления', 'warning'); return; }
    if (!confirm('Вы уверены, что хотите удалить эту пару?')) return;
    try { skipAutoScroll = true; saveScrollPosition(); await deleteSchedule(scheduleId); showNotification('Пара успешно удалена', 'success'); const sel = getSelectedTeachers(); const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`; await loadScheduleData(sel, monthVal); } catch (error) { showNotification('Ошибка при удалении: ' + error.message, 'error'); }
};

const selectCell = (td) => { if (selectedCell) selectedCell.classList.remove('cell-selected'); td.classList.add('cell-selected'); selectedCell = td; };

document.addEventListener('keydown', async (e) => {
    const activeElement = document.activeElement;
    const isInputFocused = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT' || activeElement.isContentEditable);
    if (isInputFocused) return;

    // Ctrl+C — копировать
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        if (!selectedCell) {
            showNotification('Сначала выберите ячейку (кликните по ней)', 'warning');
            return;
        }

        const pairData = getPairDataFromCell(selectedCell);
        if (pairData) {
            // Сохраняем scheduleId для операции "вырезать"
            pairData._sourceScheduleId = selectedCell.dataset.scheduleId || null;
            clipboardPair = pairData;
            clipboardCut = false;

            showNotification('📋 Пара скопирована (Ctrl+V для вставки любому преподавателю)', 'success');
            selectedCell.classList.add('cell-copied');
            setTimeout(() => selectedCell.classList.remove('cell-copied'), 1000);
        } else {
            showNotification('В выбранной ячейке нет пары', 'warning');
        }
    }

    // Ctrl+X — вырезать
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        if (!selectedCell) {
            showNotification('Сначала выберите ячейку (кликните по ней)', 'warning');
            return;
        }

        const pairData = getPairDataFromCell(selectedCell);
        if (pairData) {
            pairData._sourceScheduleId = selectedCell.dataset.scheduleId || null;
            clipboardPair = pairData;
            clipboardCut = true;

            showNotification('✂️ Пара вырезана (Ctrl+V для вставки). Исходная удалится после вставки.', 'info');
            selectedCell.classList.add('cell-cut');
            setTimeout(() => selectedCell.classList.remove('cell-cut'), 2000);
        } else {
            showNotification('В выбранной ячейке нет пары', 'warning');
        }
    }

    // Ctrl+V — вставить
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();

        if (!clipboardPair) {
            showNotification('Нет скопированной пары. Сначала Ctrl+C или Ctrl+X.', 'warning');
            return;
        }
        if (!selectedCell) {
            showNotification('Сначала выберите ячейку для вставки (кликните по ней)', 'warning');
            return;
        }

        await pastePairToCell(selectedCell, clipboardPair);

        // НЕ очищаем буфер — можно вставлять много раз!
        // Если это был Cut — очистим после успешной вставки внутри pastePairToCell
    }

    // Delete — удалить
    if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!selectedCell) return;
        e.preventDefault();
        await deletePairFromCell(selectedCell);
    }
});

/* ===== Инициализация ===== */
const init = async () => {
    try {
        GROUP_COLOR_CACHE.clear();
        const adminMode = isAdminMode();
        if (adminMode) { document.body.classList.add('admin-on', 'admin-mode'); adminInfo.style.display = 'block'; userInfo.style.display = 'none'; }
        else { document.body.classList.remove('admin-on', 'admin-mode'); adminInfo.style.display = 'none'; userInfo.style.display = 'block'; switchModeBtn.style.display = 'none'; if (addScheduleBtn) addScheduleBtn.style.display = 'none'; }
        await fillTeachers();
        await loadModalData();
        initDateSelectors();
        await render();
        updateNavDisabled();
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
                if (swapModal && swapModal.getAttribute('aria-hidden') === 'false') { swapModal.setAttribute('aria-hidden', 'true'); swapModal.classList.remove('open'); resetSwapSelection(); }
                const editorRecModal = document.getElementById('editorRecModal');
                if (editorRecModal && editorRecModal.getAttribute('aria-hidden') === 'false') { editorRecModal.setAttribute('aria-hidden', 'true'); editorRecModal.classList.remove('open'); }
                const recPanel = document.getElementById('recommendationsPanel');
                if (recPanel) recPanel.classList.remove('open');
            }
        });
        initEditorRecommendations();
    } catch (error) { console.error('Ошибка инициализации приложения:', error); }
};

init();