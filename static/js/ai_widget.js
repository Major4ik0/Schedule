// ===== AI ASSISTANT WIDGET =====

function renderMarkdown(text) {
    // Жирный текст **...**
    text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    // Курсив *...*
    text = text.replace(/\*(.+?)\*/g, '<i>$1</i>');
    // Переносы строк
    text = text.replace(/\n/g, '<br>');
    return text;
}


const AIWidget = {
    isOpen: false,
    isAdmin: false,
    context: {},
    lastPrediction: null,




    init() {
        const bodyData = document.body.dataset.isAdmin;
        this.isAdmin = bodyData === 'true';
        if (!this.isAdmin && typeof IS_ADMIN_MODE !== 'undefined') {
            this.isAdmin = Boolean(IS_ADMIN_MODE);
        }
        this.bindEvents();
        this.updateContextBadge();
        this.renderQuickActions();
    },

    bindEvents() {
        document.getElementById('aiWidgetButton')?.addEventListener('click', () => this.toggle());
        document.getElementById('aiChatClose')?.addEventListener('click', () => this.close());
        document.getElementById('aiSendBtn')?.addEventListener('click', () => this.sendMessage());
        document.getElementById('aiInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // Клик вне чата — закрыть
        document.addEventListener('click', (e) => {
            if (this.isOpen && !e.target.closest('#aiChat') && !e.target.closest('#aiWidgetButton')) {
                this.close();
            }
        });
    },

    toggle() {
        this.isOpen ? this.close() : this.open();
    },

    open() {
        this.isOpen = true;
        document.getElementById('aiChat').classList.add('open');
        document.getElementById('aiInput')?.focus();
    },

    close() {
        this.isOpen = false;
        document.getElementById('aiChat').classList.remove('open');
    },

    updateContextBadge() {
        const badge = document.getElementById('aiContextBadge');
        const label = document.getElementById('aiContextLabel');

        if (this.isAdmin) {
            badge.textContent = 'администратор';
            badge.style.background = 'rgba(239, 68, 68, 0.3)';
            label.textContent = 'Режим администратора';
        } else {
            badge.textContent = 'пользователь';
            badge.style.background = 'rgba(34, 197, 94, 0.3)';
            label.textContent = 'Режим пользователя';
        }
    },

    renderQuickActions() {
        const container = document.getElementById('aiQuickActions');
        if (!container) return;

        const userActions = [
            { text: '📅 Сегодня пар нет?', query: 'Какие пары сегодня?' },
            { text: '🔍 Найти группу', query: 'Где группа ' },
            { text: '👨‍🏫 Преподаватель', query: 'Когда пара у ' },
        ];

        const adminActions = [
            { text: '🔄 Замена', query: 'Найти замену для ' },
            { text: '📊 Нагрузка', query: 'Покажи нагрузку ' },
            { text: '🤖 Рекомендации', query: 'Порекомендуй преподавателя' },
            { text: '📋 Список групп', query: 'Покажи список групп' },
        ];

        const actions = this.isAdmin ? [...userActions, ...adminActions] : userActions;

        container.innerHTML = actions.map(a =>
            `<button class="ai-quick-btn" onclick="AIWidget.quickAsk('${a.query}')">${a.text}</button>`
        ).join('');
    },

    quickAsk(query) {
        document.getElementById('aiInput').value = query;
        this.sendMessage();
    },

    async sendMessage() {
    const input = document.getElementById('aiInput');
    const sendBtn = document.getElementById('aiSendBtn');
    const message = input.value.trim();
    if (!message) return;

    // Показываем сообщение пользователя
    this.addMessage(message, 'user');
    input.value = '';
    sendBtn.disabled = true;

    // Показываем индикатор печати
    this.showTyping();

    try {
        const response = await fetch('/api/assistant/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: message,
                is_admin: this.isAdmin,
                context: this.context
            })
        });

        const data = await response.json();

        // Убираем индикатор печати
        this.hideTyping();

        if (data.success) {
            this.addMessage(data.answer, 'bot', data.intent);

            // Сохраняем контекст
            if (data.context) {
                this.context = { ...this.context, ...data.context };
            }

            // ===== АВТО-ФИДБЕК: предыдущий ответ был полезен =====
            if (this.lastPrediction && !this.lastPrediction.feedbackSent) {
                // Пользователь задал новый вопрос — предыдущий был полезен
                clearTimeout(this.lastPrediction.autoFeedbackTimer);
                this.sendFeedbackInternal(
                    this.lastPrediction.question,
                    this.lastPrediction.intent,
                    true
                );
            }

            // Сохраняем новое предсказание
            const autoFeedbackTimer = setTimeout(() => {
                if (this.lastPrediction && !this.lastPrediction.feedbackSent) {
                    this.sendFeedbackInternal(
                        this.lastPrediction.question,
                        this.lastPrediction.intent,
                        true
                    );
                    this.lastPrediction.feedbackSent = true;
                    console.log('📊 Auto-feedback sent (timeout):', this.lastPrediction.question);
                }
            }, 30000); // 30 секунд

            this.lastPrediction = {
                question: message,
                intent: data.intent,
                feedbackSent: false,
                autoFeedbackTimer: autoFeedbackTimer
            };

        } else {
            this.addMessage(data.error || 'Извините, произошла ошибка', 'bot');
        }
    } catch (error) {
        this.hideTyping();
        this.addMessage('Ошибка соединения с сервером', 'bot');
        console.error('AI Widget error:', error);
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
},

