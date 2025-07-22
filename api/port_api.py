# 端口的api


from flask import Blueprint, jsonify

port_bp = Blueprint('port', __name__)

@port_bp.route('/ping')
def ping():
    return jsonify({'message': 'port_api OK'})
