import pickle
import numpy as np


def inspect_pkl_model(file_path='teacher_recommender.pkl'):
    """Детальный просмотр PKL файла с моделью"""

    with open(file_path, 'rb') as f:
        data = pickle.load(f)

    print("\n" + "🔍" * 30)
    print("ДЕТАЛЬНЫЙ АНАЛИЗ PKL ФАЙЛА")
    print("🔍" * 30)

    # 1. Общая информация
    print(f"\n📦 Файл: {file_path}")
    print(f"📊 Тип данных: {type(data).__name__}")

    # 2. Если это словарь (как в нашем случае)
    if isinstance(data, dict):
        print(f"\n📑 Ключи словаря ({len(data.keys())}):")
        for i, key in enumerate(data.keys(), 1):
            print(f"   {i}. {key}")

        # 3. Детальный анализ каждого ключа
        for key, value in data.items():
            print(f"\n{'=' * 40}")
            print(f"🔑 Ключ: {key}")
            print(f"{'=' * 40}")
            print(f"   Тип: {type(value).__name__}")

            if key == 'model':
                if hasattr(value, 'get_params'):
                    print(f"   📈 Модель: {value.__class__.__name__}")
                    print(f"   Параметры: {value.get_params()}")
                    if hasattr(value, 'feature_importances_'):
                        print(f"   Важность признаков: {value.feature_importances_}")
                    if hasattr(value, 'n_estimators'):
                        print(f"   Количество деревьев: {value.n_estimators}")

            elif key == 'label_encoders':
                print(f"   Количество кодировщиков: {len(value)}")
                for enc_name, encoder in list(value.items())[:5]:
                    if hasattr(encoder, 'classes_'):
                        print(f"     - {enc_name}: {len(encoder.classes_)} классов")
                        print(f"       Примеры: {list(encoder.classes_)[:3]}")

            elif key == 'tfidf_vectorizer':
                print(f"   📝 TF-IDF векторизатор")
                if hasattr(value, 'vocabulary_'):
                    print(f"   Словарь: {len(value.vocabulary_)} слов")
                    print(f"   Примеры: {list(value.vocabulary_.keys())[:5]}")

            elif key == 'feature_names':
                print(f"   Количество признаков: {len(value)}")
                print(f"   Примеры: {value[:5]}")

            elif key == 'last_training_date':
                print(f"   📅 Дата обучения: {value}")

            else:
                print(f"   Значение: {value}")

    # 4. Если это объект модели
    elif hasattr(data, 'predict'):
        print(f"\n🤖 Объект модели: {data.__class__.__name__}")
        if hasattr(data, 'feature_importances_'):
            print(f"   Важность признаков: {data.feature_importances_}")
        if hasattr(data, 'classes_'):
            print(f"   Классы: {data.classes_}")

    # 5. Размер данных
    import sys
    print(f"\n💾 Размер в памяти: ~{sys.getsizeof(str(data)) / 1024:.2f} KB")

    return data


# Запуск
model_data = inspect_pkl_model('teacher_recommender.pkl')