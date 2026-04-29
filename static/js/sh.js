let swapContext = null;
let PERIODS_DATA = {}; // Кэш расписания пар по датам
/* ===== Утилиты дат (one‑liners) ===== */
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

// В начало файла sh.js
let pendingScrollRestore = null;

// Функция сохранения позиции скролла
const saveScrollPosition = () => {
    const wrap = document.querySelector('.table-wrap');

    pendingScrollRestore = {
        tableLeft: wrap ? wrap.scrollLeft : 0,
        windowTop: window.scrollY,
        windowLeft: window.scrollX
    };

    console.log('💾 Saved scroll - windowTop:', pendingScrollRestore.windowTop, 'tableLeft:', pendingScrollRestore.tableLeft);
};

// Функция принудительного восстановления скролла
const forceRestoreScroll = () => {
    if (!pendingScrollRestore) {
        console.log('⚠️ No scroll to restore');
        return;
    }

    const wrap = document.querySelector('.table-wrap');
    const targetTop = pendingScrollRestore.windowTop;
    const targetLeft = pendingScrollRestore.tableLeft;

    console.log('🎯 Restoring windowTop to:', targetTop);

    const applyScroll = () => {
        window.scrollTo(pendingScrollRestore.windowLeft || 0, targetTop);

        if (wrap) {
            wrap.scrollLeft = targetLeft;
        }

        console.log('📍 Applied - windowTop:', window.scrollY, 'tableLeft:', wrap?.scrollLeft);
    };

    applyScroll();
    setTimeout(applyScroll, 50);
    setTimeout(applyScroll, 150);
    setTimeout(applyScroll, 300);
    setTimeout(() => {
        applyScroll();
        console.log('✅ Final windowTop:', window.scrollY);
        pendingScrollRestore = null;
    }, 500);
};

let scrollTimeout;
window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        if (!pendingScrollRestore) {
            const wrap = document.querySelector('.table-wrap');
            pendingScrollRestore = {
                tableLeft: wrap ? wrap.scrollLeft : 0,
                windowTop: window.scrollY,
                windowLeft: window.scrollX
            };
        }
    }, 100);
}, { passive: true });

/* ===== API функции ===== */
const API_BASE = '/api';

// Система цветов преподавателей
let TEACHER_COLORS = {};
let COLOR_PALETTE = [];

// Глобальные переменные для хранения данных
let DISCIPLINES = [];
let CLASSROOMS = [];
let LESSON_TYPES = [];
let GROUPS = [];
let TEACHER_ID = {};

// Определение режима администратора
const isAdminMode = () => {
    return IS_ADMIN_MODE === true;
};
let FACULTIES = [];
const loadFaculties = async () => {
    try {
        const response = await fetch(`${API_BASE}/getFaculty`);
        const data = await response.json();
        // Сервер возвращает: { idfaculty, shortName, faculty }
        FACULTIES = data.map(f => ({
            id: f.idfaculty,
            name: f.faculty,
            short_name: f.shortName
        }));
        console.log('Faculties loaded:', FACULTIES);
    } catch (error) {
        console.error('Error loading faculties:', error);
        FACULTIES = [];
    }
};
// ===== ПЕРЕМЕННЫЕ ДЛЯ ОДИНОЧНОГО ВЫБОРА =====
let selectedTeacherSingle = null;  // Хранит выбранного преподавателя
let selectedRoomSingle = null;    // Хранит выбранную аудиторию
let selectedGroupSingle = null;   // Хранит выбранную группу

// ===== ОДИНОЧНЫЙ ВЫБОР ПРЕПОДАВАТЕЛЯ =====
const renderTeacherSingleList = (filter = '', pmkFilter = 'all') => {
    const container = document.getElementById('teacherSingleList');
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
        const isSelected = selectedTeacherSingle === name;
        const categoryStr = String(TEACHERS_LIST[name]?.category || 'other');
        const pmkLabel = categoryStr === '1' ? 'ПМК 1' : categoryStr === '2' ? 'ПМК 2' : 'Другое';

        return `
            <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(name)}">
                <span class="dot" style="background: ${TEACHER_COLORS[name] || '#ccc'}; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;"></span>
                <span class="name">${escapeHtml(name)}</span>
                <span class="pmk-badge">${pmkLabel}</span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', () => {
            selectedTeacherSingle = item.dataset.name;
            document.getElementById('teacherSingleSearch').value = selectedTeacherSingle;
            document.getElementById('teacherSingleDropdown').style.display = 'none';
            renderTeacherSingleList();
        });
    });
};

// Инициализация одиночного выбора преподавателя
const initTeacherSingle = () => {
    const searchInput = document.getElementById('teacherSingleSearch');
    const dropdown = document.getElementById('teacherSingleDropdown');

    if (!searchInput || !dropdown) return;

    // Рендер списка
    const renderList = (filter = '', pmkFilter = 'all') => {
        const container = document.getElementById('teacherSingleList');
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
            const isSelected = selectedTeacherSingle === name;
            const categoryStr = String(TEACHERS_LIST[name]?.category || 'other');
            const pmkLabel = categoryStr === '1' ? 'ПМК 1' : categoryStr === '2' ? 'ПМК 2' : 'Другое';

            return `
                <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(name)}">
                    <span class="dot" style="background: ${TEACHER_COLORS[name] || '#ccc'}; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;"></span>
                    <span class="name">${escapeHtml(name)}</span>
                    <span class="pmk-badge">${pmkLabel}</span>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.multi-list-item').forEach(item => {
            item.addEventListener('click', () => {
                selectedTeacherSingle = item.dataset.name;
                searchInput.value = selectedTeacherSingle;
                dropdown.style.display = 'none';
                renderList(searchInput.value);
            });
        });
    };

    // Обработчики
    searchInput.addEventListener('focus', () => {
        dropdown.style.display = 'block';
        const activePmk = document.querySelector('#pmkTabs .pmk-tab.active')?.dataset?.pmk || 'all';
        renderList(searchInput.value, activePmk);
    });

    searchInput.addEventListener('input', (e) => {
        dropdown.style.display = 'block';
        const activePmk = document.querySelector('#pmkTabs .pmk-tab.active')?.dataset?.pmk || 'all';
        renderList(e.target.value, activePmk);
    });

    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = 'block';
        const activePmk = document.querySelector('#pmkTabs .pmk-tab.active')?.dataset?.pmk || 'all';
        renderList(searchInput.value, activePmk);
    });

    // ПМК фильтры
    document.querySelectorAll('#pmkTabs .pmk-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('#pmkTabs .pmk-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            dropdown.style.display = 'block';
            renderList(searchInput.value, tab.dataset.pmk);
        });
    });

    // Закрытие при клике вне
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('teacherSingleWrap');
        if (wrap && !wrap.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });

    // Начальный рендер
    renderList();
};
// ===== ОДИНОЧНЫЙ ВЫБОР АУДИТОРИИ =====
const renderRoomSingleList = (filter = '', buildingFilter = 'all') => {
    const container = document.getElementById('roomSingleList');
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
        const isSelected = selectedRoomSingle === String(r.id);
        return `
            <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-id="${r.id}">
                <span class="name">🏫 ${escapeHtml(r.short_name)}</span>
                <span class="pmk-badge">${getRoomBuilding(r.short_name)}</span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', () => {
            selectedRoomSingle = item.dataset.id;
            const room = CLASSROOMS.find(r => String(r.id) === selectedRoomSingle);
            document.getElementById('roomSingleSearch').value = room ? room.short_name : '';
            document.getElementById('roomSingleDropdown').style.display = 'none';
            renderRoomSingleList();
        });
    });
};

// Инициализация одиночного выбора аудитории
const initRoomSingle = () => {
    const searchInput = document.getElementById('roomSingleSearch');
    const dropdown = document.getElementById('roomSingleDropdown');

    if (!searchInput || !dropdown) return;

    const renderList = (filter = '', buildingFilter = 'all') => {
        const container = document.getElementById('roomSingleList');
        if (!container) return;

        const searchFilter = filter || '';

        const filtered = CLASSROOMS.filter(r => {
            const matchesSearch = !searchFilter || r.short_name.toLowerCase().includes(searchFilter.toLowerCase());
            const matchesBuilding = buildingFilter === 'all' || getRoomBuilding(r.short_name) === buildingFilter;
            return matchesSearch && matchesBuilding;
        });

        console.log('Room filter:', { filter, buildingFilter, total: CLASSROOMS.length, filtered: filtered.length });

        if (filtered.length === 0) {
            container.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted); font-size: 12px;">Ничего не найдено</div>';
            return;
        }

        container.innerHTML = filtered.map(r => {
            const isSelected = selectedRoomSingle === String(r.id);
            return `
                <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-id="${r.id}">
                    <span class="name">🏫 ${escapeHtml(r.short_name)}</span>
                    <span class="pmk-badge">${getRoomBuilding(r.short_name)}</span>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.multi-list-item').forEach(item => {
            item.addEventListener('click', () => {
                selectedRoomSingle = item.dataset.id;
                const room = CLASSROOMS.find(r => String(r.id) === selectedRoomSingle);
                searchInput.value = room ? room.short_name : '';
                dropdown.style.display = 'none';
            });
        });
    };

    // === ИСПРАВЛЕНИЕ: Сначала рендерим вкладки корпусов, потом навешиваем обработчики ===
    const renderBuildingTabs = () => {
        const tabsContainer = document.getElementById('buildingTabs');
        if (!tabsContainer) return;

        const buildings = new Set();
        CLASSROOMS.forEach(r => buildings.add(getRoomBuilding(r.short_name)));

        let html = '<button class="pmk-tab active" data-building="all">Все</button>';
        [...buildings].sort().forEach(b => {
            html += `<button class="pmk-tab" data-building="${b}">${b}</button>`;
        });
        tabsContainer.innerHTML = html;

        // Навешиваем обработчики на вкладки
        tabsContainer.querySelectorAll('.pmk-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                tabsContainer.querySelectorAll('.pmk-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                dropdown.style.display = 'block';
                renderList(searchInput.value, tab.dataset.building);
            });
        });
    };

    // Рендерим вкладки
    renderBuildingTabs();

    // Показываем список при фокусе
    searchInput.addEventListener('focus', () => {
        dropdown.style.display = 'block';
        const activeBuilding = document.querySelector('#buildingTabs .pmk-tab.active')?.dataset?.building || 'all';
        renderList(searchInput.value, activeBuilding);
    });

    // Показываем список при вводе
    searchInput.addEventListener('input', (e) => {
        dropdown.style.display = 'block';
        const activeBuilding = document.querySelector('#buildingTabs .pmk-tab.active')?.dataset?.building || 'all';
        renderList(e.target.value, activeBuilding);
    });

    // Показываем список при клике
    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = 'block';
        const activeBuilding = document.querySelector('#buildingTabs .pmk-tab.active')?.dataset?.building || 'all';
        renderList(searchInput.value, activeBuilding);
    });

    // Закрытие при клике вне
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('roomSingleWrap');
        if (wrap && !wrap.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });

    // Начальный рендер
    renderList();
};

// ===== ОДИНОЧНЫЙ ВЫБОР ГРУППЫ =====
const renderGroupSingleList = (filter = '', facultyFilter = 'all') => {
    const container = document.getElementById('groupSingleList');
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
        const isSelected = selectedGroupSingle === String(g.id);
        const faculty = FACULTIES ? FACULTIES.find(f => String(f.id) === String(g.idfaculty)) : null;
        const facultyName = faculty ? (faculty.short_name || faculty.name) : '';
        return `
            <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-id="${g.id}">
                <span class="name">${escapeHtml(g.name)}</span>
                ${facultyName ? `<span class="pmk-badge">${escapeHtml(facultyName)}</span>` : ''}
            </div>
        `;
    }).join('');

    container.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', () => {
            selectedGroupSingle = item.dataset.id;
            const group = GROUPS.find(g => String(g.id) === selectedGroupSingle);
            document.getElementById('groupSingleSearch').value = group ? group.name : '';
            document.getElementById('groupSingleDropdown').style.display = 'none';
            renderGroupSingleList();
        });
    });
};

// Инициализация одиночного выбора группы
const initGroupSingle = () => {
    const searchInput = document.getElementById('groupSingleSearch');
    const dropdown = document.getElementById('groupSingleDropdown');

    if (!searchInput || !dropdown) return;

    const renderList = (filter = '', facultyFilter = 'all') => {
        const container = document.getElementById('groupSingleList');
        if (!container) return;

        const searchFilter = filter || '';

        const filtered = GROUPS.filter(g => {
            const matchesSearch = !searchFilter || g.name.toLowerCase().includes(searchFilter.toLowerCase());
            const matchesFaculty = facultyFilter === 'all' || String(g.idfaculty) === String(facultyFilter);
            return matchesSearch && matchesFaculty;
        });

        console.log('Group filter:', { filter, facultyFilter, total: GROUPS.length, filtered: filtered.length });

        if (filtered.length === 0) {
            container.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted); font-size: 12px;">Ничего не найдено</div>';
            return;
        }

        container.innerHTML = filtered.map(g => {
            const isSelected = selectedGroupSingle === String(g.id);
            const faculty = FACULTIES ? FACULTIES.find(f => String(f.id) === String(g.idfaculty)) : null;
            const facultyName = faculty ? (faculty.short_name || faculty.name) : '';
            return `
                <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-id="${g.id}">
                    <span class="name">${escapeHtml(g.name)}</span>
                    ${facultyName ? `<span class="pmk-badge">${escapeHtml(facultyName)}</span>` : ''}
                </div>
            `;
        }).join('');

        container.querySelectorAll('.multi-list-item').forEach(item => {
            item.addEventListener('click', () => {
                selectedGroupSingle = item.dataset.id;
                const group = GROUPS.find(g => String(g.id) === selectedGroupSingle);
                searchInput.value = group ? group.name : '';
                dropdown.style.display = 'none';
            });
        });
    };

    // === ИСПРАВЛЕНИЕ: Сначала рендерим вкладки факультетов ===
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

        // Навешиваем обработчики на вкладки
        tabsContainer.querySelectorAll('.pmk-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                tabsContainer.querySelectorAll('.pmk-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                dropdown.style.display = 'block';
                renderList(searchInput.value, tab.dataset.faculty);
            });
        });
    };

    // Рендерим вкладки
    renderFacultyTabs();

    // Показываем список при фокусе
    searchInput.addEventListener('focus', () => {
        dropdown.style.display = 'block';
        const activeFaculty = document.querySelector('#facultyTabs .pmk-tab.active')?.dataset?.faculty || 'all';
        renderList(searchInput.value, activeFaculty);
    });

    // Показываем список при вводе
    searchInput.addEventListener('input', (e) => {
        dropdown.style.display = 'block';
        const activeFaculty = document.querySelector('#facultyTabs .pmk-tab.active')?.dataset?.faculty || 'all';
        renderList(e.target.value, activeFaculty);
    });

    // Показываем список при клике
    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = 'block';
        const activeFaculty = document.querySelector('#facultyTabs .pmk-tab.active')?.dataset?.faculty || 'all';
        renderList(searchInput.value, activeFaculty);
    });

    // Закрытие при клике вне
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('groupSingleWrap');
        if (wrap && !wrap.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });

    // Начальный рендер
    renderList();
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

        // Заполняем селекты для типа и дисциплины (они остались <select>)
        populateSelect('f_type', LESSON_TYPES, 'id', 'alias');
        populateSelect('f_course', DISCIPLINES, 'id', 'alias');

        // Инициализируем одиночные выборы с поиском
        initTeacherSingle();
        initRoomSingle();
        initGroupSingle();

        // Инициализируем множественный выбор
        initMultiSelect();

    } catch (error) {
        console.error('Error loading modal data:', error);
    }
};


// Функция для заполнения выпадающего списка
const populateSelect = (selectId, data, valueField, textField) => {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;

    while (select.options.length > 1) {
        select.remove(1);
    }

    data.forEach(item => {
        const option = document.createElement('option');
        option.value = item[valueField];
        option.textContent = item[textField];
        option.title = item.title || item[textField];
        select.appendChild(option);
    });

    if (currentValue && data.some(item => item[valueField] === currentValue)) {
        select.value = currentValue;
    }
};


