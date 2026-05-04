# ai_model/nlu_model.py
"""
Собственный NLU (Natural Language Understanding) для AI-ассистента.
Обучается на примерах и предсказывает намерение пользователя.
Работает полностью локально, без интернета.
"""
import os
import pickle
import numpy as np
from datetime import datetime
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder


class NLUModel:
    """
    Модель понимания естественного языка.
    Обучается на парах (вопрос, намерение).
    """

    def __init__(self, model_path='nlu_model.pkl'):
        self.model_path = model_path
        self.vectorizer = None
        self.classifier = None
        self.label_encoder = None  # <-- ДОБАВЛЕН LabelEncoder
        self.intents = []
        self.load_model()

    def _get_default_training_data(self):
        """Базовый набор обучающих данных."""
        data = [
            # Приветствия
            ("привет", "greeting"),
            ("здравствуй", "greeting"),
            ("добрый день", "greeting"),
            ("доброе утро", "greeting"),
            ("приветствую", "greeting"),
            ("здарова", "greeting"),
            ("ку", "greeting"),
            ("добрый вечер", "greeting"),

            # Помощь
            ("что ты умеешь", "help"),
            ("помощь", "help"),
            ("помоги", "help"),
            ("какие функции", "help"),
            ("что ты можешь", "help"),
            ("расскажи о себе", "help"),
            ("твои возможности", "help"),
            ("как пользоваться", "help"),

            # Ближайшая пара у группы
            ("когда пара у группы 1290", "next_lesson_group"),
            ("ближайшая пара у 1290", "next_lesson_group"),
            ("расписание группы 1290", "next_lesson_group"),
            ("когда следующая пара у 1290", "next_lesson_group"),
            ("какая ближайшая пара у 444", "next_lesson_group"),
            ("когда учиться группе 555", "next_lesson_group"),
            ("когда занятие у группы 666", "next_lesson_group"),
            ("когда пары у 777", "next_lesson_group"),
            ("расписание 888", "next_lesson_group"),
            ("когда пара у 999", "next_lesson_group"),

            # Ближайшая пара у преподавателя
            ("когда пара у иванова", "next_lesson_teacher"),
            ("когда пара у преподавателя иванова", "next_lesson_teacher"),
            ("расписание преподавателя петрова", "next_lesson_teacher"),
            ("когда ближайшая пара у сидорова", "next_lesson_teacher"),
            ("когда ведет иванов", "next_lesson_teacher"),
            ("расписание иванова", "next_lesson_teacher"),
            ("когда занятие у петрова", "next_lesson_teacher"),
            ("когда пары у кузнецова", "next_lesson_teacher"),
            ("когда работает смирнов", "next_lesson_teacher"),

            # Сегодня
            ("какие пары сегодня", "today_schedule"),
            ("что сегодня по расписанию", "today_schedule"),
            ("расписание на сегодня", "today_schedule"),
            ("сегодня есть пары", "today_schedule"),
            ("какие занятия сегодня", "today_schedule"),
            ("сегодня учимся", "today_schedule"),
            ("пар нет сегодня", "today_schedule"),
            ("что сегодня", "today_schedule"),
            ("пары на сегодня", "today_schedule"),

            # Поиск группы
            ("где группа 1290", "find_group"),
            ("найди группу 1290", "find_group"),
            ("какая группа 1290", "find_group"),
            ("информация о группе 555", "find_group"),
            ("найти 444", "find_group"),
            ("где находится 777", "find_group"),
            ("покажи группу 888", "find_group"),
            ("кто в группе 999", "find_group"),

            # Список групп
            ("список групп", "list_groups"),
            ("все группы", "list_groups"),
            ("какие есть группы", "list_groups"),
            ("перечисли группы", "list_groups"),
            ("покажи все группы", "list_groups"),
            ("какие группы существуют", "list_groups"),

            # Нагрузка
            ("покажи нагрузку", "workload"),
            ("нагрузка преподавателя", "workload"),
            ("сколько часов у иванова", "workload"),
            ("статистика нагрузки", "workload"),
            ("общая нагрузка", "workload"),
            ("нагрузка преподавателей", "workload"),
            ("сколько пар ведет петров", "workload"),
            ("часы преподавателя", "workload"),
            ("загруженность сидорова", "workload"),

            # Замена/рекомендации
            ("кого поставить на замену", "swap_recommendation"),
            ("замена преподавателя", "swap_recommendation"),
            ("порекомендуй замену", "swap_recommendation"),
            ("кто может заменить", "swap_recommendation"),
            ("найти замену", "swap_recommendation"),
            ("заменить пару", "swap_recommendation"),
            ("предложи замену", "swap_recommendation"),
            ("кто еще может провести", "swap_recommendation"),
            ("альтернативный преподаватель", "swap_recommendation"),
        ]
        return data

    def train(self, additional_data=None, model_type='mlp'):
        """Обучает модель на основе данных."""
        # Собираем все данные
        training_data = self._get_default_training_data()
        if additional_data:
            training_data.extend(additional_data)

        # Аугментация данных — создаём варианты фраз
        augmented = []
        for text, intent in training_data:
            augmented.append((text, intent))
            # Добавляем вариант с опечаткой
            if len(text) > 5:
                # Перестановка соседних букв (имитация опечатки)
                chars = list(text)
                if len(chars) > 4:
                    i = len(chars) // 2
                    chars[i], chars[i + 1] = chars[i + 1], chars[i]
                    augmented.append((''.join(chars), intent))

        training_data = augmented

        # Разделяем на X и y
        X = [item[0] for item in training_data]
        y = [item[1] for item in training_data]

        # LabelEncoder для преобразования строк в числа
        self.label_encoder = LabelEncoder()
        y_encoded = self.label_encoder.fit_transform(y)
        # Проверяем, что каждого класса минимум 2 примера
        from collections import Counter
        class_counts = Counter(y_encoded)
        rare_classes = [cls for cls, count in class_counts.items() if count < 2]

        if rare_classes:
            print(f"⚠️ Удаляю редкие классы (меньше 2 примеров): {rare_classes}")
            # Удаляем примеры с редкими классами
            mask = [y_encoded[i] not in rare_classes for i in range(len(y_encoded))]
            X = [X[i] for i in range(len(X)) if mask[i]]
            y = [y[i] for i in range(len(y)) if mask[i]]

            if len(set(y)) < 2:
                print("❌ После фильтрации осталось меньше 2 классов. Обучение невозможно.")
                return 0

            # Пересоздаём label encoder и кодируем заново
            self.label_encoder = LabelEncoder()
            y_encoded = self.label_encoder.fit_transform(y)
            self.intents = sorted(list(set(y)))

        # Сохраняем список намерений
        self.intents = sorted(list(set(y)))

        # Векторизуем текст — ВОЗВРАЩАЕМ char_wb для русского языка
        self.vectorizer = TfidfVectorizer(
            ngram_range=(1, 4),  # от 1 до 4 символов
            max_features=800,  # больше признаков
            analyzer='char_wb',  # символьный анализ (лучше для русского)
            min_df=1,
            sublinear_tf=True,  # сглаживание частот
        )
        X_vec = self.vectorizer.fit_transform(X)
        X_dense = X_vec.toarray()

        # Создаём классификатор — простая модель
        if model_type == 'mlp':
            self.classifier = MLPClassifier(
                hidden_layer_sizes=(100, 50),  # больше нейронов
                activation='relu',
                max_iter=2000,  # больше итераций
                random_state=42,
                early_stopping=True,
                validation_fraction=0.15,
                learning_rate='adaptive',
                learning_rate_init=0.01,
            )
        else:
            from sklearn.ensemble import RandomForestClassifier
            self.classifier = RandomForestClassifier(
                n_estimators=150,
                max_depth=15,
                random_state=42
            )

        # Оцениваем точность на train/test split
        X_train, X_test, y_train, y_test = train_test_split(
            X_dense, y_encoded, test_size=0.2, random_state=42, stratify=y_encoded
        )

        # Обучаем
        self.classifier.fit(X_train, y_train)
        accuracy = self.classifier.score(X_test, y_test)

        print(f"NLU Model trained. Intent count: {len(self.intents)}, "
              f"Accuracy: {accuracy:.2%}, Samples: {len(training_data)}")

        # Сохраняем модель
        self.save_model()
        return accuracy

    def predict(self, text: str, return_proba=False):
        """
        Предсказывает намерение для текста.
        """
        if not self.classifier or not self.vectorizer:
            print("Model not trained. Training on default data...")
            self.train()

        # Векторизуем текст
        X = self.vectorizer.transform([text])
        X_dense = X.toarray()  # <-- плотная матрица

        # Предсказываем
        y_pred = self.classifier.predict(X_dense)[0]

        # Декодируем обратно в строку
        intent = self.label_encoder.inverse_transform([y_pred])[0]

        if return_proba:
            proba = self.classifier.predict_proba(X_dense)[0]
            proba_dict = {
                self.label_encoder.inverse_transform([i])[0]: round(float(prob), 4)
                for i, prob in enumerate(proba)
            }
            proba_dict = dict(sorted(proba_dict.items(), key=lambda x: x[1], reverse=True))
            return intent, proba_dict

        return intent

    def add_examples(self, examples):
        """Добавляет новые примеры и дообучает модель."""
        print(f"Adding {len(examples)} new examples and retraining...")
        accuracy = self.train(additional_data=examples)
        return accuracy

    def save_model(self):
        """Сохраняет модель на диск"""
        with open(self.model_path, 'wb') as f:
            pickle.dump({
                'vectorizer': self.vectorizer,
                'classifier': self.classifier,
                'label_encoder': self.label_encoder,
                'intents': self.intents,
                'trained_at': datetime.now().isoformat()
            }, f)
        print(f"NLU Model saved to {self.model_path}")

    def load_model(self):
        """Загружает модель с диска"""
        if os.path.exists(self.model_path):
            with open(self.model_path, 'rb') as f:
                data = pickle.load(f)
                self.vectorizer = data['vectorizer']
                self.classifier = data['classifier']
                self.label_encoder = data.get('label_encoder')
                self.intents = data.get('intents', [])
                trained_at = data.get('trained_at', 'unknown')
                print(f"NLU Model loaded. Trained at: {trained_at}, Intents: {len(self.intents)}")
        else:
            print("No saved model found. Will train on first use.")


# Синглтон
nlu_model = NLUModel()


def init_nlu():
    """Инициализирует NLU модель (обучает, если нет сохранённой)"""
    if not nlu_model.classifier:
        nlu_model.train()
    return nlu_model


def get_nlu_model():
    """Возвращает синглтон NLU модели"""
    return nlu_model