// Основной объект приложения
const WorkloadApp = {
    // Конфигурация
    config: {
        theme: 'light',
        currentView: 'table',
        selectedTeachers: new Set(),
        currentPeriod: 'year',
        currentFaculty: 'all',
        selectedTypes: [],
        dateFrom: null,
        dateTo: null
    },

    // Данные
    data: {
        teachers: [],
        faculties: [],
        workload: [],
        stats: {},
        currentTeacher: null,
        allTeachersList: [],
        monthlyTrendData: null,
        teacherColors: new Map(),
        facultyColors: {},  // Цвета факультетов
        lessonTypes: []
    },

    // Инициализация
    async init() {
        this.bindEvents();
        this.initTheme();
        await this.loadFacultyColors();
        await this.loadLessonTypes();
        await this.loadTeachers();
        await this.loadFaculties();
        await this.loadWorkload();
    },

    // Загрузка типов занятий из БД
    async loadLessonTypes() {
        try {
            const response = await fetch('/api/workload/getLessonTypes');
            this.data.lessonTypes = await response.json();

            // Устанавливаем выбранные типы по умолчанию (все)
            this.config.selectedTypes = this.data.lessonTypes.map(t => t.alias);

            // Рендерим чекбоксы
            this.renderLessonTypes();
        } catch (error) {
            console.error('Ошибка загрузки типов занятий:', error);
            this.showNotification('Ошибка загрузки типов занятий', 'error');
        }
    },
    // Рендер типов занятий
    renderLessonTypes() {
        const container = document.getElementById('typesGrid');
        if (!container) return;

        if (!this.data.lessonTypes.length) {
            container.innerHTML = '<div class="empty-state">Нет типов занятий</div>';
            return;
        }

        container.innerHTML = this.data.lessonTypes.map(type => `
            <label class="type-checkbox" title="${type.name}">
                <input type="checkbox" value="${type.alias}" ${this.config.selectedTypes.includes(type.alias) ? 'checked' : ''}>
                <span class="type-dot" style="background: ${type.color}"></span>
                <span>${type.alias} - ${type.name.length > 30 ? type.name.substring(0, 27) + '...' : type.name}</span>
            </label>
        `).join('');

        // Обновляем счетчик
        this.updateSelectedTypesCount();

        // Добавляем обработчики
        document.querySelectorAll('#typesGrid .type-checkbox input').forEach(cb => {
            cb.addEventListener('change', () => {
                this.config.selectedTypes = Array.from(
                    document.querySelectorAll('#typesGrid .type-checkbox input:checked')
                ).map(cb => cb.value);
                this.updateSelectedTypesCount();
            });
        });

        // Обработчики для кнопок "Выбрать все" и "Снять все"
        const selectAllBtn = document.getElementById('selectAllTypes');
        const deselectAllBtn = document.getElementById('deselectAllTypes');

        if (selectAllBtn) {
            selectAllBtn.onclick = () => {
                document.querySelectorAll('#typesGrid .type-checkbox input').forEach(cb => {
                    cb.checked = true;
                });
                this.config.selectedTypes = this.data.lessonTypes.map(t => t.alias);
                this.updateSelectedTypesCount();
            };
        }

        if (deselectAllBtn) {
            deselectAllBtn.onclick = () => {
                document.querySelectorAll('#typesGrid .type-checkbox input').forEach(cb => {
                    cb.checked = false;
                });
                this.config.selectedTypes = [];
                this.updateSelectedTypesCount();
            };
        }
    },

    // Добавьте новый метод для обновления счетчика
    updateSelectedTypesCount() {
        const countSpan = document.getElementById('selectedTypesCount');
        if (countSpan) {
            const selectedCount = this.config.selectedTypes.length;
            const totalCount = this.data.lessonTypes.length;
            countSpan.textContent = `Выбрано: ${selectedCount}/${totalCount}`;
        }
    },

    // Привязка событий
    bindEvents() {
        document.getElementById('themeToggle')?.addEventListener('click', () => this.toggleTheme());

        const trigger = document.getElementById('selectorTrigger');
        const dropdown = document.getElementById('selectorDropdown');

        trigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown?.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.teacher-selector')) {
                dropdown?.classList.remove('open');
            }
        });

        document.getElementById('teacherSearch')?.addEventListener('input', (e) => {
            this.filterTeacherList(e.target.value);
        });

        document.getElementById('selectAllBtn')?.addEventListener('click', () => this.selectAllTeachers());
        document.getElementById('clearAllBtn')?.addEventListener('click', () => this.clearAllTeachers());

        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.config.currentPeriod = btn.dataset.period;

                const customRange = document.getElementById('customDateRange');
                customRange.style.display = this.config.currentPeriod === 'custom' ? 'flex' : 'none';
            });
        });

        document.getElementById('facultySelect')?.addEventListener('change', (e) => {
            this.config.currentFaculty = e.target.value;
        });

        document.querySelectorAll('.type-checkbox input').forEach(cb => {
            cb.addEventListener('change', () => {
                this.config.selectedTypes = Array.from(
                    document.querySelectorAll('.type-checkbox input:checked')
                ).map(cb => cb.value);
            });
        });

        document.getElementById('applyFilters')?.addEventListener('click', () => this.loadWorkload());
        document.getElementById('resetFilters')?.addEventListener('click', () => this.resetFilters());

        document.querySelectorAll('.view-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const view = tab.dataset.view;
                this.switchView(view);
            });
        });

        document.getElementById('exportExcelBtn')?.addEventListener('click', () => this.exportToExcel());

        document.getElementById('closeModalBtn')?.addEventListener('click', () => this.closeModal());
        document.querySelector('.modal')?.addEventListener('click', (e) => {
            if (e.target === document.querySelector('.modal')) this.closeModal();
        });

        document.getElementById('chartTypeSelect')?.addEventListener('change', () => this.renderCharts());
    },

    // Загрузка цветов факультетов
    async loadFacultyColors() {
        try {
            const response = await fetch('/api/workload/getFacultyColors');
            this.data.facultyColors = await response.json();
        } catch (error) {
            console.error('Ошибка загрузки цветов:', error);
        }
    },

    // Загрузка преподавателей
    async loadTeachers() {
        try {
            const response = await fetch('/api/workload/getTeachers');
            this.data.allTeachersList = await response.json();

            this.data.teachers = {
                all: this.data.allTeachersList.map(t => t.id),
                '1': this.data.allTeachersList.filter(t => t.pmk?.id === 1).map(t => t.id),
                '2': this.data.allTeachersList.filter(t => t.pmk?.id === 2).map(t => t.id)
            };

            this.renderTeacherSelector();
        } catch (error) {
            console.error('Ошибка загрузки преподавателей:', error);
            this.showNotification('Ошибка загрузки преподавателей', 'error');
        }
    },

    // Рендер селектора преподавателей
    renderTeacherSelector() {
        const categories = document.getElementById('teacherCategories');
        const list = document.getElementById('teacherList');

        if (!categories || !list) return;

        categories.innerHTML = `
            <button class="cat-btn active" data-cat="all">Все</button>
            <button class="cat-btn" data-cat="1">ПКМ 1</button>
            <button class="cat-btn" data-cat="2">ПКМ 2</button>
        `;

        list.innerHTML = this.data.allTeachersList.map(teacher => `
            <label class="teacher-item">
                <input type="checkbox" value="${teacher.id}" data-name="${teacher.name}">
                <span class="teacher-dot" style="background: ${this.getTeacherColor(teacher.name)}"></span>
                <span class="teacher-name">${teacher.name}</span>
                <span class="teacher-cat">ПКМ ${teacher.pmk?.id || '-'}</span>
            </label>
        `).join('');

        document.querySelectorAll('.cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const cat = btn.dataset.cat;

                document.querySelectorAll('.teacher-item').forEach(item => {
                    const input = item.querySelector('input');
                    const teacher = this.data.allTeachersList.find(t => t.id == input.value);
                    if (cat === 'all' || (teacher.pmk?.id == cat)) {
                        item.style.display = '';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        });

        document.querySelectorAll('.teacher-item input').forEach(cb => {
            cb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.config.selectedTeachers.add(parseInt(e.target.value));
                } else {
                    this.config.selectedTeachers.delete(parseInt(e.target.value));
                }
                this.updateSelectorText();
            });
        });

        this.updateSelectorText();
    },

    // Обновление текста селектора
    updateSelectorText() {
        const count = this.config.selectedTeachers.size;
        const total = this.data.allTeachersList.length;
        const textSpan = document.querySelector('.selected-text');
        const countSpan = document.querySelector('.selected-count');

        if (textSpan) {
            if (count === 0) textSpan.textContent = 'Все преподаватели';
            else if (count === total) textSpan.textContent = 'Все преподаватели';
            else textSpan.textContent = `Выбрано: ${count}`;
        }
        if (countSpan) countSpan.textContent = `${count}/${total}`;
    },

    // Фильтрация списка
    filterTeacherList(searchTerm) {
        const term = searchTerm.toLowerCase();
        document.querySelectorAll('.teacher-item').forEach(item => {
            const name = item.querySelector('.teacher-name')?.textContent.toLowerCase();
            item.style.display = name?.includes(term) ? '' : 'none';
        });
    },

    // Выбрать всех
    selectAllTeachers() {
        document.querySelectorAll('.teacher-item input').forEach(cb => {
            cb.checked = true;
            this.config.selectedTeachers.add(parseInt(cb.value));
        });
        this.updateSelectorText();
    },

    // Очистить всех
    clearAllTeachers() {
        document.querySelectorAll('.teacher-item input').forEach(cb => {
            cb.checked = false;
        });
        this.config.selectedTeachers.clear();
        this.updateSelectorText();
    },

    // Загрузка факультетов
    async loadFaculties() {
        try {
            const response = await fetch('/api/workload/getFaculties');
            this.data.faculties = await response.json();

            const select = document.getElementById('facultySelect');
            select.innerHTML = '<option value="all">Все факультеты</option>' +
                this.data.faculties.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
        } catch (error) {
            console.error('Ошибка загрузки факультетов:', error);
        }
    },

    // Загрузка нагрузки
    async loadWorkload() {
        this.showLoader(true);

        try {
            const params = {
                teachers: Array.from(this.config.selectedTeachers),
                period: this.config.currentPeriod,
                faculty: this.config.currentFaculty,
                types: this.config.selectedTypes
            };

            if (this.config.currentPeriod === 'custom') {
                params.dateFrom = document.getElementById('dateFrom').value;
                params.dateTo = document.getElementById('dateTo').value;
            }

            const response = await fetch('/api/workload/getWorkload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });

            const result = await response.json();
            this.data.workload = result.workload || [];
            this.data.stats = result.stats || {};

            this.updateTeacherColors();

            this.updateStats();
            this.updateCurrentView();

            this.data.monthlyTrendData = null;

            this.showNotification('Данные загружены', 'success');
        } catch (error) {
            console.error('Ошибка загрузки:', error);
            this.showNotification('Ошибка загрузки данных', 'error');
        } finally {
            this.showLoader(false);
        }
    },

    // Обновление цветов преподавателей на основе факультетов
    updateTeacherColors() {
        this.data.workload.forEach(teacher => {
            if (teacher.faculty_id && this.data.facultyColors[teacher.faculty_id]) {
                this.data.teacherColors.set(teacher.teacher_id, this.data.facultyColors[teacher.faculty_id]);
            } else {
                this.data.teacherColors.set(teacher.teacher_id, this.getTeacherColor(teacher.teacher_name));
            }
        });
    },

    // Получить цвет факультета по ID
    getFacultyColor(facultyId) {
        const colors = {
            37: "#F19CBB",
            41: "#F19CBB",
            42: "#396a42",
            40: "#E5BE01",
            39: "#42AAFF",
            0: "#888888"  // Цвет для "Без факультета"
        };
        return colors[facultyId] || '#3b82f6';
    },

    // Обновление статистики
    updateStats() {
        document.getElementById('totalHours').textContent = this.data.stats.totalHours || 0;
        document.getElementById('teacherCount').textContent = this.data.stats.teacherCount || 0;
        document.getElementById('totalLessons').textContent = this.data.stats.totalLessons || 0;
        document.getElementById('avgHours').textContent = this.data.stats.averageHours || 0;
    },

    // Обновление текущего представления
    updateCurrentView() {
        switch (this.config.currentView) {
            case 'table': this.renderTable(); break;
            case 'chart': this.renderCharts(); break;
            case 'cards': this.renderCards(); break;
            case 'analytics': this.renderAnalytics(); break;
        }
    },

    // Рендер таблицы
    renderTable() {
        const tbody = document.getElementById('tableBody');
        if (!tbody) return;

        if (!this.data.workload.length) {
            tbody.innerHTML = `
                <tr><td colspan="10" class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M3 6h18M3 12h18M3 18h18"/>
                    </svg>
                    <p>Нет данных для отображения</p>
                </td></tr>
            `;
            return;
        }

        tbody.innerHTML = this.data.workload.map(item => {
            const total = item.total_hours;
            const percentage = item.percentage || Math.min(100, Math.round((total / 150) * 100));
            const barColor = percentage > 80 ? '#ef4444' : (percentage > 60 ? '#f59e0b' : '#10b981');
            const teacherColor = this.data.teacherColors.get(item.teacher_id) || this.getTeacherColor(item.teacher_name);
            // Сохраняем детали по факультетам в атрибут data
            const facultiesDetail = encodeURIComponent(JSON.stringify(item.faculties_detail || []));

            return `
                <tr class="teacher-row" data-teacher-id="${item.teacher_id}" data-faculties='${JSON.stringify(item.faculties_detail || [])}' data-expanded="false">
                    <td class="sticky">
                        <div class="teacher-cell" style="cursor: pointer;" onclick="WorkloadApp.toggleTeacherDetails(${item.teacher_id}, event)">
                            <span class="expand-icon">▶</span>
                            <span class="teacher-dot" style="background: ${teacherColor}"></span>
                            <span>${item.teacher_name}</span>
                        </div>
                      </td>
                      <td>${item.faculty || '-'}</td>
                    <td class="text-right">${item.lectures || 0}</td>
                    <td class="text-right">${item.practice || 0}</td>
                    <td class="text-right">${item.seminars || 0}</td>
                    <td class="text-right">${item.labs || 0}</td>
                    <td class="text-right">${item.exams || 0}</td>
                    <td class="text-right">${item.course_works || 0}</td>
                    <td class="text-right"><strong>${total}</strong></td>
                    <td>
                        <button class="action-btn" onclick="WorkloadApp.openTeacherModal(${item.teacher_id})">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                    </td>
                </tr>
                <tr class="details-row" data-teacher-id="${item.teacher_id}" style="display: none;">
                    <td colspan="11">
                        <div class="teacher-details-container"></div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // Переключение деталей преподавателя в таблице
    async toggleTeacherDetails(teacherId, event) {
        event.stopPropagation();

        const row = document.querySelector(`tr.teacher-row[data-teacher-id="${teacherId}"]`);
        const detailsRow = document.querySelector(`tr.details-row[data-teacher-id="${teacherId}"]`);
        const expandIcon = row.querySelector('.expand-icon');

        if (detailsRow.style.display === 'none') {
            // Получаем данные из атрибута
            const facultiesData = JSON.parse(row.getAttribute('data-faculties') || '[]');
            const teacherName = row.querySelector('.teacher-cell span:last-child').textContent;
            const teacherColor = this.data.teacherColors.get(teacherId) || this.getTeacherColor(teacherName);

            const container = detailsRow.querySelector('.teacher-details-container');
            container.innerHTML = this.renderTeacherFacultiesTable(facultiesData, teacherName, teacherColor);

            detailsRow.style.display = 'table-row';
            expandIcon.textContent = '▼';
        } else {
            detailsRow.style.display = 'none';
            expandIcon.textContent = '▶';
        }
    },

    // Рендер таблицы с факультетами для преподавателя
    renderTeacherFacultiesTable(facultiesData, teacherName, teacherColor) {
        if (!facultiesData || facultiesData.length === 0) {
            return '<div class="empty-state">Нет данных о нагрузке по факультетам</div>';
        }

        const totalHours = facultiesData.reduce((sum, f) => sum + (f.total_hours || 0), 0);
        const totalLessons = facultiesData.reduce((sum, f) => sum + (f.total_lessons || 0), 0);

        return `
            <div class="teacher-faculties-detail">
                <div class="detail-summary" style="border-left: 4px solid ${teacherColor}">
                    <div class="detail-summary-info">
                        <strong>${teacherName}</strong>
                        <span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="display: inline; margin-right: 4px;">
                                <path d="M21 12v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3"/>
                                <path d="M12 2v8"/>
                                <path d="m9 7 3-3 3 3"/>
                            </svg>
                            Общая нагрузка: ${totalHours} часов (${totalLessons} занятий)
                        </span>
                    </div>
                </div>
                ${facultiesData.map(faculty => {
                    const facultyColor = this.getFacultyColor(faculty.faculty_id);
                    return `
                        <div class="faculty-group" style="border-left: 3px solid ${facultyColor}">
                            <div class="faculty-header" style="background: ${facultyColor}15">
                                <div class="faculty-name">
                                    <span class="faculty-color-dot" style="background: ${facultyColor}"></span>
                                    <strong>${faculty.faculty_name || 'Без факультета'}</strong>
                                </div>
                                <div class="faculty-total">
                                    <span class="faculty-stat">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                            <circle cx="12" cy="12" r="10"/>
                                            <polyline points="12 6 12 12 16 14"/>
                                        </svg>
                                        ${faculty.total_hours || 0} ч
                                    </span>
                                    <span class="faculty-stat">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                                            <line x1="8" y1="21" x2="16" y2="21"/>
                                            <line x1="12" y1="17" x2="12" y2="21"/>
                                        </svg>
                                        ${faculty.total_lessons || 0} зан
                                    </span>
                                </div>
                            </div>
                            <div class="faculty-stats-grid">
                                <div class="faculty-stat-item">
                                    <span class="stat-label">Лекции</span>
                                    <span class="stat-value">${faculty.lectures || 0} ч</span>
                                </div>
                                <div class="faculty-stat-item">
                                    <span class="stat-label">Практики</span>
                                    <span class="stat-value">${faculty.practice || 0} ч</span>
                                </div>
                                <div class="faculty-stat-item">
                                    <span class="stat-label">Семинары</span>
                                    <span class="stat-value">${faculty.seminars || 0} ч</span>
                                </div>
                                <div class="faculty-stat-item">
                                    <span class="stat-label">Лабораторные</span>
                                    <span class="stat-value">${faculty.labs || 0} ч</span>
                                </div>
                                <div class="faculty-stat-item">
                                    <span class="stat-label">Экзамены</span>
                                    <span class="stat-value">${faculty.exams || 0} ч</span>
                                </div>
                                <div class="faculty-stat-item">
                                    <span class="stat-label">Зачеты</span>
                                    <span class="stat-value">${faculty.tests || 0} ч</span>
                                </div>
                                <div class="faculty-stat-item">
                                    <span class="stat-label">Курсовые</span>
                                    <span class="stat-value">${faculty.course_works || 0} ч</span>
                                </div>
                                <div class="faculty-stat-item">
                                    <span class="stat-label">Контрольные</span>
                                    <span class="stat-value">${faculty.controls || 0} ч</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    // Открыть модальное окно с деталями преподавателя
    async openTeacherModal(teacherId) {
        this.showLoader(true);
        try {
            const response = await fetch(`/api/workload/${teacherId}/details`);
            const data = await response.json();

            this.renderTeacherModal(data);
            document.getElementById('detailModal')?.classList.add('open');
        } catch (error) {
            console.error('Ошибка:', error);
            this.showNotification('Ошибка загрузки деталей', 'error');
        } finally {
            this.showLoader(false);
        }
    },

    // Рендер модального окна
    renderTeacherModal(data) {
        const modalContent = document.getElementById('modalContent');
        if (!modalContent) return;

        const teacher = data.teacher_info;
        const teacherColor = this.data.teacherColors.get(teacher.id) || this.getTeacherColor(teacher.name);

        modalContent.innerHTML = `
            <div class="teacher-detail-modal">
                <div class="detail-header">
                    <div class="detail-avatar" style="background: ${teacherColor}">
                        ${this.getInitials(teacher.name)}
                    </div>
                    <div class="detail-info">
                        <h2>${teacher.name}</h2>
                        <p>${teacher.academic_degree || 'Нет степени'} • ${teacher.cathedra || 'Нет кафедры'} • ${teacher.pmk || ''}</p>
                        <div class="detail-stats">
                            <span class="stat-badge">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <circle cx="12" cy="12" r="10"/>
                                    <polyline points="12 6 12 12 16 14"/>
                                </svg>
                                ${data.total_hours || 0} часов
                            </span>
                            <span class="stat-badge">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                                    <line x1="8" y1="21" x2="16" y2="21"/>
                                    <line x1="12" y1="17" x2="12" y2="21"/>
                                </svg>
                                ${data.total_lessons || 0} занятий
                            </span>
                        </div>
                    </div>
                </div>
                <div class="detail-faculties">
                    <h3>Распределение нагрузки по факультетам</h3>
                    ${data.faculties && data.faculties.length > 0 ? data.faculties.map(faculty => {
                        const facultyColor = this.getFacultyColor(faculty.faculty_id);
                        return `
                            <div class="faculty-group" style="border-left: 3px solid ${facultyColor}">
                                <div class="faculty-header" style="background: ${facultyColor}15">
                                    <div class="faculty-name">
                                        <span class="faculty-color-dot" style="background: ${facultyColor}"></span>
                                        <strong>${faculty.faculty_name}</strong>
                                    </div>
                                    <div class="faculty-total">
                                        <span>${faculty.total_hours} часов</span>
                                        <span>${faculty.total_lessons} занятий</span>
                                    </div>
                                </div>
                                <div class="faculty-stats-grid">
                                    <div class="faculty-stat-item">
                                        <span class="stat-label">Лекции</span>
                                        <span class="stat-value">${faculty.lectures || 0} ч</span>
                                    </div>
                                    <div class="faculty-stat-item">
                                        <span class="stat-label">Практики</span>
                                        <span class="stat-value">${faculty.practice || 0} ч</span>
                                    </div>
                                    <div class="faculty-stat-item">
                                        <span class="stat-label">Лабораторные</span>
                                        <span class="stat-value">${faculty.labs || 0} ч</span>
                                    </div>
                                    <div class="faculty-stat-item">
                                        <span class="stat-label">Экзамены</span>
                                        <span class="stat-value">${faculty.exams || 0} ч</span>
                                    </div>
                                </div>
                                ${faculty.lessons && faculty.lessons.length > 0 ? `
                                    <div class="faculty-lessons">
                                        <div class="lessons-title">Детализация по дисциплинам:</div>
                                        <table class="faculty-lessons-table">
                                            <thead>
                                                <tr>
                                                    <th>Дисциплина</th>
                                                    <th>Тип</th>
                                                    <th>Группа</th>
                                                    <th>Кол-во</th>
                                                    <th>Часы</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${faculty.lessons.map(lesson => `
                                                    <tr>
                                                        <td>${lesson.course_name}</td>
                                                        <td><span class="type-badge">${lesson.lesson_type_short}</span></td>
                                                        <td>${lesson.group_name}</td>
                                                        <td class="text-right">${lesson.lessons_count}</td>
                                                        <td class="text-right">${lesson.hours}</td>
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('') : '<div class="empty-state">Нет данных</div>'}
                </div>
            </div>
        `;
    },

    // Закрыть модальное окно
    closeModal() {
        document.getElementById('detailModal')?.classList.remove('open');
    },

    // Рендер графиков
    async renderCharts() {
        this.showLoader(true);

        try {
            const params = {
                teachers: Array.from(this.config.selectedTeachers),
                period: this.config.currentPeriod,
                faculty: this.config.currentFaculty,
                types: this.config.selectedTypes
            };

            if (this.config.currentPeriod === 'custom') {
                params.dateFrom = document.getElementById('dateFrom').value;
                params.dateTo = document.getElementById('dateTo').value;
            }

            console.log('Chart params:', params);

            const response = await fetch('/api/workload/getWorkloadByFaculties', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });

            const data = await response.json();
            console.log('Chart data received:', data);

            // Сохраняем данные для использования в других методах
            this.chartData = data;

            // Очищаем контейнер графиков
            const chartContainer = document.querySelector('#chartView .chart-container');
            if (!chartContainer) return;

            // Сохраняем оригинальный HTML для графика тренда
            const trendChartHtml = document.querySelector('#chartView .chart-card:last-child')?.outerHTML || '';

            if (data.type === 'single') {
                // Один факультет - показываем один график
                chartContainer.innerHTML = `
                    <div class="chart-card chart-main">
                        <div class="chart-header">
                            <h4>Распределение нагрузки по преподавателям - ${data.faculty.faculty_name}</h4>
                            <div class="chart-controls">
                                <select id="chartTypeSelect" class="chart-type-select">
                                    <option value="bar">Столбчатая диаграмма</option>
                                    <option value="pie">Круговая диаграмма</option>
                                    <option value="doughnut">Кольцевая диаграмма</option>
                                    <option value="radar">Радарная диаграмма</option>
                                </select>
                            </div>
                        </div>
                        <div class="chart-wrapper">
                            <canvas id="mainChart"></canvas>
                        </div>
                    </div>
                    ${trendChartHtml}
                `;

                // Рендерим график для одного факультета
                this.renderSingleFacultyChart(data.faculty);
            } else {
                // Несколько факультетов - показываем несколько графиков
                let chartsHtml = '';
                for (const faculty of data.faculties) {
                    if (faculty.teachers && faculty.teachers.length > 0) {
                        chartsHtml += `
                            <div class="chart-card faculty-chart" data-faculty-id="${faculty.faculty_id}">
                                <div class="chart-header">
                                    <h4>${faculty.faculty_name}</h4>
                                    <div class="chart-controls">
                                        <select class="chart-type-select-faculty" data-faculty-id="${faculty.faculty_id}">
                                            <option value="bar">Столбчатая</option>
                                            <option value="pie">Круговая</option>
                                            <option value="doughnut">Кольцевая</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="chart-wrapper">
                                    <canvas id="chart_faculty_${faculty.faculty_id}"></canvas>
                                </div>
                            </div>
                        `;
                    }
                }

                if (chartsHtml) {
                    chartContainer.innerHTML = `
                        <div class="multi-charts-grid">
                            ${chartsHtml}
                        </div>
                        ${trendChartHtml}
                    `;

                    // Рендерим графики для каждого факультета
                    for (const faculty of data.faculties) {
                        if (faculty.teachers && faculty.teachers.length > 0) {
                            this.renderFacultyChart(faculty);
                        }
                    }

                    // Добавляем обработчики для селектов
                    document.querySelectorAll('.chart-type-select-faculty').forEach(select => {
                        select.addEventListener('change', (e) => {
                            const facultyId = e.target.dataset.facultyId;
                            const faculty = data.faculties.find(f => f.faculty_id == facultyId);
                            if (faculty) {
                                this.renderFacultyChart(faculty, e.target.value);
                            }
                        });
                    });
                } else {
                    chartContainer.innerHTML = `
                        <div class="empty-state">Нет данных для отображения графиков</div>
                        ${trendChartHtml}
                    `;
                }
            }

            // Добавляем обработчик для основного селекта (если есть)
            const mainSelect = document.getElementById('chartTypeSelect');
            if (mainSelect) {
                // Удаляем старый обработчик, чтобы не было дублирования
                const newSelect = mainSelect.cloneNode(true);
                mainSelect.parentNode.replaceChild(newSelect, mainSelect);
                newSelect.addEventListener('change', () => {
                    if (data.type === 'single') {
                        this.renderSingleFacultyChart(data.faculty, newSelect.value);
                    }
                });
            }

            // Загружаем данные тренда
            await this.loadMonthlyTrendData();

        } catch (error) {
            console.error('Ошибка загрузки графиков:', error);
            this.showNotification('Ошибка загрузки графиков', 'error');
        } finally {
            this.showLoader(false);
        }
    },

    // Рендер графика для одного факультета
    renderSingleFacultyChart(faculty, chartType = null) {
        const canvas = document.getElementById('mainChart');
        if (!canvas) {
            console.error('Canvas mainChart not found');
            return;
        }

        const ctx = canvas.getContext('2d');
        if (this.mainChart) {
            this.mainChart.destroy();
        }

        const type = chartType || document.getElementById('chartTypeSelect')?.value || 'bar';
        const teachers = faculty.teachers || [];

        if (teachers.length === 0) {
            console.warn('No teachers data for faculty:', faculty);
            return;
        }

        const topTeachers = teachers.slice(0, 15);

        const labels = topTeachers.map(t => {
            const name = t.teacher_name.split(' ').slice(0, 2).join(' ');
            return name.length > 20 ? name.substring(0, 18) + '...' : name;
        });
        const data = topTeachers.map(t => t.total_hours);

        const facultyColor = this.getFacultyColor(faculty.faculty_id);

        this.mainChart = new Chart(ctx, {
            type: type,
            data: {
                labels: labels,
                datasets: [{
                    label: `Нагрузка (часы) - ${faculty.faculty_name}`,
                    data: data,
                    backgroundColor: type === 'bar' ? facultyColor + '80' : this.generateColors(teachers.length),
                    borderColor: facultyColor,
                    borderWidth: 1,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.raw} часов`,
                            title: (tooltipItems) => {
                                const idx = tooltipItems[0].dataIndex;
                                return topTeachers[idx]?.teacher_name || '';
                            }
                        }
                    }
                }
            }
        });
    },

    // Рендер графика для факультета
    renderFacultyChart(faculty, chartType = null) {
        const canvas = document.getElementById(`chart_faculty_${faculty.faculty_id}`);
        if (!canvas) {
            console.error(`Canvas chart_faculty_${faculty.faculty_id} not found`);
            return;
        }

        const ctx = canvas.getContext('2d');

        // Уничтожаем старый график если есть
        if (this.facultyCharts && this.facultyCharts[faculty.faculty_id]) {
            this.facultyCharts[faculty.faculty_id].destroy();
        }

        const select = document.querySelector(`.chart-type-select-faculty[data-faculty-id="${faculty.faculty_id}"]`);
        const type = chartType || (select ? select.value : 'bar');

        const teachers = faculty.teachers || [];

        if (teachers.length === 0) {
            console.warn('No teachers data for faculty:', faculty);
            return;
        }

        const topTeachers = teachers.slice(0, 10);

        const labels = topTeachers.map(t => {
            const name = t.teacher_name.split(' ').slice(0, 2).join(' ');
            return name.length > 15 ? name.substring(0, 13) + '...' : name;
        });
        const data = topTeachers.map(t => t.total_hours);

        const facultyColor = this.getFacultyColor(faculty.faculty_id);

        if (!this.facultyCharts) this.facultyCharts = {};

        this.facultyCharts[faculty.faculty_id] = new Chart(ctx, {
            type: type,
            data: {
                labels: labels,
                datasets: [{
                    label: 'Часы',
                    data: data,
                    backgroundColor: type === 'bar' ? facultyColor + '80' : this.generateColors(teachers.length),
                    borderColor: facultyColor,
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 10, font: { size: 10 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.raw} часов`,
                            title: (tooltipItems) => {
                                const idx = tooltipItems[0].dataIndex;
                                return topTeachers[idx]?.teacher_name || '';
                            }
                        }
                    }
                },
                scales: type === 'bar' ? {
                    y: { beginAtZero: true, title: { display: true, text: 'Часы' } }
                } : {}
            }
        });
    },

    // Загрузка данных тренда
    async loadMonthlyTrendData() {
        try {
            const params = {
                teachers: Array.from(this.config.selectedTeachers),
                faculty: this.config.currentFaculty,
                types: this.config.selectedTypes  // ДОБАВЛЯЕМ ТИПЫ
            };

            console.log('Monthly trend params:', params);  // Для отладки

            const response = await fetch('/api/workload/getMonthlyTrend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });

            const trendData = await response.json();
            console.log('Monthly trend data:', trendData);  // Для отладки

            this.data.monthlyTrendData = trendData;

            // Обновляем график тренда
            const ctx2 = document.getElementById('trendChart')?.getContext('2d');
            if (ctx2) {
                if (this.trendChart) this.trendChart.destroy();

                const maxData = Math.max(...trendData.data, 100);

                this.trendChart = new Chart(ctx2, {
                    type: 'line',
                    data: {
                        labels: trendData.labels,
                        datasets: [{
                            label: 'Общая нагрузка (часы)',
                            data: trendData.data,
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            fill: true,
                            tension: 0.4,
                            pointBackgroundColor: trendData.data.map(v => {
                                if (v === 0) return '#cbd5e1';
                                if (v > maxData * 0.8) return '#ef4444';
                                if (v > maxData * 0.5) return '#f59e0b';
                                return '#10b981';
                            }),
                            pointRadius: 5,
                            pointHoverRadius: 7
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'top' },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => `${ctx.raw} часов`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                title: { display: true, text: 'Часы' },
                                max: maxData * 2
                            },
                            x: { title: { display: true, text: 'Месяцы' } }
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Ошибка загрузки данных тренда:', error);
        }
    },

    // Генерация цветов для круговых диаграмм
    generateColors(count) {
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#d946ef'];
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(colors[i % colors.length]);
        }
        return result;
    },

    // Рендер карточек
    renderCards() {
        const grid = document.getElementById('cardsGrid');
        if (!grid) return;

        if (!this.data.workload.length) {
            grid.innerHTML = '<div class="empty-state">Нет данных</div>';
            return;
        }

        grid.innerHTML = this.data.workload.map(item => {
            const total = item.total_hours;
            const percentage = item.percentage || Math.min(100, Math.round((total / 150) * 100));
            const teacherColor = this.data.teacherColors.get(item.teacher_id) || this.getTeacherColor(item.teacher_name);

            return `
                <div class="teacher-card" onclick="WorkloadApp.openTeacherModal(${item.teacher_id})">
                    <div class="card-header">
                        <div class="card-avatar" style="background: ${teacherColor}">
                            ${this.getInitials(item.teacher_name)}
                        </div>
                        <div class="card-info">
                            <h4>${item.teacher_name}</h4>
                            <p>${item.faculty || 'Нет факультета'}</p>
                        </div>
                    </div>
                    <div class="card-stats">
                        <div class="stat">
                            <span class="stat-value">${total}</span>
                            <span class="stat-label">часов</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">${item.lectures || 0}</span>
                            <span class="stat-label">лекций</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">${item.practice || 0}</span>
                            <span class="stat-label">практик</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">${item.labs || 0}</span>
                            <span class="stat-label">лабов</span>
                        </div>
                    </div>
                   
                </div>
            `;
        }).join('');
    },

    // Рендер аналитики
    renderAnalytics() {
        if (!this.data.workload.length) return;

        // Динамическое распределение по типам занятий из БД
        const typesMap = {};

        // Собираем данные по типам из загруженной нагрузки
        this.data.workload.forEach(teacher => {
            // Используем данные из faculties_detail для получения типов
            if (teacher.faculties_detail) {
                teacher.faculties_detail.forEach(faculty => {
                    // Здесь нужно добавить типы из деталей
                    // Так как в текущей структуре нет прямого доступа к типам,
                    // будем использовать имеющиеся поля
                    if (teacher.lectures > 0) typesMap['Лекции'] = (typesMap['Лекции'] || 0) + teacher.lectures;
                    if (teacher.practice > 0) typesMap['Практики'] = (typesMap['Практики'] || 0) + teacher.practice;
                    if (teacher.labs > 0) typesMap['Лабораторные'] = (typesMap['Лабораторные'] || 0) + teacher.labs;
                    if (teacher.exams > 0) typesMap['Экзамены'] = (typesMap['Экзамены'] || 0) + teacher.exams;
                    if (teacher.course_works > 0) typesMap['Курсовые'] = (typesMap['Курсовые'] || 0) + teacher.course_works;
                    if (teacher.seminars > 0) typesMap['Семинары'] = (typesMap['Семинары'] || 0) + teacher.seminars;
                    if (teacher.tests > 0) typesMap['Зачеты'] = (typesMap['Зачеты'] || 0) + teacher.tests;
                    if (teacher.controls > 0) typesMap['Контрольные'] = (typesMap['Контрольные'] || 0) + teacher.controls;
                });
            } else {
                // Fallback если нет faculties_detail
                if (teacher.lectures > 0) typesMap['Лекции'] = (typesMap['Лекции'] || 0) + teacher.lectures;
                if (teacher.practice > 0) typesMap['Практики'] = (typesMap['Практики'] || 0) + teacher.practice;
                if (teacher.labs > 0) typesMap['Лабораторные'] = (typesMap['Лабораторные'] || 0) + teacher.labs;
                if (teacher.exams > 0) typesMap['Экзамены'] = (typesMap['Экзамены'] || 0) + teacher.exams;
                if (teacher.course_works > 0) typesMap['Курсовые'] = (typesMap['Курсовые'] || 0) + teacher.course_works;
                if (teacher.seminars > 0) typesMap['Семинары'] = (typesMap['Семинары'] || 0) + teacher.seminars;
                if (teacher.tests > 0) typesMap['Зачеты'] = (typesMap['Зачеты'] || 0) + teacher.tests;
                if (teacher.controls > 0) typesMap['Контрольные'] = (typesMap['Контрольные'] || 0) + teacher.controls;
            }
        });

        // Фильтруем только типы с ненулевыми значениями
        const filteredTypes = Object.fromEntries(
            Object.entries(typesMap).filter(([_, value]) => value > 0)
        );

        const typeDiv = document.getElementById('typeDistribution');
        if (typeDiv) {
            if (Object.keys(filteredTypes).length === 0) {
                typeDiv.innerHTML = '<div class="empty-state">Нет данных по типам занятий</div>';
            } else {
                const maxType = Math.max(...Object.values(filteredTypes));
                typeDiv.innerHTML = Object.entries(filteredTypes).map(([name, value]) => `
                    <div class="dist-item">
                        <span>${name}</span>
                        <div class="dist-bar">
                            <div class="dist-fill" style="width: ${maxType > 0 ? (value / maxType) * 100 : 0}%"></div>
                        </div>
                        <span>${value} ч</span>
                    </div>
                `).join('');
            }
        }

        // Распределение по факультетам (оставляем как есть)
        const faculties = {};
        this.data.workload.forEach(w => {
            const faculty = w.faculty || 'Другие';
            faculties[faculty] = (faculties[faculty] || 0) + w.total_hours;
        });

        const facultyDiv = document.getElementById('facultyDistribution');
        if (facultyDiv) {
            if (Object.keys(faculties).length === 0) {
                facultyDiv.innerHTML = '<div class="empty-state">Нет данных по факультетам</div>';
            } else {
                const maxFaculty = Math.max(...Object.values(faculties));
                facultyDiv.innerHTML = Object.entries(faculties).slice(0, 5).map(([name, value]) => `
                    <div class="dist-item">
                        <span>${name}</span>
                        <div class="dist-bar">
                            <div class="dist-fill" style="width: ${maxFaculty > 0 ? (value / maxFaculty) * 100 : 0}%"></div>
                        </div>
                        <span>${value} ч</span>
                    </div>
                `).join('');
            }
        }

        // Топ преподавателей (оставляем как есть)
        const topTeachersDiv = document.getElementById('topTeachers');
        if (topTeachersDiv) {
            if (this.data.workload.length === 0) {
                topTeachersDiv.innerHTML = '<div class="empty-state">Нет данных</div>';
            } else {
                const top5 = [...this.data.workload].sort((a, b) => b.total_hours - a.total_hours).slice(0, 5);
                topTeachersDiv.innerHTML = top5.map((t, i) => `
                    <div class="top-item" onclick="WorkloadApp.openTeacherModal(${t.teacher_id})" style="cursor: pointer;">
                        <span class="top-rank">${i + 1}</span>
                        <span class="top-name">${t.teacher_name.split(' ').slice(0, 2).join(' ')}</span>
                        <span class="top-value">${t.total_hours} ч</span>
                    </div>
                `).join('');
            }
        }
    },

    // Переключение представления
    switchView(view) {
        this.config.currentView = view;

        document.querySelectorAll('.view-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });

        document.querySelectorAll('.view-content').forEach(content => {
            content.classList.toggle('active', content.id === `${view}View`);
        });

        this.updateCurrentView();
    },

    // Сброс фильтров
    resetFilters() {
        this.config.selectedTeachers.clear();
        this.config.currentPeriod = 'year';
        this.config.currentFaculty = 'all';
        this.config.selectedTypes = ['Л', 'ПЗ', 'С', 'ЛР', 'Э', 'КуР', 'З', 'КР'];

        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.period === 'year');
        });
        document.getElementById('customDateRange').style.display = 'none';
        document.getElementById('facultySelect').value = 'all';
        document.querySelectorAll('.type-checkbox input').forEach(cb => {
            cb.checked = this.config.selectedTypes.includes(cb.value);
        });

        this.selectAllTeachers();
        this.updateSelectorText();
        this.loadWorkload();
    },

    // Экспорт в Excel
    async exportToExcel() {
        this.showNotification('Подготовка файла...', 'info');

        try {
            const params = {
                teachers: Array.from(this.config.selectedTeachers),
                period: this.config.currentPeriod,
                faculty: this.config.currentFaculty,
                types: this.config.selectedTypes
            };

            if (this.config.currentPeriod === 'custom') {
                params.dateFrom = document.getElementById('dateFrom').value;
                params.dateTo = document.getElementById('dateTo').value;
            }

            const response = await fetch('/api/workload/exportExcel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });

            if (!response.ok) throw new Error('Ошибка экспорта');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `нагрузка_${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            window.URL.revokeObjectURL(url);

            this.showNotification('Экспорт завершен', 'success');
        } catch (error) {
            console.error('Ошибка экспорта:', error);
            this.showNotification('Ошибка экспорта', 'error');
        }
    },

    // Вспомогательные методы
    getInitials(name) {
        if (!name) return '??';
        return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
    },

    getTeacherColor(name) {
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
        return colors[Math.abs(this.hashCode(name) % colors.length)];
    },

    hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    },

    initTheme() {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark') {
            document.body.classList.add('dark');
            const sunIcon = document.querySelector('.sun-icon');
            const moonIcon = document.querySelector('.moon-icon');
            if (sunIcon && moonIcon) {
                sunIcon.style.display = 'none';
                moonIcon.style.display = 'block';
            }
        }
    },

    toggleTheme() {
        document.body.classList.toggle('dark');
        const isDark = document.body.classList.contains('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');

        const sunIcon = document.querySelector('.sun-icon');
        const moonIcon = document.querySelector('.moon-icon');
        if (sunIcon && moonIcon) {
            sunIcon.style.display = isDark ? 'none' : 'block';
            moonIcon.style.display = isDark ? 'block' : 'none';
        }

        if (this.config.currentView === 'chart') this.renderCharts();
    },

    showLoader(show) {
        const loader = document.getElementById('loader');
        if (loader) loader.classList.toggle('active', show);
    },

    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications') || this.createNotificationContainer();
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <span>${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
            <span>${message}</span>
        `;
        container.appendChild(notification);

        setTimeout(() => notification.remove(), 3000);
    },

    createNotificationContainer() {
        const container = document.createElement('div');
        container.id = 'notifications';
        container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 8px;';
        document.body.appendChild(container);
        return container;
    }
};

// Глобальный доступ для onclick
window.WorkloadApp = WorkloadApp;

// Запуск
document.addEventListener('DOMContentLoaded', () => WorkloadApp.init());