// Инициализация системы цветов
const initColorSystem = async (teachersCount = 12) => {
    try {
        const paletteSize = Math.max(12, teachersCount);

        const response = await fetch(`${API_BASE}/palette/${paletteSize}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        COLOR_PALETTE = data.palette;
    } catch (error) {
        console.error('Ошибка загрузки палитры, используем fallback:', error);
        COLOR_PALETTE = generateFallbackPalette(teachersCount);
    }
};

// Функция для генерации fallback палитры нужного размера
const generateFallbackPalette = (count) => {
    const basePalette = [
        '#7c5cff', '#22c55e', '#3b82f6', '#f59e0b',
        '#ef4444', '#8b5cf6', '#10b981', '#06b6d4',
        '#d946ef', '#f97316', '#84cc16', '#14b8a6'
    ];

    if (count <= basePalette.length) {
        return basePalette.slice(0, count);
    }

    const additionalColors = [];
    for (let i = basePalette.length; i < count; i++) {
        const hue = (i * 137.5) % 360;
        const saturation = 70 + (i % 3) * 10;
        const lightness = 45 + (i % 2) * 10;
        additionalColors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
    }

    return [...basePalette, ...additionalColors];
};

// Получение цвета для преподавателя
const getTeacherColor = async (teacherName) => {
    if (!teacherName) return '#cccccc';

    if (TEACHER_COLORS[teacherName]) {
        const colorObj = TEACHER_COLORS[teacherName];
        const color = typeof colorObj === 'object' ? colorObj.color : colorObj;
        return color;
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
        console.warn('✗ API failed, using local calculation:', error);

        if (COLOR_PALETTE.length === 0) {
            await initColorSystem();
        }

        const teacherHash = hashString(teacherName);
        const colorIndex = teacherHash % COLOR_PALETTE.length;
        const fallbackColor = COLOR_PALETTE[colorIndex];

        TEACHER_COLORS[teacherName] = fallbackColor;
        return fallbackColor;
    }
};

// Получение цветов для нескольких преподавателей
const getTeachersColors = async (teachers) => {
    if (teachers.length === 0) return {};

    try {
        const totalTeachers = Object.keys(TEACHERS_LIST).length;
        const paletteSize = Math.max(12, totalTeachers);

        const response = await fetch(`${API_BASE}/teachers-colors`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                teachers: teachers,
                palette_size: paletteSize
            })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();

        const processedData = {};
        Object.keys(data).forEach(teacher => {
            const colorObj = data[teacher];
            processedData[teacher] = typeof colorObj === 'object' ? colorObj.color : colorObj;
        });

        Object.assign(TEACHER_COLORS, processedData);
        return processedData;
    } catch (error) {
        console.warn('Ошибка получения цветов преподавателей, используем локальный расчет:', error);
        const colors = {};
        teachers.forEach(teacher => {
            if (!TEACHER_COLORS[teacher]) {
                const teacherHash = hashString(teacher);
                const colorIndex = teacherHash % COLOR_PALETTE.length;
                TEACHER_COLORS[teacher] = COLOR_PALETTE[colorIndex];
            }
            colors[teacher] = TEACHER_COLORS[teacher];
        });
        return colors;
    }
};

// Локальная функция хэширования (fallback)
const hashString = (s) => {
    if (!s) return 0;
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
};

const teacherId = (n) => 't-' + hashString(n);

// Получение списка преподавателей
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

// Получение расписания для преподавателей
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
            try {
                const errorData = await response.json();
                errorText = errorData.error || errorText;
            } catch (e) {
                errorText = `HTTP error! status: ${response.status}`;
            }
            throw new Error(errorText);
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching schedule:', error);
        throw error;
    }
};

// Добавление расписания
const postSchedule = async (scheduleData) => {
    try {
        console.log(scheduleData)
        const response = await fetch(`${API_BASE}/postSchedule`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(scheduleData)
        });

        if (!response.ok) {
            let errorText = 'Ошибка добавления расписания';
            try {
                const errorData = await response.json();
                errorText = errorData.error || errorText;
            } catch (e) {
                errorText = `HTTP error! status: ${response.status}`;
            }
            throw new Error(errorText);
        }
        return await response.json();
    } catch (error) {
        console.error('Error posting schedule:', error);
        throw error;
    }
};

// Обновление расписания
const updateSchedule = async (scheduleData) => {
    try {
        const response = await fetch(`${API_BASE}/updateSchedule`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(scheduleData)
        });

        if (!response.ok) throw new Error('Ошибка обновления расписания');
        return await response.json();
    } catch (error) {
        console.error('Error updating schedule:', error);
        throw error;
    }
};

// Удаление расписания
const deleteSchedule = async (scheduleId) => {
    try {
        const response = await fetch(`${API_BASE}/deleteSchedule?schedule_id=${scheduleId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Ошибка удаления расписания');
        return await response.json();
    } catch (error) {
        console.error('Error deleting schedule:', error);
        throw error;
    }
};

/* ===== Хранилище ===== */
let DATA = {};
let TEACHERS_LIST = {};
let TEACHER_CATEGORIES = {};

/* ===== DOM ===== */
const teachersSel = document.getElementById('teachers'),
    allTeachersChk = document.getElementById('allTeachers'),
    monthInput = null,
    monthLabel = document.getElementById('monthLabel'),
    prevMonthBtn = document.getElementById('prevMonth'),
    nextMonthBtn = document.getElementById('nextMonth'),
    openPicker = document.getElementById('openPicker'),
    openJump = document.getElementById('openJump'),
    jumpPanel = document.getElementById('jumpPanel'),
    jumpMonth = document.getElementById('jumpMonth'),
    jumpYear = document.getElementById('jumpYear'),
    applyJump = document.getElementById('applyJump'),
    buildBtn = document.getElementById('build'),
    build_1Btn = document.getElementById('build_1'),
    printBtn = document.getElementById('print'),
    tables = document.getElementById('tables'),
    adminInfo = document.getElementById('adminInfo'),
    userInfo = document.getElementById('userInfo'),
    adminStatusText = document.getElementById('adminStatusText');

const rail = document.getElementById('rail'),
    railSearch = document.getElementById('railSearch'),
    railList = document.getElementById('railList'),
    railToggle = document.getElementById('railToggle'),
    railCategories = document.getElementById('railCategories');

const modal = document.getElementById('modal'),
    modalTitle = document.getElementById('modalTitle'),
    f_type = document.getElementById('f_type'),
    f_course = document.getElementById('f_course'),
    f_lesson_num = document.getElementById('f_lesson_num'),
    btnSave = document.getElementById('btnSave'),
    btnCancel = document.getElementById('btnCancel'),
    btnDelete = document.getElementById('btnDelete');

// Новые элементы для панели кандидатов
const candidatesPanel = document.getElementById('candidatesPanel'),
    candidatesLoading = document.getElementById('candidatesLoading'),
    candidatesBusyList = document.getElementById('candidatesBusyList'),
    candidatesFreeExpList = document.getElementById('candidatesFreeExpList'),
    candidatesFreeOtherList = document.getElementById('candidatesFreeOtherList'),
    candidatesEmpty = document.getElementById('candidatesEmpty'),
    candidatesBtn = document.getElementById('showCandidatesBtn');

const teacherSingleWrap = document.getElementById('teacherSingleWrap'),
    teacherSingleSearch = document.getElementById('teacherSingleSearch'),
    teacherSingleDropdown = document.getElementById('teacherSingleDropdown'),
    teacherSingleList = document.getElementById('teacherSingleList'),
    multiTeacher = document.getElementById('multiTeacher'),
    teacherMulti = document.getElementById('teacherMulti'),
    teacherSearch = document.getElementById('teacherSearch'),
    teacherDropdown = document.getElementById('teacherDropdown'),
    teacherList = document.getElementById('teacherList'),
    teacherBadge = document.getElementById('teacherBadge');

// Аудитории
const roomSingleWrap = document.getElementById('roomSingleWrap'),
    roomSingleSearch = document.getElementById('roomSingleSearch'),
    roomSingleDropdown = document.getElementById('roomSingleDropdown'),
    roomSingleList = document.getElementById('roomSingleList'),
    multiRoom = document.getElementById('multiRoom'),
    roomMulti = document.getElementById('roomMulti'),
    roomSearch = document.getElementById('roomSearch'),
    roomDropdown = document.getElementById('roomDropdown'),
    roomList = document.getElementById('roomList'),
    roomBadge = document.getElementById('roomBadge');

// Группы
const groupSingleWrap = document.getElementById('groupSingleWrap'),
    groupSingleSearch = document.getElementById('groupSingleSearch'),
    groupSingleDropdown = document.getElementById('groupSingleDropdown'),
    groupSingleList = document.getElementById('groupSingleList'),
    multiGroup = document.getElementById('multiGroup'),
    groupMulti = document.getElementById('groupMulti'),
    groupSearch = document.getElementById('groupSearch'),
    groupDropdown = document.getElementById('groupDropdown'),
    groupList = document.getElementById('groupList'),
    groupBadge = document.getElementById('groupBadge');


const addScheduleBtn = document.getElementById('addSchedule'),
    f_date = document.getElementById('f_date'),
    f_teacher = document.getElementById('f_teacher'),
    f_pair = document.getElementById('f_pair');

// Состояния выбора
let selectedTeachersModal = new Set();
let selectedRoomsModal = new Set();
let selectedGroupsModal = new Set();

// Мультиселект элементы
const ms = document.getElementById('msTeachers'),
    msBadge = document.getElementById('msBadge'),
    msSearch = document.getElementById('msSearch'),
    msList = document.getElementById('msList'),
    msAll = document.getElementById('msAll'),
    msNone = document.getElementById('msNone'),
    msSelectCategory = document.getElementById('msSelectCategory'),
    msCategories = document.getElementById('msCategories'),
    msAllTeachers = document.getElementById('msAllTeachers');

// Добавить после других DOM элементов
const switchModeBtn = document.getElementById('switchMode');
const swapModal = document.getElementById('swapModal');
const swapModalTitle = document.getElementById('swapModalTitle');
const swapFromTeacher = document.getElementById('swapFromTeacher');
const swapToTeacher = document.getElementById('swapToTeacher');
const swapDate = document.getElementById('swapDate');
const swapPair = document.getElementById('swapPair');
const swapCancel = document.getElementById('swapCancel');
const swapConfirm = document.getElementById('swapConfirm');

/* ===== UI/STATE ===== */
const selectedTeachers = new Set();
let TEACHER_SECTIONS = [];
let activeCategory = 'all';
let RAIL_CATEGORIES_STATE = {};
let swapMode = false;
let selectedSwapCell = null;

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();

// Обработчик кнопки режима замены
switchModeBtn.addEventListener('click', () => {
    swapMode = !swapMode;

    if (swapMode) {
        switchModeBtn.textContent = 'Отменить замену';
        switchModeBtn.classList.remove('ghost');
        switchModeBtn.classList.add('yellow');
        document.body.classList.add('swap-mode');
        showNotification('Выберите пару для замены. Кликните на ячейку с парой.', 'info');
    } else {
        switchModeBtn.textContent = 'Режим замены';
        switchModeBtn.classList.remove('yellow');
        switchModeBtn.classList.add('ghost');
        document.body.classList.remove('swap-mode');
        resetSwapSelection();
    }
});

// Инициализация множественного выбора
const initMultiSelect = () => {
    // Преподаватели
    setupMultiSelectTeacher();

    // Аудитории
    setupMultiSelectRoom();

    // Группы
    setupMultiSelectGroup();

    // Обработчики чекбоксов "Несколько"
    if (multiTeacher) {
        multiTeacher.addEventListener('change', () => toggleMultiMode('teacher'));
    }
    if (multiRoom) {
        multiRoom.addEventListener('change', () => toggleMultiMode('room'));
    }
    if (multiGroup) {
        multiGroup.addEventListener('change', () => toggleMultiMode('group'));
    }
};

const setupMultiSelectTeacher = () => {
    const searchInput = document.getElementById('teacherSearch');
    const dropdown = document.getElementById('teacherDropdown');
    const list = document.getElementById('teacherList');

    if (!searchInput || !dropdown || !list) return;

    // При фокусе на поиск - показываем dropdown
    searchInput.addEventListener('focus', () => {
        dropdown.style.display = 'block';
        const activePmk = document.querySelector('.pmk-tab.active')?.dataset?.pmk || 'all';
        renderTeacherMultiList(searchInput.value, activePmk);
    });

    // При вводе текста - фильтруем и показываем
    searchInput.addEventListener('input', (e) => {
        dropdown.style.display = 'block';
        const activePmk = document.querySelector('.pmk-tab.active')?.dataset?.pmk || 'all';
        renderTeacherMultiList(e.target.value, activePmk);
    });

    // При клике на поле поиска - показываем
    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = 'block';
        const activePmk = document.querySelector('.pmk-tab.active')?.dataset?.pmk || 'all';
        renderTeacherMultiList(searchInput.value, activePmk);
    });

    // ПМК фильтры
    document.querySelectorAll('.pmk-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.pmk-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            dropdown.style.display = 'block';
            renderTeacherMultiList(searchInput.value, tab.dataset.pmk);
        });
    });

    // Начальный рендер (скрытый)
    renderTeacherMultiList('', '1');
};


// Настройка множественного выбора аудиторий
const setupMultiSelectRoom = () => {
    const searchInput = document.getElementById('roomSearch');
    const dropdown = document.getElementById('roomDropdown');
    const list = document.getElementById('roomList');

    if (!searchInput || !dropdown || !list) return;
    // Рендерим вкладки корпусов
    const renderBuildingTabs = () => {
        const tabsContainer = document.getElementById('buildingTabs');
        if (!tabsContainer) return;

        const buildings = new Set();
        CLASSROOMS.forEach(r => buildings.add(getRoomBuilding(r.short_name)));

        let html = '<button class="pmk-tab active" data-building="all">Все</button>';
        [...buildings].sort().forEach(b => {
            html += `<button class="pmk-tab" data-building="${b}">${b}</button>`;
        });
        tabsContainer.innerHTML = html;

        tabsContainer.querySelectorAll('.pmk-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                tabsContainer.querySelectorAll('.pmk-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                dropdown.style.display = 'block';
                renderRoomMultiList(searchInput.value, tab.dataset.building);
            });
        });
    };

    renderBuildingTabs();

    searchInput.addEventListener('focus', () => {
        dropdown.style.display = 'block';
        renderRoomMultiList(searchInput.value);
    });

    searchInput.addEventListener('input', (e) => {
        dropdown.style.display = 'block';
        renderRoomMultiList(e.target.value);
    });

    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = 'block';
        renderRoomMultiList(searchInput.value);
    });

    renderRoomMultiList('');
};

const setupMultiSelectGroup = () => {
    const searchInput = document.getElementById('groupSearch');
    const dropdown = document.getElementById('groupDropdown');

    if (!searchInput || !dropdown) return;

    // Рендерим вкладки факультетов
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
                dropdown.style.display = 'block';
                renderGroupMultiList(searchInput.value, tab.dataset.faculty);
            });
        });
    };

    renderFacultyTabs();

    searchInput.addEventListener('focus', () => {
        dropdown.style.display = 'block';
        const activeFaculty = document.querySelector('#facultyTabs .pmk-tab.active')?.dataset?.faculty || 'all';
        renderGroupMultiList(searchInput.value, activeFaculty);
    });

    searchInput.addEventListener('input', (e) => {
        dropdown.style.display = 'block';
        const activeFaculty = document.querySelector('#facultyTabs .pmk-tab.active')?.dataset?.faculty || 'all';
        renderGroupMultiList(e.target.value, activeFaculty);
    });

    searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = 'block';
        const activeFaculty = document.querySelector('#facultyTabs .pmk-tab.active')?.dataset?.faculty || 'all';
        renderGroupMultiList(searchInput.value, activeFaculty);
    });

    renderGroupMultiList('', 'all');
};

