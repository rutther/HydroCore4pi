# 用户控制、指令输出
# TODO: 实现 /api/control/on, /api/control/status 等接口

from flask import Blueprint, jsonify

control_bp = Blueprint('control', __name__)

@control_bp.route('/ping')
def ping():
    return jsonify({'message': 'control_api OK'})
