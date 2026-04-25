import traceback
import psycopg2
import psycopg2.extras


class DataBase:

    def __init__(self):
        self.params_connection = {
            "dbname": "organaizer12",
            "user": "postgres",
            "password": "12345678",
            "host": "10.55.12.97",
            # "host": "localhost",
            "port": "5432",
        }
        self.conn = None
        self.cursor = None

    def init(self):
        try:
            if self.conn is None or self.conn.closed:
                self.conn = psycopg2.connect(**self.params_connection)
                self.cursor = self.conn.cursor()
            return False
        except Exception:
            traceback.print_exc()
            return True

    def rollback(self):
        """Откат транзакции"""
        try:
            if self.conn and not self.conn.closed:
                self.conn.rollback()
        except Exception:
            traceback.print_exc()

    def close(self):
        """Закрытие соединения"""
        try:
            if self.cursor:
                self.cursor.close()
            if self.conn and not self.conn.closed:
                self.conn.close()
        except Exception:
            traceback.print_exc()

    def execute(self, params, *args, **kwargs):
        """ Сохраняем только один результат """
        if self.init():
            return
        try:
            with self.conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(params, *args, **kwargs)
                self.conn.commit()
                return cur
        except Exception:
            traceback.print_exc()
            self.rollback()
            return None

    def fetchone(self, params, *args, **kwargs):
        """ Получаем только один результат """
        if self.init():
            return None
        try:
            with self.conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(params, *args, **kwargs)
                row = cur.fetchone()
                return dict(row) if row is not None else None
        except Exception:
            traceback.print_exc()
            self.rollback()
            return None

    def fetchall(self, params, *args, **kwargs):
        """ Получаем все результаты """
        if self.init():
            return []
        try:
            with self.conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(params, *args, **kwargs)
                rows = cur.fetchall()
                return [dict(row) for row in rows]
        except Exception:
            traceback.print_exc()
            self.rollback()
            return []

    def execute_returning(self, query, params=None, *args, **kwargs):
        """Выполняет запрос с RETURNING и коммитит изменения"""
        if self.init():
            return None
        try:
            with self.conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(query, params)
                row = cur.fetchone()
                self.conn.commit()
                return dict(row) if row is not None else None
        except Exception as e:
            print(f"Error in execute_returning: {e}")
            traceback.print_exc()
            self.rollback()
            return None