// Закрытие дропдаунов при клике вне
document.addEventListener('click', (e) => {
    const teacherMulti = document.getElementById('teacherMulti');
    const roomMulti = document.getElementById('roomMulti');
    const groupMulti = document.getElementById('groupMulti');

    const teacherDropdown = document.getElementById('teacherDropdown');
    const roomDropdown = document.getElementById('roomDropdown');
    const groupDropdown = document.getElementById('groupDropdown');

    if (teacherMulti && !teacherMulti.contains(e.target) && teacherDropdown) {
        teacherDropdown.style.display = 'none';
    }
    if (roomMulti && !roomMulti.contains(e.target) && roomDropdown) {
        roomDropdown.style.display = 'none';
    }
    if (groupMulti && !groupMulti.contains(e.target) && groupDropdown) {
        groupDropdown.style.display = 'none';
    }
});
// Флаг для отслеживания режима ручного добавления
let isManualAdd = false;

// Функция открытия модального окна для ручного добавления
const openManualAddModal = () => {
    ctx = null;
    isManualAdd = true;

    selectedTeachersModal.clear();
    selectedRoomsModal.clear();
    selectedGroupsModal.clear();
    multiTeacher.checked = false;
    multiRoom.checked = false;
    multiGroup.checked = false;
    toggleMultiMode('teacher');
    toggleMultiMode('room');
    toggleMultiMode('group');
    updateBadge('teacher');
    updateBadge('room');
    updateBadge('group');

    // Очищаем одиночные поля
    selectedTeacherSingle = null;
    selectedRoomSingle = null;
    selectedGroupSingle = null;

    f_type.value = '';
    f_lesson_num.value = '';
    f_course.value = '';

    // Очищаем поля поиска одиночного выбора
    if (teacherSingleSearch) teacherSingleSearch.value = '';
    if (roomSingleSearch) roomSingleSearch.value = '';
    if (groupSingleSearch) groupSingleSearch.value = '';

    f_date.value = new Date().toISOString().split('T')[0];
    f_pair.value = '';

    if (f_teacher.options.length <= 1) {
        const teachersSorted = Object.keys(TEACHERS_LIST).sort((a, b) => a.localeCompare(b, 'ru'));
        f_teacher.innerHTML = '<option value="">Выберите преподавателя</option>' +
            teachersSorted.map(n => `<option value="${n}">${n}</option>`).join('');
    }
    f_teacher.value = '';

    document.querySelectorAll('.manual-field').forEach(el => el.style.display = 'block');

    btnDelete.style.display = 'none';

    openModal('Добавление расписания', null);
};



const updateBadge = (type) => {
    let selectedSet, badgeEl, itemCount;

    switch(type) {
        case 'teacher':
            selectedSet = selectedTeachersModal;
            badgeEl = document.getElementById('teacherBadge');
            itemCount = Object.keys(TEACHERS_LIST).length;
            break;
        case 'room':
            selectedSet = selectedRoomsModal;
            badgeEl = document.getElementById('roomBadge');
            itemCount = CLASSROOMS.length;
            break;
        case 'group':
            selectedSet = selectedGroupsModal;
            badgeEl = document.getElementById('groupBadge');
            itemCount = GROUPS.length;
            break;
    }

    if (!badgeEl) return;

    const count = selectedSet.size;
    if (count === 0) {
        badgeEl.textContent = 'Ничего не выбрано';
    } else if (count === itemCount) {
        badgeEl.textContent = `Выбрано все (${count})`;
    } else {
        badgeEl.textContent = `Выбрано: ${count}`;
    }
};

// Обновленная функция toggleMultiMode
const toggleMultiMode = (type) => {
    switch(type) {
        case 'teacher':
            if (teacherSingleWrap) teacherSingleWrap.style.display = multiTeacher.checked ? 'none' : 'block';
            if (teacherMulti) teacherMulti.style.display = multiTeacher.checked ? 'block' : 'none';
            if (multiTeacher.checked) {
                renderTeacherTags();
                updateBadge('teacher');
                if (teacherDropdown) teacherDropdown.style.display = 'none';
                if (teacherSearch) teacherSearch.value = '';
            }
            break;
        case 'room':
            if (roomSingleWrap) roomSingleWrap.style.display = multiRoom.checked ? 'none' : 'block';
            if (roomMulti) roomMulti.style.display = multiRoom.checked ? 'block' : 'none';
            if (multiRoom.checked) {
                renderRoomTags();
                updateBadge('room');
                if (roomDropdown) roomDropdown.style.display = 'none';
                if (roomSearch) roomSearch.value = '';
            }
            break;
        case 'group':
            if (groupSingleWrap) groupSingleWrap.style.display = multiGroup.checked ? 'none' : 'block';
            if (groupMulti) groupMulti.style.display = multiGroup.checked ? 'block' : 'none';
            if (multiGroup.checked) {
                renderGroupTags();
                updateBadge('group');
                if (groupDropdown) groupDropdown.style.display = 'none';
                if (groupSearch) groupSearch.value = '';
            }
            break;
    }
};


const removeTeacherTag = (name) => {
    selectedTeachersModal.delete(name);
    renderTeacherTags();
    renderTeacherMultiList();
    updateBadge('teacher');
};

// Рендер множественного списка преподавателей с ПМК
const renderTeacherMultiList = (filter = '', pmkFilter = 'all') => {
    const container = document.getElementById('teacherList');
    if (!container) return;

    const allTeachers = Object.keys(TEACHERS_LIST).sort((a, b) => a.localeCompare(b, 'ru'));

    console.log('Rendering teachers:', {
        filter,
        pmkFilter,
        total: allTeachers.length,
        sampleTeacher: allTeachers[0] ? {
            name: allTeachers[0],
            category: TEACHERS_LIST[allTeachers[0]]?.category,
            categoryType: typeof TEACHERS_LIST[allTeachers[0]]?.category
        } : null
    });

    const filtered = allTeachers.filter(name => {
        const teacherCategory = TEACHERS_LIST[name]?.category;

        // Приводим категорию к строке для сравнения
        const categoryStr = String(teacherCategory || 'other');

        // ПКМ фильтр: 'all' показывает всех, иначе сравниваем как строки
        const matchesPmk = pmkFilter === 'all' || categoryStr === pmkFilter;

        // Поиск по имени
        const matchesSearch = !filter || name.toLowerCase().includes(filter.toLowerCase());

        return matchesPmk && matchesSearch;
    });

    console.log('Filtered teachers:', filtered.length, 'first 3:', filtered.slice(0, 3).map(n => ({
        name: n,
        category: TEACHERS_LIST[n]?.category
    })));

    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted); font-size: 12px;">Ничего не найдено</div>';
        return;
    }

    container.innerHTML = filtered.map(name => {
        const isSelected = selectedTeachersModal.has(name);
        const teacherData = TEACHERS_LIST[name];
        const category = teacherData?.category;
        const categoryStr = String(category || 'other');
        const pmkLabel = categoryStr === '1' ? 'ПМК 1' : categoryStr === '2' ? 'ПМК 2' : 'Другое';

        return `
            <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(name)}">
                <input type="checkbox" ${isSelected ? 'checked' : ''} tabindex="-1">
                <span class="dot" style="background: ${TEACHER_COLORS[name] || '#ccc'}; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;"></span>
                <span class="name">${escapeHtml(name)}</span>
                <span class="pmk-badge">${pmkLabel}</span>
            </div>
        `;
    }).join('');

    // Обработчики клика
    container.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const name = item.dataset.name;
            const checkbox = item.querySelector('input[type="checkbox"]');

            checkbox.checked = !checkbox.checked;

            if (checkbox.checked) {
                selectedTeachersModal.add(name);
                item.classList.add('selected');
            } else {
                selectedTeachersModal.delete(name);
                item.classList.remove('selected');
            }

            renderTeacherTags();
            updateBadge('teacher');
        });
    });

    updateBadge('teacher');
};


// Рендер тегов преподавателей
const renderTeacherTags = () => {
    const container = document.getElementById('selectedTeachersTags');
    if (!container) return;

    if (selectedTeachersModal.size === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = Array.from(selectedTeachersModal).map(name => `
        <span class="tag-item">
            <span class="dot" style="background: ${TEACHER_COLORS[name] || '#ccc'}; width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 4px;"></span>
            ${escapeHtml(name)}
            <button class="tag-remove" data-name="${escapeHtml(name)}">×</button>
        </span>
    `).join('');

    // Обработчики удаления тегов
    container.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = btn.dataset.name;
            selectedTeachersModal.delete(name);
            renderTeacherTags();

            // Обновляем список
            const searchInput = document.getElementById('teacherSearch');
            const activePmk = document.querySelector('.pmk-tab.active')?.dataset?.pmk || 'all';
            renderTeacherMultiList(searchInput?.value || '', activePmk);
            updateBadge('teacher');
        });
    });
};

// Функция извлечения корпуса из названия аудитории
const getRoomBuilding = (shortName) => {
    if (!shortName) return 'Другие';
    // Ищем цифры в начале (например "1к320" -> "1")
    const match = shortName.match(/^(\d+)к/);
    if (match) return `К${match[1]}`;
    // Или первую цифру
    const firstDigit = shortName.match(/^(\d+)/);
    if (firstDigit) return `К${firstDigit[1]}`;
    return 'Другие';
};

// Рендер аудиторий с группировкой по корпусу
const renderRoomMultiList = (filter = '', buildingFilter = 'all') => {
    const container = document.getElementById('roomList');
    if (!container) return;

    // Собираем уникальные корпуса
    const buildings = new Set();
    CLASSROOMS.forEach(r => buildings.add(getRoomBuilding(r.short_name)));

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
        return `
            <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-id="${r.id}">
                <input type="checkbox" ${isSelected ? 'checked' : ''} tabindex="-1">
                <span class="name">🏫 ${escapeHtml(r.short_name)}</span>
                <span class="pmk-badge">${getRoomBuilding(r.short_name)}</span>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) {
                selectedRoomsModal.add(id);
                item.classList.add('selected');
            } else {
                selectedRoomsModal.delete(id);
                item.classList.remove('selected');
            }
            renderRoomTags();
            updateBadge('room');
        });
    });

    updateBadge('room');

    return buildings; // Возвращаем для рендера табов
};


// Рендер тегов аудиторий
const renderRoomTags = () => {
    const container = document.getElementById('selectedRoomsTags');
    if (!container) return;

    if (selectedRoomsModal.size === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = Array.from(selectedRoomsModal).map(id => {
        const room = CLASSROOMS.find(r => r.id.toString() === id);
        const name = room ? room.short_name : id;
        return `
            <span class="tag-item">
                🏫 ${escapeHtml(name)}
                <button class="tag-remove" data-id="${id}">×</button>
            </span>
        `;
    }).join('');

    container.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedRoomsModal.delete(btn.dataset.id);
            renderRoomTags();
            renderRoomMultiList(document.getElementById('roomSearch')?.value || '');
            updateBadge('room');
        });
    });
};

// Рендер множественного списка групп
// Рендер множественного списка групп с категориями по факультету
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

        return `
            <div class="multi-list-item ${isSelected ? 'selected' : ''}" data-id="${g.id}">
                <input type="checkbox" ${isSelected ? 'checked' : ''} tabindex="-1">
                <span class="name">${escapeHtml(g.name)}</span>
                ${facultyName ? `<span class="pmk-badge">${escapeHtml(facultyName)}</span>` : ''}
            </div>
        `;
    }).join('');

    container.querySelectorAll('.multi-list-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;

            if (checkbox.checked) {
                selectedGroupsModal.add(String(id));
                item.classList.add('selected');
            } else {
                selectedGroupsModal.delete(String(id));
                item.classList.remove('selected');
            }

            renderGroupTags();
            updateBadge('group');
        });
    });

    updateBadge('group');
};

// Рендер тегов групп
const renderGroupTags = () => {
    const container = document.getElementById('selectedGroupsTags');
    if (!container) return;

    if (selectedGroupsModal.size === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = Array.from(selectedGroupsModal).map(id => {
        const group = GROUPS.find(g => g.id.toString() === id);
        const name = group ? group.name : id;
        return `
            <span class="tag-item">
                👥 ${escapeHtml(name)}
                <button class="tag-remove" data-id="${id}">×</button>
            </span>
        `;
    }).join('');

    container.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedGroupsModal.delete(btn.dataset.id);
            renderGroupTags();
            renderGroupMultiList(document.getElementById('groupSearch')?.value || '');
            updateBadge('group');
        });
    });
};

// ПМК фильтры
document.addEventListener('click', (e) => {
    const tab = e.target.closest('.pmk-tab');
    if (tab) {
        const container = tab.closest('.pmk-tabs');
        container.querySelectorAll('.pmk-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const pmk = tab.dataset.pmk;
        const searchInput = document.getElementById('teacherSearch');
        renderTeacherMultiList(searchInput?.value || '', pmk);
    }
});

// Поиск преподавателей
const teacherSearchInput = document.getElementById('teacherSearch');
if (teacherSearchInput) {
    teacherSearchInput.addEventListener('input', (e) => {
        const activePmk = document.querySelector('.pmk-tab.active')?.dataset?.pmk || '1';
        renderTeacherMultiList(e.target.value, activePmk);
    });

    teacherSearchInput.addEventListener('focus', () => {
        teacherDropdown.style.display = 'block';
        const activePmk = document.querySelector('.pmk-tab.active')?.dataset?.pmk || '1';
        renderTeacherMultiList(teacherSearchInput.value, activePmk);
    });
}

// Закрытие дропдауна при клике вне
document.addEventListener('click', (e) => {
    const teacherMulti = document.getElementById('teacherMulti');
    const roomMulti = document.getElementById('roomMulti');
    const groupMulti = document.getElementById('groupMulti');

    const teacherDropdown = document.getElementById('teacherDropdown');
    const roomDropdown = document.getElementById('roomDropdown');
    const groupDropdown = document.getElementById('groupDropdown');

    if (teacherMulti && teacherDropdown && !teacherMulti.contains(e.target)) {
        teacherDropdown.style.display = 'none';
    }
    if (roomMulti && roomDropdown && !roomMulti.contains(e.target)) {
        roomDropdown.style.display = 'none';
    }
    if (groupMulti && groupDropdown && !groupMulti.contains(e.target)) {
        groupDropdown.style.display = 'none';
    }
});

// Обработчики для модального окна замены
swapCancel.addEventListener('click', () => {
    swapModal.setAttribute('aria-hidden', 'true');
    swapModal.classList.remove('open');
    resetSwapSelection();
});

document.addEventListener('DOMContentLoaded', () => {
    const swapDateInput = document.getElementById('swapDateInput');
    if (swapDateInput) {
        swapDateInput.addEventListener('change', async (e) => {
            if (swapContext) {
                swapContext.date = e.target.value;
                await renderPairSelection(e.target.value, swapContext.pairIndex);
            }
        });
    }
});

swapConfirm.addEventListener('click', async () => {
    const selectedTeacherOption = document.querySelector('#swapTeachersList .teacher-option.selected');

    if (!selectedTeacherOption) {
        showNotification('Выберите преподавателя для замены', 'error');
        return;
    }

    if (!swapContext) {
        showNotification('Нет данных о замене', 'error');
        return;
    }

    const toTeacher = selectedTeacherOption.dataset.name;
    const {fromTeacher, date, pairIndex, scheduleId, pairId, originalPairIndex} = swapContext;

    if (fromTeacher === toTeacher && pairIndex === originalPairIndex) {
        showNotification('Это та же самая ячейка. Выберите другую пару или другого преподавателя.', 'error');
        return;
    }

    if (fromTeacher === toTeacher) {
        const existingPair = DATA[toTeacher]?.[date]?.[pairIndex];
        if (existingPair) {
            if (!confirm(`У преподавателя ${toTeacher} уже есть пара в это время. Заменить существующую пару?`)) {
                return;
            }
        }
    }

    const actionType = fromTeacher === toTeacher ? 'Перенести пару' : 'Передать пару';
    const confirmMessage = `${actionType}:\n\n` +
        `От: ${fromTeacher}\n` +
        (fromTeacher === toTeacher ? '' : `К: ${toTeacher}\n`) +
        `Дата: ${date}\n` +
        `Пара: ${pairIndex + 1}`;

    if (!confirm(confirmMessage)) {
        return;
    }

    try {
        saveScrollPosition();
        swapConfirm.disabled = true;
        swapConfirm.innerHTML = '<span style="opacity: 0.7;">Выполнение...</span>';

        const result = await performSwap(fromTeacher, toTeacher, date, pairIndex, scheduleId, pairId);

        if (result.success) {
            showNotification('Замена успешно выполнена', 'success');

            const selectedTeachers = getSelectedTeachers();
            const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
            await loadScheduleData(selectedTeachers, monthVal);

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

// Функция выполнения замены на сервере
const performSwap = async (fromTeacher, toTeacher, date, pairIndex, scheduleId, pairId = null) => {
    try {
        const response = await fetch(`${API_BASE}/swapSchedule`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from_teacher: fromTeacher,
                to_teacher: toTeacher,
                date: date,
                pair_index: pairIndex,
                schedule_id: scheduleId,
                pair_id: pairId
            })
        });

        if (!response.ok) {
            let errorText = 'Ошибка выполнения замены';
            try {
                const errorData = await response.json();
                errorText = errorData.error || errorText;
            } catch (e) {
                errorText = `HTTP error! status: ${response.status}`;
            }
            throw new Error(errorText);
        }

        return await response.json();
    } catch (error) {
        console.error('Error performing swap:', error);
        throw error;
    }
};

// ====== НОВЫЕ ФУНКЦИИ УПРАВЛЕНИЯ МЕСЯЦЕМ/ГОДОМ ======

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
    const monthNames = [
        'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];

    const monthLabel = document.getElementById('monthLabel');
    const monthSelect = document.getElementById('monthSelect');
    const yearSelect = document.getElementById('yearSelect');

    if (monthLabel) {
        monthLabel.textContent = `${monthNames[currentMonth]} ${currentYear}`;
    }

    if (monthSelect) {
        monthSelect.value = currentMonth;
    }

    if (yearSelect) {
        yearSelect.value = currentYear;
    }

}

function initDateSelectors() {
    populateYears();
    updateDateDisplay();

    document.getElementById('prevMonth')?.addEventListener('click', () => {
        saveScrollPosition();
        currentMonth--;
        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }
        updateDateDisplay();
        render();
    });

    document.getElementById('nextMonth')?.addEventListener('click', () => {
        saveScrollPosition();
        currentMonth++;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        }
        updateDateDisplay();
        render();
    });

    const monthSelect = document.getElementById('monthSelect');
    if (monthSelect) {
        monthSelect.addEventListener('change', (e) => {
            currentMonth = parseInt(e.target.value);
            updateDateDisplay();
            render();
        });
    }

    const yearSelect = document.getElementById('yearSelect');
    if (yearSelect) {
        yearSelect.addEventListener('change', (e) => {
            currentYear = parseInt(e.target.value);
            updateDateDisplay();
            render();
        });
    }

    document.getElementById('todayBtn')?.addEventListener('click', () => {
        const now = new Date();
        currentYear = now.getFullYear();
        currentMonth = now.getMonth();
        updateDateDisplay();
        render();
    });
}

swapModal.addEventListener('click', (e) => {
    if (e.target === swapModal) {
        swapModal.setAttribute('aria-hidden', 'true');
        swapModal.classList.remove('open');
        resetSwapSelection();
    }
});

const resetSwapSelection = () => {
    if (selectedSwapCell) {
        selectedSwapCell.classList.remove('swap-selected');
        selectedSwapCell = null;
    }

    swapContext = null;

    if (swapModal) {
        document.getElementById('swapTeacherSearch').value = '';
        document.querySelectorAll('#teacherCategories .teacher-category-btn').forEach((btn, index) => {
            btn.classList.toggle('active', index === 0);
        });
        document.querySelectorAll('#pairSelection .pair-option').forEach((option, index) => {
            option.classList.toggle('selected', index === 0);
        });
    }
};

const getPeriodsForDate = async (date) => {
    try {
        if (PERIODS_DATA[date]) {
            return PERIODS_DATA[date];
        }

        const response = await fetch(`${API_BASE}/getPeriodsForDate?date=${date}`);
        if (!response.ok) {
            throw new Error('Failed to load periods');
        }

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

    let studyYear;
    if (month >= 9) {
        studyYear = year;
    } else {
        studyYear = year - 1;
    }

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
            return `
        <div class="pair-option ${isSelected ? 'selected' : ''}" 
             data-pair="${period.index}" 
             data-pair-id="${period.pair_id}">
          ${period.short_name}
          <span class="pair-time">${period.time_range}</span>
        </div>
      `;
        }).join('');

        pairSelection.innerHTML = periodsHTML;

        pairSelection.querySelectorAll('.pair-option').forEach(option => {
            option.addEventListener('click', () => {
                pairSelection.querySelectorAll('.pair-option').forEach(o =>
                    o.classList.remove('selected')
                );
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


const showNotification = (message, type = 'info') => {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    z-index: 1000;
    max-width: 300px;
  `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
};


