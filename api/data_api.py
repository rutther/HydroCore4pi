
# TODO: 实现 /api/data/latest 等接口

from flask import Blueprint, jsonify

data_bp = Blueprint('data', __name__)

@data_bp.route('/ping')
def ping():
    return jsonify({'message': 'data_api OK'})
