// Основной объект приложения
const WorkloadApp = {
    // Конфигурация
    config: {
        theme: 'light',
        currentView: 'table',
        selectedTeachers: new Set(),
        currentPeriod: 'year',
        currentFaculty: 'all',
        selectedTypes: ['Л', 'ПЗ', 'С', 'ЛР', 'Э', 'КуР', 'З', 'КР'],
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
        allTeachersList: []
    },

    // Инициализация
    async init() {
        this.bindEvents();
        this.initTheme();
        await this.loadTeachers();
        await this.loadFaculties();
        await this.loadWorkload();
    },

    // Привязка событий
    bindEvents() {
        // Тема
        document.getElementById('themeToggle')?.addEventListener('click', () => this.toggleTheme());

        // Селектор преподавателей
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

        // Поиск преподавателей
        document.getElementById('teacherSearch')?.addEventListener('input', (e) => {
            this.filterTeacherList(e.target.value);
        });

        // Выбор всех/очистка
        document.getElementById('selectAllBtn')?.addEventListener('click', () => this.selectAllTeachers());
        document.getElementById('clearAllBtn')?.addEventListener('click', () => this.clearAllTeachers());

        // Периоды
        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.config.currentPeriod = btn.dataset.period;

                const customRange = document.getElementById('customDateRange');
                customRange.style.display = this.config.currentPeriod === 'custom' ? 'flex' : 'none';
            });
        });

        // Факультет
        document.getElementById('facultySelect')?.addEventListener('change', (e) => {
            this.config.currentFaculty = e.target.value;
        });

        // Типы занятий
        document.querySelectorAll('.type-checkbox input').forEach(cb => {
            cb.addEventListener('change', () => {
                this.config.selectedTypes = Array.from(
                    document.querySelectorAll('.type-checkbox input:checked')
                ).map(cb => cb.value);
            });
        });

        // Применение фильтров
        document.getElementById('applyFilters')?.addEventListener('click', () => this.loadWorkload());

        // Сброс фильтров
        document.getElementById('resetFilters')?.addEventListener('click', () => this.resetFilters());

        // Переключение вкладок
        document.querySelectorAll('.view-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const view = tab.dataset.view;
                this.switchView(view);
            });
        });

        // Экспорт
        document.getElementById('exportExcelBtn')?.addEventListener('click', () => this.exportToExcel());

        // Закрытие модального окна
        document.getElementById('closeModalBtn')?.addEventListener('click', () => this.closeModal());
        document.querySelector('.modal')?.addEventListener('click', (e) => {
            if (e.target === document.querySelector('.modal')) this.closeModal();
        });
    },

    // Загрузка преподавателей
    async loadTeachers() {
        try {
            const response = await fetch('/api/workload/getTeachers');
            this.data.allTeachersList = await response.json();

            // Категоризация преподавателей по ПМК
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

        // Категории
        categories.innerHTML = `
            <button class="cat-btn active" data-cat="all">Все</button>
            <button class="cat-btn" data-cat="1">ПКМ 1</button>
            <button class="cat-btn" data-cat="2">ПКМ 2</button>
        `;

        // Список преподавателей
        list.innerHTML = this.data.allTeachersList.map(teacher => `
            <label class="teacher-item">
                <input type="checkbox" value="${teacher.id}" data-name="${teacher.name}">
                <span class="teacher-dot" style="background: ${this.getTeacherColor(teacher.name)}"></span>
                <span class="teacher-name">${teacher.name}</span>
                <span class="teacher-cat">ПКМ ${teacher.pmk?.id || '-'}</span>
            </label>
        `).join('');

        // Обработчики категорий
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

        // Обработчики выбора
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

            this.updateStats();
            this.updateCurrentView();

            this.showNotification('Данные загружены', 'success');
        } catch (error) {
            console.error('Ошибка загрузки:', error);
            this.showNotification('Ошибка загрузки данных', 'error');
        } finally {
            this.showLoader(false);
        }
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

            return `
                <tr>
                    <td class="sticky">
                        <div class="teacher-cell">
                            <span class="teacher-dot" style="background: ${this.getTeacherColor(item.teacher_name)}"></span>
                            <span>${item.teacher_name}</span>
                        </div>
                    </td>
                    <td>${item.faculty || '-'}</td>
                    <td class="text-right">${item.lectures || 0}</td>
                    <td class="text-right">${item.practice || 0}</td>
                    <td class="text-right">${item.labs || 0}</td>
                    <td class="text-right">${item.exams || 0}</td>
                    <td class="text-right">${item.course_works || 0}</td>
                    <td class="text-right"><strong>${total}</strong></td>
                    <td>
                        <div class="progress-cell">
                            <span>${percentage}%</span>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${percentage}%; background: ${barColor}"></div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <button class="action-btn" onclick="WorkloadApp.showTeacherDetails(${item.teacher_id})">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // Рендер графиков
    renderCharts() {
        if (!this.data.workload.length) return;

        // Основной график
        const ctx1 = document.getElementById('mainChart')?.getContext('2d');
        if (ctx1) {
            if (this.mainChart) this.mainChart.destroy();

            const labels = this.data.workload.slice(0, 15).map(w => {
                const name = w.teacher_name.split(' ').slice(0, 2).join(' ');
                return name.length > 20 ? name.substring(0, 18) + '...' : name;
            });
            const data = this.data.workload.slice(0, 15).map(w => w.total_hours);
            const chartType = document.getElementById('chartTypeSelect')?.value || 'bar';

            this.mainChart = new Chart(ctx1, {
                type: chartType,
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Нагрузка (часы)',
                        data: data,
                        backgroundColor: chartType === 'bar' ? '#3b82f6' : this.generateColors(data.length),
                        borderColor: '#2563eb',
                        borderWidth: 1,
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'top' },
                        tooltip: { callbacks: { label: (ctx) => `${ctx.raw} часов` } }
                    }
                }
            });
        }

        // Трендовый график
        const ctx2 = document.getElementById('trendChart')?.getContext('2d');
        if (ctx2) {
            if (this.trendChart) this.trendChart.destroy();

            // Генерация данных по месяцам
            const months = ['Сен', 'Окт', 'Ноя', 'Дек', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн'];
            const monthlyData = this.generateMonthlyData();

            this.trendChart = new Chart(ctx2, {
                type: 'line',
                data: {
                    labels: months,
                    datasets: [{
                        label: 'Общая нагрузка',
                        data: monthlyData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'top' } }
                }
            });
        }

        // Обработчик изменения типа
        document.getElementById('chartTypeSelect')?.addEventListener('change', () => this.renderCharts());
    },

    // Генерация месячных данных
    generateMonthlyData() {
        const monthly = Array(10).fill(0);
        this.data.workload.forEach(w => {
            // Симуляция распределения по месяцам
            const randomMonth = Math.floor(Math.random() * 10);
            monthly[randomMonth] += w.total_hours / this.data.workload.length;
        });
        return monthly;
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
            const color = `hsl(${Math.abs(this.hashCode(item.teacher_name) % 360)}, 70%, 55%)`;

            return `
                <div class="teacher-card" onclick="WorkloadApp.showTeacherDetails(${item.teacher_id})">
                    <div class="card-header">
                        <div class="card-avatar" style="background: ${color}">
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
                    <div class="card-progress">
                        <div class="progress-label">
                            <span>Загрузка</span>
                            <span>${percentage}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${percentage}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    // Рендер аналитики
    renderAnalytics() {
        if (!this.data.workload.length) return;

        // Распределение по типам занятий
        const types = {
            'Лекции': 0, 'Практики': 0, 'Лабы': 0, 'Экзамены': 0, 'Курсовые': 0
        };
        this.data.workload.forEach(w => {
            types['Лекции'] += w.lectures || 0;
            types['Практики'] += w.practice || 0;
            types['Лабы'] += w.labs || 0;
            types['Экзамены'] += w.exams || 0;
            types['Курсовые'] += w.course_works || 0;
        });

        const typeDiv = document.getElementById('typeDistribution');
        if (typeDiv) {
            const maxType = Math.max(...Object.values(types));
            typeDiv.innerHTML = Object.entries(types).map(([name, value]) => `
                <div class="dist-item">
                    <span>${name}</span>
                    <div class="dist-bar">
                        <div class="dist-fill" style="width: ${(value / maxType) * 100}%"></div>
                    </div>
                    <span>${value} ч</span>
                </div>
            `).join('');
        }

        // Распределение по факультетам
        const faculties = {};
        this.data.workload.forEach(w => {
            const faculty = w.faculty || 'Другие';
            faculties[faculty] = (faculties[faculty] || 0) + w.total_hours;
        });

        const facultyDiv = document.getElementById('facultyDistribution');
        if (facultyDiv) {
            const maxFaculty = Math.max(...Object.values(faculties));
            facultyDiv.innerHTML = Object.entries(faculties).slice(0, 5).map(([name, value]) => `
                <div class="dist-item">
                    <span>${name}</span>
                    <div class="dist-bar">
                        <div class="dist-fill" style="width: ${(value / maxFaculty) * 100}%"></div>
                    </div>
                    <span>${value} ч</span>
                </div>
            `).join('');
        }

        // Топ преподавателей
        const topTeachersDiv = document.getElementById('topTeachers');
        if (topTeachersDiv) {
            const top5 = [...this.data.workload].sort((a, b) => b.total_hours - a.total_hours).slice(0, 5);
            topTeachersDiv.innerHTML = top5.map((t, i) => `
                <div class="top-item">
                    <span class="top-rank">${i + 1}</span>
                    <span class="top-name">${t.teacher_name.split(' ').slice(0, 2).join(' ')}</span>
                    <span class="top-value">${t.total_hours} ч</span>
                </div>
            `).join('');
        }

        // Коэффициент загрузки
        const loadFactorDiv = document.getElementById('loadFactor');
        if (loadFactorDiv) {
            const total = this.data.stats.totalHours || 0;
            const count = this.data.stats.teacherCount || 1;
            const avg = total / count;
            const norm = 150;
            const factor = Math.round((avg / norm) * 100);

            loadFactorDiv.innerHTML = `
                <div class="load-factor-circle">
                    <svg viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="54" fill="none" stroke="#e2e8f0" stroke-width="8"/>
                        <circle cx="60" cy="60" r="54" fill="none" stroke="#3b82f6" stroke-width="8"
                                stroke-dasharray="${factor * 3.39} ${360 - factor * 3.39}"
                                stroke-dashoffset="0" transform="rotate(-90 60 60)"/>
                    </svg>
                    <div class="factor-value">${factor}%</div>
                </div>
                <div class="factor-info">
                    <p>Средняя нагрузка: ${Math.round(avg)} ч/преп</p>
                    <p>Норма: ${norm} ч/месяц</p>
                    <p>Общая нагрузка: ${total} ч</p>
                </div>
            `;
        }
    },

    // Показать детали преподавателя
    async showTeacherDetails(teacherId) {
        this.showLoader(true);
        try {
            const response = await fetch(`/api/workload/${teacherId}/details`);
            const data = await response.json();

            this.data.currentTeacher = data;
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
        const lessons = data.lessons || [];
        const stats = data.stats || {};

        modalContent.innerHTML = `
            <div class="teacher-detail">
                <div class="detail-header">
                    <div class="detail-avatar" style="background: ${this.getTeacherColor(teacher.name)}">
                        ${this.getInitials(teacher.name)}
                    </div>
                    <div class="detail-info">
                        <h2>${teacher.name}</h2>
                        <p>${teacher.academic_degree || 'Нет степени'} • ${teacher.cathedra || 'Нет кафедры'}</p>
                        <div class="detail-stats">
                            <span>📊 ${stats.monthLessons || 0} занятий</span>
                            <span>⏱️ ${stats.monthHours || 0} часов</span>
                            <span>📈 ${stats.avgWorkload || '0%'}</span>
                        </div>
                    </div>
                </div>
                <div class="detail-lessons">
                    <h3>📅 Последние занятия</h3>
                    <div class="lessons-table">
                        <table>
                            <thead>
                                <tr><th>Дата</th><th>Дисциплина</th><th>Тип</th><th>Группа</th><th>Аудитория</th></tr>
                            </thead>
                            <tbody>
                                ${lessons.slice(0, 10).map(l => `
                                    <tr>
                                        <td>${l.date}</td>
                                        <td>${l.subject}</td>
                                        <td><span class="type-badge">${l.type}</span></td>
                                        <td>${l.group}</td>
                                        <td>${l.room || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    },

    // Закрыть модальное окно
    closeModal() {
        document.getElementById('detailModal')?.classList.remove('open');
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

        // Сброс UI
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

    generateColors(count) {
        const colors = [];
        for (let i = 0; i < count; i++) {
            colors.push(`hsl(${(i * 360 / count)}, 70%, 60%)`);
        }
        return colors;
    },

    initTheme() {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark') {
            document.body.classList.add('dark');
            document.querySelector('.sun-icon')?.style.setProperty('display', 'none');
            document.querySelector('.moon-icon')?.style.setProperty('display', 'block');
        }
    },

    toggleTheme() {
        document.body.classList.toggle('dark');
        const isDark = document.body.classList.contains('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');

        const sun = document.querySelector('.sun-icon');
        const moon = document.querySelector('.moon-icon');
        if (sun && moon) {
            sun.style.display = isDark ? 'none' : 'block';
            moon.style.display = isDark ? 'block' : 'none';
        }

        // Перерисовка графиков
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