// Загрузка и отображение преподавателей с цветами и категориями
const fillTeachers = async () => {
    try {
        TEACHERS_LIST = await fetchTeachers();

        TEACHER_CATEGORIES = {};
        Object.keys(TEACHERS_LIST).forEach(teacherName => {
            // Приводим категорию к строке
            const category = String(TEACHERS_LIST[teacherName]?.category || 'other');
            if (!TEACHER_CATEGORIES[category]) {
                TEACHER_CATEGORIES[category] = [];
            }
            TEACHER_CATEGORIES[category].push(teacherName);

            // Также сохраняем строковое значение обратно
            TEACHERS_LIST[teacherName].category = category;
        });

        Object.keys(TEACHER_CATEGORIES).forEach(category => {
            TEACHER_CATEGORIES[category].sort((a, b) => a.localeCompare(b, 'ru'));
        });

        await initColorSystem(Object.keys(TEACHERS_LIST).length);

        teachersSel.innerHTML = Object.keys(TEACHERS_LIST).sort((a, b) => a.localeCompare(b, 'ru'))
            .map(n => `<option value="${n}">${n}</option>`).join('');

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

    } catch (error) {
        console.error('Ошибка при загрузке преподавателей:', error);
    }
};

const renderTeacherCategories = () => {
    const categories = Object.keys(TEACHER_CATEGORIES).sort();

    const categoryNames = {
        '1': 'ПМК 1',
        '2': 'ПМК 2',
        'other': 'Другие'
    };

    let categoriesHTML = `<div class="ms-category ${activeCategory === 'all' ? 'active' : ''}" data-category="all">
        Все преподаватели
    </div>`;

    categories.forEach(category => {
        const categoryName = categoryNames[category] || `Категория ${category}`;
        const count = TEACHER_CATEGORIES[category]?.length || 0;
        categoriesHTML += `<div class="ms-category ${activeCategory === category ? 'active' : ''}" data-category="${category}">
            ${categoryName} <span class="category-count">(${count})</span>
        </div>`;
    });

    if (msCategories) {
        msCategories.innerHTML = categoriesHTML;

        msCategories.querySelectorAll('.ms-category').forEach(cat => {
            cat.addEventListener('click', () => {
                const category = cat.dataset.category;
                activeCategory = category;

                msCategories.querySelectorAll('.ms-category').forEach(c =>
                    c.classList.remove('active')
                );
                cat.classList.add('active');

                renderTeacherList(category);
            });
        });
    }
};

const renderTeacherList = async (category) => {
    let teachers = [];

    if (category === 'all') {
        teachers = Object.keys(TEACHERS_LIST).sort((a, b) => a.localeCompare(b, 'ru'));
    } else {
        teachers = TEACHER_CATEGORIES[category] || [];
    }

    const msItems = await Promise.all(teachers.map(async (n) => {
        const color = await getTeacherColor(n);
        const isSelected = selectedTeachers.has(n);
        return `<label class="ms-item ${isSelected ? 'selected' : ''}" data-name="${n}">
            <input type="checkbox" data-name="${n}" ${isSelected ? 'checked' : ''} />
            <span class="dot" style="background:${color}"></span>
            <span>${n}</span>
        </label>`;
    }));

    msList.innerHTML = msItems.join('');
    updateMsBadge();
};

const setDefaultMonth = () => {
    const now = new Date(),
        ym = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

    monthInput.value = ym;
    monthLabel.textContent = formatMonthTitle(ym);

    const monthNames = Array.from({length: 12}, (_, i) =>
        new Date(2000, i, 1).toLocaleDateString('ru-RU', {month: 'long'})
    );

    jumpMonth.innerHTML = monthNames.map((n, i) =>
        `<option value="${pad2(i + 1)}">${n}</option>`
    ).join('');

    jumpMonth.value = pad2(now.getMonth() + 1);
    jumpYear.value = now.getFullYear();
    allTeachersChk.checked = false;
    updateGlobalNavForMonth(ym);
};

const updateGlobalNavForMonth = (v) => {
    const {lastDay} = getMonthBounds(v);
    populateJumpTeacher();
};

const updateMsBadge = () => {
    const c = selectedTeachers.size,
        t = Object.keys(TEACHERS_LIST).length;

    msBadge.textContent = c === t ? 'Все' : (c ? `${c} выбрано` : 'Ничего не выбрано');
    msBadge.className = c === t ? 'badge all' : (c ? 'badge some' : 'badge none');
};

const getSelectedTeachers = () => {
    return allTeachersChk.checked ?
        Object.keys(TEACHERS_LIST) :
        Array.from(selectedTeachers);
};

