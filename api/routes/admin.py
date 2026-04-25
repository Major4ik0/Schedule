# -*- coding: utf-8 -*-
from flask import jsonify, request, session
from api import api_bp


@api_bp.route('/check-admin-password', methods=['POST'])
def check_admin_password():
    data = request.get_json()
    login = data.get('login', '')
    psw = data.get('password', '')

    if psw == '12345678' and login == 'admin':
        session.permanent = True
        session['is_admin'] = True
        return jsonify({"success": True})

    return jsonify({"success": False, "error": 'Неверные данные'})


@api_bp.route('/debug-session')
def debug_session():
    return jsonify({
        'is_admin': session.get('is_admin', False),
        'session_id': session.get('_id', 'none'),
        'session_data': dict(session)
    })