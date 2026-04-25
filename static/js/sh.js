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
        windowTop: window.scrollY,  // <-- ВАЖНО: вертикальная позиция окна
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
        // ВАЖНО: сначала восстанавливаем вертикальный скролл окна
        window.scrollTo(pendingScrollRestore.windowLeft || 0, targetTop);

        // Потом горизонтальный скролл таблицы
        if (wrap) {
            wrap.scrollLeft = targetLeft;
        }

        console.log('📍 Applied - windowTop:', window.scrollY, 'tableLeft:', wrap?.scrollLeft);
    };

    // Применяем несколько раз с разными задержками для надежности
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
            // Сохраняем только если нет ожидающего восстановления
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
    // Проверяем URL или другие параметры для определения режима администратора
    return IS_ADMIN_MODE === true;
};

// Функция для загрузки данных в модальное окно
const loadModalData = async () => {
    try {
        console.log('Loading modal data...');

        const [disciplinesRes, classroomsRes, lessonTypesRes, groupsRes] = await Promise.all([
            fetch(`${API_BASE}/getDisciplines`),
            fetch(`${API_BASE}/getClassrooms`),
            fetch(`${API_BASE}/getLessonTypes`),
            fetch(`${API_BASE}/getGroups`)
        ]);

        if (!disciplinesRes.ok || !classroomsRes.ok || !lessonTypesRes.ok || !groupsRes.ok) {
            throw new Error('Failed to load modal data');
        }

        DISCIPLINES = await disciplinesRes.json();
        CLASSROOMS = await classroomsRes.json();
        LESSON_TYPES = await lessonTypesRes.ok ? await lessonTypesRes.json() : [];
        GROUPS = await groupsRes.json();
        // Заполняем выпадающие списки
        populateSelect('f_type', LESSON_TYPES, 'id', 'alias');
        populateSelect('f_room', CLASSROOMS, 'id', 'short_name');
        populateSelect('f_group', GROUPS, 'id', 'name');
        populateSelect('f_course', DISCIPLINES, 'id', 'alias');

    } catch (error) {
        console.error('Error loading modal data:', error);
        // Fallback - оставляем поля как есть
    }
};

// Функция для заполнения выпадающего списка
const populateSelect = (selectId, data, valueField, textField) => {
    const select = document.getElementById(selectId);
    if (!select) return;

    // Сохраняем текущее значение
    const currentValue = select.value;

    // Очищаем список (кроме первого option)
    while (select.options.length > 1) {
        select.remove(1);
    }

    // Добавляем опции из данных
    data.forEach(item => {
        const option = document.createElement('option');
        option.value = item[valueField];
        option.textContent = item[textField];
        option.title = item.title || item[textField]; // Для дисциплин показываем title при наведении
        select.appendChild(option);
    });

    // Восстанавливаем значение, если оно есть в новых данных
    if (currentValue && data.some(item => item[valueField] === currentValue)) {
        select.value = currentValue;
    }
};