/* ===== Рендеринг таблиц с цветами ===== */
const buildHeadRow = (year, month0, lastDay) => {
    const tr = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.className = 'col-pair col-head row-head';
    th0.textContent = 'Часы';
    tr.appendChild(th0);

    const now = new Date(),
        todayIso = isoFromYMD(now.getFullYear(), now.getMonth(), now.getDate());

    for (let d = 1; d <= lastDay; d++) {
        const iso = isoFromYMD(year, month0, d),
            dt = new Date(year, month0, d);
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

    const teacherColor = await getTeacherColor(teacher);

    const title = document.createElement('div');
    title.className = 'teacher-title';
    title.id = teacherId(teacher);

    const dotSpan = document.createElement('span');
    dotSpan.className = 'dot';
    dotSpan.style.cssText = `width:12px;height:12px;border-radius:50%;background:${teacherColor};display:inline-block;margin-right:8px`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = teacher;

    title.appendChild(dotSpan);
    title.appendChild(nameSpan);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.appendChild(buildHeadRow(year, month0, lastDay));
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let i = 0; i < 4; i++) {
        const tr = document.createElement('tr');
        const rowHead = document.createElement('td');
        rowHead.className = 'row-head col-pair';
        const hoursMap = ['1 - 2', '3 - 4', '5 - 6', '7 - 8'];
        rowHead.textContent = hoursMap[i] || `Пара ${i + 1}`;
        tr.appendChild(rowHead);

        for (let d = 1; d <= lastDay; d++) {
            const iso = isoFromYMD(year, month0, d),
                pair = (tData[iso] || [])[i];
            const td = document.createElement('td');
            td.classList.add(new Date(`${year}-${month0 + 1}-${d}`).getDay() === 0 ? "isSundayTrue" : "isSundayFalse");
            if (isAdminMode()) td.classList.add('editable');
            td.dataset.teacher = teacher;
            td.dataset.date = iso;
            td.dataset.index = i;
            td.dataset.teacher_mid = pair?.teacher_mid || '';

            if (pair && pair.schedule_id) {
                td.dataset.scheduleId = pair.schedule_id;
                td.style.backgroundColor = await findCathedraByGroupName(pair.group);
            }

            td.innerHTML = pair ?
                `<div class="pair">
                    <div class="line">
                        <span class="chip"><span class="dot"></span>${pair.type}${pair.lesson_num ? ` ${pair.lesson_num}` : ''}</span>
                        <span class="chip green"><span class="dot"></span>${pair.room}</span>
                    </div>
                    <div class="line">
                        <span class="chip">${pair.group}</span>
                        <span class="chip">${pair.course}</span>
                    </div>
                </div>` : `<span class="chip muted">-</span>`;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(title);
    wrap.appendChild(table);
    attachScrollUX(wrap, table);
    TEACHER_SECTIONS = [{name: teacher, id: teacherId(teacher), el: title}];
    return wrap;
};

const renderCombinedStacked = async (teachers, monthVal) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const {year, month0, lastDay} = getMonthBounds(monthVal);
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.appendChild(buildHeadRow(year, month0, lastDay));
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    TEACHER_SECTIONS = [];

    const teachersColors = await getTeachersColors(teachers);

    for (const tName of teachers) {
        const teacherColor = teachersColors[tName] || await getTeacherColor(tName);

        const sec = document.createElement('tr');
        const secTd = document.createElement('td');
        secTd.colSpan = lastDay + 1;
        secTd.className = 'section-head';
        const id = teacherId(tName);
        secTd.id = id;
        secTd.innerHTML = `<span class="chip ch" style="border-color:${teacherColor}">
            <span class="dot" style="background:${teacherColor}"></span>${tName}
        </span>`;
        sec.appendChild(secTd);
        tbody.appendChild(sec);
        TEACHER_SECTIONS.push({name: tName, id, el: secTd});

        for (let i = 0; i < 4; i++) {
            const tr = document.createElement('tr');
            const rowHead = document.createElement('td');
            rowHead.className = 'row-head col-pair';
            const hoursMap = ['1 - 2', '3 - 4', '5 - 6', '7 - 8'];
            rowHead.textContent = hoursMap[i] || `Пара ${i + 1}`;
            tr.appendChild(rowHead);

            for (let d = 1; d <= lastDay; d++) {
                const iso = isoFromYMD(year, month0, d),
                    pair = (DATA[tName]?.[iso] || [])[i];
                const td = document.createElement('td');
                td.classList.add(new Date(`${year}-${month0 + 1}-${d}`).getDay() === 0 ? "isSundayTrue" : "isSundayFalse");

                if (isAdminMode()) td.classList.add('editable');
                td.dataset.teacher = tName;
                td.dataset.date = iso;
                td.dataset.index = i;
                td.dataset.teacher_mid = pair?.teacher_mid || '';

                if (pair && pair.schedule_id) {
                    td.dataset.scheduleId = pair.schedule_id;
                    td.style.backgroundColor = await findCathedraByGroupName(pair.group);
                }


                td.innerHTML = pair ?
                    `<div class="pair">
                    <div class="line">
                        <span class="chip"><span class="dot"></span>${pair.type}${pair.lesson_num ? ` ${pair.lesson_num}` : ''}</span>
                        <span class="chip green"><span class="dot"></span>${pair.room}</span>
                    </div>
                    <div class="line">
                        <span class="chip">${pair.group}</span>
                        <span class="chip">${pair.course}</span>
                    </div>
                </div>` : `<span class="chip muted">-</span>`;
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    attachScrollUX(wrap, table);
    return wrap;
};

/* ===== Навигация/прокрутка ===== */
const getWrap = () => tables.querySelector('.table-wrap');

const dayWidth = (wrap) => {
    const th = wrap?.querySelector('thead th:nth-child(2)');
    return th ? th.getBoundingClientRect().width : 80;
};

const getLastDay = () => daysInMonth(currentYear, currentMonth);

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const refreshNavAutoHide = () => {
    const wrap = getWrap();
    if (!wrap) return;
    const last = getLastDay();
    const cur = Math.max(1, Math.min(last, currentDayFromScroll(wrap)));
    updateNavDisabled();
};

window.addEventListener('resize', refreshNavAutoHide);
window.addEventListener('scroll', refreshNavAutoHide, {passive: true});

let suppressSyncUntil = 0;

const setSuppress = (ms) => suppressSyncUntil = performance.now() + ms;

const updateNavDisabled = () => {
    const wrap = getWrap();
    if (!wrap) return;
    const last = getLastDay();
    const cur = clamp(currentDayFromScroll(wrap), 1, last);
    const atStart = cur <= 1, atEnd = cur >= last;
};

const currentDayFromScroll = (wrap) => 1 + Math.round((wrap?.scrollLeft || 0) / dayWidth(wrap));

const scrollToDay = (day, behavior = 'auto') => {
    const wrap = getWrap();
    if (!wrap) return;
    const last = getLastDay();
    const d = clamp(Number(day), 1, last);
    setSuppress(behavior === 'smooth' ? 350 : 80);
    wrap.scrollTo({left: dayWidth(wrap) * (d - 1), behavior});
};

const syncDayControlsFromScroll = (wrap) => {
    if (performance.now() < suppressSyncUntil) return;
    const last = getLastDay();
    const d = clamp(currentDayFromScroll(wrap), 1, last);
    updateNavDisabled();
};


async function findCathedraByGroupName(groupName) {
    const response = await fetch(`${API_BASE}/getColorAtGroup/${encodeURIComponent(groupName)}`);

    if (!response.ok) {
        let errorText = 'Ошибка загрузки расписания';
        try {
            const errorData = await response.json();
            errorText = errorData.error || errorText;
        } catch (e) {
            errorText = `HTTP error! status: ${response.status}`;
        }
        throw new Error(errorText);
    }

    return await response.json();
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

/* ===== Модалка редактирования ===== */
let ctx = null;

let openModal = (title, pairData = null) => {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const pairInfo = document.getElementById('pairInfo');
    const showRecBtn = document.getElementById('showRecommendationsBtn');

    modalTitle.textContent = title;

    // Заполняем информацию о паре
    if (pairData) {
        pairInfo.style.display = 'block';
        const hoursMap = ['1-2 час (8:00-9:30)', '3-4 час (9:45-11:15)', '5-6 час (11:30-13:00)', '7-8 час (14:00-15:30)'];

        document.getElementById('pairInfoTeacher').textContent = pairData.teacher || '-';
        document.getElementById('pairInfoDate').textContent = pairData.date || '-';
        document.getElementById('pairInfoPeriod').textContent = hoursMap[pairData.index] || `Пара ${(pairData.index || 0) + 1}`;
    } else {
        pairInfo.style.display = 'none';
    }

    // Показываем кнопку рекомендаций только для администратора при наличии ctx
    if (showRecBtn) {
        showRecBtn.style.display = (isAdminMode() && (ctx || isManualAdd)) ? 'inline-flex' : 'none';
    }

    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');

    const recPanel = document.getElementById('editorRecommendationsPanel');
    if (recPanel) recPanel.style.display = 'none';
};


const originalOpenModal = openModal;
openModal = function(title, pairData = null) {
    if (!isManualAdd) {
        document.querySelectorAll('.manual-field').forEach(el => el.style.display = 'none');
    }
    originalOpenModal(title, pairData);
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

// ===== ВАЖНО: ОБЪЕДИНЕННЫЙ ОБРАБОТЧИК КЛИКА =====
// Заменяет закомментированный обработчик и обработчик выделения ячейки
// ===== ВАЖНО: ИСПРАВЛЕННЫЕ ОБРАБОТЧИКИ КЛИКОВ =====

// Задержка для определения двойного клика
let clickTimer = null;

// Одинарный клик — выделение ячейки (или режим замены)
tables.addEventListener('click', async (e) => {
    const td = e.target.closest('td');
    if (!td || !td.dataset.teacher) return;

    saveScrollPosition();

    // === РЕЖИМ ЗАМЕНЫ (приоритетный) ===
    if (swapMode) {
        // Отменяем таймер двойного клика если есть
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
        }

        const teacher = td.dataset.teacher;
        const iso = td.dataset.date;
        const index = Number(td.dataset.index);
        const scheduleId = td.dataset.scheduleId;

        if (!scheduleId) {
            showNotification('В этой ячейке нет пары для замены', 'error');
            return;
        }

        if (selectedSwapCell) {
            selectedSwapCell.classList.remove('swap-selected');
        }

        td.classList.add('swap-selected');
        selectedSwapCell = td;

        await openSwapModal(teacher, iso, index, scheduleId);
        return;
    }

    // === ОБЫЧНЫЙ РЕЖИМ / РЕЖИМ АДМИНИСТРАТОРА ===
    // Используем таймер для различения одинарного и двойного клика

    // Если это повторный клик по той же ячейке в течение 300мс — считаем двойным
    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;

        // ДВОЙНОЙ КЛИК — открываем редактор (только для админа)
        if (isAdminMode()) {
            if (DISCIPLINES.length === 0) {
                await loadModalData();
            }

            const teacher = td.dataset.teacher;
            const iso = td.dataset.date;
            const index = Number(td.dataset.index);
            const scheduleId = td.dataset.scheduleId;
            const teacher_mid = td.dataset.teacher_mid;

            ctx = {teacher, iso, index, scheduleId, teacher_mid};

            const list = (DATA[teacher]?.[iso] || []);
            const pair = list[index];

            // Сбрасываем состояния множественного выбора
            selectedTeachersModal.clear();
            selectedRoomsModal.clear();
            selectedGroupsModal.clear();
            multiTeacher.checked = false;
            multiRoom.checked = false;
            multiGroup.checked = false;
            toggleMultiMode('teacher');
            toggleMultiMode('room');
            toggleMultiMode('group');
            updateBadge('teacher');
            updateBadge('room');
            updateBadge('group');

            if (teacherSearch) teacherSearch.value = '';
            if (roomSearch) roomSearch.value = '';
            if (groupSearch) groupSearch.value = '';

            const getTypeId = (typeAlias) => {
                const found = LESSON_TYPES.find(item => item.alias === typeAlias);
                return found ? found.id : '';
            };

            const getRoomId = (roomAlias) => {
                const found = CLASSROOMS.find(item => item.short_name === roomAlias);
                return found ? found.id : '';
            };

            const getGroupId = (groupName) => {
                const found = GROUPS.find(item => item.name === groupName);
                return found ? found.id : '';
            };

            const getCourseId = (courseAlias) => {
                const found = DISCIPLINES.find(item => item.alias === courseAlias);
                return found ? found.id : '';
            };

            if (pair) {
                f_type.value = getTypeId(pair.type);
                f_lesson_num.value = pair.lesson_num || '';
                f_course.value = getCourseId(pair.course);
                selectedTeacherSingle = teacher || '';
                if (teacherSingleSearch) teacherSingleSearch.value = teacher || '';

                selectedRoomSingle = getRoomId(pair.room);
                const room = CLASSROOMS.find(r => String(r.id) === String(selectedRoomSingle));
                if (roomSingleSearch) roomSingleSearch.value = room ? room.short_name : '';

                selectedGroupSingle = getGroupId(pair.group);
                const group = GROUPS.find(g => String(g.id) === String(selectedGroupSingle));
                if (groupSingleSearch) groupSingleSearch.value = group ? group.name : '';

                if (pair.teachers && pair.teachers.length > 1) {
                    multiTeacher.checked = true;
                    toggleMultiMode('teacher');
                    pair.teachers.forEach(t => selectedTeachersModal.add(t));
                    updateBadge('teacher');
                }
                if (pair.rooms && pair.rooms.length > 1) {
                    multiRoom.checked = true;
                    toggleMultiMode('room');
                    pair.rooms.forEach(r => selectedRoomsModal.add(r.toString()));
                    updateBadge('room');
                }
                if (pair.groups && pair.groups.length > 1) {
                    multiGroup.checked = true;
                    toggleMultiMode('group');
                    pair.groups.forEach(g => selectedGroupsModal.add(g.toString()));
                    updateBadge('group');
                }
            } else {
                f_type.value = '';
                roomSingle.value = '';
                groupSingle.value = '';
                f_course.value = '';
                f_lesson_num.value = '';
            }

            btnDelete.style.display = pair && pair.schedule_id ? 'inline-flex' : 'none';

            openModal(`${teacher} — ${iso}`, {
                teacher: teacher,
                date: iso,
                index: index,
                scheduleId: scheduleId
            });
        }
        return;
    }

    // ОДИНАРНЫЙ КЛИК — выделяем ячейку (для копирования)
    selectCell(td);

    // Устанавливаем таймер для определения двойного клика
    clickTimer = setTimeout(() => {
        clickTimer = null;
    }, 300); // 300мс ожидание второго клика
});

// Функция открытия модального окна замены с улучшенным интерфейсом
let openSwapModal = async (fromTeacher, date, pairIndex, scheduleId) => {
    try {
        const currentData = DATA[fromTeacher]?.[date]?.[pairIndex];
        if (!currentData) {
            showNotification('Не удалось получить данные о паре', 'error');
            return;
        }

        document.getElementById('currentTeacher').textContent = fromTeacher;
        document.getElementById('currentCourse').textContent = currentData.course || 'Не указано';
        document.getElementById('currentGroup').textContent = currentData.group || 'Не указано';
        document.getElementById('currentRoom').textContent = currentData.room || 'Не указано';

        const swapDateInput = document.getElementById('swapDateInput');
        swapDateInput.value = date;
        swapDateInput.min = new Date().toISOString().split('T')[0];

        swapDateInput.addEventListener('change', async (e) => {
            const newDate = e.target.value;
            if (swapContext) {
                swapContext.date = newDate;
            }

            await renderPairSelection(newDate, swapContext?.pairIndex || pairIndex);
        });

        await renderPairSelection(date, pairIndex);

        await populateTeacherListForSwap(fromTeacher);

        swapModal.setAttribute('aria-hidden', 'false');
        swapModal.classList.add('open');
        swapModalTitle.textContent = `Замена пары: ${fromTeacher}`;

        swapContext = {
            fromTeacher,
            date,
            pairIndex,
            scheduleId,
            originalDate: date,
            originalPairIndex: pairIndex,
            pairId: currentData.pair_id || 0
        };

    } catch (error) {
        console.error('Error opening swap modal:', error);
        showNotification('Ошибка при открытии окна замены', 'error');
    }
};

const populateTeacherListForSwap = async (excludeTeacher) => {
    const teachersList = document.getElementById('swapTeachersList');
    const teacherSearch = document.getElementById('swapTeacherSearch');

    teachersList.innerHTML = '';

    const allTeachers = Object.keys(TEACHERS_LIST);

    if (allTeachers.length === 0) {
        teachersList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Нет доступных преподавателей</div>';
        return;
    }

    const teachersHTML = await Promise.all(allTeachers.map(async (teacherName) => {
        const category = TEACHERS_LIST[teacherName]?.category || 'other';
        const categoryNames = {
            '1': 'ПМК 1',
            '2': 'ПМК 2',
            'other': 'Другие'
        };

        const color = await getTeacherColor(teacherName);

        const isCurrentTeacher = teacherName === excludeTeacher;

        return `
      <div class="teacher-option ${isCurrentTeacher ? 'current-teacher' : ''}" 
           data-name="${teacherName}" 
           data-category="${category}"
           data-search="${teacherName.toLowerCase()}">
        <span class="teacher-dot" style="background: ${color}"></span>
        <span class="teacher-name">${teacherName} ${isCurrentTeacher ? '(текущий)' : ''}</span>
        <span class="teacher-category">${categoryNames[category] || 'Другие'}</span>
      </div>
    `;
    }));

    teachersList.innerHTML = teachersHTML.join('');

    teachersList.querySelectorAll('.teacher-option').forEach(option => {
        option.addEventListener('click', () => {
            teachersList.querySelectorAll('.teacher-option').forEach(o =>
                o.classList.remove('selected')
            );
            option.classList.add('selected');
        });
    });

    const handleSearch = () => {
        const searchTerm = teacherSearch.value.toLowerCase().trim();
        teachersList.querySelectorAll('.teacher-option').forEach(option => {
            const searchText = option.dataset.search;
            const shouldShow = !searchTerm || searchText.includes(searchTerm);
            option.style.display = shouldShow ? '' : 'none';
        });
    };

    teacherSearch.addEventListener('input', handleSearch);

    document.querySelectorAll('#teacherCategories .teacher-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#teacherCategories .teacher-category-btn').forEach(b =>
                b.classList.remove('active')
            );
            btn.classList.add('active');

            const selectedCategory = btn.dataset.category;

            teachersList.querySelectorAll('.teacher-option').forEach(option => {
                const category = option.dataset.category;
                const matchesCategory = selectedCategory === 'all' || category === selectedCategory;
                option.style.display = matchesCategory ? '' : 'none';
            });
        });
    });

    const currentTeacherOption = teachersList.querySelector(`.teacher-option[data-name="${excludeTeacher}"]`);
    if (currentTeacherOption) {
        currentTeacherOption.classList.add('selected');
    }
};