// Внутренний метод для отправки фидбека (без UI)
sendFeedbackInternal(question, intent, wasHelpful) {
    fetch('/api/assistant/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            question: question,
            predicted_intent: intent,
            was_helpful: wasHelpful
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.retrained) {
            console.log('🎓 Модель автоматически дообучена!');
        }
    })
    .catch(console.error);
},

// Обновлённый метод обратной связи от кнопок (с очисткой таймера)
sendFeedback(msgId, wasHelpful) {
    const btn = document.querySelector(`#${msgId} .thumbs-up`);
    if (btn) {
        btn.style.background = '#22c55e';
        btn.style.color = 'white';
    }

    if (this.lastPrediction && !this.lastPrediction.feedbackSent) {
        // Отменяем авто-фидбек
        clearTimeout(this.lastPrediction.autoFeedbackTimer);

        this.sendFeedbackInternal(
            this.lastPrediction.question,
            this.lastPrediction.intent,
            wasHelpful
        );

        this.lastPrediction.feedbackSent = true;
    }
},

showCorrection(msgId) {
    const correctIntent = prompt(
        'Что должен был ответить бот?\n\nВарианты:\n' +
        '• next_lesson_group - ближайшая пара у группы\n' +
        '• next_lesson_teacher - ближайшая пара у преподавателя\n' +
        '• today_schedule - расписание на сегодня\n' +
        '• find_group - найти группу\n' +
        '• list_groups - список групп\n' +
        '• workload - нагрузка\n' +
        '• swap_recommendation - замена\n' +
        '• help - помощь\n' +
        '• greeting - приветствие'
    );

    if (correctIntent && this.lastPrediction) {
        // Отменяем авто-фидбек
        clearTimeout(this.lastPrediction.autoFeedbackTimer);

        fetch('/api/assistant/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: this.lastPrediction.question,
                predicted_intent: this.lastPrediction.intent,
                correct_intent: correctIntent,
                was_helpful: false
            })
        }).then(r => r.json()).then(data => {
            if (data.retrained) {
                this.addMessage('🎓 Спасибо! Модель дообучена и стала умнее!', 'bot');
            } else {
                this.addMessage('Спасибо за обратную связь! Пример сохранён.', 'bot');
            }
        }).catch(console.error);

        this.lastPrediction.feedbackSent = true;
    }
},

    addMessage(text, sender, intent = null) {
        const container = document.getElementById('aiMessages');
        if (!container) return;

        const avatar = sender === 'user' ? '👤' : '🤖';
        const msgId = 'msg_' + Date.now();

        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-message ${sender}`;

        let actionsHTML = '';
        if (sender === 'bot') {
            actionsHTML = `
                <div class="ai-message-actions">
                    <button class="ai-action-btn thumbs-up" onclick="AIWidget.sendFeedback('${msgId}', true)" title="Полезно">👍</button>
                    <button class="ai-action-btn thumbs-down" onclick="AIWidget.showCorrection('${msgId}')" title="Не полезно">👎</button>
                </div>
            `;
        }

        msgDiv.id = msgId;
        msgDiv.innerHTML = `
            <div class="ai-message-avatar">${avatar}</div>
            <div class="ai-message-wrapper">
                <div class="ai-message-content">${renderMarkdown(text)}</div>
                ${actionsHTML}
            </div>
        `;

        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    },

    // Новые методы для обратной связи:
    sendFeedback(msgId, wasHelpful) {
        const btn = document.querySelector(`#${msgId} .thumbs-up`);
        if (btn) {
            btn.style.background = '#22c55e';
            btn.style.color = 'white';
        }

        if (this.lastPrediction) {
            fetch('/api/assistant/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: this.lastPrediction.question,
                    predicted_intent: this.lastPrediction.intent,
                    was_helpful: wasHelpful
                })
            }).catch(console.error);
        }
    },

    showCorrection(msgId) {
        const correctIntent = prompt(
            'Что должен был ответить бот?\n\nВарианты:\n' +
            '• next_lesson_group - ближайшая пара у группы\n' +
            '• next_lesson_teacher - ближайшая пара у преподавателя\n' +
            '• today_schedule - расписание на сегодня\n' +
            '• find_group - найти группу\n' +
            '• list_groups - список групп\n' +
            '• workload - нагрузка\n' +
            '• swap_recommendation - замена\n' +
            '• help - помощь\n' +
            '• greeting - приветствие'
        );

        if (correctIntent && this.lastPrediction) {
            fetch('/api/assistant/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: this.lastPrediction.question,
                    predicted_intent: this.lastPrediction.intent,
                    correct_intent: correctIntent,
                    was_helpful: false
                })
            }).then(r => r.json()).then(data => {
                if (data.retrained) {
                    this.addMessage('🎓 Спасибо! Модель дообучена и стала умнее!', 'bot');
                } else {
                    this.addMessage('Спасибо за обратную связь! Пример сохранён.', 'bot');
                }
            }).catch(console.error);
        }
    },

    showTyping() {
        const container = document.getElementById('aiMessages');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'ai-message bot';
        typingDiv.id = 'aiTypingIndicator';
        typingDiv.innerHTML = `
            <div class="ai-message-avatar">🤖</div>
            <div class="ai-message-content">
                <div class="ai-typing">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        container.appendChild(typingDiv);
        container.scrollTop = container.scrollHeight;
    },

    hideTyping() {
        document.getElementById('aiTypingIndicator')?.remove();
    }
};

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => AIWidget.init());