// Инициализация системы цветов
const initColorSystem = async (teachersCount = 12) => {
    try {
        // Динамически определяем размер палитры на основе количества преподавателей
        const paletteSize = Math.max(12, teachersCount);
        // console.log(`Загружаем палитру для ${teachersCount} преподавателей, размер: ${paletteSize}`);

        const response = await fetch(`${API_BASE}/palette/${paletteSize}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        COLOR_PALETTE = data.palette;
        // console.log(`Палитра цветов загружена (${COLOR_PALETTE.length} цветов):`, COLOR_PALETTE);
    } catch (error) {
        console.error('Ошибка загрузки палитры, используем fallback:', error);
        // Fallback палитра - генерируем нужное количество цветов
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

    // Если нужно больше цветов, чем в базовой палитре, генерируем дополнительные
    if (count <= basePalette.length) {
        return basePalette.slice(0, count);
    }

    // Генерируем дополнительные цвета
    const additionalColors = [];
    for (let i = basePalette.length; i < count; i++) {
        const hue = (i * 137.5) % 360; // Золотой угол для равномерного распределения
        const saturation = 70 + (i % 3) * 10; // 70-90%
        const lightness = 45 + (i % 2) * 10; // 45-55%
        additionalColors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
    }

    return [...basePalette, ...additionalColors];
};

// Получение цвета для преподавателя
const getTeacherColor = async (teacherName) => {
    // console.log('=== getTeacherColor called for:', teacherName);

    if (!teacherName) return '#cccccc';

    if (TEACHER_COLORS[teacherName]) {
        // Если цвет уже объект, извлекаем значение color
        const colorObj = TEACHER_COLORS[teacherName];
        const color = typeof colorObj === 'object' ? colorObj.color : colorObj;
        // console.log('✓ Color from cache:', teacherName, color);
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
            // console.log('⚠ Palette empty, initializing...');
            await initColorSystem();
        }

        const teacherHash = hashString(teacherName);
        const colorIndex = teacherHash % COLOR_PALETTE.length;
        const fallbackColor = COLOR_PALETTE[colorIndex];

        TEACHER_COLORS[teacherName] = fallbackColor;
        // console.log('✓ Local color calculated:', teacherName, fallbackColor);
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

        // Преобразуем объекты в строки цветов
        const processedData = {};
        Object.keys(data).forEach(teacher => {
            const colorObj = data[teacher];
            processedData[teacher] = typeof colorObj === 'object' ? colorObj.color : colorObj;
        });

        Object.assign(TEACHER_COLORS, processedData);
        // console.log('Цвета преподавателей загружены с сервера:', processedData);
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
        // Предзагружаем цвета для всех преподавателей
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
            // Получаем текст ошибки от сервера
            let errorText = 'Ошибка загрузки расписания';
            try {
                const errorData = await response.json();
                errorText = errorData.error || errorText;
            } catch (e) {
                // Если не удалось распарсить JSON, используем стандартный текст
                errorText = `HTTP error! status: ${response.status}`;
            }
            throw new Error(errorText);
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching schedule:', error);
        throw error; // Пробрасываем ошибку дальше
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
            // Пытаемся получить детали ошибки от сервера
            let errorText = 'Ошибка добавления расписания';
            try {
                const errorData = await response.json();
                errorText = errorData.error || errorText;
            } catch (e) {
                // Если не удалось распарсить JSON, используем статус
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
    f_room = document.getElementById('f_room'),
    f_group = document.getElementById('f_group'),
    f_course = document.getElementById('f_course'),
    btnSave = document.getElementById('btnSave'),
    btnCancel = document.getElementById('btnCancel'),
    btnDelete = document.getElementById('btnDelete');

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
let RAIL_CATEGORIES_STATE = {}; // Состояние свернутости категорий в быстром переходе
let swapMode = false; // Новый флаг для режима замены
let selectedSwapCell = null; // Выбранная ячейка для замены

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();

// Обработчик кнопки режима замены
switchModeBtn.addEventListener('click', () => {
    swapMode = !swapMode;

    if (swapMode) {
        switchModeBtn.textContent = 'Отменить замену';
        switchModeBtn.classList.remove('ghost');
        switchModeBtn.classList.add('primary');
        document.body.classList.add('swap-mode');
        showNotification('Выберите пару для замены. Кликните на ячейку с парой.', 'info');
    } else {
        switchModeBtn.textContent = 'Режим замены';
        switchModeBtn.classList.remove('primary');
        switchModeBtn.classList.add('ghost');
        document.body.classList.remove('swap-mode');
        resetSwapSelection();
    }
});

// Обработчики для модального окна замены
swapCancel.addEventListener('click', () => {
    swapModal.setAttribute('aria-hidden', 'true');
    swapModal.classList.remove('open');
    resetSwapSelection();
});
// Добавить обработчики для выбора даты и пары
// Инициализация обработчика даты при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    const swapDateInput = document.getElementById('swapDateInput');
    if (swapDateInput) {
        swapDateInput.addEventListener('change', async (e) => {
            if (swapContext) {
                swapContext.date = e.target.value;
                // Обновляем список пар для новой даты
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

    // Проверяем, не выбрана ли ТОЧНО ТА ЖЕ САМАЯ ЯЧЕЙКА
    // (тот же преподаватель, та же дата и тот же индекс пары)
    if (fromTeacher === toTeacher && pairIndex === originalPairIndex) {
        showNotification('Это та же самая ячейка. Выберите другую пару или другого преподавателя.', 'error');
        return;
    }

    // Если это тот же преподаватель, но другая пара - разрешаем
    // Это позволяет переносить пары у одного преподавателя с одного времени на другое

    // Проверяем, есть ли уже пара у этого преподавателя в выбранное время
    if (fromTeacher === toTeacher) {
        const existingPair = DATA[toTeacher]?.[date]?.[pairIndex];
        if (existingPair) {
            if (!confirm(`У преподавателя ${toTeacher} уже есть пара в это время. Заменить существующую пару?`)) {
                return;
            }
        }
    }

    // Показываем подтверждение
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
        // Показываем индикатор загрузки
        swapConfirm.disabled = true;
        swapConfirm.innerHTML = '<span style="opacity: 0.7;">Выполнение...</span>';

        // Выполняем замену на сервере
        const result = await performSwap(fromTeacher, toTeacher, date, pairIndex, scheduleId, pairId);

        if (result.success) {
            showNotification('Замена успешно выполнена', 'success');

            // Обновляем данные
            const selectedTeachers = getSelectedTeachers();
            const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
            await loadScheduleData(selectedTeachers, monthVal);

            // Закрываем модальное окно и сбрасываем режим
            swapModal.setAttribute('aria-hidden', 'true');
            swapModal.classList.remove('open');
            resetSwapSelection();
            switchModeBtn.click(); // Выключаем режим замены
        } else {
            alert('Ошибка при замене: ' + (result.error || 'Неизвестная ошибка'));
        }
    } catch (error) {
        alert('Ошибка при замене: ' + error.message);
    } finally {
        // Восстанавливаем кнопку
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
                pair_id: pairId  // Добавляем pair_id если есть
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

// Заполняем года (от текущего -5 до +5 лет)
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

    // Устанавливаем текущий год
    yearSelect.value = currentYear;
}

// Обновляем отображение даты
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

// Инициализация селекторов даты
function initDateSelectors() {
    populateYears();
    updateDateDisplay();

    // Обработчики для навигации
    document.getElementById('prevMonth')?.addEventListener('click', () => {
        saveScrollPosition();
        currentMonth--;
        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }
        updateDateDisplay();
        render(); // Используем вашу функцию render()
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

    // Обработчики для селекторов
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

    // Кнопка "Сегодня"
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

// Функция для сброса выбора замены
const resetSwapSelection = () => {
    if (selectedSwapCell) {
        selectedSwapCell.classList.remove('swap-selected');
        selectedSwapCell = null;
    }

    // Сбрасываем контекст
    swapContext = null;

    // Сбрасываем форму
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

// Функция для получения расписания пар для даты
const getPeriodsForDate = async (date) => {
    try {
        // Проверяем кэш
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

        // Fallback - используем дефолтное расписание на основе данных из periods
        return getFallbackPeriods(date);
    }
};

// Fallback функция на основе статических данных
const getFallbackPeriods = (date) => {
    // Определяем учебный год по дате
    const dateObj = new Date(date);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;

    let studyYear;
    if (month >= 9) {
        studyYear = year;
    } else {
        studyYear = year - 1;
    }

    // Дефолтное расписание на основе учебного года
    const defaultPeriods = {
        2025: [  // 2025-2026 учебный год (s_year_id = 34)
            {index: 0, pair_id: 112, name: '1-2 vac', short_name: '1-я пара', time_range: ''},
            {index: 1, pair_id: 113, name: '3-4 vac', short_name: '2-я пара', time_range: ''},
            {index: 2, pair_id: 114, name: '5-6 vac', short_name: '3-я пара', time_range: ''},
            {index: 3, pair_id: 115, name: '7-8 vac', short_name: '4-я пара', time_range: ''}
        ],
        2024: [  // 2024-2025 учебный год (s_year_id = 33)
            {index: 0, pair_id: 104, name: '1-2 vac', short_name: '1-я пара', time_range: ''},
            {index: 1, pair_id: 105, name: '3-4 vac', short_name: '2-я пара', time_range: ''},
            {index: 2, pair_id: 106, name: '5-6 vac', short_name: '3-я пара', time_range: ''},
            {index: 3, pair_id: 107, name: '7-8 vac', short_name: '4-я пара', time_range: ''}
        ]
    };

    return defaultPeriods[studyYear] || defaultPeriods[2025];
};


// Функция для рендеринга выбора пар на основе данных
const renderPairSelection = async (date, selectedPairIndex = 0) => {
    const pairSelection = document.getElementById('pairSelection');

    if (!pairSelection) return;

    try {
        // Показываем индикатор загрузки
        pairSelection.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Загрузка расписания...</div>';

        // Получаем расписание пар для даты
        const periods = await getPeriodsForDate(date);

        if (!periods || periods.length === 0) {
            pairSelection.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--danger);">Нет данных о расписании пар</div>';
            return;
        }

        // Рендерим варианты пар
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

        // Добавляем обработчики событий
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


// Функция для показа уведомлений
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

        // Собираем категории из данных преподавателей
        TEACHER_CATEGORIES = {};
        Object.keys(TEACHERS_LIST).forEach(teacherName => {
            const category = TEACHERS_LIST[teacherName].category || 'other';
            if (!TEACHER_CATEGORIES[category]) {
                TEACHER_CATEGORIES[category] = [];
            }
            TEACHER_CATEGORIES[category].push(teacherName);
        });

        // Сортируем преподавателей внутри категорий
        Object.keys(TEACHER_CATEGORIES).forEach(category => {
            TEACHER_CATEGORIES[category].sort((a, b) => a.localeCompare(b, 'ru'));
        });

        // Инициализируем систему цветов с правильным количеством преподавателей
        await initColorSystem(Object.keys(TEACHERS_LIST).length);

        // Заполняем select
        teachersSel.innerHTML = Object.keys(TEACHERS_LIST).sort((a, b) => a.localeCompare(b, 'ru'))
            .map(n => `<option value="${n}">${n}</option>`).join('');

        // Заполняем категории в мультиселекте
        renderTeacherCategories();

        // Заполняем мультиселект с цветами
        renderTeacherList('all');

        updateMsBadge();

        // Автоматически выбираем всех преподавателей, если их немного
        if (Object.keys(TEACHERS_LIST).length <= 20) {
            Object.keys(TEACHERS_LIST).forEach(n => selectedTeachers.add(n));
            allTeachersChk.checked = true;
            updateMsBadge();
        }

    } catch (error) {
        console.error('Ошибка при загрузке преподавателей:', error);
    }
};

// Рендеринг категорий преподавателей
const renderTeacherCategories = () => {
    const categories = Object.keys(TEACHER_CATEGORIES).sort();

    // Создаем красивый маппинг номеров категорий на понятные названия
    const categoryNames = {
        '1': 'ПКМ 1',
        '2': 'ПКМ 2',
        'other': 'Другие'
    };

    let categoriesHTML = `<div class="ms-category ${activeCategory === 'all' ? 'active' : ''}" data-category="all">
        Все преподаватели
    </div>`;

    categories.forEach(category => {
        const categoryName = categoryNames[category] || `Категория ${category}`;
        const count = TEACHER_CATEGORIES[category].length;
        categoriesHTML += `<div class="ms-category ${activeCategory === category ? 'active' : ''}" data-category="${category}">
            ${categoryName} <span class="category-count">(${count})</span>
        </div>`;
    });

    msCategories.innerHTML = categoriesHTML;

    // Добавляем обработчики событий для категорий
    msCategories.querySelectorAll('.ms-category').forEach(cat => {
        cat.addEventListener('click', () => {
            const category = cat.dataset.category;
            activeCategory = category;

            // Обновляем активную категорию
            msCategories.querySelectorAll('.ms-category').forEach(c =>
                c.classList.remove('active')
            );
            cat.classList.add('active');

            // Показываем соответствующий список преподавателей
            renderTeacherList(category);
        });
    });
};

// Рендеринг списка преподавателей для выбранной категории
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
    th0.textContent = 'Часы занятий';
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
            // Автоматически включаем режим редактирования для администратора
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
                        <span class="chip"><span class="dot"></span>${pair.type}</span>
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

    // Получаем цвета для всех преподавателей
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

                // Автоматически включаем режим редактирования для администратора
                if (isAdminMode()) td.classList.add('editable');
                td.dataset.teacher = tName;
                td.dataset.date = iso;
                td.dataset.index = i;
                td.dataset.teacher_mid = pair?.teacher_mid || '';

                if (pair && pair.schedule_id) {
                    td.dataset.scheduleId = pair.schedule_id;
                    td.style.backgroundColor = await findCathedraByGroupName(pair.group);
                }


                // language=HTML
                td.innerHTML = pair ?
                    `<div class="pair">
                        <div class="line">
                            <span class="chip"><span class="dot"></span>${pair.type}</span>
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
        // Получаем текст ошибки от сервера
        let errorText = 'Ошибка загрузки расписания';
        try {
            const errorData = await response.json();
            errorText = errorData.error || errorText;
        } catch (e) {
            // Если не удалось распарсить JSON, используем стандартный текст
            errorText = `HTTP error! status: ${response.status}`;
        }
        throw new Error(errorText);
    }

    return await response.json();
}

const populateJumpTeacher = async () => {
    const sel = getSelectedTeachers();

    // Создаем категории для быстрого перехода с возможностью сворачивания
    const railCategoriesHTML = Object.keys(TEACHER_CATEGORIES).map(category => {
        const categoryNames = {
            '1': 'ПКМ 1',
            '2': 'ПКМ 2',
            'other': 'Другие'
        };
        const categoryName = categoryNames[category] || `Категория ${category}`;
        const teachersInCategory = TEACHER_CATEGORIES[category].filter(t => sel.includes(t));

        if (teachersInCategory.length === 0) return '';

        const isExpanded = RAIL_CATEGORIES_STATE[category] !== false; // По умолчанию развернуто

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

    // Добавляем обработчики для сворачивания/разворачивания категорий
    railCategories.querySelectorAll('.rail-category-title').forEach(title => {
        title.addEventListener('click', (e) => {
            e.stopPropagation();
            const category = title.dataset.category;
            const isExpanded = title.classList.contains('expanded');

            // Обновляем состояние
            RAIL_CATEGORIES_STATE[category] = !isExpanded;

            // Перерисовываем быстрый переход
            populateJumpTeacher();
        });
    });

    // Добавляем обработчики для перехода к преподавателю
    railCategories.querySelectorAll('.rail-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.target;
            const el = document.getElementById(id);

            if (el) {
                // 1. Временно отключаем sticky для этого элемента
                const originalPosition = window.getComputedStyle(el).position;
                const originalTop = window.getComputedStyle(el).top;
                const originalZIndex = window.getComputedStyle(el).zIndex;

                if (el.classList.contains('section-head')) {
                    el.style.position = 'relative';
                    el.style.top = '0';
                    el.style.zIndex = 'auto';
                }

                // 2. Используем scrollIntoView с более агрессивными настройками
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                    inline: 'nearest'
                });

                // 3. Дополнительно немного поднимаем для надежности
                setTimeout(() => {
                    const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
                    window.scrollTo({
                        top: currentScroll - 50,
                        behavior: 'smooth'
                    });
                }, 300);

                // 4. Возвращаем sticky стили обратно
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

// Найдите функцию openModal в sh.js и обновите её
const openModal = (title, pairData = null) => {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const pairInfo = document.getElementById('pairInfo');
    const showRecBtn = document.getElementById('showRecommendationsBtn');

    modalTitle.textContent = title;

    // Заполняем информацию о паре
    if (pairData) {
        const hoursMap = ['1-2 пара', '3-4 пара', '5-6 пара', '7-8 пара'];

        pairInfo.innerHTML = `
            <div class="pair-info-icon">📅</div>
            <div class="pair-info-content">
                <div class="pair-info-title">${pairData.teacher} • ${pairData.date}</div>
                <div class="pair-info-value">${hoursMap[pairData.index] || `Пара ${pairData.index + 1}`}</div>
            </div>
            ${pairData.scheduleId ? '<span class="pair-info-badge">Редактирование</span>' : 
                                     '<span class="pair-info-badge">Новая пара</span>'}
        `;
    }

    // Показываем кнопку рекомендаций только для администратора
    if (showRecBtn && isAdminMode()) {
        showRecBtn.style.display = 'flex';
    }

    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');

    // Скрываем панель рекомендаций при открытии нового модального окна
    const recPanel = document.getElementById('editorRecommendationsPanel');
    if (recPanel) recPanel.style.display = 'none';
};

const closeModal = () => {
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');
};

// Обработчик клика по ячейке для редактирования
tables.addEventListener('click', async (e) => {
    const td = e.target.closest('td');
    if (!td || !td.dataset.teacher) return;
    // Сохраняем позицию ДО любых действий
    saveScrollPosition();

    // Если в режиме замены
    if (swapMode) {
        // Проверяем, есть ли пара в ячейке
        const teacher = td.dataset.teacher;
        const iso = td.dataset.date;
        const index = Number(td.dataset.index);
        const scheduleId = td.dataset.scheduleId;

        if (!scheduleId) {
            showNotification('В этой ячейке нет пары для замены', 'error');
            return;
        }

        // Снимаем выделение с предыдущей ячейки
        if (selectedSwapCell) {
            selectedSwapCell.classList.remove('swap-selected');
        }

        // Выделяем новую ячейку
        td.classList.add('swap-selected');
        selectedSwapCell = td;

        // Открываем модальное окно замены
        await openSwapModal(teacher, iso, index, scheduleId);
        return;
    }

    if (!isAdminMode() || !td.dataset.teacher) return;

    if (DISCIPLINES.length === 0) {
        await loadModalData();
    }

    const teacher = td.dataset.teacher;
    const iso = td.dataset.date;
    const index = Number(td.dataset.index);
    const scheduleId = td.dataset.scheduleId;
    const teacher_mid = td.dataset.teacher_mid;
    const period = td.dataset.period;
    const cid = td.dataset.cid;
    const rid = td.dataset.rid;
    const gid = td.dataset.gid;

    ctx = {teacher, iso, index, scheduleId, teacher_mid, period, cid, rid, gid};

    const list = (DATA[teacher]?.[iso] || []);
    const pair = list[index];

    // Получаем ID из псевдонимов
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

    // Устанавливаем значения
    if (pair) {
        f_type.value = getTypeId(pair.type);
        f_room.value = getRoomId(pair.room);
        f_group.value = getGroupId(pair.group);
        f_course.value = getCourseId(pair.course);
    } else {
        f_type.value = '';
        f_room.value = '';
        f_group.value = '';
        f_course.value = '';
    }

    btnDelete.style.display = pair && pair.schedule_id ? 'inline-flex' : 'none';

    const hoursMap = ['1 - 2', '3 - 4', '5 - 6', '7 - 8'];
    const title = `${teacher} — ${iso}`;

    // Открываем с данными пары
    openModal(title, {
        teacher: teacher,
        date: iso,
        index: index,
        scheduleId: scheduleId
    });
});

// Функция открытия модального окна замены с улучшенным интерфейсом
let openSwapModal = async (fromTeacher, date, pairIndex, scheduleId) => {
    try {
        // Получаем детали текущей пары
        const currentData = DATA[fromTeacher]?.[date]?.[pairIndex];
        if (!currentData) {
            showNotification('Не удалось получить данные о паре', 'error');
            return;
        }

        // Заполняем информацию о текущей паре
        document.getElementById('currentTeacher').textContent = fromTeacher;
        document.getElementById('currentCourse').textContent = currentData.course || 'Не указано';
        document.getElementById('currentGroup').textContent = currentData.group || 'Не указано';
        document.getElementById('currentRoom').textContent = currentData.room || 'Не указано';

        // Заполняем дату
        const swapDateInput = document.getElementById('swapDateInput');
        swapDateInput.value = date;
        swapDateInput.min = new Date().toISOString().split('T')[0];

        // Добавляем обработчик изменения даты
        swapDateInput.addEventListener('change', async (e) => {
            const newDate = e.target.value;
            if (swapContext) {
                swapContext.date = newDate;
            }

            // Обновляем список пар для новой даты
            await renderPairSelection(newDate, swapContext?.pairIndex || pairIndex);
        });

        // Рендерим выбор пар с учетом даты
        await renderPairSelection(date, pairIndex);

        // Заполняем список преподавателей
        await populateTeacherListForSwap(fromTeacher);

        // Показываем модальное окно
        swapModal.setAttribute('aria-hidden', 'false');
        swapModal.classList.add('open');
        swapModalTitle.textContent = `Замена пары: ${fromTeacher}`;

        // Сохраняем контекст замены
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

    // Очищаем список
    teachersList.innerHTML = '';

    // Получаем всех преподавателей, ВКЛЮЧАЯ текущего
    // Убираем фильтр excludeTeacher
    const allTeachers = Object.keys(TEACHERS_LIST); // Убираем .filter(teacher => teacher !== excludeTeacher)

    if (allTeachers.length === 0) {
        teachersList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Нет доступных преподавателей</div>';
        return;
    }

    // Заполняем список с цветами и категориями
    const teachersHTML = await Promise.all(allTeachers.map(async (teacherName) => {
        const category = TEACHERS_LIST[teacherName]?.category || 'other';
        const categoryNames = {
            '1': 'ПКМ 1',
            '2': 'ПКМ 2',
            'other': 'Другие'
        };

        const color = await getTeacherColor(teacherName);

        // Добавляем метку для текущего преподавателя
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

    // Добавляем обработчики выбора преподавателя
    teachersList.querySelectorAll('.teacher-option').forEach(option => {
        option.addEventListener('click', () => {
            teachersList.querySelectorAll('.teacher-option').forEach(o =>
                o.classList.remove('selected')
            );
            option.classList.add('selected');
        });
    });

    // Добавляем обработчик поиска
    const handleSearch = () => {
        const searchTerm = teacherSearch.value.toLowerCase().trim();
        teachersList.querySelectorAll('.teacher-option').forEach(option => {
            const searchText = option.dataset.search;
            const shouldShow = !searchTerm || searchText.includes(searchTerm);
            option.style.display = shouldShow ? '' : 'none';
        });
    };

    teacherSearch.addEventListener('input', handleSearch);

    // Добавляем обработчики фильтров по категориям
    document.querySelectorAll('#teacherCategories .teacher-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Обновляем активную кнопку
            document.querySelectorAll('#teacherCategories .teacher-category-btn').forEach(b =>
                b.classList.remove('active')
            );
            btn.classList.add('active');

            const selectedCategory = btn.dataset.category;

            // Показываем/скрываем преподавателей по категории
            teachersList.querySelectorAll('.teacher-option').forEach(option => {
                const category = option.dataset.category;
                const matchesCategory = selectedCategory === 'all' || category === selectedCategory;
                option.style.display = matchesCategory ? '' : 'none';
            });
        });
    });

    // Выделяем текущего преподавателя при открытии модального окна
    const currentTeacherOption = teachersList.querySelector(`.teacher-option[data-name="${excludeTeacher}"]`);
    if (currentTeacherOption) {
        currentTeacherOption.classList.add('selected');
    }
};

// Сохранение изменений
btnSave.addEventListener('click', async () => {
    if (!ctx) return;

    const {teacher, iso, index, scheduleId, teacher_mid, period, cid, rid, gid} = ctx;
    const scheduleData = {
        teacher_name: teacher,
        teacher_mid: teacher_mid,
        period: period,
        date: iso,
        pair_index: index,
        typeid: f_type.value.trim(),
        rid: f_room.value.trim(),
        gid: f_group.value.trim(),
        cid: f_course.value.trim()
    };

    if (!scheduleData.typeid || !scheduleData.rid || !scheduleData.gid || !scheduleData.cid) {
        alert('Пожалуйста, заполните все поля');
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

btnCancel.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// Двойной клик по ячейке тоже открывает редактор
tables.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td');
    if (!td || !isAdminMode() || !td.dataset.teacher) return;
    // Сохраняем позицию ДО любых действий
    saveScrollPosition();

    const teacher = td.dataset.teacher;
    const iso = td.dataset.date;
    const index = Number(td.dataset.index);
    const scheduleId = td.dataset.scheduleId;
    const teacher_mid = td.dataset.teacher_mid;
    const period = td.dataset.period;
    const cid = td.dataset.cid;
    const rid = td.dataset.rid;
    const gid = td.dataset.gid;

    ctx = {teacher, iso, index, scheduleId, teacher_mid, period, cid, rid, gid};

    const list = (DATA[teacher]?.[iso] || []);
    const pair = list[index];

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
        f_room.value = getRoomId(pair.room);
        f_group.value = getGroupId(pair.group);
        f_course.value = getCourseId(pair.course);
    } else {
        f_type.value = '';
        f_room.value = '';
        f_group.value = '';
        f_course.value = '';
    }

    btnDelete.style.display = pair && pair.schedule_id ? 'inline-flex' : 'none';

    const hoursMap = ['1 - 2', '3 - 4', '5 - 6', '7 - 8'];
    const title = `${teacher} — ${iso}`;

    openModal(title, {
        teacher: teacher,
        date: iso,
        index: index,
        scheduleId: scheduleId
    });
});
document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
/* ===== Основные функции ===== */
const applyMonth = (v) => {
    monthInput.value = v;
    monthLabel.textContent = formatMonthTitle(v);
    updateGlobalNavForMonth(v);
    // render();
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
        // автоматический рендеринг
        // await renderTable();
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
        // await renderTable();
    }
};

// Основная функция рендеринга таблицы с цветами
const renderTable = async () => {
    const sel = getSelectedTeachers(),
        monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    if (monthInput) monthInput.value = monthVal;

    tables.innerHTML = '';

    if (!sel.length) {
        // tables.innerHTML = '<p class="error">Выберите хотя бы одного преподавателя</p>';
        tables.innerHTML = '<div class="note" style="margin-top: 6px;">\n' +
            '    Выберите преподавателей и месяц, затем нажмите "Показать расписание"\n' +
            '</div>';
        await populateJumpTeacher();
        return;
    }
    // // Проверяем, есть ли данные для отображения
    // if (!DATA || Object.keys(DATA).length === 0) {
    //     tables.innerHTML = '<p class="note">Нажмите "Показать расписание" чтобы загрузить данные</p>';
    //     return;
    // }

    if (sel.length > 1) {
        const table = await renderCombinedStacked(sel, monthVal);
        tables.appendChild(table);
    } else {
        const table = await renderTeacher(sel[0], monthVal);
        tables.appendChild(table);
    }

    const todayElement = document.querySelector('.today');
    if (todayElement) {
        // Прокручиваем к элементу с плавной анимацией
        todayElement.scrollIntoView({
            behavior: 'auto',
            block: 'center',    // вертикальное выравнивание: start, center, end, nearest
            inline: 'center'    // горизонтальное выравнивание
        });
    }

    await populateJumpTeacher();
    const wrap = getWrap();
    if (wrap) {
        syncDayControlsFromScroll(wrap);
        refreshNavAutoHide();
    }
    if (pendingScrollRestore) {
        // Даем время на полный рендеринг
        setTimeout(() => forceRestoreScroll(), 100);
    }
};

const render = () => {

    const sel = getSelectedTeachers(),
        monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    if (!monthVal) return;
    // Проверяем, есть ли выбранные преподаватели
    if (sel.length === 0) {
        tables.innerHTML = '<p class="error">Выберите хотя бы одного преподавателя</p>';
        return;
    }
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
// Замените существующий обработчик printBtn.addEventListener
printBtn.addEventListener('click', () => {
    // Устанавливаем дату печати в body
    const now = new Date();
    const printDate = now.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    document.body.setAttribute('data-print-date', printDate);

    // Добавляем заголовок для печати
    const printHeader = document.createElement('div');
    printHeader.className = 'print-header';
    printHeader.innerHTML = `
        <h1>Расписание преподавателей</h1>
        <div class="print-date">Дата печати: ${printDate}</div>
    `;

    // Добавляем информацию о выбранных преподавателях
    const selectedTeachers = getSelectedTeachers();
    const monthVal = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const printInfo = document.createElement('div');
    printInfo.className = 'print-info';
    printInfo.innerHTML = `
        <strong>Период:</strong> ${formatMonthTitle(monthVal)}<br>
        <strong>Преподаватели:</strong> ${selectedTeachers.join(', ')}<br>
        <strong>Количество преподавателей:</strong> ${selectedTeachers.length}
    `;

    // Временно добавляем элементы
    const tables = document.getElementById('tables');
    if (tables.firstChild) {
        tables.insertBefore(printHeader, tables.firstChild);
        tables.insertBefore(printInfo, tables.firstChild.nextSibling);
    }

    // Вызываем печать
    window.print();

    // Удаляем временные элементы после печати
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

// openPicker.addEventListener('click', () => safeOpenMonthPicker());
//
// monthInput.addEventListener('change', () => applyMonth(monthInput.value));
//
// prevMonthBtn.addEventListener('click', () => applyMonth(shiftMonth(monthInput.value, -1)));
//
// nextMonthBtn.addEventListener('click', () => applyMonth(shiftMonth(monthInput.value, 1)));
//
// openJump.addEventListener('click', () => jumpPanel.classList.toggle('open'));
//
// applyJump.addEventListener('click', () => {
//     const y = Number(jumpYear.value) || new Date().getFullYear(),
//         m = jumpMonth.value;
//     applyMonth(`${y}-${m}`);
// });

allTeachersChk.addEventListener('change', () => {
    if (allTeachersChk.checked) {
        selectedTeachers.clear();
        Object.keys(TEACHERS_LIST).forEach(n => selectedTeachers.add(n));
    } else {
        selectedTeachers.clear();
    }
    updateMsBadge();
    renderTeacherList(activeCategory);
    // render();
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
    // render();
});

msNone.addEventListener('click', () => {
    selectedTeachers.clear();
    allTeachersChk.checked = false;
    updateMsBadge();
    renderTeacherList(activeCategory);
    // render();
});

// Выбор всей категории
msSelectCategory.addEventListener('click', () => {
    if (activeCategory === 'all') {
        // Выбрать всех преподавателей
        selectedTeachers.clear();
        Object.keys(TEACHERS_LIST).forEach(n => selectedTeachers.add(n));
    } else {
        // Выбрать всех преподавателей в текущей категории
        const categoryTeachers = TEACHER_CATEGORIES[activeCategory] || [];
        categoryTeachers.forEach(n => selectedTeachers.add(n));
    }
    allTeachersChk.checked = selectedTeachers.size === Object.keys(TEACHERS_LIST).length;
    updateMsBadge();
    renderTeacherList(activeCategory);
    // render();
});

// Глобальная навигация
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
    const courseAlias = pairData.course;  // alias дисциплины

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

    // Показываем загрузку
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

    // Проверяем наличие элемента badge (он может отсутствовать)
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

    // Получаем ID типа занятия
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

    // Если cathedra_id отсутствует в данных, получаем его через API
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

    // Получаем учебный год
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

    // Показываем панель и загрузку
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
                    // ИСПРАВЛЕНИЕ: confidence уже в процентах, не умножаем на 100
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


// Вспомогательная функция для получения дня недели
function getDayOfWeek(dateStr) {
    const date = new Date(dateStr);
    let day = date.getDay();
    // Преобразуем воскресенье с 0 на 7, понедельник 1 и т.д.
    return day === 0 ? 7 : day;
}

// Инициализация кнопок
document.addEventListener('DOMContentLoaded', function() {
    // Кнопка обычных рекомендаций
    const loadRecBtn = document.getElementById('loadRecommendations');
    if (loadRecBtn) {
        loadRecBtn.addEventListener('click', loadRecommendations);
    }

    // Кнопка ИИ рекомендаций
    const loadAIRecommendationsBtn = document.getElementById('loadAIRecommendations');
    if (loadAIRecommendationsBtn) {
        loadAIRecommendationsBtn.addEventListener('click', loadAIRecommendations);
    }

    // Кнопка закрытия панели
    const closeBtn = document.getElementById('closeRecommendations');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('recommendationsPanel').classList.remove('open');
        });
    }

    // Закрытие по Escape
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
        // МАТЕМАТИЧЕСКИЙ КОЭФФИЦИЕНТ (уже в процентах)
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

        // Определяем цвет для математического коэффициента
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
                        <span class="rec-pmk">ПКМ ${teacher.id_pmk || '?'}</span>
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
// Функция отображения ИИ рекомендаций
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
        // ИСПРАВЛЕНИЕ: confidence уже в процентах (0-100), не умножаем на 100
        const confidence = teacher.confidence || 0;
        const stats = teacher.stats || {};

        const initials = (teacher.firstname?.[0] || '') + (teacher.lastname?.[0] || '');
        const avatarColor = teacher.id_pmk === 1 ? '#667eea' : '#48bb78';

        // Округляем до целого числа
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
                        <span class="rec-pmk">ПКМ ${teacher.id_pmk || '?'}</span>
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


// Обновляем функцию выбора преподавателя
function selectRecommendedTeacher(teacherName, teacherId) {
    // Заполняем поиск
    const searchInput = document.getElementById('swapTeacherSearch');
    if (searchInput) {
        searchInput.value = teacherName;
        searchInput.dispatchEvent(new Event('input'));
    }

    // Выделяем в списке
    const teachersList = document.getElementById('swapTeachersList');
    teachersList.querySelectorAll('.teacher-option').forEach(opt => {
        opt.classList.remove('selected');
    });

    const selectedOption = teachersList.querySelector(`.teacher-option[data-name="${teacherName}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
        selectedOption.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Подсвечиваем выбранную рекомендацию
    document.querySelectorAll('.rec-item').forEach(item => {
        item.classList.remove('selected');
        if (item.querySelector('.rec-name')?.textContent.includes(teacherName)) {
            item.classList.add('selected');
        }
    });

    showNotification(`Выбран: ${teacherName}`, 'success');
}

// Инициализация
document.addEventListener('DOMContentLoaded', function() {
    // Кнопка рекомендаций
    const loadRecBtn = document.getElementById('loadRecommendations');
    if (loadRecBtn) {
        loadRecBtn.addEventListener('click', loadRecommendations);
    }

    // Кнопка закрытия панели
    const closeBtn = document.getElementById('closeRecommendations');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('recommendationsPanel').classList.remove('open');
        });
    }

    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('recommendationsPanel').classList.remove('open');
        }
    });

    // Клик вне панели
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

// Обновляем openSwapModal
const originalOpenSwapModal = openSwapModal;
openSwapModal = async function(fromTeacher, date, pairIndex, scheduleId) {
    await originalOpenSwapModal.call(this, fromTeacher, date, pairIndex, scheduleId);

    // Добавляем данные в swapContext
    const pairData = DATA[fromTeacher]?.[date]?.[pairIndex];
    if (pairData && swapContext) {
        swapContext.pairData = pairData;
    }

    // Закрываем панель рекомендаций при открытии нового окна
    document.getElementById('recommendationsPanel').classList.remove('open');
};

// Глобальная переменная для текущего типа рекомендаций
let currentRecType = 'math';

// Функция для получения рекомендаций для преподавателя (через модальное окно)
const loadPairRecommendations = async () => {
    if (!ctx) {
        showNotification('Сначала выберите ячейку для добавления пары', 'warning');
        return;
    }

    const teacherId = TEACHERS_LIST[ctx.teacher]?.id;
    if (!teacherId) {
        showNotification('Не удалось определить ID преподавателя', 'error');
        return;
    }

    // Заполняем информацию о текущей паре
    const hoursMap = ['1-2 пара', '3-4 пара', '5-6 пара', '7-8 пара'];
    document.getElementById('editorRecTeacher').textContent = ctx.teacher;
    document.getElementById('editorRecDate').textContent = ctx.iso;
    document.getElementById('editorRecPeriod').textContent = hoursMap[ctx.index] || `Пара ${ctx.index + 1}`;

    // Определяем день недели и период
    const dateObj = new Date(ctx.iso);
    const dayOfWeek = dateObj.getDay() === 0 ? 7 : dateObj.getDay();
    const periodId = await getPeriodIdForDateTime(ctx.iso, ctx.index);

    // Показываем модальное окно
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
                    const emptyText = empty.querySelector('.empty-text');
                    const emptyHint = empty.querySelector('.empty-hint');
                    if (emptyText) emptyText.textContent = 'Нет рекомендаций';
                    if (emptyHint) emptyHint.textContent = currentRecType === 'math'
                        ? 'У преподавателя пока нет истории занятий для математического анализа'
                        : 'Недостаточно данных для ИИ рекомендаций';
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
        console.error('Error loading recommendations:', error);
        if (loading) loading.style.display = 'none';
        if (empty) {
            const emptyText = empty.querySelector('.empty-text');
            const emptyHint = empty.querySelector('.empty-hint');
            if (emptyText) emptyText.textContent = 'Ошибка соединения';
            if (emptyHint) emptyHint.textContent = error.message;
            empty.style.display = 'block';
        }
    }
};

// Отображение рекомендаций в модальном окне
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

// Применение рекомендации и закрытие модального окна
const applyRecommendationAndClose = async (courseId, groupId, typeId) => {
    // Находим значения для отображения
    const course = DISCIPLINES.find(c => c.id == courseId);
    const group = GROUPS.find(g => g.id == groupId);
    const lessonType = LESSON_TYPES.find(t => t.id == typeId);

    if (course) {
        f_course.value = courseId;
        const event = new Event('change', { bubbles: true });
        f_course.dispatchEvent(event);
    }

    if (group) {
        f_group.value = groupId;
        const event = new Event('change', { bubbles: true });
        f_group.dispatchEvent(event);
    }

    if (lessonType) {
        f_type.value = typeId;
        const event = new Event('change', { bubbles: true });
        f_type.dispatchEvent(event);
    }

    // Закрываем модальное окно
    closeEditorRecModal();

    showNotification(`Рекомендация применена!`, 'success');
};

// Закрытие модального окна рекомендаций
const closeEditorRecModal = () => {
    const modal = document.getElementById('editorRecModal');
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');

    // Сбрасываем состояние
    const loading = document.getElementById('editorRecLoading');
    const list = document.getElementById('editorRecList');
    const empty = document.getElementById('editorRecEmpty');

    if (loading) loading.style.display = 'none';
    if (list) list.style.display = 'none';
    if (empty) empty.style.display = 'none';
};

// Инициализация рекомендаций в редакторе
const initEditorRecommendations = () => {
    const showRecBtn = document.getElementById('showRecommendationsBtn');
    const closeModalBtn = document.getElementById('closeEditorRecModal');
    const closeModalBtn2 = document.getElementById('closeEditorRecModalBtn');
    const recTypeTabs = document.querySelectorAll('.rec-type-tab');

    // Кнопка показа рекомендаций
    if (showRecBtn) {
        showRecBtn.addEventListener('click', () => {
            loadPairRecommendations();
        });
    }

    // Закрытие модального окна
    const closeModal = () => closeEditorRecModal();

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (closeModalBtn2) closeModalBtn2.addEventListener('click', closeModal);

    // Переключение вкладок рекомендаций
    if (recTypeTabs) {
        recTypeTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Обновляем активную вкладку
                recTypeTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Сохраняем текущий тип
                currentRecType = tab.dataset.rectype;

                // Перезагружаем рекомендации
                loadPairRecommendations();
            });
        });
    }

    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('editorRecModal');
            if (modal.getAttribute('aria-hidden') === 'false') {
                closeEditorRecModal();
            }
        }
    });

    // Закрытие при клике на overlay
    const modal = document.getElementById('editorRecModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeEditorRecModal();
            }
        });
    }
};
// Функция для получения ID периода по дате и индексу пары
const getPeriodIdForDateTime = async (date, pairIndex) => {
    try {
        const response = await fetch(`${API_BASE}/getPeriodsForDate?date=${date}`);
        const data = await response.json();
        if (data.periods && data.periods[pairIndex]) {
            return data.periods[pairIndex].pair_id;
        }
        // Fallback: возвращаем стандартные ID периодов
        const defaultPeriodIds = [112, 113, 114, 115]; // для 2025-2026 учебного года
        return defaultPeriodIds[pairIndex] || 112;
    } catch (error) {
        console.error('Error getting period ID:', error);
        // Fallback
        const defaultPeriodIds = [112, 113, 114, 115];
        return defaultPeriodIds[pairIndex] || 112;
    }
};
// Вспомогательная функция для экранирования HTML
const escapeHtml = (str) => {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/* ===== Инициализация ===== */
const init = async () => {
    try {
        // Определяем режим администратора
        const adminMode = isAdminMode();
        if (adminMode) {
            document.body.classList.add('admin-on', 'admin-mode');
            adminInfo.style.display = 'block';
            userInfo.style.display = 'none';

            // adminStatusText.textContent = 'Вы можете редактировать пары прямо в таблице.';
        } else {
            document.body.classList.remove('admin-on', 'admin-mode');
            adminInfo.style.display = 'none';
            userInfo.style.display = 'block';
            switchModeBtn.style.display = 'none';
            // adminStatusText.textContent = 'Для редактирования расписания войдите как администратор.';
        }

        await fillTeachers();
        await loadModalData();

        initDateSelectors();
        // await render();
        updateNavDisabled();
        // Добавляем обработчик Escape для отмены режима замены
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (swapMode) {
                    switchModeBtn.click();
                }
                if (modal.getAttribute('aria-hidden') === 'false') {
                    closeModal();
                }
                if (swapModal.getAttribute('aria-hidden') === 'false') {
                    swapModal.setAttribute('aria-hidden', 'true');
                    swapModal.classList.remove('open');
                    resetSwapSelection();
                }
            }
        });
        initEditorRecommendations();

    } catch (error) {
        console.error('Ошибка инициализации приложения:', error);
    }
};

// Очистка кэша цветов (для отладки)
const clearColorCache = () => {
    TEACHER_COLORS = {};
    console.log('Color cache cleared');
    render();
};

// Запуск приложения
init()