// Сохранение изменений
btnSave.addEventListener('click', async () => {
    if (isManualAdd) {
        const selectedDate = f_date.value;
        const selectedTeacher = f_teacher.value;
        const selectedPair = f_pair.value;

        if (!selectedDate) {
            alert('Выберите дату');
            return;
        }
        if (!selectedTeacher) {
            alert('Выберите преподавателя');
            return;
        }
        if (selectedPair === '') {
            alert('Выберите пару');
            return;
        }

        const scheduleData = {
            teacher_name: selectedTeacher,
            teacher_mid: '',
            period: '',
            date: selectedDate,
            pair_index: parseInt(selectedPair),
            typeid: f_type.value.trim(),
            cid: f_course.value.trim(),
            lesson_num: f_lesson_num.value.trim() || null
        };

        if (multiTeacher.checked) {
            scheduleData.teachers = Array.from(selectedTeachersModal);
            scheduleData.teacher_name = scheduleData.teachers[0] || selectedTeacher || '';
        } else {
            scheduleData.teacher_name = selectedTeacherSingle || '';
        }

        if (multiRoom.checked) {
            scheduleData.rooms = Array.from(selectedRoomsModal);
            scheduleData.rid = scheduleData.rooms[0] || '';
        } else {
            scheduleData.rid = selectedRoomSingle || '';
        }

        if (multiGroup.checked) {
            scheduleData.groups = Array.from(selectedGroupsModal);
            scheduleData.gid = scheduleData.groups[0] || '';
        } else {
            scheduleData.gid = selectedGroupSingle || '';
        }

        if (!scheduleData.typeid || !scheduleData.cid || !scheduleData.rid || !scheduleData.gid) {
            alert('Пожалуйста, заполните все обязательные поля');
            return;
        }

        try {
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

    const {teacher, iso, index, scheduleId, teacher_mid, period, cid, rid, gid} = ctx;
    const scheduleData = {
        teacher_name: teacher,
        teacher_mid: teacher_mid,
        period: period,
        date: iso,
        pair_index: index,
        typeid: f_type.value.trim(),
        rid: roomSingle.value.trim(),
        gid: groupSingle.value.trim(),
        cid: f_course.value.trim(),
        lesson_num: f_lesson_num.value.trim() || null
    };

    if (multiTeacher.checked) {
        scheduleData.teachers = Array.from(selectedTeachersModal);
        scheduleData.teacher_name = scheduleData.teachers[0];
    } else {
        scheduleData.rid = roomSingle.value.trim();
    }

    if (multiRoom.checked) {
        scheduleData.rooms = Array.from(selectedRoomsModal);
        scheduleData.rid = scheduleData.rooms[0];
    } else {
        scheduleData.rid = roomSingle.value.trim();
    }

    if (multiGroup.checked) {
        scheduleData.groups = Array.from(selectedGroupsModal);
        scheduleData.gid = scheduleData.groups[0];
    } else {
        scheduleData.gid = groupSingle.value.trim();
    }

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

// Удаление записи
btnDelete.addEventListener('click', async () => {
    if (!ctx || !ctx.scheduleId) return;

    if (!confirm('Вы уверены, что хотите удалить эту запись?')) return;

    try {
        saveScrollPosition();
        await deleteSchedule(ctx.scheduleId);
        closeModal();

        const selectedTeachers = getSelectedTeachers();
        const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
        await loadScheduleData(selectedTeachers, monthVal);

    } catch (error) {
        alert('Ошибка при удалении: ' + error.message);
    }
});

document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});


document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
/* ===== Основные функции ===== */
const applyMonth = (v) => {
    monthInput.value = v;
    monthLabel.textContent = formatMonthTitle(v);
    updateGlobalNavForMonth(v);
    updateNavDisabled();
};

const safeOpenMonthPicker = () => {
    try {
        if (monthInput && typeof monthInput.showPicker === 'function') {
            monthInput.showPicker();
            return 'native';
        }
    } catch (e) {
    }
    jumpPanel.classList.add('open');
    jumpYear.focus();
    return 'fallback';
};

// Функция загрузки расписания
const loadScheduleData = async (teachers, month) => {
    if (teachers.length === 0) {
        DATA = {};
        await renderTable();
        return;
    }

    try {
        DATA = await fetchSchedule(teachers, month);
        await renderTable();
        if (swapMode) {
            switchModeBtn.click();
        }
    } catch (error) {
        console.error('Ошибка при загрузке расписания:', error);
        tables.innerHTML = `<p class="error">Ошибка загрузки расписания: ${error.message}</p>`;
        DATA = {};
    }
};

// Основная функция рендеринга таблицы с цветами
const renderTable = async () => {
    const sel = getSelectedTeachers(),
        monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    if (monthInput) monthInput.value = monthVal;

    tables.innerHTML = '';


    if (!sel.length) {
        tables.innerHTML = '<div class="note" style="margin-top: 6px;">\n' +
            '    Выберите преподавателей и месяц, затем нажмите "Показать расписание"\n' +
            '</div>';
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

    const todayElement = document.querySelector('.today');
    if (todayElement) {
        todayElement.scrollIntoView({
            behavior: 'auto',
            block: 'center',
            inline: 'center'
        });
    }

    await populateJumpTeacher();
    const wrap = getWrap();
    if (wrap) {
        syncDayControlsFromScroll(wrap);
        refreshNavAutoHide();
    }
    if (pendingScrollRestore) {
        setTimeout(() => forceRestoreScroll(), 100);
    }
};

const render = () => {

    const sel = getSelectedTeachers(),
        monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    if (!monthVal) return;
    loadScheduleData(sel, monthVal);
};

/* ===== Scroll UX ===== */
const attachScrollUX = (wrap, table) => {
    const toggleEdges = () => {
        const atStart = wrap.scrollLeft <= 2,
            atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2;
        wrap.classList.toggle('shadow-left', !atStart);
        wrap.classList.toggle('shadow-right', !atEnd);
    };

    if (!wrap._wheelBound) {
        wrap._wheelBound = true;
        wrap.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.preventDefault();
                wrap.scrollLeft += e.deltaY;
            }
        }, {passive: false});
    }

    if (!wrap._dragBound) {
        wrap._dragBound = true;
        let down = false, sx = 0, sl = 0, dragged = false;

        wrap.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            down = true;
            dragged = false;
            sx = e.clientX;
            sl = wrap.scrollLeft;
        });

        wrap.addEventListener('pointermove', (e) => {
            if (!down) return;
            const dx = e.clientX - sx;
            if (!dragged && Math.abs(dx) > 3) {
                dragged = true;
                wrap.classList.add('grabbing');
            }
            if (dragged) {
                wrap.scrollLeft = sl - dx;
            }
        });

        ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
            wrap.addEventListener(ev, () => {
                down = false;
                wrap.classList.remove('grabbing');
            })
        );
    }

    const maybeHideNavNearEnd = () => {
        const last = getLastDay();
        const cur = Math.max(1, Math.min(last, currentDayFromScroll(wrap)));
    };

    toggleEdges();
    maybeHideNavNearEnd();
};

/* ===== Слушатели UI ===== */
printBtn.addEventListener('click', () => {
    const now = new Date();
    const printDate = now.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    document.body.setAttribute('data-print-date', printDate);

    const printHeader = document.createElement('div');
    printHeader.className = 'print-header';
    printHeader.innerHTML = `
        <h1>Расписание преподавателей</h1>
        <div class="print-date">Дата печати: ${printDate}</div>
    `;

    const selectedTeachers = getSelectedTeachers();
    const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const printInfo = document.createElement('div');
    printInfo.className = 'print-info';
    printInfo.innerHTML = `
        <strong>Период:</strong> ${formatMonthTitle(monthVal)}<br>
        <strong>Преподаватели:</strong> ${selectedTeachers.join(', ')}<br>
        <strong>Количество преподавателей:</strong> ${selectedTeachers.length}
    `;

    const tables = document.getElementById('tables');
    if (tables.firstChild) {
        tables.insertBefore(printHeader, tables.firstChild);
        tables.insertBefore(printInfo, tables.firstChild.nextSibling);
    }

    window.print();

    setTimeout(() => {
        if (printHeader.parentNode) {
            printHeader.remove();
        }
        if (printInfo.parentNode) {
            printInfo.remove();
        }
    }, 100);
});

buildBtn.addEventListener('click', render);
build_1Btn.addEventListener('click', () => {
    render();
    ms.classList.remove('open');
});

allTeachersChk.addEventListener('change', () => {
    if (allTeachersChk.checked) {
        selectedTeachers.clear();
        Object.keys(TEACHERS_LIST).forEach(n => selectedTeachers.add(n));
    } else {
        selectedTeachers.clear();
    }
    updateMsBadge();
    renderTeacherList(activeCategory);
});

// Мультиселект
ms.querySelector('button').addEventListener('click', (e) => {
    e.stopPropagation();
    ms.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    if (!ms.contains(e.target)) ms.classList.remove('open');
});

msSearch.addEventListener('input', () => {
    const q = msSearch.value.trim().toLowerCase();
    msList.querySelectorAll('.ms-item').forEach(li =>
        li.style.display = li.dataset.name.toLowerCase().includes(q) ? '' : 'none'
    );
});

msList.addEventListener('click', (e) => {
    const item = e.target.closest('.ms-item');
    if (!item) return;
    const name = item.dataset.name,
        cb = item.querySelector('input[type="checkbox"]');
    cb.checked = !cb.checked;
    if (cb.checked) selectedTeachers.add(name);
    else selectedTeachers.delete(name);
    allTeachersChk.checked = selectedTeachers.size === Object.keys(TEACHERS_LIST).length;
    updateMsBadge();
});

msNone.addEventListener('click', () => {
    selectedTeachers.clear();
    allTeachersChk.checked = false;
    updateMsBadge();
    renderTeacherList(activeCategory);
});

msSelectCategory.addEventListener('click', () => {
    if (activeCategory === 'all') {
        selectedTeachers.clear();
        Object.keys(TEACHERS_LIST).forEach(n => selectedTeachers.add(n));
    } else {
        const categoryTeachers = TEACHER_CATEGORIES[activeCategory] || [];
        categoryTeachers.forEach(n => selectedTeachers.add(n));
    }
    allTeachersChk.checked = selectedTeachers.size === Object.keys(TEACHERS_LIST).length;
    updateMsBadge();
    renderTeacherList(activeCategory);
});

const setDay = (d, b = 'auto') => scrollToDay(Number(d), b);

let raf = 0, pending = null;

railSearch.addEventListener('input', () => {
    const q = railSearch.value.trim().toLowerCase();
    railCategories.querySelectorAll('.rail-item').forEach(i =>
        i.style.display = i.textContent.toLowerCase().includes(q) ? '' : 'none'
    );
});

railToggle.addEventListener('click', () => rail.classList.toggle('collapsed'));

// Функция загрузки математических рекомендаций
async function loadRecommendations() {
    const panel = document.getElementById('recommendationsPanel');
    const loading = document.getElementById('recLoading');
    const list = document.getElementById('recommendationsList');
    const empty = document.getElementById('recEmpty');
    const note = document.getElementById('recNote');
    const loadBtn = document.getElementById('loadRecommendations');
    const badge = document.getElementById('recBadge');

    if (!swapContext) {
        showNotification('Сначала выберите пару для замены', 'warning');
        return;
    }

    const currentTeacher = swapContext.fromTeacher;
    const pairData = DATA[currentTeacher]?.[swapContext.date]?.[swapContext.pairIndex];

    if (!pairData) {
        showNotification('Не удалось получить данные о паре', 'error');
        return;
    }

    const getTypeId = (typeAlias) => {
        const found = LESSON_TYPES.find(item => item.alias === typeAlias);
        return found ? found.id : null;
    };

    const pairTypeId = pairData.typeid || getTypeId(pairData.type);
    const courseId = pairData.cid;
    const groupId = pairData.gid;
    const courseAlias = pairData.course;

    let cathedraId = pairData.cathedra_id;
    if (!cathedraId) {
        try {
            const teacherId = TEACHERS_LIST[currentTeacher]?.id;
            if (teacherId) {
                const cathedraResponse = await fetch(`/api/getTeacherCathedra?teacher_id=${teacherId}`);
                const cathedraData = await cathedraResponse.json();
                if (cathedraData.success) {
                    cathedraId = cathedraData.cathedra_id;
                }
            }
        } catch (error) {
            console.error('Error getting cathedra_id:', error);
        }
    }

    const excludeTeacherId = TEACHERS_LIST[currentTeacher]?.id;

    if (!pairTypeId || !courseId || !cathedraId) {
        showNotification('Недостаточно данных для поиска рекомендаций', 'error');
        return;
    }

    if (panel) panel.classList.add('open');
    if (loading) loading.style.display = 'flex';
    if (list) list.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (note) note.style.display = 'none';
    if (badge) badge.style.display = 'none';
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = '💡 Загрузка...';
    }

    try {
        const response = await fetch('/api/getTeacherRecommendations', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                pair_type_id: pairTypeId,
                course_id: courseId,
                course_alias: courseAlias,
                group_id: groupId,
                cathedra_id: cathedraId,
                exclude_teacher_id: excludeTeacherId
            })
        });

        const data = await response.json();

        if (loading) loading.style.display = 'none';

        if (data.success) {
            if (data.recommendations && data.recommendations.length > 0) {
                displayRecommendationsPanel(data.recommendations, data.need_higher_rank, pairData);
                if (list) list.style.display = 'block';

                if (badge) {
                    badge.textContent = data.recommendations.length;
                    badge.style.display = 'inline-block';
                }

                if (note) {
                    note.style.display = 'block';
                    note.innerHTML = `
                        <div style="padding: 10px; background: linear-gradient(135deg, #7c5cff20, #6b4ecc20); border-radius: 8px;">
                            <strong>📊 Все преподаватели, которые вели эту дисциплину</strong><br>
                            <small>Найдено ${data.recommendations.length} преподавателей</small>
                        </div>
                    `;
                }
            } else {
                if (empty) {
                    empty.querySelector('.empty-text').textContent = 'Нет преподавателей';
                    empty.querySelector('.empty-hint').textContent = 'Никто не вел эту дисциплину';
                    empty.style.display = 'block';
                }
            }
        } else {
            if (empty) {
                empty.querySelector('.empty-text').textContent = 'Ошибка';
                empty.querySelector('.empty-hint').textContent = data.error || 'Не удалось получить рекомендации';
                empty.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error loading recommendations:', error);
        if (loading) loading.style.display = 'none';
        if (empty) {
            empty.querySelector('.empty-text').textContent = 'Ошибка соединения';
            empty.querySelector('.empty-hint').textContent = error.message;
            empty.style.display = 'block';
        }
    } finally {
        if (loadBtn) {
            loadBtn.disabled = false;
            loadBtn.textContent = '💡 Рекомендации';
        }
    }
}
// Функция загрузки ИИ рекомендаций
async function loadAIRecommendations() {
    const panel = document.getElementById('recommendationsPanel');
    const loading = document.getElementById('recLoading');
    const list = document.getElementById('recommendationsList');
    const empty = document.getElementById('recEmpty');
    const note = document.getElementById('recNote');
    const loadBtn = document.getElementById('loadAIRecommendations');

    const badge = document.getElementById('aiRecBadge');

    if (!swapContext) {
        showNotification('Сначала выберите пару для замены', 'warning');
        return;
    }

    const currentTeacher = swapContext.fromTeacher;
    const pairData = DATA[currentTeacher]?.[swapContext.date]?.[swapContext.pairIndex];

    if (!pairData) {
        showNotification('Не удалось получить данные о паре', 'error');
        return;
    }

    const getTypeId = (typeAlias) => {
        const found = LESSON_TYPES.find(item => item.alias === typeAlias);
        return found ? found.id : null;
    };

    const pairTypeId = pairData.typeid || getTypeId(pairData.type);
    const courseId = pairData.cid;
    const courseAlias = pairData.course;
    const groupId = pairData.gid;
    const periodId = pairData.period;
    const dayOfWeek = getDayOfWeek(swapContext.date);

    let cathedraId = pairData.cathedra_id;
    if (!cathedraId) {
        try {
            const teacherId = TEACHERS_LIST[currentTeacher]?.id;
            if (teacherId) {
                const cathedraResponse = await fetch(`/api/getTeacherCathedra?teacher_id=${teacherId}`);
                const cathedraData = await cathedraResponse.json();
                if (cathedraData.success) {
                    cathedraId = cathedraData.cathedra_id;
                    console.log('Got cathedra_id from API:', cathedraId);
                }
            }
        } catch (error) {
            console.error('Error getting cathedra_id:', error);
        }
    }

    const excludeTeacherId = TEACHERS_LIST[currentTeacher]?.id;

    let studyYearId = null;
    try {
        const yearResponse = await fetch(`/api/getStudyYear?date=${swapContext.date}`);
        const yearData = await yearResponse.json();
        if (yearData.success) {
            studyYearId = yearData.study_year_id;
        }
    } catch (error) {
        console.error('Error getting study year:', error);
    }

    console.log('=== AI Recommendations Debug ===');
    console.log('pairTypeId:', pairTypeId);
    console.log('courseId:', courseId);
    console.log('groupId:', groupId);
    console.log('periodId:', periodId);
    console.log('dayOfWeek:', dayOfWeek);
    console.log('cathedraId:', cathedraId);
    console.log('studyYearId:', studyYearId);
    console.log('excludeTeacherId:', excludeTeacherId);

    if (!pairTypeId || !courseId || !groupId || !periodId) {
        console.log('Missing data:', { pairTypeId, courseId, groupId, periodId });
        showNotification('Недостаточно данных для ИИ рекомендаций', 'error');
        return;
    }

    if (!cathedraId) {
        showNotification('Не удалось определить кафедру преподавателя', 'error');
        return;
    }

    if (!studyYearId) {
        showNotification('Не удалось определить учебный год', 'error');
        return;
    }

    if (panel) panel.classList.add('open');
    if (loading) loading.style.display = 'flex';
    if (list) list.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (note) note.style.display = 'none';
    if (badge) badge.style.display = 'none';
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = '🤖 Загрузка...';
    }

    try {
        const response = await fetch('/api/getAIRecommendations', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                course_id: courseId,
                group_id: groupId,
                course_alias: courseAlias,
                pair_type_id: pairTypeId,
                period_id: periodId,
                day_of_week: dayOfWeek,
                cathedra_id: cathedraId,
                study_year_id: studyYearId,
                exclude_teacher_id: excludeTeacherId
            })
        });

        const data = await response.json();

        if (loading) loading.style.display = 'none';

        if (data.success) {
            if (data.recommendations && data.recommendations.length > 0) {
                displayAIRecommendations(data.recommendations);
                if (list) list.style.display = 'block';

                if (badge) {
                    badge.textContent = data.recommendations.length;
                    badge.style.display = 'inline-block';
                }

                if (note) {
                    note.style.display = 'block';
                    const avgConfidence = data.recommendations.reduce((sum, r) => sum + (r.confidence || 0), 0) / data.recommendations.length;
                    note.innerHTML = `
                        <div style="padding: 10px; background: linear-gradient(135deg, #667eea20, #764ba220); border-radius: 8px;">
                            <strong>🤖 Рекомендации</strong><br>
                            <small>Найдено ${data.recommendations.length} преподавателей</small><br>
                            <small>Средняя уверенность: ${avgConfidence.toFixed(1)}%</small>
                        </div>
                    `;
                }
            } else {
                if (empty) {
                    const emptyText = empty.querySelector('.empty-text');
                    const emptyHint = empty.querySelector('.empty-hint');
                    if (emptyText) emptyText.textContent = 'Нет рекомендаций';
                    if (emptyHint) emptyHint.textContent = 'Не найдено подходящих преподавателей для этой пары';
                    empty.style.display = 'block';
                }
            }
        } else {
            if (empty) {
                const emptyText = empty.querySelector('.empty-text');
                const emptyHint = empty.querySelector('.empty-hint');
                if (emptyText) emptyText.textContent = 'Ошибка';
                if (emptyHint) emptyHint.textContent = data.error || 'Не удалось получить рекомендации';
                empty.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error:', error);
        if (loading) loading.style.display = 'none';
        if (empty) {
            const emptyText = empty.querySelector('.empty-text');
            const emptyHint = empty.querySelector('.empty-hint');
            if (emptyText) emptyText.textContent = 'Ошибка соединения';
            if (emptyHint) emptyHint.textContent = 'Проверьте подключение к серверу';
            empty.style.display = 'block';
        }
    } finally {
        if (loadBtn) {
            loadBtn.disabled = false;
            loadBtn.textContent = '🤖 Рекомендации от ИИ';
        }
    }
}


function getDayOfWeek(dateStr) {
    const date = new Date(dateStr);
    let day = date.getDay();
    return day === 0 ? 7 : day;
}

document.addEventListener('DOMContentLoaded', function() {
    const loadRecBtn = document.getElementById('loadRecommendations');
    if (loadRecBtn) {
        loadRecBtn.addEventListener('click', loadRecommendations);
    }

    const loadAIRecommendationsBtn = document.getElementById('loadAIRecommendations');
    if (loadAIRecommendationsBtn) {
        loadAIRecommendationsBtn.addEventListener('click', loadAIRecommendations);
    }

    const closeBtn = document.getElementById('closeRecommendations');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('recommendationsPanel').classList.remove('open');
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('recommendationsPanel').classList.remove('open');
        }
    });
});


function displayRecommendationsPanel(recommendations, needHigherRank, pairData) {
    const recommendationsList = document.getElementById('recommendationsList');
    if (!recommendationsList) return;

    if (!recommendations || recommendations.length === 0) {
        recommendationsList.innerHTML = '<div class="recommendations-placeholder">Нет преподавателей, которые вели эту дисциплину</div>';
        return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';

    recommendations.forEach((teacher, index) => {
        const degreeShort = teacher.degree_short || '';
        const degreeId = teacher.degree_id || 0;
        const totalCount = teacher.total_count || 0;
        const sameGroupCount = teacher.same_group_count || 0;
        const mathScore = teacher.math_score || 0;

        const initials = (teacher.firstname?.[0] || '') + (teacher.lastname?.[0] || '');
        const avatarColor = teacher.id_pmk === 1 ? '#7c5cff' : '#22c55e';

        let rankBadge = '';
        if (degreeId >= 5) rankBadge = '<span class="rec-degree">🎓 доктор наук</span>';
        else if (degreeId >= 3) rankBadge = '<span class="rec-degree">📚 кандидат наук</span>';

        let groupBadge = '';
        if (sameGroupCount > 0) {
            groupBadge = `<span class="rec-badge experience" style="background: #22c55e;">✓ Вел у этой группы (${sameGroupCount} раз)</span>`;
        } else {
            groupBadge = `<span class="rec-badge" style="background: #f59e0b;">📚 Вел эту дисциплину (${totalCount} раз)</span>`;
        }

        let mathColor = '#22c55e';
        if (mathScore < 50) mathColor = '#f59e0b';
        if (mathScore < 30) mathColor = '#ef4444';

        html += `
            <div class="rec-item" 
                 style="animation-delay: ${index * 0.05}s"
                 onclick="selectRecommendedTeacher('${teacher.full_name.replace(/'/g, "\\'")}', ${teacher.mid})">
                <div class="rec-avatar" style="background: ${avatarColor}">
                    ${initials || '👤'}
                </div>
                <div class="rec-info">
                    <div class="rec-name">${teacher.full_name}</div>
                    <div class="rec-meta">
                        ${degreeShort ? `<span class="rec-degree">${degreeShort}</span>` : ''}
                        <span class="rec-pmk">ПМК ${teacher.id_pmk || '?'}</span>
                        ${rankBadge}
                        <span class="rec-badge" style="background: ${mathColor}20; color: ${mathColor};">
                            📐 ${mathScore}%
                        </span>
                    </div>
                    <div style="margin-top: 6px;">
                        ${groupBadge}
                    </div>
                </div>
                <div class="rec-arrow">→</div>
            </div>
        `;
    });

    html += '</div>';
    recommendationsList.innerHTML = html;
}

function displayAIRecommendations(recommendations) {
    const list = document.getElementById('recommendationsList');
    if (!list) return;

    if (!recommendations || recommendations.length === 0) {
        list.innerHTML = '<div class="recommendations-placeholder">Нет рекомендаций от ИИ</div>';
        return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';

    recommendations.forEach((teacher, index) => {
        const degreeShort = teacher.degree_short || '';
        const degreeId = teacher.degree_id || 0;
        const confidence = teacher.confidence || 0;
        const stats = teacher.stats || {};

        const initials = (teacher.firstname?.[0] || '') + (teacher.lastname?.[0] || '');
        const avatarColor = teacher.id_pmk === 1 ? '#667eea' : '#48bb78';

        const confidencePercent = Math.round(confidence);

        let confidenceColor = '#22c55e';
        let confidenceText = 'Высокая';
        if (confidencePercent < 50) {
            confidenceColor = '#f59e0b';
            confidenceText = 'Средняя';
        }
        if (confidencePercent < 30) {
            confidenceColor = '#ef4444';
            confidenceText = 'Низкая';
        }

        let rankBadge = '';
        if (degreeId >= 5) rankBadge = '<span class="rec-badge rank-high">🎓 доктор</span>';
        else if (degreeId >= 3) rankBadge = '<span class="rec-badge rank-high">📚 кандидат</span>';

        html += `
            <div class="rec-item" style="animation-delay: ${index * 0.05}s"
                 onclick="selectRecommendedTeacher('${teacher.full_name.replace(/'/g, "\\'")}', ${teacher.mid})">
                <div class="rec-avatar" style="background: ${avatarColor}">
                    ${initials || '👤'}
                </div>
                <div class="rec-info">
                    <div class="rec-name">${teacher.full_name}</div>
                    <div class="rec-meta">
                        ${degreeShort ? `<span class="rec-degree">${degreeShort}</span>` : ''}
                        <span class="rec-pmk">ПМК ${teacher.id_pmk || '?'}</span>
                        ${rankBadge}
                        <span class="rec-badge" style="background: ${confidenceColor}20; color: ${confidenceColor}; font-weight: 600;">
                            🧠 ${confidencePercent}% (${confidenceText})
                        </span>
                    </div>
                    <div style="margin-top: 4px; font-size: 10px; color: #6b7280;">
                        📊 Всего: ${stats.total || 0} раз(а) | С этой группой: ${stats.same_group || 0} раз(а)
                    </div>
                </div>
                <div class="rec-arrow">→</div>
            </div>
        `;
    });

    html += '</div>';
    list.innerHTML = html;
}


function selectRecommendedTeacher(teacherName, teacherId) {
    const searchInput = document.getElementById('swapTeacherSearch');
    if (searchInput) {
        searchInput.value = teacherName;
        searchInput.dispatchEvent(new Event('input'));
    }

    const teachersList = document.getElementById('swapTeachersList');
    teachersList.querySelectorAll('.teacher-option').forEach(opt => {
        opt.classList.remove('selected');
    });

    const selectedOption = teachersList.querySelector(`.teacher-option[data-name="${teacherName}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
        selectedOption.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    document.querySelectorAll('.rec-item').forEach(item => {
        item.classList.remove('selected');
        if (item.querySelector('.rec-name')?.textContent.includes(teacherName)) {
            item.classList.add('selected');
        }
    });

    showNotification(`Выбран: ${teacherName}`, 'success');
}

document.addEventListener('DOMContentLoaded', function() {
    const loadRecBtn = document.getElementById('loadRecommendations');
    if (loadRecBtn) {
        loadRecBtn.addEventListener('click', loadRecommendations);
    }

    const closeBtn = document.getElementById('closeRecommendations');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('recommendationsPanel').classList.remove('open');
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('recommendationsPanel').classList.remove('open');
        }
    });

    document.addEventListener('click', (e) => {
        const panel = document.getElementById('recommendationsPanel');
        const button = document.getElementById('loadRecommendations');
        if (panel.classList.contains('open') &&
            !panel.contains(e.target) &&
            !button.contains(e.target)) {
            panel.classList.remove('open');
        }
    });
});

const originalOpenSwapModal = openSwapModal;
openSwapModal = async function(fromTeacher, date, pairIndex, scheduleId) {
    await originalOpenSwapModal.call(this, fromTeacher, date, pairIndex, scheduleId);

    const pairData = DATA[fromTeacher]?.[date]?.[pairIndex];
    if (pairData && swapContext) {
        swapContext.pairData = pairData;
    }

    document.getElementById('recommendationsPanel').classList.remove('open');
};

let currentRecType = 'math';

const loadPairRecommendations = async () => {
    let teacherName, teacherId;

    if (isManualAdd) {
        teacherName = f_teacher.value;
        if (!teacherName) {
            showNotification('Сначала выберите преподавателя', 'warning');
            return;
        }
        teacherId = TEACHERS_LIST[teacherName]?.id;
    } else if (ctx) {
        teacherName = ctx.teacher;
        teacherId = TEACHERS_LIST[teacherName]?.id;
    } else {
        showNotification('Сначала выберите преподавателя', 'warning');
        return;
    }

    if (!teacherId) {
        showNotification('Не удалось определить ID преподавателя', 'error');
        return;
    }

    const hoursMap = ['1-2 час', '3-4 час', '5-6 час', '7-8 час'];
    document.getElementById('editorRecTeacher').textContent = teacherName;

    if (isManualAdd) {
        document.getElementById('editorRecDate').textContent = f_date.value || 'Не выбрана';
        const pairIndex = parseInt(f_pair.value);
        document.getElementById('editorRecPeriod').textContent = !isNaN(pairIndex) ? hoursMap[pairIndex] : 'Не выбрана';
    } else if (ctx) {
        document.getElementById('editorRecDate').textContent = ctx.iso;
        document.getElementById('editorRecPeriod').textContent = hoursMap[ctx.index] || `Час ${ctx.index + 1}`;
    }

    let dayOfWeek, periodId;

    if (isManualAdd && f_date.value) {
        const dateObj = new Date(f_date.value);
        dayOfWeek = dateObj.getDay() === 0 ? 7 : dateObj.getDay();
        const pairIndex = parseInt(f_pair.value) || 0;
        periodId = await getPeriodIdForDateTime(f_date.value, pairIndex);
    } else if (ctx) {
        const dateObj = new Date(ctx.iso);
        dayOfWeek = dateObj.getDay() === 0 ? 7 : dateObj.getDay();
        periodId = await getPeriodIdForDateTime(ctx.iso, ctx.index);
    } else {
        dayOfWeek = 1;
        periodId = 112;
    }

    const modal = document.getElementById('editorRecModal');
    const loading = document.getElementById('editorRecLoading');
    const list = document.getElementById('editorRecList');
    const empty = document.getElementById('editorRecEmpty');

    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');

    if (loading) loading.style.display = 'flex';
    if (list) list.style.display = 'none';
    if (empty) empty.style.display = 'none';

    try {
        const response = await fetch('/api/getPairRecommendationsForTeacher', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                teacher_id: teacherId,
                day_of_week: dayOfWeek,
                period_id: periodId
            })
        });

        const data = await response.json();

        if (loading) loading.style.display = 'none';

        if (data.success) {
            const recommendations = currentRecType === 'math' ? data.recommendations.mathematical : data.recommendations.ai;

            if (recommendations && recommendations.length > 0) {
                displayRecommendationsInModal(recommendations, currentRecType);
                if (list) list.style.display = 'block';
            } else {
                if (empty) {
                    empty.querySelector('.empty-text').textContent = 'Нет рекомендаций';
                    empty.querySelector('.empty-hint').textContent = currentRecType === 'math'
                        ? 'У преподавателя пока нет истории занятий'
                        : 'Недостаточно данных для ИИ рекомендаций';
                    empty.style.display = 'block';
                }
            }
        } else {
            if (empty) {
                empty.querySelector('.empty-text').textContent = 'Ошибка';
                empty.querySelector('.empty-hint').textContent = data.error || 'Не удалось получить рекомендации';
                empty.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error loading recommendations:', error);
        if (loading) loading.style.display = 'none';
        if (empty) {
            empty.querySelector('.empty-text').textContent = 'Ошибка соединения';
            empty.querySelector('.empty-hint').textContent = error.message;
            empty.style.display = 'block';
        }
    }
};

const displayRecommendationsInModal = (recommendations, recType) => {
    const list = document.getElementById('editorRecList');
    if (!list) return;

    const isMath = recType === 'math';
    const scoreLabel = isMath ? '📐 Совместимость' : '🧠 Уверенность';

    let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';

    recommendations.forEach((rec, index) => {
        const score = isMath ? rec.math_score : rec.ai_score;
        const scoreColor = score > 70 ? '#22c55e' : (score > 40 ? '#f59e0b' : '#ef4444');

        const courseDisplay = rec.course_title || rec.course_alias;
        const typeDisplay = rec.type_name || rec.type_alias;

        html += `
            <div class="rec-item" style="animation: fadeIn 0.3s ease ${index * 0.05}s both; cursor: pointer;"
                 onclick="applyRecommendationAndClose(${rec.course_id}, ${rec.group_id}, ${rec.type_id})">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
                    <span class="rec-badge" style="background: ${scoreColor}20; color: ${scoreColor}; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;">
                        ${scoreLabel} ${Math.round(score)}%
                    </span>
                    ${!isMath && rec.stats?.has_lessons_at_time ? 
                        '<span class="rec-badge" style="background: #22c55e20; color: #22c55e; padding: 4px 10px; border-radius: 20px; font-size: 11px;">Уже вел в это время</span>' : ''}
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="rec-field" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-size: 12px; color: var(--muted);">Дисциплина:</span>
                        <span style="font-weight: 500;">${escapeHtml(courseDisplay)}</span>
                    </div>
                    <div class="rec-field" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-size: 12px; color: var(--muted);">Группа:</span>
                        <span style="font-weight: 500;">${escapeHtml(rec.group_name)}</span>
                    </div>
                    <div class="rec-field" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-size: 12px; color: var(--muted);">Тип занятия:</span>
                        <span style="font-weight: 500;">${escapeHtml(typeDisplay)}</span>
                    </div>
                </div>
                
                <div style="display: flex; gap: 12px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted);">
                    <span>Вел дисциплину: ${rec.frequency_course || rec.stats?.course_frequency || '?'} раз</span>
                    <span>С группой: ${rec.frequency_group || rec.stats?.group_frequency || '?'} раз</span>
                    <span>Тип: ${rec.frequency_type || rec.stats?.type_frequency || '?'} раз</span>
                </div>
            </div>
        `;
    });

    html += '</div>';
    list.innerHTML = html;
};

const applyRecommendationAndClose = async (courseId, groupId, typeId) => {
    const course = DISCIPLINES.find(c => c.id == courseId);
    const group = GROUPS.find(g => g.id == groupId);
    const lessonType = LESSON_TYPES.find(t => t.id == typeId);

    if (course) {
        f_course.value = courseId;
        const event = new Event('change', { bubbles: true });
        f_course.dispatchEvent(event);
    }

    if (group) {
        groupSingle.value = groupId;
        const event = new Event('change', { bubbles: true });
        groupSingle.dispatchEvent(event);
    }

    if (lessonType) {
        f_type.value = typeId;
        const event = new Event('change', { bubbles: true });
        f_type.dispatchEvent(event);
    }

    closeEditorRecModal();

    showNotification('Рекомендация применена!', 'success');
};

const closeEditorRecModal = () => {
    const modal = document.getElementById('editorRecModal');
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');

    const loading = document.getElementById('editorRecLoading');
    const list = document.getElementById('editorRecList');
    const empty = document.getElementById('editorRecEmpty');

    if (loading) loading.style.display = 'none';
    if (list) list.style.display = 'none';
    if (empty) empty.style.display = 'none';
};

const initEditorRecommendations = () => {
    const showRecBtn = document.getElementById('showRecommendationsBtn');
    const closeModalBtn = document.getElementById('closeEditorRecModal');
    const closeModalBtn2 = document.getElementById('closeEditorRecModalBtn');
    const recTypeTabs = document.querySelectorAll('.rec-type-tab');

    if (showRecBtn) {
        showRecBtn.addEventListener('click', () => {
            loadPairRecommendations();
        });
    }

    const closeModal = () => closeEditorRecModal();

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (closeModalBtn2) closeModalBtn2.addEventListener('click', closeModal);

    if (recTypeTabs) {
        recTypeTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                recTypeTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                currentRecType = tab.dataset.rectype;

                loadPairRecommendations();
            });
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('editorRecModal');
            if (modal.getAttribute('aria-hidden') === 'false') {
                closeEditorRecModal();
            }
        }
    });

    const modal = document.getElementById('editorRecModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeEditorRecModal();
            }
        });
    }
};

const getPeriodIdForDateTime = async (date, pairIndex) => {
    try {
        const response = await fetch(`${API_BASE}/getPeriodsForDate?date=${date}`);
        const data = await response.json();
        if (data.periods && data.periods[pairIndex]) {
            return data.periods[pairIndex].pair_id;
        }
        const defaultPeriodIds = [112, 113, 114, 115];
        return defaultPeriodIds[pairIndex] || 112;
    } catch (error) {
        console.error('Error getting period ID:', error);
        const defaultPeriodIds = [112, 113, 114, 115];
        return defaultPeriodIds[pairIndex] || 112;
    }
};

const escapeHtml = (str) => {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const loadCandidates = async () => {
    const date = isManualAdd ? f_date.value : (ctx ? ctx.iso : '');
    const pairIndex = isManualAdd ? f_pair.value : (ctx ? ctx.index : '');
    const groupId = groupSingle.value;
    const courseId = f_course.value;

    if (!date || pairIndex === '' || !groupId || !courseId) {
        showNotification('Заполните дату, пару, группу и дисциплину', 'warning');
        return;
    }

    if (candidatesPanel) candidatesPanel.style.display = 'block';
    if (candidatesLoading) candidatesLoading.style.display = 'flex';
    if (candidatesBusyList) candidatesBusyList.innerHTML = '';
    if (candidatesFreeExpList) candidatesFreeExpList.innerHTML = '';
    if (candidatesFreeOtherList) candidatesFreeOtherList.innerHTML = '';
    if (candidatesEmpty) candidatesEmpty.style.display = 'none';

    try {
        const course = DISCIPLINES.find(c => c.id == courseId);

        const response = await fetch('/api/getCandidatesForSlot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: date,
                pair_index: parseInt(pairIndex || 0),
                group_id: parseInt(groupId),
                course_id: parseInt(courseId),
                course_alias: course?.alias || ''
            })
        });

        const data = await response.json();

        if (candidatesLoading) candidatesLoading.style.display = 'none';

        if (data.success) {
            if (candidatesBusyList) {
                if (data.busy_teachers.length > 0) {
                    candidatesBusyList.innerHTML = data.busy_teachers.map(t => `
                        <div class="candidate-item busy">
                            <span class="candidate-dot" style="background: #ef4444;"></span>
                            <div class="candidate-info">
                                <span class="candidate-name">${t.name}</span>
                                <span class="candidate-meta">${t.lesson_type} | ${t.course} | ${t.group}</span>
                            </div>
                            <span class="candidate-badge busy">Занят</span>
                        </div>
                    `).join('');
                } else {
                    candidatesBusyList.innerHTML = '<div class="candidate-empty-note">Нет занятых</div>';
                }
            }

            if (candidatesFreeExpList) {
                if (data.free_teachers.experienced.length > 0) {
                    candidatesFreeExpList.innerHTML = data.free_teachers.experienced.map(t => `
                        <div class="candidate-item free recommended" onclick="selectCandidate('${t.name}', '${t.id}')">
                            <span class="candidate-dot" style="background: #10b981;"></span>
                            <div class="candidate-info">
                                <span class="candidate-name">${t.name}</span>
                                <span class="candidate-meta">
                                    ${t.degree ? t.degree + ' | ' : ''}ПМК ${t.pmk || '?'}
                                    ${t.experience ? ` | Вел ${t.experience.total} раз(а)` : ''}
                                    ${t.experience?.same_group ? ` (с этой группой: ${t.experience.same_group})` : ''}
                                </span>
                            </div>
                            <span class="candidate-badge free">✓ Свободен</span>
                        </div>
                    `).join('');
                } else {
                    candidatesFreeExpList.innerHTML = '<div class="candidate-empty-note">Нет свободных с опытом</div>';
                }
            }

            if (candidatesFreeOtherList) {
                if (data.free_teachers.unexperienced.length > 0) {
                    candidatesFreeOtherList.innerHTML = data.free_teachers.unexperienced.slice(0, 10).map(t => `
                        <div class="candidate-item free" onclick="selectCandidate('${t.name}', '${t.id}')">
                            <span class="candidate-dot" style="background: #f59e0b;"></span>
                            <div class="candidate-info">
                                <span class="candidate-name">${t.name}</span>
                                <span class="candidate-meta">
                                    ${t.degree ? t.degree + ' | ' : ''}ПМК ${t.pmk || '?'}
                                </span>
                            </div>
                            <span class="candidate-badge free">✓ Свободен</span>
                        </div>
                    `).join('');
                } else {
                    candidatesFreeOtherList.innerHTML = '<div class="candidate-empty-note">Нет других свободных</div>';
                }
            }
        } else {
            if (candidatesEmpty) {
                candidatesEmpty.style.display = 'block';
                candidatesEmpty.querySelector('.empty-text').textContent = 'Ошибка';
                candidatesEmpty.querySelector('.empty-hint').textContent = data.error || 'Не удалось загрузить';
            }
        }
    } catch (error) {
        console.error('Error loading candidates:', error);
        if (candidatesLoading) candidatesLoading.style.display = 'none';
        if (candidatesEmpty) candidatesEmpty.style.display = 'block';
    }
};

const selectCandidate = (name, id) => {
    if (isManualAdd) {
        f_teacher.value = name;
    } else {
        selectedTeacherSingle = name;
        if (teacherSingleSearch) teacherSingleSearch.value = name;
        if (teacherSingleDropdown) teacherSingleDropdown.style.display = 'none';
    }
    showNotification(`Выбран: ${name}`, 'success');
};

/* ===== Инициализация ===== */
const init = async () => {
    try {
        const adminMode = isAdminMode();
        if (adminMode) {
            document.body.classList.add('admin-on', 'admin-mode');
            adminInfo.style.display = 'block';
            userInfo.style.display = 'none';
        } else {
            document.body.classList.remove('admin-on', 'admin-mode');
            adminInfo.style.display = 'none';
            userInfo.style.display = 'block';
            switchModeBtn.style.display = 'none';
            if (addScheduleBtn) addScheduleBtn.style.display = 'none';
        }

        await fillTeachers();
        await loadModalData();

        initDateSelectors();
        await render();
        updateNavDisabled();

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
                // Также закрываем другие модальные окна
                if (swapModal && swapModal.getAttribute('aria-hidden') === 'false') {
                    swapModal.setAttribute('aria-hidden', 'true');
                    swapModal.classList.remove('open');
                    resetSwapSelection();
                }
                const editorRecModal = document.getElementById('editorRecModal');
                if (editorRecModal && editorRecModal.getAttribute('aria-hidden') === 'false') {
                    editorRecModal.setAttribute('aria-hidden', 'true');
                    editorRecModal.classList.remove('open');
                }
                const recPanel = document.getElementById('recommendationsPanel');
                if (recPanel) recPanel.classList.remove('open');
            }
        });
        initEditorRecommendations();

    } catch (error) {
        console.error('Ошибка инициализации приложения:', error);
    }
};

const clearColorCache = () => {
    TEACHER_COLORS = {};
    console.log('Color cache cleared');
    render();
};

init()

// ===== ГОРЯЧИЕ КЛАВИШИ ДЛЯ КОПИРОВАНИЯ/ВСТАВКИ/ВЫРЕЗАНИЯ ПАР =====

let copiedPair = null;
let cutPair = null;

const getPairDataFromCell = (td) => {
    const teacher = td.dataset.teacher;
    const iso = td.dataset.date;
    const index = Number(td.dataset.index);
    const scheduleId = td.dataset.scheduleId;

    if (!teacher || !iso) return null;

    const pair = DATA[teacher]?.[iso]?.[index];
    if (!pair) return null;

    let typeId = pair.typeid || '';
    if (!typeId && pair.type) {
        const found = LESSON_TYPES.find(t => t.alias === pair.type || t.id == pair.type);
        typeId = found ? found.id : '';
    }

    const roomId = pair.rid || '';
    const groupId = pair.gid || '';
    const courseId = pair.cid || '';

    const roomIds = (pair.rooms || []).map(r => {
        if (!isNaN(Number(r))) return Number(r);
        const found = CLASSROOMS.find(c => c.short_name === r || c.id == r);
        return found ? found.id : r;
    });

    const teacherNames = pair.teachers || [];

    const groupIds = (pair.groups || []).map(g => {
        if (!isNaN(Number(g))) return Number(g);
        const found = GROUPS.find(gr => gr.name === g || gr.id == g);
        return found ? found.id : g;
    });

    console.log('Final IDs:', { typeId, roomId, groupId, courseId });
    console.log('Arrays - rooms:', roomIds, 'groups:', groupIds);

    return {
        teacher,
        iso,
        index,
        scheduleId,
        pairData: { ...pair },
        teacher_mid: pair.teacher_mid || '',
        period: pair.period || '',
        cid: courseId,
        rid: roomId,
        gid: groupId,
        typeid: typeId,
        lesson_num: pair.lesson_num || null,
        teachers: teacherNames,
        rooms: roomIds,
        groups: groupIds
    };
};

const pastePairToCell = async (td, pairInfo) => {
    if (!isAdminMode()) {
        showNotification('Копирование/вставка доступны только в режиме администратора', 'warning');
        return;
    }

    const teacher = td.dataset.teacher;
    const iso = td.dataset.date;
    const index = Number(td.dataset.index);

    const existingPair = DATA[teacher]?.[iso]?.[index];
    if (existingPair && existingPair.schedule_id) {
        if (!confirm(`В ячейке уже есть пара. Заменить её?`)) {
            return;
        }
    }

    const scheduleData = {
        teacher_name: teacher,
        teacher_mid: pairInfo.teacher_mid || '',
        period: pairInfo.period || '',
        date: iso,
        pair_index: index,
        typeid: pairInfo.typeid || '',
        rid: pairInfo.rid || '',
        gid: pairInfo.gid || '',
        cid: pairInfo.cid || '',
        lesson_num: pairInfo.lesson_num || null,
        teachers: pairInfo.teachers || [],
        rooms: pairInfo.rooms || [],
        groups: pairInfo.groups || []
    };

    console.log('Pasting scheduleData:', scheduleData);

    if (!scheduleData.typeid || !scheduleData.rid || !scheduleData.gid || !scheduleData.cid) {
        showNotification('Ошибка: не удалось определить ID для всех полей.', 'error');
        console.error('Missing IDs:', {
            typeid: scheduleData.typeid,
            rid: scheduleData.rid,
            gid: scheduleData.gid,
            cid: scheduleData.cid
        });
        return;
    }

    try {
        saveScrollPosition();

        let result;
        if (existingPair && existingPair.schedule_id) {
            scheduleData.schedule_id = existingPair.schedule_id;
            result = await updateSchedule(scheduleData);
        } else {
            result = await postSchedule(scheduleData);
        }

        if (result.success) {
            showNotification('Пара успешно вставлена', 'success');

            const selectedTeachers = getSelectedTeachers();
            const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
            await loadScheduleData(selectedTeachers, monthVal);
        } else {
            showNotification('Ошибка при вставке: ' + (result.error || 'Неизвестная ошибка'), 'error');
        }
    } catch (error) {
        showNotification('Ошибка при вставке: ' + error.message, 'error');
    }
};

const deletePairFromCell = async (td) => {
    if (!isAdminMode()) {
        showNotification('Удаление доступно только в режиме администратора', 'warning');
        return;
    }

    const scheduleId = td.dataset.scheduleId;
    if (!scheduleId) {
        showNotification('В этой ячейке нет пары для удаления', 'warning');
        return;
    }

    if (!confirm('Вы уверены, что хотите удалить эту пару?')) {
        return;
    }

    try {
        saveScrollPosition();
        await deleteSchedule(scheduleId);

        showNotification('Пара успешно удалена', 'success');

        const selectedTeachers = getSelectedTeachers();
        const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
        await loadScheduleData(selectedTeachers, monthVal);
    } catch (error) {
        showNotification('Ошибка при удалении: ' + error.message, 'error');
    }
};

let selectedCell = null;

const selectCell = (td) => {
    if (selectedCell) {
        selectedCell.classList.remove('cell-selected');
    }

    td.classList.add('cell-selected');
    selectedCell = td;
};

// Обработчик горячих клавиш
document.addEventListener('keydown', async (e) => {
    const activeElement = document.activeElement;
    const isInputFocused = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.tagName === 'SELECT' ||
        activeElement.isContentEditable
    );

    if (isInputFocused) return;

    // Ctrl+C - Копировать
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();

        if (!selectedCell) {
            showNotification('Сначала выберите ячейку с парой (кликните по ней)', 'warning');
            return;
        }

        copiedPair = getPairDataFromCell(selectedCell);
        cutPair = null;

        if (copiedPair) {
            showNotification('Пара скопирована (Ctrl+V для вставки)', 'success');
            selectedCell.classList.add('cell-copied');
            setTimeout(() => selectedCell.classList.remove('cell-copied'), 1000);
        } else {
            showNotification('В выбранной ячейке нет пары', 'warning');
        }
    }

    // Ctrl+X - Вырезать
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();

        if (!selectedCell) {
            showNotification('Сначала выберите ячейку с парой (кликните по ней)', 'warning');
            return;
        }

        cutPair = getPairDataFromCell(selectedCell);
        copiedPair = null;

        if (cutPair) {
            showNotification('Пара вырезана (Ctrl+V для вставки). Исходная пара будет удалена после вставки.', 'info');
            selectedCell.classList.add('cell-cut');
            setTimeout(() => selectedCell.classList.remove('cell-cut'), 2000);
        } else {
            showNotification('В выбранной ячейке нет пары', 'warning');
        }
    }

    // Ctrl+V - Вставить
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();

        const pairToPaste = copiedPair || cutPair;

        if (!pairToPaste) {
            showNotification('Нет скопированной пары. Сначала скопируйте (Ctrl+C) или вырежьте (Ctrl+X) пару.', 'warning');
            return;
        }

        if (!selectedCell) {
            showNotification('Сначала выберите ячейку для вставки (кликните по ней)', 'warning');
            return;
        }

        await pastePairToCell(selectedCell, pairToPaste);

        if (cutPair && cutPair.scheduleId) {
            try {
                await deleteSchedule(cutPair.scheduleId);
                showNotification('Исходная пара удалена', 'info');

                const selectedTeachers = getSelectedTeachers();
                const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
                await loadScheduleData(selectedTeachers, monthVal);
            } catch (error) {
                console.error('Error deleting cut pair:', error);
            }
        }

        copiedPair = null;
        cutPair = null;
    }

    // Delete - Удалить пару
    if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!selectedCell) return;

        e.preventDefault();
        await deletePairFromCell(selectedCell);
    }
});